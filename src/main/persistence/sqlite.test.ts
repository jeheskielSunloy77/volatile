import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type {
	AlertEvent,
	AlertRule,
	ConnectionProfile,
	GovernancePolicyPack,
	HistoryEvent,
	IncidentBundle,
	ObservabilitySnapshot,
	RetentionPolicy,
	SnapshotRecord,
	WorkflowExecutionRecord,
	WorkflowTemplate,
} from '../../shared/contracts/cache'
import {
	createSqliteDatabase,
	SqliteAlertRepository,
	SqliteAlertRuleRepository,
	SqliteConnectionRepository,
	SqliteGovernanceAssignmentRepository,
	SqliteGovernancePolicyPackRepository,
	SqliteHistoryRepository,
	SqliteIncidentBundleRepository,
	SqliteObservabilityRepository,
	SqliteRetentionRepository,
	SqliteSnapshotRepository,
	SqliteWorkflowExecutionRepository,
	SqliteWorkflowTemplateRepository,
} from './sqlite'

type TestContext = {
	dbPath: string
	cleanup: () => void
}

const testContexts: TestContext[] = []

const SQLITE_RUNTIME_AVAILABLE = (() => {
	const tempDirectory = fs.mkdtempSync(
		path.join(os.tmpdir(), 'volatile-sqlite-check-'),
	)
	const dbPath = path.join(tempDirectory, 'runtime-check.db')

	try {
		const db = createSqliteDatabase(dbPath)
		db.close()
		return true
	} catch (error) {
		void error
		return false
	} finally {
		fs.rmSync(tempDirectory, { recursive: true, force: true })
	}
})()

const createTestDatabase = () => {
	const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'volatile-sqlite-'))
	const dbPath = path.join(tempDirectory, 'volatile-test.db')
	const db = createSqliteDatabase(dbPath)

	testContexts.push({
		dbPath,
		cleanup: () => {
			db.close()
			fs.rmSync(tempDirectory, { recursive: true, force: true })
		},
	})

	return db
}

afterEach(() => {
	while (testContexts.length > 0) {
		const context = testContexts.pop()
		context?.cleanup()
	}
})

const createProfile = (): ConnectionProfile => ({
	id: 'conn-1',
	name: 'Primary Redis',
	engine: 'redis',
	host: '127.0.0.1',
	port: 6379,
	dbIndex: 0,
	tlsEnabled: false,
	environment: 'dev',
	tags: ['local'],
	secretRef: 'conn-1',
	readOnly: false,
	forceReadOnly: true,
	timeoutMs: 5000,
	retryMaxAttempts: 3,
	retryBackoffMs: 200,
	retryBackoffStrategy: 'fixed',
	retryAbortOnErrorRate: 0.5,
	createdAt: '2026-02-17T00:00:00.000Z',
	updatedAt: '2026-02-17T00:00:00.000Z',
})

const describeSqlite = SQLITE_RUNTIME_AVAILABLE ? describe : describe.skip

