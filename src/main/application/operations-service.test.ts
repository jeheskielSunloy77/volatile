import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import type {
	ConnectionCreateRequest,
	CacheFlushScope,
	ConnectionProfile,
	ConnectionSecret,
	ProviderCapabilities,
	RetentionPolicy,
	StorageSummary,
} from '../../shared/contracts/cache'
import { isRedisFamilyEngine } from '../../shared/lib/cache-engines'

import { OperationFailure } from '../domain/operation-failure'
import { OperationsService } from './operations-service'
import type {
	CacheGateway,
	ConnectionRepository,
	EngineEventIngestor,
	MemcachedKeyIndexRepository,
	RetentionRepository,
	SecretStore,
} from './ports'

class InMemoryConnectionRepository implements ConnectionRepository {
	private readonly map = new Map<string, ConnectionProfile>()

	public async list(): Promise<ConnectionProfile[]> {
		return Array.from(this.map.values())
	}

	public async findById(id: string): Promise<ConnectionProfile | null> {
		return this.map.get(id) ?? null
	}

	public async save(profile: ConnectionProfile): Promise<void> {
		this.map.set(profile.id, profile)
	}

	public async delete(id: string): Promise<void> {
		this.map.delete(id)
	}
}

class InMemorySecretStore implements SecretStore {
	public readonly map = new Map<string, ConnectionSecret>()

	public async saveSecret(
		profileId: string,
		secret: ConnectionSecret,
	): Promise<void> {
		this.map.set(profileId, secret)
	}

	public async getSecret(profileId: string): Promise<ConnectionSecret> {
		const secret = this.map.get(profileId)
		if (!secret) {
			throw new Error('missing secret')
		}

		return secret
	}

	public async deleteSecret(profileId: string): Promise<void> {
		this.map.delete(profileId)
	}
}

class InMemoryMemcachedIndexRepository implements MemcachedKeyIndexRepository {
	public async listKeys(connectionId: string, limit: number): Promise<string[]> {
		void connectionId
		void limit
		return []
	}

	public async countKeys(connectionId: string): Promise<number> {
		void connectionId
		return 0
	}

	public async searchKeys(
		connectionId: string,
		pattern: string,
		limit: number,
		cursor?: string,
	): Promise<string[]> {
		void connectionId
		void pattern
		void limit
		void cursor
		return []
	}

	public async countKeysByPattern(
		connectionId: string,
		pattern: string,
	): Promise<number> {
		void connectionId
		void pattern
		return 0
	}

	public async upsertKey(connectionId: string, key: string): Promise<void> {
		void connectionId
		void key
	}

	public async removeKey(connectionId: string, key: string): Promise<void> {
		void connectionId
		void key
	}

	public async deleteByConnectionId(connectionId: string): Promise<void> {
		void connectionId
	}
}

const capabilities: ProviderCapabilities = {
	supportsTTL: true,
	supportsMonitorStream: false,
	supportsSlowLog: false,
	supportsBulkDeletePreview: false,
	supportsSnapshotRestore: false,
	supportsPatternScan: true,
}

const createGatewayMock = (overrides?: Partial<CacheGateway>): CacheGateway => {
	const base: CacheGateway = {
		testConnection: vi.fn(async () => ({ latencyMs: 5, capabilities })),
		getCapabilities: vi.fn(() => capabilities),
		listKeys: vi.fn(async () => ({ keys: [], nextCursor: undefined })),
		searchKeys: vi.fn(async () => ({ keys: [], nextCursor: undefined })),
		countKeys: vi.fn(async () => ({ totalKeys: 0 })),
		countKeysByPattern: vi.fn(async () => ({ totalKeys: 0, totalFoundKeys: 0 })),
		getValue: vi.fn(async (profile, _secret, key) => ({
			key,
			value: null,
			ttlSeconds: null,
			supportsTTL: isRedisFamilyEngine(profile.engine),
		})),
		setValue: vi.fn(async () => undefined),
		deleteKey: vi.fn(async () => undefined),
		flush: vi.fn(async () => undefined),
		pollEngineEvents: vi.fn(async (_profile, _secret, args) => ({
			events: [],
			nextCursor: args.cursor,
		})),
	}

	return {
		...base,
		...overrides,
	}
}

const createConnectionPayload = (): ConnectionCreateRequest => ({
	profile: {
		name: 'local redis',
		engine: 'redis',
		host: '127.0.0.1',
		port: 6379,
		dbIndex: 0,
		tlsEnabled: false,
		environment: 'dev',
		tags: ['local'],
		readOnly: false,
		forceReadOnly: false,
		timeoutMs: 5000,
		retryMaxAttempts: 2,
		retryBackoffMs: 10,
		retryBackoffStrategy: 'fixed',
		retryAbortOnErrorRate: 1,
	},
	secret: {
		password: 'secret',
	},
})

const createFlushArgs = (scope: CacheFlushScope) => ({
	connectionId: 'flush-connection',
	scope,
	guardrailConfirmed: true,
})

const createStoredProfile = (): ConnectionProfile => ({
	id: 'stored-1',
	name: 'stored redis',
	engine: 'redis',
	host: '127.0.0.1',
	port: 6379,
	dbIndex: 0,
	tlsEnabled: false,
	environment: 'dev',
	tags: [],
	secretRef: 'stored-1',
	readOnly: false,
	forceReadOnly: false,
	timeoutMs: 5000,
	retryMaxAttempts: 2,
	retryBackoffMs: 10,
	retryBackoffStrategy: 'fixed',
	retryAbortOnErrorRate: 1,
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString(),
})

