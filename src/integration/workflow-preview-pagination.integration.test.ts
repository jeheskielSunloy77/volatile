import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { CacheGateway } from '../main/application/ports'
import { OperationsService } from '../main/application/operations-service'
import { InMemorySecretStore } from '../main/infrastructure/secrets/in-memory-secret-store'
import {
	createSqliteDatabase,
	SqliteAlertRepository,
	SqliteConnectionRepository,
	SqliteHistoryRepository,
	SqliteMemcachedKeyIndexRepository,
	SqliteObservabilityRepository,
	SqliteSnapshotRepository,
	SqliteWorkflowExecutionRepository,
	SqliteWorkflowTemplateRepository,
} from '../main/persistence/sqlite'
import type {
	ConnectionDraft,
	ConnectionProfile,
	ConnectionSecret,
	ConnectionTestResult,
	KeyListResult,
	KeyValueRecord,
	ProviderCapabilities,
} from '../shared/contracts/cache'

const capabilities: ProviderCapabilities = {
	supportsTTL: true,
	supportsMonitorStream: false,
	supportsSlowLog: false,
	supportsBulkDeletePreview: false,
	supportsSnapshotRestore: false,
	supportsPatternScan: true,
}

const toRegex = (pattern: string): RegExp => {
	const escaped = pattern
		.replaceAll('\\', '\\\\')
		.replaceAll('.', '\\.')
		.replaceAll('*', '.*')
	return new RegExp(`^${escaped}$`)
}

class InMemoryCacheGateway implements CacheGateway {
	private readonly map = new Map<
		string,
		{ value: string; ttlSeconds: number | null }
	>()

	public async testConnection(
		profile: ConnectionDraft,
		secret: ConnectionSecret,
	): Promise<ConnectionTestResult> {
		void profile
		void secret
		return { latencyMs: 1, capabilities }
	}

	public getCapabilities(
		profile: Pick<ConnectionProfile, 'engine'>,
	): ProviderCapabilities {
		void profile
		return capabilities
	}

	public async listKeys(
		profile: ConnectionProfile,
		_secret: ConnectionSecret,
		args: { cursor?: string; limit: number },
	): Promise<KeyListResult> {
		const cursor = args.cursor ?? ''
		const keys = Array.from(this.map.keys())
			.filter((fullKey) => fullKey.startsWith(`${profile.id}:`))
			.map((fullKey) => fullKey.replace(`${profile.id}:`, ''))
			.sort()
			.filter((key) => key > cursor)
			.slice(0, args.limit)

		return {
			keys,
			nextCursor:
				keys.length === args.limit && keys.length > 0
					? keys[keys.length - 1]
					: undefined,
		}
	}

	public async searchKeys(
		profile: ConnectionProfile,
		_secret: ConnectionSecret,
		args: { pattern: string; limit: number; cursor?: string },
	): Promise<KeyListResult> {
		const cursor = args.cursor ?? ''
		const matcher = toRegex(args.pattern)
		const keys = Array.from(this.map.keys())
			.filter((fullKey) => fullKey.startsWith(`${profile.id}:`))
			.map((fullKey) => fullKey.replace(`${profile.id}:`, ''))
			.filter((key) => matcher.test(key))
			.sort()
			.filter((key) => key > cursor)
			.slice(0, args.limit)

		return {
			keys,
			nextCursor:
				keys.length === args.limit && keys.length > 0
					? keys[keys.length - 1]
					: undefined,
		}
	}

	public async countKeys(
		profile: ConnectionProfile,
		_secret: ConnectionSecret,
	): Promise<{ totalKeys: number }> {
		void _secret
		const totalKeys = Array.from(this.map.keys()).filter((fullKey) =>
			fullKey.startsWith(`${profile.id}:`),
		).length

		return {
			totalKeys,
		}
	}

	public async countKeysByPattern(
		profile: ConnectionProfile,
		_secret: ConnectionSecret,
		args: { pattern: string },
	): Promise<{ totalKeys: number; totalFoundKeys: number }> {
		void _secret
		const matcher = toRegex(args.pattern)
		const keys = Array.from(this.map.keys())
			.filter((fullKey) => fullKey.startsWith(`${profile.id}:`))
			.map((fullKey) => fullKey.replace(`${profile.id}:`, ''))
		const totalFoundKeys = keys.filter((key) => matcher.test(key)).length

		return {
			totalKeys: keys.length,
			totalFoundKeys,
		}
	}