describeSqlite('sqlite persistence v2', () => {
	it('persists connection policy and retry fields', async () => {
		const db = createTestDatabase()
		const repository = new SqliteConnectionRepository(db)
		const profile = createProfile()

		await repository.save(profile)

		const stored = await repository.findById(profile.id)
		expect(stored).not.toBeNull()
		expect(stored?.forceReadOnly).toBe(true)
		expect(stored?.retryMaxAttempts).toBe(3)
		expect(stored?.retryBackoffMs).toBe(200)
		expect(stored?.retryBackoffStrategy).toBe('fixed')
		expect(stored?.retryAbortOnErrorRate).toBe(0.5)
	})

	it('round-trips Redis-family engine variants', async () => {
		const db = createTestDatabase()
		const repository = new SqliteConnectionRepository(db)
		const profile = {
			...createProfile(),
			id: 'conn-valkey',
			name: 'Valkey',
			engine: 'valkey' as const,
		}

		await repository.save(profile)

		const stored = await repository.findById(profile.id)
		expect(stored?.engine).toBe('valkey')
	})

	it('stores and fetches snapshot records', async () => {
		const db = createTestDatabase()
		const connectionRepository = new SqliteConnectionRepository(db)
		const snapshotRepository = new SqliteSnapshotRepository(db)
		const profile = createProfile()

		await connectionRepository.save(profile)

		const snapshot: SnapshotRecord = {
			id: 'snap-1',
			connectionId: profile.id,
			key: 'user:1',
			capturedAt: '2026-02-17T01:00:00.000Z',
			redactedValueHash: 'hash-1',
			value: 'old-value',
			ttlSeconds: 120,
			reason: 'set',
		}

		await snapshotRepository.save(snapshot)

		const listed = await snapshotRepository.list({
			connectionId: profile.id,
			key: 'user:1',
			limit: 10,
		})

		expect(listed).toHaveLength(1)
		expect(listed[0].id).toBe(snapshot.id)

		const latest = await snapshotRepository.findLatest({
			connectionId: profile.id,
			key: 'user:1',
		})

		expect(latest?.redactedValueHash).toBe('hash-1')
	})

	it('stores and queries workflow templates and executions', async () => {
		const db = createTestDatabase()
		const connectionRepository = new SqliteConnectionRepository(db)
		const templateRepository = new SqliteWorkflowTemplateRepository(db)
		const executionRepository = new SqliteWorkflowExecutionRepository(db)
		const profile = createProfile()

		await connectionRepository.save(profile)

		const template: WorkflowTemplate = {
			id: 'wf-template-1',
			name: 'Delete sessions',
			kind: 'deleteByPattern',
			parameters: {
				pattern: 'session:*',
			},
			requiresApprovalOnProd: true,
			supportsDryRun: true,
			createdAt: '2026-02-17T01:00:00.000Z',
			updatedAt: '2026-02-17T01:00:00.000Z',
		}

		await templateRepository.save(template)

		const execution: WorkflowExecutionRecord = {
			id: 'wf-exec-1',
			workflowTemplateId: template.id,
			workflowName: template.name,
			workflowKind: template.kind,
			connectionId: profile.id,
			startedAt: '2026-02-17T01:10:00.000Z',
			finishedAt: '2026-02-17T01:10:10.000Z',
			status: 'success',
			retryCount: 1,
			dryRun: false,
			parameters: template.parameters,
			stepResults: [
				{
					step: 'delete:session:1',
					status: 'success',
					attempts: 2,
					durationMs: 42,
				},
			],
			checkpointToken: 'next:2',
			policyPackId: 'policy-pack-1',
			scheduleWindowId: 'window-1',
			resumedFromExecutionId: 'wf-exec-parent',
		}

		await executionRepository.save(execution)

		const templates = await templateRepository.list()
		expect(templates).toHaveLength(1)
		expect(templates[0].name).toBe('Delete sessions')

		const executions = await executionRepository.list({
			connectionId: profile.id,
			limit: 10,
		})

		expect(executions).toHaveLength(1)
		expect(executions[0].retryCount).toBe(1)
		expect(executions[0].stepResults[0].attempts).toBe(2)
		expect(executions[0].checkpointToken).toBe('next:2')
		expect(executions[0].policyPackId).toBe('policy-pack-1')
		expect(executions[0].scheduleWindowId).toBe('window-1')
		expect(executions[0].resumedFromExecutionId).toBe('wf-exec-parent')
	})

	it('stores history and observability snapshots', async () => {
		const db = createTestDatabase()
		const connectionRepository = new SqliteConnectionRepository(db)
		const historyRepository = new SqliteHistoryRepository(db)
		const observabilityRepository = new SqliteObservabilityRepository(db)
		const profile = createProfile()

		await connectionRepository.save(profile)

		const event: HistoryEvent = {
			id: 'history-1',
			timestamp: '2026-02-17T02:00:00.000Z',
			source: 'app',
			connectionId: profile.id,
			environment: profile.environment,
			action: 'key.set',
			keyOrPattern: 'user:1',
			durationMs: 32,
			status: 'success',
			details: {
				attempts: 1,
			},
		}

		const snapshot: ObservabilitySnapshot = {
			id: 'obs-1',
			connectionId: profile.id,
			timestamp: '2026-02-17T02:00:00.000Z',
			latencyP50Ms: 32,
			latencyP95Ms: 32,
			errorRate: 0,
			reconnectCount: 0,
			opsPerSecond: 0.25,
			slowOpCount: 0,
		}

		await historyRepository.append(event)
		await observabilityRepository.append(snapshot)

		const historyRows = await historyRepository.query({
			connectionId: profile.id,
			limit: 10,
		})

		const observabilityRows = await observabilityRepository.query({
			connectionId: profile.id,
			limit: 10,
		})

		expect(historyRows).toHaveLength(1)
		expect(historyRows[0].action).toBe('key.set')
		expect(observabilityRows).toHaveLength(1)
		expect(observabilityRows[0].latencyP95Ms).toBe(32)
	})

	it('stores and marks alerts as read', async () => {
		const db = createTestDatabase()
		const alertRepository = new SqliteAlertRepository(db)

		const alert: AlertEvent = {
			id: 'alert-1',
			createdAt: '2026-02-17T03:00:00.000Z',
			connectionId: 'conn-1',
			environment: 'prod',
			severity: 'warning',
			title: 'Policy block',
			message: 'Delete was blocked by prod guardrail.',
			source: 'policy',
			read: false,
		}

		await alertRepository.append(alert)
		await alertRepository.append({
			...alert,
			id: 'alert-2',
		})

		const unreadCountBefore = await alertRepository.countUnread()
		expect(unreadCountBefore).toBe(2)

		const unread = await alertRepository.list({
			unreadOnly: true,
			limit: 10,
		})

		expect(unread).toHaveLength(2)

		await alertRepository.markRead(alert.id)

		const unreadCountAfterSingleRead = await alertRepository.countUnread()
		expect(unreadCountAfterSingleRead).toBe(1)

		const unreadAfterMark = await alertRepository.list({
			unreadOnly: true,
			limit: 10,
		})

		expect(unreadAfterMark).toHaveLength(1)

		const allAlerts = await alertRepository.list({
			unreadOnly: false,
			limit: 10,
		})

		expect(allAlerts).toHaveLength(2)

		await alertRepository.markAllRead()

		const unreadCountAfterMarkAll = await alertRepository.countUnread()
		expect(unreadCountAfterMarkAll).toBe(0)

		await alertRepository.deleteAll()

		const alertsAfterDelete = await alertRepository.list({
			unreadOnly: false,
			limit: 10,
		})

		expect(alertsAfterDelete).toHaveLength(0)
		expect(await alertRepository.countUnread()).toBe(0)
	})

	it('stores v3 governance, alert rule, incident, and retention entities', async () => {
		const db = createTestDatabase()
		const connectionRepository = new SqliteConnectionRepository(db)
		const alertRuleRepository = new SqliteAlertRuleRepository(db)
		const governancePolicyPackRepository =
			new SqliteGovernancePolicyPackRepository(db)
		const governanceAssignmentRepository =
			new SqliteGovernanceAssignmentRepository(db)
		const incidentBundleRepository = new SqliteIncidentBundleRepository(db)
		const retentionRepository = new SqliteRetentionRepository(db)
		const profile = createProfile()

		await connectionRepository.save(profile)

		const alertRule: AlertRule = {
			id: 'rule-1',
			name: 'High Error Rate',
			metric: 'errorRate',
			threshold: 0.2,
			lookbackMinutes: 10,
			severity: 'critical',
			connectionId: profile.id,
			environment: profile.environment,
			enabled: true,
			createdAt: '2026-02-17T03:15:00.000Z',
			updatedAt: '2026-02-17T03:15:00.000Z',
		}
		await alertRuleRepository.save(alertRule)

		const policyPack: GovernancePolicyPack = {
			id: 'policy-pack-1',
			name: 'Prod Guardrails',
			description: 'Restrict prod automation',
			environments: ['prod'],
			maxWorkflowItems: 150,
			maxRetryAttempts: 2,
			schedulingEnabled: true,
			executionWindows: [
				{
					id: 'window-1',
					weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'],
					startTime: '09:00',
					endTime: '17:00',
					timezone: 'UTC',
				},
			],
			enabled: true,
			createdAt: '2026-02-17T03:16:00.000Z',
			updatedAt: '2026-02-17T03:16:00.000Z',
		}
		await governancePolicyPackRepository.save(policyPack)
		await governanceAssignmentRepository.assign({
			connectionId: profile.id,
			policyPackId: policyPack.id,
		})

		const incidentBundle: IncidentBundle = {
			id: 'incident-1',
			createdAt: '2026-02-17T03:20:00.000Z',
			from: '2026-02-17T02:00:00.000Z',
			to: '2026-02-17T03:00:00.000Z',
			connectionIds: [profile.id],
			includes: ['timeline', 'logs', 'diagnostics', 'metrics'],
			redactionProfile: 'strict',
			checksum: 'abc123',
			artifactPath: '/tmp/incident-1.json',
			timelineCount: 10,
			logCount: 4,
			diagnosticCount: 2,
			metricCount: 8,
			truncated: false,
		}
		await incidentBundleRepository.save(incidentBundle)

		const retentionPolicy: RetentionPolicy = {
			dataset: 'incidentArtifacts',
			retentionDays: 14,
			storageBudgetMb: 64,
			autoPurgeOldest: true,
		}
		await retentionRepository.savePolicy(retentionPolicy)

		const rules = await alertRuleRepository.list()
		const packs = await governancePolicyPackRepository.list()
		const assignments = await governanceAssignmentRepository.list({
			connectionId: profile.id,
		})
		const bundles = await incidentBundleRepository.list(10)
		const retentionPolicies = await retentionRepository.listPolicies()
		const summary = await retentionRepository.getStorageSummary()

		expect(rules).toHaveLength(1)
		expect(rules[0].metric).toBe('errorRate')
		expect(packs).toHaveLength(1)
		expect(packs[0].executionWindows[0].id).toBe('window-1')
		expect(assignments).toHaveLength(1)
		expect(assignments[0].policyPackId).toBe(policyPack.id)
		expect(bundles).toHaveLength(1)
		expect(bundles[0].redactionProfile).toBe('strict')
		expect(bundles[0].truncated).toBe(false)
		expect(
			retentionPolicies.some(
				(policy) =>
					policy.dataset === 'incidentArtifacts' && policy.retentionDays === 14,
			),
		).toBe(true)
		expect(summary.datasets.length).toBeGreaterThan(0)
	})
})