describe('OperationsService', () => {
	it('creates and stores connection profiles with keychain references', async () => {
		const repository = new InMemoryConnectionRepository()
		const secretStore = new InMemorySecretStore()
		const memcachedIndex = new InMemoryMemcachedIndexRepository()
		const gateway = createGatewayMock()

		const service = new OperationsService(
			repository,
			secretStore,
			memcachedIndex,
			gateway,
		)

		const created = await service.createConnection(createConnectionPayload())

		expect(created.id).toBeTruthy()
		expect(created.secretRef).toBe(created.id)

		const stored = await repository.findById(created.id)
		expect(stored?.name).toBe('local redis')
		expect(secretStore.map.get(created.id)?.password).toBe('secret')
	})

	it('blocks writes on read-only profiles', async () => {
		const repository = new InMemoryConnectionRepository()
		const secretStore = new InMemorySecretStore()
		const memcachedIndex = new InMemoryMemcachedIndexRepository()
		const setValueMock = vi.fn(async () => undefined)
		const gateway = createGatewayMock({ setValue: setValueMock })

		const profile: ConnectionProfile = {
			id: 'readonly-1',
			name: 'readonly redis',
			engine: 'redis',
			host: '127.0.0.1',
			port: 6379,
			dbIndex: 0,
			tlsEnabled: false,
			environment: 'dev',
			tags: [],
			secretRef: 'readonly-1',
			readOnly: true,
			forceReadOnly: false,
			timeoutMs: 5000,
			retryMaxAttempts: 2,
			retryBackoffMs: 10,
			retryBackoffStrategy: 'fixed',
			retryAbortOnErrorRate: 1,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		}

		await repository.save(profile)
		await secretStore.saveSecret(profile.id, { password: 'secret' })

		const service = new OperationsService(
			repository,
			secretStore,
			memcachedIndex,
			gateway,
		)

		await expect(
			service.setKey({
				connectionId: profile.id,
				key: 'test:key',
				value: 'value',
			}),
		).rejects.toBeInstanceOf(OperationFailure)

		expect(setValueMock).not.toHaveBeenCalled()
	})

	it('passes typed Redis key payloads through to the cache gateway', async () => {
		const repository = new InMemoryConnectionRepository()
		const secretStore = new InMemorySecretStore()
		const memcachedIndex = new InMemoryMemcachedIndexRepository()
		const setValueMock = vi.fn(async () => undefined)
		const gateway = createGatewayMock({ setValue: setValueMock })

		const profile: ConnectionProfile = {
			...createStoredProfile(),
			id: 'typed-write-1',
			secretRef: 'typed-write-1',
		}

		await repository.save(profile)
		await secretStore.saveSecret(profile.id, { password: 'secret' })

		const service = new OperationsService(
			repository,
			secretStore,
			memcachedIndex,
			gateway,
		)

		await service.setKey({
			connectionId: profile.id,
			key: 'user:123',
			value: {
				kind: 'hash',
				entries: [
					{ field: 'id', value: '123' },
					{ field: 'status', value: 'active' },
				],
			},
			ttlSeconds: 60,
		})

		expect(setValueMock).toHaveBeenCalledWith(
			expect.any(Object),
			expect.any(Object),
			{
				key: 'user:123',
				value: {
					kind: 'hash',
					entries: [
						{ field: 'id', value: '123' },
						{ field: 'status', value: 'active' },
					],
				},
				ttlSeconds: 60,
			},
		)
	})

	it('updates a key by writing the destination and deleting the source', async () => {
		const repository = new InMemoryConnectionRepository()
		const secretStore = new InMemorySecretStore()
		const memcachedIndex = new InMemoryMemcachedIndexRepository()
		const setValueMock = vi.fn(async () => undefined)
		const deleteKeyMock = vi.fn(async () => undefined)
		const getValueMock = vi.fn(async (_profile, _secret, key) => ({
			key,
			value: null,
			ttlSeconds: null,
			supportsTTL: true,
			keyType: 'none' as const,
		}))
		const gateway = createGatewayMock({
			getValue: getValueMock,
			setValue: setValueMock,
			deleteKey: deleteKeyMock,
		})

		const profile: ConnectionProfile = {
			...createStoredProfile(),
			id: 'update-key-1',
			secretRef: 'update-key-1',
		}

		await repository.save(profile)
		await secretStore.saveSecret(profile.id, { password: 'secret' })

		const service = new OperationsService(
			repository,
			secretStore,
			memcachedIndex,
			gateway,
		)

		await service.updateKey({
			connectionId: profile.id,
			currentKey: 'user:1',
			key: 'user:2',
			value: {
				kind: 'set',
				members: ['a', 'b'],
			},
			ttlSeconds: 120,
		})

		expect(getValueMock).toHaveBeenCalledWith(
			expect.any(Object),
			expect.any(Object),
			'user:2',
		)
		expect(setValueMock).toHaveBeenCalledWith(expect.any(Object), expect.any(Object), {
			key: 'user:2',
			value: {
				kind: 'set',
				members: ['a', 'b'],
			},
			ttlSeconds: 120,
		})
		expect(deleteKeyMock).toHaveBeenCalledWith(
			expect.any(Object),
			expect.any(Object),
			'user:1',
		)
	})

	it('rejects key updates when the destination already exists', async () => {
		const repository = new InMemoryConnectionRepository()
		const secretStore = new InMemorySecretStore()
		const memcachedIndex = new InMemoryMemcachedIndexRepository()
		const setValueMock = vi.fn(async () => undefined)
		const gateway = createGatewayMock({
			getValue: vi.fn(async (_profile, _secret, key) => ({
				key,
				value: 'taken',
				ttlSeconds: null,
				supportsTTL: true,
				keyType: 'string' as const,
			})),
			setValue: setValueMock,
		})

		const profile: ConnectionProfile = {
			...createStoredProfile(),
			id: 'update-key-2',
			secretRef: 'update-key-2',
		}

		await repository.save(profile)
		await secretStore.saveSecret(profile.id, { password: 'secret' })

		const service = new OperationsService(
			repository,
			secretStore,
			memcachedIndex,
			gateway,
		)

		await expect(
			service.updateKey({
				connectionId: profile.id,
				currentKey: 'user:1',
				key: 'user:2',
				value: 'value',
			}),
		).rejects.toMatchObject({
			code: 'CONFLICT',
			message: 'Key "user:2" already exists.',
		})

		expect(setValueMock).not.toHaveBeenCalled()
	})

	it('rolls back metadata when secret storage fails during create', async () => {
		const repository = new InMemoryConnectionRepository()
		const memcachedIndex = new InMemoryMemcachedIndexRepository()
		const gateway = createGatewayMock()
		const secretStore: SecretStore = {
			saveSecret: vi.fn(async () => {
				throw new Error('keychain unavailable')
			}),
			getSecret: vi.fn(async () => ({ password: 'secret' })),
			deleteSecret: vi.fn(async () => undefined),
		}

		const service = new OperationsService(
			repository,
			secretStore,
			memcachedIndex,
			gateway,
		)

		await expect(
			service.createConnection(createConnectionPayload()),
		).rejects.toEqual(
			expect.objectContaining({
				name: 'OperationFailure',
				code: 'INTERNAL_ERROR',
			}),
		)

		const profiles = await repository.list()
		expect(profiles).toHaveLength(0)
	})

	it('uses stored secret for edit-mode connection tests when secret input is blank', async () => {
		const repository = new InMemoryConnectionRepository()
		const secretStore = new InMemorySecretStore()
		const memcachedIndex = new InMemoryMemcachedIndexRepository()
		const testConnectionMock = vi.fn(async () => ({ latencyMs: 7, capabilities }))
		const gateway = createGatewayMock({ testConnection: testConnectionMock })
		const storedProfile = createStoredProfile()

		await repository.save(storedProfile)
		await secretStore.saveSecret(storedProfile.id, {
			username: 'stored-user',
			password: 'stored-pass',
		})

		const service = new OperationsService(
			repository,
			secretStore,
			memcachedIndex,
			gateway,
		)

		await service.testConnection({
			connectionId: storedProfile.id,
			profile: createConnectionPayload().profile,
			secret: {},
		})

		expect(testConnectionMock).toHaveBeenCalledWith(
			expect.any(Object),
			expect.objectContaining({
				username: 'stored-user',
				password: 'stored-pass',
			}),
		)
	})

	it('overlays provided edit-mode test secret fields on top of stored secret', async () => {
		const repository = new InMemoryConnectionRepository()
		const secretStore = new InMemorySecretStore()
		const memcachedIndex = new InMemoryMemcachedIndexRepository()
		const testConnectionMock = vi.fn(async () => ({ latencyMs: 9, capabilities }))
		const gateway = createGatewayMock({ testConnection: testConnectionMock })
		const storedProfile = createStoredProfile()

		await repository.save(storedProfile)
		await secretStore.saveSecret(storedProfile.id, {
			username: 'stored-user',
			password: 'stored-pass',
			token: 'stored-token',
		})

		const service = new OperationsService(
			repository,
			secretStore,
			memcachedIndex,
			gateway,
		)

		await service.testConnection({
			connectionId: storedProfile.id,
			profile: createConnectionPayload().profile,
			secret: {
				password: 'override-pass',
			},
		})

		expect(testConnectionMock).toHaveBeenCalledWith(
			expect.any(Object),
			expect.objectContaining({
				username: 'stored-user',
				password: 'override-pass',
				token: 'stored-token',
			}),
		)
	})

	it('blocks writes when forced read-only policy is enabled', async () => {
		const repository = new InMemoryConnectionRepository()
		const secretStore = new InMemorySecretStore()
		const memcachedIndex = new InMemoryMemcachedIndexRepository()
		const setValueMock = vi.fn(async () => undefined)
		const gateway = createGatewayMock({ setValue: setValueMock })

		const profile: ConnectionProfile = {
			...createStoredProfile(),
			id: 'forced-ro-1',
			secretRef: 'forced-ro-1',
			forceReadOnly: true,
		}

		await repository.save(profile)
		await secretStore.saveSecret(profile.id, { password: 'secret' })

		const service = new OperationsService(
			repository,
			secretStore,
			memcachedIndex,
			gateway,
		)

		await expect(
			service.setKey({
				connectionId: profile.id,
				key: 'blocked:key',
				value: 'value',
			}),
		).rejects.toEqual(
			expect.objectContaining({
				code: 'UNAUTHORIZED',
			}),
		)
		expect(setValueMock).not.toHaveBeenCalled()
	})

	it('enforces prod guardrail for destructive deletes', async () => {
		const repository = new InMemoryConnectionRepository()
		const secretStore = new InMemorySecretStore()
		const memcachedIndex = new InMemoryMemcachedIndexRepository()
		const deleteKeyMock = vi.fn(async () => undefined)
		const gateway = createGatewayMock({ deleteKey: deleteKeyMock })

		const profile: ConnectionProfile = {
			...createStoredProfile(),
			id: 'prod-1',
			environment: 'prod',
			secretRef: 'prod-1',
		}

		await repository.save(profile)
		await secretStore.saveSecret(profile.id, { password: 'secret' })

		const service = new OperationsService(
			repository,
			secretStore,
			memcachedIndex,
			gateway,
		)

		await expect(
			service.deleteKey({
				connectionId: profile.id,
				key: 'prod:key',
			}),
		).rejects.toEqual(
			expect.objectContaining({
				code: 'UNAUTHORIZED',
			}),
		)

		expect(deleteKeyMock).not.toHaveBeenCalled()

		await expect(
			service.deleteKey({
				connectionId: profile.id,
				key: 'prod:key',
				guardrailConfirmed: true,
			}),
		).resolves.toEqual({
			success: true,
		})

		expect(deleteKeyMock).toHaveBeenCalledTimes(1)
	})

	it('flushes the selected database through the cache gateway', async () => {
		const repository = new InMemoryConnectionRepository()
		const secretStore = new InMemorySecretStore()
		const memcachedIndex = new InMemoryMemcachedIndexRepository()
		const flushMock = vi.fn(async () => undefined)
		const gateway = createGatewayMock({ flush: flushMock })

		const profile: ConnectionProfile = {
			...createStoredProfile(),
			id: 'flush-connection',
			dbIndex: 4,
			secretRef: 'flush-connection',
		}

		await repository.save(profile)
		await secretStore.saveSecret(profile.id, { password: 'secret' })

		const service = new OperationsService(
			repository,
			secretStore,
			memcachedIndex,
			gateway,
		)

		await expect(service.flushCache(createFlushArgs('database'))).resolves.toEqual({
			success: true,
		})

		expect(flushMock).toHaveBeenCalledWith(
			expect.objectContaining({ id: profile.id, dbIndex: 0 }),
			expect.any(Object),
			{ scope: 'database' },
		)
	})

	it('flushes prefix namespaces using namespace scope and prefix metadata', async () => {
		const repository = new InMemoryConnectionRepository()
		const secretStore = new InMemorySecretStore()
		const memcachedIndex = new InMemoryMemcachedIndexRepository()
		const flushMock = vi.fn(async () => undefined)
		const gateway = createGatewayMock({ flush: flushMock })

		const profile: ConnectionProfile = {
			...createStoredProfile(),
			id: 'flush-connection',
			secretRef: 'flush-connection',
		}

		await repository.save(profile)
		await secretStore.saveSecret(profile.id, { password: 'secret' })

		const service = new OperationsService(
			repository,
			secretStore,
			memcachedIndex,
			gateway,
		)

		const namespace = await service.createNamespace({
			namespace: {
				connectionId: profile.id,
				name: 'tenant-a',
				strategy: 'keyPrefix',
				keyPrefix: 'tenant:',
			},
		})

		await expect(
			service.flushCache({
				...createFlushArgs('namespace'),
				namespaceId: namespace.id,
			}),
		).resolves.toEqual({
			success: true,
		})

		expect(flushMock).toHaveBeenCalledWith(
			expect.objectContaining({ id: profile.id }),
			expect.any(Object),
			{ scope: 'namespace', keyPrefix: 'tenant:' },
		)
	})

	it('rejects namespace flushes without a namespace selection', async () => {
		const repository = new InMemoryConnectionRepository()
		const secretStore = new InMemorySecretStore()
		const memcachedIndex = new InMemoryMemcachedIndexRepository()
		const flushMock = vi.fn(async () => undefined)
		const gateway = createGatewayMock({ flush: flushMock })

		const profile: ConnectionProfile = {
			...createStoredProfile(),
			id: 'flush-connection',
			secretRef: 'flush-connection',
		}

		await repository.save(profile)
		await secretStore.saveSecret(profile.id, { password: 'secret' })

		const service = new OperationsService(
			repository,
			secretStore,
			memcachedIndex,
			gateway,
		)

		await expect(service.flushCache(createFlushArgs('namespace'))).rejects.toEqual(
			expect.objectContaining({
				code: 'VALIDATION_ERROR',
			}),
		)

		expect(flushMock).not.toHaveBeenCalled()
	})

	it('returns exact key totals with and without pattern filters', async () => {
		const repository = new InMemoryConnectionRepository()
		const secretStore = new InMemorySecretStore()
		const memcachedIndex = new InMemoryMemcachedIndexRepository()
		const countKeysMock = vi.fn(async () => ({ totalKeys: 42 }))
		const countKeysByPatternMock = vi.fn(async () => ({
			totalKeys: 42,
			totalFoundKeys: 9,
		}))
		const gateway = createGatewayMock({
			countKeys: countKeysMock,
			countKeysByPattern: countKeysByPatternMock,
		})

		const profile: ConnectionProfile = {
			...createStoredProfile(),
			id: 'count-1',
			secretRef: 'count-1',
		}

		await repository.save(profile)
		await secretStore.saveSecret(profile.id, { password: 'secret' })

		const service = new OperationsService(
			repository,
			secretStore,
			memcachedIndex,
			gateway,
		)

		const unfiltered = await service.countKeys({
			connectionId: profile.id,
		})
		const filtered = await service.countKeys({
			connectionId: profile.id,
			pattern: 'session:*',
		})

		expect(unfiltered).toEqual({ totalKeys: 42 })
		expect(filtered).toEqual({ totalKeys: 42, totalFoundKeys: 9 })
		expect(countKeysMock).toHaveBeenCalledTimes(1)
		expect(countKeysByPatternMock).toHaveBeenCalledWith(
			expect.objectContaining({ id: profile.id }),
			expect.any(Object),
			{ pattern: 'session:*' },
		)
	})

	it('lists prefix namespaces using scoped pattern search and strips prefixes', async () => {
		const repository = new InMemoryConnectionRepository()
		const secretStore = new InMemorySecretStore()
		const memcachedIndex = new InMemoryMemcachedIndexRepository()
		const listKeysMock = vi.fn(async () => ({
			keys: [{ key: 'fallback' }],
			nextCursor: '7',
		}))
		const searchKeysMock = vi.fn(async () => ({
			keys: [{ key: 'tenant:user:1' }, { key: 'tenant:user:2' }],
			nextCursor: '13',
		}))
		const gateway = createGatewayMock({
			listKeys: listKeysMock,
			searchKeys: searchKeysMock,
		})

		const profile: ConnectionProfile = {
			...createStoredProfile(),
			id: 'namespace-prefix-1',
			secretRef: 'namespace-prefix-1',
		}

		await repository.save(profile)
		await secretStore.saveSecret(profile.id, { password: 'secret' })

		const service = new OperationsService(
			repository,
			secretStore,
			memcachedIndex,
			gateway,
		)

		const namespace = await service.createNamespace({
			namespace: {
				connectionId: profile.id,
				name: 'tenant-a',
				strategy: 'keyPrefix',
				keyPrefix: 'tenant:',
			},
		})

		const result = await service.listKeys({
			connectionId: profile.id,
			namespaceId: namespace.id,
			limit: 100,
		})

		expect(result).toEqual({
			keys: [{ key: 'user:1' }, { key: 'user:2' }],
			nextCursor: '13',
		})
		expect(searchKeysMock).toHaveBeenCalledWith(
			expect.objectContaining({ id: profile.id }),
			expect.any(Object),
			{ pattern: 'tenant:*', cursor: undefined, limit: 100 },
		)
		expect(listKeysMock).not.toHaveBeenCalled()
	})

	it('restores keys from latest snapshot records', async () => {
		const repository = new InMemoryConnectionRepository()
		const secretStore = new InMemorySecretStore()
		const memcachedIndex = new InMemoryMemcachedIndexRepository()
		const setValueMock = vi.fn(async () => undefined)
		const getValueMock = vi
			.fn()
			.mockResolvedValueOnce({
				key: 'user:1',
				value: 'old-value',
				ttlSeconds: 120,
				supportsTTL: true,
			})
			.mockResolvedValueOnce({
				key: 'user:1',
				value: 'current-value',
				ttlSeconds: 90,
				supportsTTL: true,
			})
		const gateway = createGatewayMock({
			getValue: getValueMock,
			setValue: setValueMock,
		})

		const profile: ConnectionProfile = {
			...createStoredProfile(),
			id: 'rollback-1',
			secretRef: 'rollback-1',
		}

		await repository.save(profile)
		await secretStore.saveSecret(profile.id, { password: 'secret' })

		const service = new OperationsService(
			repository,
			secretStore,
			memcachedIndex,
			gateway,
		)

		await service.setKey({
			connectionId: profile.id,
			key: 'user:1',
			value: 'new-value',
			ttlSeconds: 30,
		})

		await service.restoreSnapshot({
			connectionId: profile.id,
			key: 'user:1',
		})

		expect(setValueMock).toHaveBeenCalledWith(
			expect.any(Object),
			expect.any(Object),
			expect.objectContaining({
				key: 'user:1',
				value: 'old-value',
				ttlSeconds: 120,
			}),
		)
	})

	it('rejects rollback snapshot IDs that do not match requested key', async () => {
		const repository = new InMemoryConnectionRepository()
		const secretStore = new InMemorySecretStore()
		const memcachedIndex = new InMemoryMemcachedIndexRepository()
		const getValueMock = vi
			.fn()
			.mockResolvedValueOnce({
				key: 'user:2',
				value: 'old-value',
				ttlSeconds: 30,
				supportsTTL: true,
			})
			.mockResolvedValueOnce({
				key: 'user:1',
				value: 'other-value',
				ttlSeconds: 60,
				supportsTTL: true,
			})
		const gateway = createGatewayMock({
			getValue: getValueMock,
		})

		const profile: ConnectionProfile = {
			...createStoredProfile(),
			id: 'rollback-key-mismatch-1',
			secretRef: 'rollback-key-mismatch-1',
		}

		await repository.save(profile)
		await secretStore.saveSecret(profile.id, { password: 'secret' })

		const service = new OperationsService(
			repository,
			secretStore,
			memcachedIndex,
			gateway,
		)

		await service.setKey({
			connectionId: profile.id,
			key: 'user:2',
			value: 'updated-value',
			ttlSeconds: 15,
		})

		const snapshots = await service.listSnapshots({
			connectionId: profile.id,
			key: 'user:2',
			limit: 1,
		})

		await expect(
			service.restoreSnapshot({
				connectionId: profile.id,
				key: 'user:1',
				snapshotId: snapshots[0].id,
			}),
		).rejects.toEqual(
			expect.objectContaining({
				code: 'VALIDATION_ERROR',
			}),
		)
	})

	it('executes workflow dry-runs without mutating keys and stores execution records', async () => {
		const repository = new InMemoryConnectionRepository()
		const secretStore = new InMemorySecretStore()
		const memcachedIndex = new InMemoryMemcachedIndexRepository()
		const deleteKeyMock = vi.fn(async () => undefined)
		const searchKeysMock = vi.fn(async () => ({
			keys: [{ key: 'session:1' }, { key: 'session:2' }],
			nextCursor: undefined,
		}))
		const gateway = createGatewayMock({
			deleteKey: deleteKeyMock,
			searchKeys: searchKeysMock,
		})

		const profile: ConnectionProfile = {
			...createStoredProfile(),
			id: 'workflow-1',
			secretRef: 'workflow-1',
		}

		await repository.save(profile)
		await secretStore.saveSecret(profile.id, { password: 'secret' })

		const service = new OperationsService(
			repository,
			secretStore,
			memcachedIndex,
			gateway,
		)

		const execution = await service.executeWorkflow({
			connectionId: profile.id,
			template: {
				name: 'Delete sessions',
				kind: 'deleteByPattern',
				parameters: {
					pattern: 'session:*',
					limit: 50,
				},
				requiresApprovalOnProd: true,
				supportsDryRun: true,
			},
			dryRun: true,
		})

		expect(execution.status).toBe('success')
		expect(execution.dryRun).toBe(true)
		expect(deleteKeyMock).not.toHaveBeenCalled()

		const history = await service.listWorkflowExecutions({
			connectionId: profile.id,
			limit: 20,
		})

		expect(history).toHaveLength(1)
		expect(history[0].id).toBe(execution.id)
	})

	it('creates policy alerts for blocked operations', async () => {
		const repository = new InMemoryConnectionRepository()
		const secretStore = new InMemorySecretStore()
		const memcachedIndex = new InMemoryMemcachedIndexRepository()
		const gateway = createGatewayMock()

		const profile: ConnectionProfile = {
			...createStoredProfile(),
			id: 'alert-1',
			secretRef: 'alert-1',
			forceReadOnly: true,
		}

		await repository.save(profile)
		await secretStore.saveSecret(profile.id, { password: 'secret' })

		const service = new OperationsService(
			repository,
			secretStore,
			memcachedIndex,
			gateway,
		)

		await expect(
			service.setKey({
				connectionId: profile.id,
				key: 'alert:key',
				value: 'value',
			}),
		).rejects.toBeInstanceOf(OperationFailure)

		const alerts = await service.listAlerts({ limit: 20, unreadOnly: false })
		expect(alerts.length).toBeGreaterThan(0)
		expect(alerts[0].source).toBe('policy')
	})

	it('reports unread alert counts and supports mark-all-read', async () => {
		const repository = new InMemoryConnectionRepository()
		const secretStore = new InMemorySecretStore()
		const memcachedIndex = new InMemoryMemcachedIndexRepository()
		const gateway = createGatewayMock()

		const profile: ConnectionProfile = {
			...createStoredProfile(),
			id: 'alert-count-1',
			secretRef: 'alert-count-1',
			forceReadOnly: true,
		}

		await repository.save(profile)
		await secretStore.saveSecret(profile.id, { password: 'secret' })

		const service = new OperationsService(
			repository,
			secretStore,
			memcachedIndex,
			gateway,
		)

		await expect(
			service.setKey({
				connectionId: profile.id,
				key: 'alert:key:1',
				value: 'value',
			}),
		).rejects.toBeInstanceOf(OperationFailure)
		await expect(
			service.setKey({
				connectionId: profile.id,
				key: 'alert:key:2',
				value: 'value',
			}),
		).rejects.toBeInstanceOf(OperationFailure)

		const unreadCount = await service.getUnreadAlertCount()
		expect(unreadCount.unreadCount).toBeGreaterThanOrEqual(2)

		await expect(service.markAllAlertsRead({})).resolves.toEqual({
			success: true,
		})

		const unreadAfterMarkAll = await service.getUnreadAlertCount()
		expect(unreadAfterMarkAll.unreadCount).toBe(0)
	})

	it('supports deleting all alerts', async () => {
		const repository = new InMemoryConnectionRepository()
		const secretStore = new InMemorySecretStore()
		const memcachedIndex = new InMemoryMemcachedIndexRepository()
		const gateway = createGatewayMock()

		const profile: ConnectionProfile = {
			...createStoredProfile(),
			id: 'alert-delete-all-1',
			secretRef: 'alert-delete-all-1',
			forceReadOnly: true,
		}

		await repository.save(profile)
		await secretStore.saveSecret(profile.id, { password: 'secret' })

		const service = new OperationsService(
			repository,
			secretStore,
			memcachedIndex,
			gateway,
		)

		await expect(
			service.setKey({
				connectionId: profile.id,
				key: 'alert:key:1',
				value: 'value',
			}),
		).rejects.toBeInstanceOf(OperationFailure)
		await expect(
			service.setKey({
				connectionId: profile.id,
				key: 'alert:key:2',
				value: 'value',
			}),
		).rejects.toBeInstanceOf(OperationFailure)

		const unreadBeforeDelete = await service.getUnreadAlertCount()
		expect(unreadBeforeDelete.unreadCount).toBeGreaterThanOrEqual(2)

		await expect(service.deleteAllAlerts()).resolves.toEqual({
			success: true,
		})

		const alertsAfterDelete = await service.listAlerts({
			limit: 20,
			unreadOnly: false,
		})
		expect(alertsAfterDelete).toHaveLength(0)

		const unreadAfterDelete = await service.getUnreadAlertCount()
		expect(unreadAfterDelete.unreadCount).toBe(0)
	})

	it('supports alert rule CRUD and emits rule-triggered alerts', async () => {
		const repository = new InMemoryConnectionRepository()
		const secretStore = new InMemorySecretStore()
		const memcachedIndex = new InMemoryMemcachedIndexRepository()
		const setValueMock = vi.fn(
			async (
				_profile: ConnectionProfile,
				_secret: ConnectionSecret,
				args: {
					key: string
					value: string
					ttlSeconds?: number
				},
			) => {
				if (args.key === 'rule:error') {
					throw new Error('rule failure')
				}
			},
		)
		const gateway = createGatewayMock({
			setValue: setValueMock,
		})

		const profile: ConnectionProfile = {
			...createStoredProfile(),
			id: 'rule-conn-1',
			secretRef: 'rule-conn-1',
		}

		await repository.save(profile)
		await secretStore.saveSecret(profile.id, { password: 'secret' })

		const service = new OperationsService(
			repository,
			secretStore,
			memcachedIndex,
			gateway,
		)

		const created = await service.createAlertRule({
			rule: {
				name: 'Error Burst',
				metric: 'failedOperationCount',
				threshold: 0,
				lookbackMinutes: 10,
				severity: 'critical',
				connectionId: profile.id,
				enabled: true,
			},
		})

		expect(created.id).toBeTruthy()

		await expect(
			service.setKey({
				connectionId: profile.id,
				key: 'rule:error',
				value: 'value',
			}),
		).rejects.toBeInstanceOf(OperationFailure)

		const alerts = await service.listAlerts({
			unreadOnly: false,
			limit: 50,
		})

		expect(
			alerts.some((alert) => alert.title.includes('Alert rule triggered')),
		).toBe(true)

		const updated = await service.updateAlertRule({
			id: created.id,
			rule: {
				...created,
				enabled: false,
				name: 'Error Burst Disabled',
			},
		})

		expect(updated.enabled).toBe(false)

		await expect(
			service.deleteAlertRule({
				id: created.id,
			}),
		).resolves.toEqual({ success: true })
	})

	it('records ingested engine events in history timeline', async () => {
		const repository = new InMemoryConnectionRepository()
		const secretStore = new InMemorySecretStore()
		const memcachedIndex = new InMemoryMemcachedIndexRepository()
		const gateway = createGatewayMock()

		const profile: ConnectionProfile = {
			...createStoredProfile(),
			id: 'engine-event-1',
			secretRef: 'engine-event-1',
		}

		await repository.save(profile)
		await secretStore.saveSecret(profile.id, { password: 'secret' })

		const service = new OperationsService(
			repository,
			secretStore,
			memcachedIndex,
			gateway,
		)

		await service.ingestEngineEvent({
			connectionId: profile.id,
			action: 'engine.slowlog',
			keyOrPattern: 'session:*',
			durationMs: 900,
			status: 'success',
		})

		const history = await service.listHistory({
			connectionId: profile.id,
			limit: 10,
		})

		expect(history[0].source).toBe('engine')
		expect(history[0].action).toBe('engine.slowlog')
	})

	it('starts and stops the configured engine event ingestor', async () => {
		const repository = new InMemoryConnectionRepository()
		const secretStore = new InMemorySecretStore()
		const memcachedIndex = new InMemoryMemcachedIndexRepository()
		const gateway = createGatewayMock()

		const profile: ConnectionProfile = {
			...createStoredProfile(),
			id: 'engine-event-2',
			secretRef: 'engine-event-2',
		}

		await repository.save(profile)
		await secretStore.saveSecret(profile.id, { password: 'secret' })

		const startMock = vi.fn(
			async (args: { onEvent: (event: unknown) => Promise<void> }) => {
				void args
				return undefined
			},
		)
		const stopMock = vi.fn(async () => undefined)
		const ingestor: EngineEventIngestor = {
			start: startMock,
			stop: stopMock,
		}

		const service = new OperationsService(
			repository,
			secretStore,
			memcachedIndex,
			gateway,
			{
				engineEventIngestor: ingestor,
			},
		)

		await service.startEngineEventIngestion()
		await service.stopEngineEventIngestion()

		expect(startMock).toHaveBeenCalledTimes(1)
		expect(stopMock).toHaveBeenCalledTimes(1)
	})

	it('builds keyspace activity and compare-period analytics from history', async () => {
		const repository = new InMemoryConnectionRepository()
		const secretStore = new InMemorySecretStore()
		const memcachedIndex = new InMemoryMemcachedIndexRepository()
		const setValueMock = vi.fn(
			async (
				_profile: ConnectionProfile,
				_secret: ConnectionSecret,
				args: {
					key: string
					value: string
					ttlSeconds?: number
				},
			) => {
				if (args.key === 'user:error') {
					throw new Error('simulated write failure')
				}
			},
		)
		const gateway = createGatewayMock({
			setValue: setValueMock,
		})

		const profile: ConnectionProfile = {
			...createStoredProfile(),
			id: 'analytics-1',
			secretRef: 'analytics-1',
		}

		await repository.save(profile)
		await secretStore.saveSecret(profile.id, { password: 'secret' })

		const service = new OperationsService(
			repository,
			secretStore,
			memcachedIndex,
			gateway,
		)

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
		await expect(
			service.setKey({
				connectionId: profile.id,
				key: 'user:error',
				value: 'value-3',
			}),
		).rejects.toBeInstanceOf(OperationFailure)

		const from = new Date(Date.now() - 60_000).toISOString()
		const to = new Date(Date.now() + 60_000).toISOString()

		const keyspace = await service.getKeyspaceActivity({
			connectionId: profile.id,
			from,
			to,
			intervalMinutes: 1,
			limit: 10,
		})

		expect(keyspace.topPatterns.length).toBeGreaterThan(0)
		expect(keyspace.topPatterns[0].pattern).toBe('user:*')
		expect(keyspace.distribution.length).toBeGreaterThan(0)

		const compare = await service.comparePeriods({
			connectionId: profile.id,
			baselineFrom: '2020-01-01T00:00:00.000Z',
			baselineTo: '2020-01-01T00:01:00.000Z',
			compareFrom: from,
			compareTo: to,
		})

		const operationMetric = compare.metrics.find(
			(metric) => metric.metric === 'operationCount',
		)
		const errorRateMetric = compare.metrics.find(
			(metric) => metric.metric === 'errorRate',
		)

		expect(operationMetric?.compare).toBeGreaterThan(0)
		expect(errorRateMetric?.compare).toBeGreaterThan(0)
	})

	it('previews and exports incident bundles then lists persisted bundles', async () => {
		const repository = new InMemoryConnectionRepository()
		const secretStore = new InMemorySecretStore()
		const memcachedIndex = new InMemoryMemcachedIndexRepository()
		const gateway = createGatewayMock()

		const profile: ConnectionProfile = {
			...createStoredProfile(),
			id: 'incident-conn-1',
			secretRef: 'incident-conn-1',
		}

		await repository.save(profile)
		await secretStore.saveSecret(profile.id, { password: 'secret' })

		const service = new OperationsService(
			repository,
			secretStore,
			memcachedIndex,
			gateway,
		)

		await service.setKey({
			connectionId: profile.id,
			key: 'incident:key',
			value: 'value',
		})
		await service.ingestEngineEvent({
			connectionId: profile.id,
			action: 'engine.failure',
			keyOrPattern: 'incident:key',
			durationMs: 900,
			status: 'error',
		})

		const from = new Date(Date.now() - 60_000).toISOString()
		const to = new Date(Date.now() + 60_000).toISOString()

		const preview = await service.previewIncidentBundle({
			from,
			to,
			includes: ['timeline', 'logs', 'diagnostics', 'metrics'],
			redactionProfile: 'default',
			connectionIds: [profile.id],
		})

		expect(preview.timelineCount).toBeGreaterThan(0)
		expect(preview.diagnosticCount).toBeGreaterThan(0)
		expect(preview.checksumPreview).toBeTruthy()
		expect(preview.truncated).toBe(false)
		expect(preview.manifest.timelineEventIds.length).toBe(preview.timelineCount)

		const tempDirectory = fs.mkdtempSync(
			path.join(os.tmpdir(), 'volatile-incident-'),
		)
		const destinationPath = path.join(tempDirectory, 'bundle.json')

		const exported = await service.exportIncidentBundle({
			from,
			to,
			includes: ['timeline', 'logs', 'diagnostics', 'metrics'],
			redactionProfile: 'strict',
			connectionIds: [profile.id],
			destinationPath,
		})

		expect(exported.artifactPath).toBe(destinationPath)
		expect(fs.existsSync(destinationPath)).toBe(true)
		expect(exported.truncated).toBe(false)

		const bundles = await service.listIncidentBundles({
			limit: 10,
		})

		expect(bundles.length).toBe(1)
		expect(bundles[0].checksum).toBe(exported.checksum)

		const artifact = JSON.parse(fs.readFileSync(destinationPath, 'utf8')) as {
			metadata: { redactionProfile: string }
		}
		expect(artifact.metadata.redactionProfile).toBe('strict')

		const asyncDestinationPath = path.join(tempDirectory, 'bundle-async.json')
		const startedJob = await service.startIncidentBundleExport({
			from,
			to,
			includes: ['timeline', 'logs', 'diagnostics', 'metrics'],
			redactionProfile: 'default',
			connectionIds: [profile.id],
			destinationPath: asyncDestinationPath,
		})

		expect(['pending', 'running']).toContain(startedJob.status)

		let asyncJob = await service.getIncidentBundleExportJob({
			jobId: startedJob.id,
		})
		for (let attempt = 0; attempt < 80; attempt += 1) {
			if (
				asyncJob.status === 'success' ||
				asyncJob.status === 'failed' ||
				asyncJob.status === 'cancelled'
			) {
				break
			}

			await new Promise((resolve) => {
				setTimeout(resolve, 5)
			})
			asyncJob = await service.getIncidentBundleExportJob({
				jobId: startedJob.id,
			})
		}

		expect(asyncJob.status).toBe('success')
		expect(asyncJob.progressPercent).toBe(100)
		expect(asyncJob.bundle?.artifactPath).toBe(asyncDestinationPath)
		expect(fs.existsSync(asyncDestinationPath)).toBe(true)

		fs.rmSync(tempDirectory, { recursive: true, force: true })
	})

	it('enforces governance windows and resumes aborted workflows from checkpoints', async () => {
		const repository = new InMemoryConnectionRepository()
		const secretStore = new InMemorySecretStore()
		const memcachedIndex = new InMemoryMemcachedIndexRepository()
		const searchKeysMock = vi.fn(async () => ({
			keys: [{ key: 'job:1' }, { key: 'job:2' }, { key: 'job:3' }],
			nextCursor: undefined,
		}))
		const deleteKeyMock = vi.fn(
			async (
				_profile: ConnectionProfile,
				_secret: ConnectionSecret,
				key: string,
			) => {
				if (key === 'job:2') {
					throw new Error('planned workflow failure')
				}
			},
		)
		const gateway = createGatewayMock({
			searchKeys: searchKeysMock,
			deleteKey: deleteKeyMock,
		})

		const profile: ConnectionProfile = {
			...createStoredProfile(),
			id: 'governance-conn-1',
			secretRef: 'governance-conn-1',
			environment: 'dev',
		}

		await repository.save(profile)
		await secretStore.saveSecret(profile.id, { password: 'secret' })

		const service = new OperationsService(
			repository,
			secretStore,
			memcachedIndex,
			gateway,
		)

		const weekdayByIndex = [
			'sun',
			'mon',
			'tue',
			'wed',
			'thu',
			'fri',
			'sat',
		] as const
		const todayWeekday = weekdayByIndex[new Date().getUTCDay()]
		const blockedWeekday =
			weekdayByIndex[(new Date().getUTCDay() + 1) % weekdayByIndex.length]

		const policyPack = await service.createGovernancePolicyPack({
			policyPack: {
				name: 'Dev Governance',
				description: 'Only allow controlled windows',
				environments: ['dev'],
				maxWorkflowItems: 25,
				maxRetryAttempts: 1,
				schedulingEnabled: true,
				executionWindows: [
					{
						id: 'blocked-window',
						weekdays: [blockedWeekday],
						startTime: '00:00',
						endTime: '23:59',
						timezone: 'UTC',
					},
				],
				enabled: true,
			},
		})

		await service.assignGovernancePolicyPack({
			connectionId: profile.id,
			policyPackId: policyPack.id,
		})

		await expect(
			service.executeWorkflow({
				connectionId: profile.id,
				template: {
					name: 'Delete jobs',
					kind: 'deleteByPattern',
					parameters: {
						pattern: 'job:*',
						limit: 25,
					},
					requiresApprovalOnProd: true,
					supportsDryRun: true,
				},
			}),
		).rejects.toEqual(
			expect.objectContaining({
				code: 'UNAUTHORIZED',
			}),
		)

		await service.updateGovernancePolicyPack({
			id: policyPack.id,
			policyPack: {
				name: 'Dev Governance',
				description: 'Only allow controlled windows',
				environments: ['dev'],
				maxWorkflowItems: 25,
				maxRetryAttempts: 1,
				schedulingEnabled: true,
				executionWindows: [
					{
						id: 'active-window',
						weekdays: [todayWeekday],
						startTime: '00:00',
						endTime: '23:59',
						timezone: 'UTC',
					},
				],
				enabled: true,
			},
		})

		const execution = await service.executeWorkflow({
			connectionId: profile.id,
			template: {
				name: 'Delete jobs',
				kind: 'deleteByPattern',
				parameters: {
					pattern: 'job:*',
					limit: 25,
				},
				requiresApprovalOnProd: true,
				supportsDryRun: true,
			},
			retryPolicy: {
				maxAttempts: 5,
				backoffMs: 0,
				backoffStrategy: 'fixed',
				abortOnErrorRate: 0.4,
			},
		})

		expect(execution.status).toBe('aborted')
		expect(execution.policyPackId).toBe(policyPack.id)
		expect(execution.scheduleWindowId).toBe('active-window')
		expect(execution.checkpointToken).toBe('2')
		expect(
			execution.stepResults.find((step) => step.status === 'error')?.attempts,
		).toBe(1)

		const resumed = await service.resumeWorkflow({
			executionId: execution.id,
		})

		expect(resumed.status).toBe('success')
		expect(resumed.resumedFromExecutionId).toBe(execution.id)
		expect(resumed.stepResults).toHaveLength(1)
		expect(resumed.stepResults[0].step).toContain('job:3')
	})

	it('delegates retention policy operations and auto-purges over-budget datasets', async () => {
		const repository = new InMemoryConnectionRepository()
		const secretStore = new InMemorySecretStore()
		const memcachedIndex = new InMemoryMemcachedIndexRepository()
		const gateway = createGatewayMock()

		const profile: ConnectionProfile = {
			...createStoredProfile(),
			id: 'retention-conn-1',
			secretRef: 'retention-conn-1',
		}

		await repository.save(profile)
		await secretStore.saveSecret(profile.id, { password: 'secret' })

		const policyList: RetentionPolicy[] = [
			{
				dataset: 'timelineEvents',
				retentionDays: 30,
				storageBudgetMb: 1,
				autoPurgeOldest: true,
			},
			{
				dataset: 'observabilitySnapshots',
				retentionDays: 30,
				storageBudgetMb: 64,
				autoPurgeOldest: true,
			},
			{
				dataset: 'workflowHistory',
				retentionDays: 30,
				storageBudgetMb: 64,
				autoPurgeOldest: true,
			},
			{
				dataset: 'incidentArtifacts',
				retentionDays: 30,
				storageBudgetMb: 64,
				autoPurgeOldest: true,
			},
		]

		const summary: StorageSummary = {
			generatedAt: new Date().toISOString(),
			datasets: [
				{
					dataset: 'timelineEvents',
					rowCount: 10,
					totalBytes: 2_097_152,
					budgetBytes: 1_048_576,
					usageRatio: 2,
					overBudget: true,
				},
				{
					dataset: 'observabilitySnapshots',
					rowCount: 1,
					totalBytes: 256,
					budgetBytes: 67_108_864,
					usageRatio: 0,
					overBudget: false,
				},
				{
					dataset: 'workflowHistory',
					rowCount: 0,
					totalBytes: 0,
					budgetBytes: 67_108_864,
					usageRatio: 0,
					overBudget: false,
				},
				{
					dataset: 'incidentArtifacts',
					rowCount: 0,
					totalBytes: 0,
					budgetBytes: 67_108_864,
					usageRatio: 0,
					overBudget: false,
				},
			],
			totalBytes: 2_097_408,
		}

		const savePolicyMock = vi.fn(async () => undefined)
		const purgeMock = vi.fn(
			async (request: {
				dataset:
					| 'timelineEvents'
					| 'observabilitySnapshots'
					| 'workflowHistory'
					| 'incidentArtifacts'
				olderThan?: string
				dryRun?: boolean
			}) => ({
				dataset: request.dataset,
				cutoff: request.olderThan ?? new Date().toISOString(),
				dryRun: Boolean(request.dryRun),
				deletedRows: request.dryRun ? 5 : 10,
				freedBytes: request.dryRun ? 500 : 1000,
			}),
		)
		const retentionRepository: RetentionRepository = {
			listPolicies: vi.fn(async () => policyList),
			savePolicy: savePolicyMock,
			purge: purgeMock,
			getStorageSummary: vi.fn(async () => summary),
		}

		const service = new OperationsService(
			repository,
			secretStore,
			memcachedIndex,
			gateway,
			{
				retentionRepository,
			},
		)

		const listed = await service.listRetentionPolicies()
		expect(listed.policies).toHaveLength(4)

		const updated = await service.updateRetentionPolicy({
			policy: {
				dataset: 'timelineEvents',
				retentionDays: 0,
				storageBudgetMb: 0,
				autoPurgeOldest: false,
			},
		})

		expect(updated.retentionDays).toBe(1)
		expect(updated.storageBudgetMb).toBe(1)
		expect(savePolicyMock).toHaveBeenCalledWith(updated)

		await service.setKey({
			connectionId: profile.id,
			key: 'retention:key',
			value: 'value',
		})

		expect(purgeMock).toHaveBeenCalledWith({
			dataset: 'timelineEvents',
			dryRun: false,
		})

		const dryRunPurge = await service.purgeRetentionData({
			dataset: 'workflowHistory',
			dryRun: true,
		})
		expect(dryRunPurge.dryRun).toBe(true)
		expect(dryRunPurge.dataset).toBe('workflowHistory')

		const storageSummary = await service.getStorageSummary()
		expect(storageSummary.totalBytes).toBe(summary.totalBytes)
	})
})