	public async getValue(
		profile: ConnectionProfile,
		_secret: ConnectionSecret,
		key: string,
	): Promise<KeyValueRecord> {
		const stored = this.map.get(`${profile.id}:${key}`)
		return {
			key,
			value: stored?.value ?? null,
			ttlSeconds: stored?.ttlSeconds ?? null,
			supportsTTL: true,
		}
	}

	public async setValue(
		profile: ConnectionProfile,
		_secret: ConnectionSecret,
		args: { key: string; value: string; ttlSeconds?: number },
	): Promise<void> {
		this.map.set(`${profile.id}:${args.key}`, {
			value: args.value,
			ttlSeconds: args.ttlSeconds ?? null,
		})
	}

	public async deleteKey(
		profile: ConnectionProfile,
		_secret: ConnectionSecret,
		key: string,
	): Promise<void> {
		this.map.delete(`${profile.id}:${key}`)
	}

	public async flush(
		profile: ConnectionProfile,
		_secret: ConnectionSecret,
		args: { scope: 'database' | 'namespace'; keyPrefix?: string },
	): Promise<void> {
		void profile
		void args
	}

	public async pollEngineEvents(
		profile: ConnectionProfile,
		_secret: ConnectionSecret,
		args: { cursor?: string; limit: number },
	): Promise<{ events: []; nextCursor?: string }> {
		void profile
		void args.limit
		return {
			events: [],
			nextCursor: args.cursor,
		}
	}
}

type TestContext = {
	close: () => void
}

const contexts: TestContext[] = []

afterEach(() => {
	while (contexts.length > 0) {
		const context = contexts.pop()
		context?.close()
	}
})

describe('workflow preview pagination integration', () => {
	it('returns next cursor and supports paging across preview requests', async () => {
		const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'volatile-intg-'))
		const dbPath = path.join(tempDirectory, 'integration.db')
		const db = createSqliteDatabase(dbPath)
		contexts.push({
			close: () => {
				db.close()
				fs.rmSync(tempDirectory, { recursive: true, force: true })
			},
		})

		const connectionRepository = new SqliteConnectionRepository(db)
		const memcachedKeyIndexRepository = new SqliteMemcachedKeyIndexRepository(db)
		const snapshotRepository = new SqliteSnapshotRepository(db)
		const workflowTemplateRepository = new SqliteWorkflowTemplateRepository(db)
		const workflowExecutionRepository = new SqliteWorkflowExecutionRepository(db)
		const historyRepository = new SqliteHistoryRepository(db)
		const observabilityRepository = new SqliteObservabilityRepository(db)
		const alertRepository = new SqliteAlertRepository(db)

		const service = new OperationsService(
			connectionRepository,
			new InMemorySecretStore(),
			memcachedKeyIndexRepository,
			new InMemoryCacheGateway(),
			{
				snapshotRepository,
				workflowTemplateRepository,
				workflowExecutionRepository,
				historyRepository,
				observabilityRepository,
				alertRepository,
			},
		)

		const profile = await service.createConnection({
			profile: {
				name: 'Integration Redis',
				engine: 'redis',
				host: '127.0.0.1',
				port: 6379,
				dbIndex: 0,
				tlsEnabled: false,
				environment: 'dev',
				tags: [],
				readOnly: false,
				timeoutMs: 5000,
				retryMaxAttempts: 1,
				retryBackoffMs: 0,
				retryBackoffStrategy: 'fixed',
				retryAbortOnErrorRate: 1,
			},
			secret: {
				password: 'secret',
			},
		})

		await service.setKey({
			connectionId: profile.id,
			key: 'user:1',
			value: 'value-1',
		})
		await service.setKey({
			connectionId: profile.id,
			key: 'user:2',
			value: 'value-2',
		})

		const firstPage = await service.previewWorkflow({
			connectionId: profile.id,
			template: {
				name: 'Delete Users',
				kind: 'deleteByPattern',
				parameters: {
					pattern: 'user:*',
					limit: 1,
				},
				requiresApprovalOnProd: true,
				supportsDryRun: true,
			},
			limit: 1,
		})

		expect(firstPage.items).toHaveLength(1)
		expect(firstPage.nextCursor).toBeDefined()

		const secondPage = await service.previewWorkflow({
			connectionId: profile.id,
			template: {
				name: 'Delete Users',
				kind: 'deleteByPattern',
				parameters: {
					pattern: 'user:*',
					limit: 1,
				},
				requiresApprovalOnProd: true,
				supportsDryRun: true,
			},
			cursor: firstPage.nextCursor,
			limit: 1,
		})

		expect(secondPage.items).toHaveLength(1)
		expect(secondPage.items[0].key).not.toBe(firstPage.items[0].key)
	})
})
