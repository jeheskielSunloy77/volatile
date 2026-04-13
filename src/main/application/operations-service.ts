import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { v4 as uuidv4 } from 'uuid'

import type {
	AlertEvent,
	AlertListRequest,
	AlertMarkAllReadRequest,
	AlertMarkReadRequest,
	AlertUnreadCountResult,
	AlertRule,
	AlertRuleCreateRequest,
	AlertRuleDeleteRequest,
	AlertRuleUpdateRequest,
	CompareMetricDelta,
	ComparePeriodsRequest,
	ComparePeriodsResult,
	ConnectionCapabilitiesRequest,
	CacheFlushRequest,
	ConnectionCreateRequest,
	ConnectionDeleteRequest,
	ConnectionGetRequest,
	ConnectionProfile,
	ConnectionSecret,
	ConnectionTestRequest,
	ConnectionUpdateRequest,
	NamespaceCreateRequest,
	NamespaceDeleteRequest,
	NamespaceListRequest,
	NamespaceProfile,
	NamespaceUpdateRequest,
	FailedOperationDiagnostic,
	FailedOperationDrilldownRequest,
	FailedOperationDrilldownResult,
	GovernanceAssignment,
	GovernanceAssignmentListRequest,
	GovernanceAssignmentRequest,
	GovernancePolicyPack,
	GovernancePolicyPackCreateRequest,
	GovernancePolicyPackDeleteRequest,
	GovernancePolicyPackUpdateRequest,
	HistoryEvent,
	HistoryQueryRequest,
	IncidentBundle,
	IncidentBundleExportJobCancelRequest,
	IncidentBundleExportJobGetRequest,
	IncidentBundleExportJobResumeRequest,
	IncidentBundleExportRequest,
	IncidentBundleExportStartRequest,
	IncidentBundleListRequest,
	IncidentBundlePreview,
	IncidentBundlePreviewRequest,
	IncidentExportJob,
	KeyCountRequest,
	KeyCountResult,
	KeyDeleteRequest,
	KeyGetRequest,
	KeyListRequest,
	KeyListResult,
	KeySearchRequest,
	KeySetRequest,
	KeyUpdateRequest,
	KeyspaceActivityPattern,
	KeyspaceActivityPoint,
	KeyspaceActivityRequest,
	KeyspaceActivityView,
	KeyValueRecord,
	MutationResult,
	ObservabilityDashboard,
	ObservabilityDashboardRequest,
	ObservabilitySnapshot,
	ProviderCapabilities,
	RetentionPolicy,
	RetentionPolicyListResult,
	RetentionPolicyUpdateRequest,
	RetentionPurgeRequest,
	RetentionPurgeResult,
	RollbackRestoreRequest,
	SnapshotListRequest,
	SnapshotRecord,
	StorageSummary,
	WorkflowDryRunPreview,
	WorkflowDryRunPreviewItem,
	WorkflowExecuteRequest,
	WorkflowExecutionGetRequest,
	WorkflowExecutionListRequest,
	WorkflowExecutionRecord,
	WorkflowKind,
	WorkflowRerunRequest,
	WorkflowResumeRequest,
	WorkflowStepResult,
	WorkflowStepRetryPolicy,
	WorkflowTemplate,
	WorkflowTemplateCreateRequest,
	WorkflowTemplateDeleteRequest,
	WorkflowTemplateDraft,
	WorkflowTemplatePreviewRequest,
	WorkflowTemplateUpdateRequest,
} from '../../shared/contracts/cache'
import { isRedisFamilyEngine } from '../../shared/lib/cache-engines'
import { OperationFailure } from '../domain/operation-failure'
import { assertConnectionWritable } from '../policies/read-only-policy'
import type {
	AlertRepository,
	AlertRuleRepository,
	CacheGateway,
	ConnectionRepository,
	EngineEventIngestor,
	EngineTimelineEventInput,
	GovernanceAssignmentRepository,
	GovernancePolicyPackRepository,
	HistoryRepository,
	IncidentBundleRepository,
	MemcachedKeyIndexRepository,
	NamespaceRepository,
	ObservabilityRepository,
	RetentionRepository,
	SecretStore,
	SnapshotRepository,
	WorkflowExecutionRepository,
	WorkflowTemplateRepository,
} from './ports'

const DEFAULT_TIMEOUT_MS = 5000
const DEFAULT_RETRY_MAX_ATTEMPTS = 1
const DEFAULT_RETRY_BACKOFF_MS = 250
const DEFAULT_RETRY_ABORT_ON_ERROR_RATE = 1
const SLOW_OPERATION_THRESHOLD_MS = 750
const DASHBOARD_DEFAULT_LIMIT = 200
const RETENTION_ALERT_COOLDOWN_MS = 5 * 60_000
const RETENTION_BUDGET_WARN_RATIO = 0.9
const INCIDENT_DATASET_SAMPLE_LIMIT = 5000

class IncidentExportCancelledError extends Error {
	public constructor() {
		super('Incident bundle export was cancelled.')
		this.name = 'IncidentExportCancelledError'
	}
}

type RetryPolicy = {
	maxAttempts: number
	backoffMs: number
	backoffStrategy: 'fixed' | 'exponential'
	abortOnErrorRate: number
}

type OperationStatus = 'success' | 'error' | 'blocked'

type IncidentBundleCollection = {
	connectionIds: string[]
	timeline: HistoryEvent[]
	logs: AlertEvent[]
	diagnostics: FailedOperationDiagnostic[]
	metrics: ObservabilitySnapshot[]
	truncated: boolean
}

type IncidentExportJobState = {
	job: IncidentExportJob
	cancelRequested: boolean
	execution: Promise<void> | null
}

type ExecuteWithPolicyArgs<T> = {
	profile: ConnectionProfile
	action: string
	keyOrPattern: string
	run: () => Promise<T>
	retryPolicy?: RetryPolicy
	suppressTelemetry?: boolean
}

type ExecuteWithPolicyResult<T> = {
	result: T
	attempts: number
	durationMs: number
}

type ServiceDependencies = {
	snapshotRepository: SnapshotRepository
	workflowTemplateRepository: WorkflowTemplateRepository
	workflowExecutionRepository: WorkflowExecutionRepository
	historyRepository: HistoryRepository
	observabilityRepository: ObservabilityRepository
	alertRepository: AlertRepository
	alertRuleRepository: AlertRuleRepository
	governancePolicyPackRepository: GovernancePolicyPackRepository
	governanceAssignmentRepository: GovernanceAssignmentRepository
	incidentBundleRepository: IncidentBundleRepository
	retentionRepository: RetentionRepository
	engineEventIngestor: EngineEventIngestor
	namespaceRepository: NamespaceRepository
}

const BUILTIN_WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
	{
		id: 'builtin-delete-by-pattern',
		name: 'Delete By Pattern',
		kind: 'deleteByPattern',
		parameters: {
			pattern: '*',
			limit: 100,
		},
		requiresApprovalOnProd: true,
		supportsDryRun: true,
		createdAt: '2026-02-17T00:00:00.000Z',
		updatedAt: '2026-02-17T00:00:00.000Z',
	},
	{
		id: 'builtin-ttl-normalize',
		name: 'TTL Normalize',
		kind: 'ttlNormalize',
		parameters: {
			pattern: '*',
			ttlSeconds: 3600,
			limit: 100,
		},
		requiresApprovalOnProd: true,
		supportsDryRun: true,
		createdAt: '2026-02-17T00:00:00.000Z',
		updatedAt: '2026-02-17T00:00:00.000Z',
	},
	{
		id: 'builtin-warmup-set',
		name: 'Warmup Set',
		kind: 'warmupSet',
		parameters: {
			entries: [],
		},
		requiresApprovalOnProd: false,
		supportsDryRun: true,
		createdAt: '2026-02-17T00:00:00.000Z',
		updatedAt: '2026-02-17T00:00:00.000Z',
	},
]

class InMemorySnapshotRepository implements SnapshotRepository {
	private readonly records: SnapshotRecord[] = []

	public async save(record: SnapshotRecord): Promise<void> {
		this.records.unshift(record)
	}

	public async list(args: {
		connectionId: string
		key?: string
		limit: number
	}): Promise<SnapshotRecord[]> {
		return this.records
			.filter(
				(record) =>
					record.connectionId === args.connectionId &&
					(args.key === undefined || args.key === record.key),
			)
			.slice(0, args.limit)
	}

	public async findLatest(args: {
		connectionId: string
		key: string
	}): Promise<SnapshotRecord | null> {
		return (
			this.records.find(
				(record) =>
					record.connectionId === args.connectionId && record.key === args.key,
			) ?? null
		)
	}

	public async findById(id: string): Promise<SnapshotRecord | null> {
		return this.records.find((record) => record.id === id) ?? null
	}
}

class InMemoryNamespaceRepository implements NamespaceRepository {
	private readonly records = new Map<string, NamespaceProfile>()

	public async listByConnectionId(connectionId: string): Promise<NamespaceProfile[]> {
		return Array.from(this.records.values())
			.filter((record) => record.connectionId === connectionId)
			.sort((left, right) => left.name.localeCompare(right.name))
	}

	public async findById(id: string): Promise<NamespaceProfile | null> {
		return this.records.get(id) ?? null
	}

	public async save(namespace: NamespaceProfile): Promise<void> {
		this.records.set(namespace.id, namespace)
	}

	public async delete(id: string): Promise<void> {
		this.records.delete(id)
	}
}

class InMemoryWorkflowTemplateRepository implements WorkflowTemplateRepository {
	private readonly records = new Map<string, WorkflowTemplate>()

	public async save(template: WorkflowTemplate): Promise<void> {
		this.records.set(template.id, template)
	}

	public async list(): Promise<WorkflowTemplate[]> {
		return Array.from(this.records.values())
	}

	public async findById(id: string): Promise<WorkflowTemplate | null> {
		return this.records.get(id) ?? null
	}

	public async delete(id: string): Promise<void> {
		this.records.delete(id)
	}
}

class InMemoryWorkflowExecutionRepository implements WorkflowExecutionRepository {
	private readonly records = new Map<string, WorkflowExecutionRecord>()

	public async save(record: WorkflowExecutionRecord): Promise<void> {
		this.records.set(record.id, record)
	}

	public async list(
		args: WorkflowExecutionListRequest,
	): Promise<WorkflowExecutionRecord[]> {
		return Array.from(this.records.values())
			.filter(
				(record) =>
					(args.connectionId === undefined ||
						record.connectionId === args.connectionId) &&
					(args.namespaceId === undefined ||
						record.namespaceId === args.namespaceId) &&
					(args.templateId === undefined ||
						record.workflowTemplateId === args.templateId),
			)
			.sort((left, right) => right.startedAt.localeCompare(left.startedAt))
			.slice(0, args.limit)
	}

	public async findById(id: string): Promise<WorkflowExecutionRecord | null> {
		return this.records.get(id) ?? null
	}
}

class InMemoryHistoryRepository implements HistoryRepository {
	private readonly events: HistoryEvent[] = []

	public async append(event: HistoryEvent): Promise<void> {
		this.events.unshift(event)
	}

	public async query(args: HistoryQueryRequest): Promise<HistoryEvent[]> {
		return this.events
			.filter((event) => {
				if (args.connectionId && event.connectionId !== args.connectionId) {
					return false
				}

				if (args.from && event.timestamp < args.from) {
					return false
				}

				if (args.to && event.timestamp > args.to) {
					return false
				}

				return true
			})
			.slice(0, args.limit)
	}
}

class InMemoryObservabilityRepository implements ObservabilityRepository {
	private readonly snapshots: ObservabilitySnapshot[] = []

	public async append(snapshot: ObservabilitySnapshot): Promise<void> {
		this.snapshots.unshift(snapshot)
	}

	public async query(args: {
		connectionId?: string
		from?: string
		to?: string
		limit: number
	}): Promise<ObservabilitySnapshot[]> {
		return this.snapshots
			.filter((snapshot) => {
				if (args.connectionId && snapshot.connectionId !== args.connectionId) {
					return false
				}

				if (args.from && snapshot.timestamp < args.from) {
					return false
				}

				if (args.to && snapshot.timestamp > args.to) {
					return false
				}

				return true
			})
			.slice(0, args.limit)
	}
}

class InMemoryAlertRepository implements AlertRepository {
	private readonly events = new Map<string, AlertEvent>()

	public async append(event: AlertEvent): Promise<void> {
		this.events.set(event.id, event)
	}

	public async list(request: AlertListRequest): Promise<AlertEvent[]> {
		return Array.from(this.events.values())
			.filter(
				(event) => !request.unreadOnly || (request.unreadOnly && !event.read),
			)
			.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
			.slice(0, request.limit)
	}

	public async countUnread(): Promise<number> {
		return Array.from(this.events.values()).filter((event) => !event.read).length
	}

	public async markRead(id: string): Promise<void> {
		const event = this.events.get(id)
		if (!event) {
			return
		}

		this.events.set(id, {
			...event,
			read: true,
		})
	}

	public async markAllRead(): Promise<void> {
		for (const [id, event] of this.events.entries()) {
			if (event.read) {
				continue
			}

			this.events.set(id, {
				...event,
				read: true,
			})
		}
	}

	public async deleteAll(): Promise<void> {
		this.events.clear()
	}
}

class InMemoryAlertRuleRepository implements AlertRuleRepository {
	private readonly rules = new Map<string, AlertRule>()

	public async list(): Promise<AlertRule[]> {
		return Array.from(this.rules.values()).sort((left, right) =>
			right.updatedAt.localeCompare(left.updatedAt),
		)
	}

	public async findById(id: string): Promise<AlertRule | null> {
		return this.rules.get(id) ?? null
	}

	public async save(rule: AlertRule): Promise<void> {
		this.rules.set(rule.id, rule)
	}

	public async delete(id: string): Promise<void> {
		this.rules.delete(id)
	}
}

class InMemoryGovernancePolicyPackRepository implements GovernancePolicyPackRepository {
	private readonly policyPacks = new Map<string, GovernancePolicyPack>()

	public async list(): Promise<GovernancePolicyPack[]> {
		return Array.from(this.policyPacks.values()).sort((left, right) =>
			right.updatedAt.localeCompare(left.updatedAt),
		)
	}

	public async findById(id: string): Promise<GovernancePolicyPack | null> {
		return this.policyPacks.get(id) ?? null
	}

	public async save(policyPack: GovernancePolicyPack): Promise<void> {
		this.policyPacks.set(policyPack.id, policyPack)
	}

	public async delete(id: string): Promise<void> {
		this.policyPacks.delete(id)
	}
}

class InMemoryGovernanceAssignmentRepository implements GovernanceAssignmentRepository {
	private readonly assignments = new Map<string, string>()

	public async list(
		args: GovernanceAssignmentListRequest,
	): Promise<GovernanceAssignment[]> {
		if (args.connectionId) {
			const policyPackId = this.assignments.get(args.connectionId)
			if (!policyPackId) {
				return []
			}

			return [
				{
					connectionId: args.connectionId,
					policyPackId,
				},
			]
		}

		return Array.from(this.assignments.entries()).map(
			([connectionId, policyPackId]) => ({
				connectionId,
				policyPackId,
			}),
		)
	}

	public async assign(args: {
		connectionId: string
		policyPackId?: string
	}): Promise<void> {
		if (!args.policyPackId) {
			this.assignments.delete(args.connectionId)
			return
		}

		this.assignments.set(args.connectionId, args.policyPackId)
	}
}

class InMemoryIncidentBundleRepository implements IncidentBundleRepository {
	private readonly bundles = new Map<string, IncidentBundle>()

	public async save(bundle: IncidentBundle): Promise<void> {
		this.bundles.set(bundle.id, bundle)
	}

	public async list(limit: number): Promise<IncidentBundle[]> {
		return Array.from(this.bundles.values())
			.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
			.slice(0, limit)
	}
}

class InMemoryRetentionRepository implements RetentionRepository {
	private readonly policies = new Map<
		RetentionPolicy['dataset'],
		RetentionPolicy
	>([
		['timelineEvents', this.defaultPolicy('timelineEvents')],
		['observabilitySnapshots', this.defaultPolicy('observabilitySnapshots')],
		['workflowHistory', this.defaultPolicy('workflowHistory')],
		['incidentArtifacts', this.defaultPolicy('incidentArtifacts')],
	])

	public async listPolicies(): Promise<RetentionPolicy[]> {
		return Array.from(this.policies.values()).sort((left, right) =>
			left.dataset.localeCompare(right.dataset),
		)
	}

	public async savePolicy(policy: RetentionPolicy): Promise<void> {
		this.policies.set(policy.dataset, policy)
	}

	public async purge(
		request: RetentionPurgeRequest,
	): Promise<RetentionPurgeResult> {
		return {
			dataset: request.dataset,
			cutoff: request.olderThan ?? new Date().toISOString(),
			dryRun: Boolean(request.dryRun),
			deletedRows: 0,
			freedBytes: 0,
		}
	}

	public async getStorageSummary(): Promise<StorageSummary> {
		const datasets = (await this.listPolicies()).map((policy) => ({
			dataset: policy.dataset,
			rowCount: 0,
			totalBytes: 0,
			budgetBytes: policy.storageBudgetMb * 1024 * 1024,
			usageRatio: 0,
			overBudget: false,
		}))

		return {
			generatedAt: new Date().toISOString(),
			datasets,
			totalBytes: 0,
		}
	}

	private defaultPolicy(dataset: RetentionPolicy['dataset']): RetentionPolicy {
		return {
			dataset,
			retentionDays: 30,
			storageBudgetMb: 512,
			autoPurgeOldest: true,
		}
	}
}

class NoopEngineEventIngestor implements EngineEventIngestor {
	public async start(args: {
		onEvent: (event: EngineTimelineEventInput) => Promise<void>
	}): Promise<void> {
		void args
	}

	public async stop(): Promise<void> {
		return Promise.resolve()
	}
}

export class OperationsService {
	private readonly snapshotRepository: SnapshotRepository

	private readonly workflowTemplateRepository: WorkflowTemplateRepository

	private readonly workflowExecutionRepository: WorkflowExecutionRepository

	private readonly historyRepository: HistoryRepository

	private readonly observabilityRepository: ObservabilityRepository

	private readonly alertRepository: AlertRepository

	private readonly alertRuleRepository: AlertRuleRepository

	private readonly governancePolicyPackRepository: GovernancePolicyPackRepository

	private readonly governanceAssignmentRepository: GovernanceAssignmentRepository

	private readonly incidentBundleRepository: IncidentBundleRepository

	private readonly retentionRepository: RetentionRepository

	private readonly engineEventIngestor: EngineEventIngestor

	private readonly namespaceRepository: NamespaceRepository

	private readonly operationSamples = new Map<
		string,
		Array<{ timestamp: number; durationMs: number; status: OperationStatus }>
	>()

	private readonly alertRuleCooldown = new Map<string, number>()

	private readonly retentionAlertCooldown = new Map<string, number>()

	private readonly incidentExportJobs = new Map<string, IncidentExportJobState>()

	public constructor(
		private readonly connectionRepository: ConnectionRepository,
		private readonly secretStore: SecretStore,
		private readonly memcachedKeyIndexRepository: MemcachedKeyIndexRepository,
		private readonly cacheGateway: CacheGateway,
		dependencies?: Partial<ServiceDependencies>,
	) {
		this.snapshotRepository =
			dependencies?.snapshotRepository ?? new InMemorySnapshotRepository()
		this.workflowTemplateRepository =
			dependencies?.workflowTemplateRepository ??
			new InMemoryWorkflowTemplateRepository()
		this.workflowExecutionRepository =
			dependencies?.workflowExecutionRepository ??
			new InMemoryWorkflowExecutionRepository()
		this.historyRepository =
			dependencies?.historyRepository ?? new InMemoryHistoryRepository()
		this.observabilityRepository =
			dependencies?.observabilityRepository ??
			new InMemoryObservabilityRepository()
		this.alertRepository =
			dependencies?.alertRepository ?? new InMemoryAlertRepository()
		this.alertRuleRepository =
			dependencies?.alertRuleRepository ?? new InMemoryAlertRuleRepository()
		this.governancePolicyPackRepository =
			dependencies?.governancePolicyPackRepository ??
			new InMemoryGovernancePolicyPackRepository()
		this.governanceAssignmentRepository =
			dependencies?.governanceAssignmentRepository ??
			new InMemoryGovernanceAssignmentRepository()
		this.incidentBundleRepository =
			dependencies?.incidentBundleRepository ??
			new InMemoryIncidentBundleRepository()
		this.retentionRepository =
			dependencies?.retentionRepository ?? new InMemoryRetentionRepository()
		this.engineEventIngestor =
			dependencies?.engineEventIngestor ?? new NoopEngineEventIngestor()
		this.namespaceRepository =
			dependencies?.namespaceRepository ?? new InMemoryNamespaceRepository()
	}

	public async startEngineEventIngestion(): Promise<void> {
		await this.engineEventIngestor.start({
			onEvent: async (event) => {
				await this.ingestEngineEvent(event)
			},
		})
	}

	public async stopEngineEventIngestion(): Promise<void> {
		await this.engineEventIngestor.stop()
	}

	public async listConnections(): Promise<ConnectionProfile[]> {
		return this.connectionRepository.list()
	}

	public async getConnection(
		payload: ConnectionGetRequest,
	): Promise<ConnectionProfile> {
		const profile = await this.connectionRepository.findById(payload.id)

		if (!profile) {
			throw new OperationFailure(
				'VALIDATION_ERROR',
				'Connection profile was not found.',
				false,
				{ id: payload.id },
			)
		}

		return profile
	}

	public async listNamespaces(
		payload: NamespaceListRequest,
	): Promise<NamespaceProfile[]> {
		await this.requireConnection(payload.connectionId)
		return this.namespaceRepository.listByConnectionId(payload.connectionId)
	}

	public async createNamespace(
		payload: NamespaceCreateRequest,
	): Promise<NamespaceProfile> {
		const connection = await this.requireConnection(payload.namespace.connectionId)
		validateNamespaceDraft(payload.namespace, connection.engine)

		const existing = await this.namespaceRepository.listByConnectionId(connection.id)
		assertNamespaceNameUnique(existing, payload.namespace.name)

		const now = new Date().toISOString()
		const namespace: NamespaceProfile = {
			id: uuidv4(),
			connectionId: connection.id,
			name: payload.namespace.name.trim(),
			engine: connection.engine,
			strategy: payload.namespace.strategy,
			dbIndex:
				payload.namespace.strategy === 'redisLogicalDb'
					? payload.namespace.dbIndex
					: undefined,
			keyPrefix:
				payload.namespace.strategy === 'keyPrefix'
					? payload.namespace.keyPrefix?.trim()
					: undefined,
			createdAt: now,
			updatedAt: now,
		}

		await this.namespaceRepository.save(namespace)
		return namespace
	}

	public async updateNamespace(
		payload: NamespaceUpdateRequest,
	): Promise<NamespaceProfile> {
		const existing = await this.namespaceRepository.findById(payload.id)
		if (!existing) {
			throw new OperationFailure(
				'VALIDATION_ERROR',
				'Namespace was not found.',
				false,
				{ id: payload.id },
			)
		}

		const siblings = await this.namespaceRepository.listByConnectionId(
			existing.connectionId,
		)
		assertNamespaceNameUnique(
			siblings.filter((namespace) => namespace.id !== existing.id),
			payload.name,
		)

		const updated: NamespaceProfile = {
			...existing,
			name: payload.name.trim(),
			updatedAt: new Date().toISOString(),
		}

		await this.namespaceRepository.save(updated)
		return updated
	}

	public async deleteNamespace(
		payload: NamespaceDeleteRequest,
	): Promise<MutationResult> {
		await this.namespaceRepository.delete(payload.id)
		return { success: true }
	}

	public async createConnection(
		payload: ConnectionCreateRequest,
	): Promise<ConnectionProfile> {
		const now = new Date().toISOString()
		const normalizedProfile = normalizeDraft(payload.profile)
		const id = uuidv4()

		const profile: ConnectionProfile = {
			id,
			...normalizedProfile,
			secretRef: id,
			createdAt: now,
			updatedAt: now,
		}

		let profileSaved = false
		try {
			await this.connectionRepository.save(profile)
			profileSaved = true
			await this.secretStore.saveSecret(profile.id, payload.secret)

			return profile
		} catch (error) {
			let rollbackSucceeded = false

			if (profileSaved) {
				try {
					await this.connectionRepository.delete(profile.id)
					rollbackSucceeded = true
				} catch (rollbackError) {
					void rollbackError
				}
			}

			throw new OperationFailure(
				'INTERNAL_ERROR',
				'Connection profile could not be saved securely. Please try again.',
				false,
				{
					rollbackAttempted: profileSaved,
					rollbackSucceeded: profileSaved ? rollbackSucceeded : undefined,
					stage: profileSaved ? 'secret-store' : 'metadata-store',
					cause: error instanceof Error ? error.message : 'unknown',
				},
			)
		}
	}

	public async updateConnection(
		payload: ConnectionUpdateRequest,
	): Promise<ConnectionProfile> {
		const existing = await this.connectionRepository.findById(payload.id)

		if (!existing) {
			throw new OperationFailure(
				'VALIDATION_ERROR',
				'Connection profile was not found.',
				false,
				{ id: payload.id },
			)
		}

		const normalizedProfile = normalizeDraft(payload.profile)

		const profile: ConnectionProfile = {
			...existing,
			...normalizedProfile,
			updatedAt: new Date().toISOString(),
		}

		await this.connectionRepository.save(profile)

		if (payload.secret) {
			await this.secretStore.saveSecret(profile.id, payload.secret)
		}

		return profile
	}

	public async deleteConnection(
		payload: ConnectionDeleteRequest,
	): Promise<MutationResult> {
		await this.connectionRepository.delete(payload.id)
		await this.secretStore.deleteSecret(payload.id)
		await this.memcachedKeyIndexRepository.deleteByConnectionId(payload.id)

		return {
			success: true,
		}
	}

	public async testConnection(
		payload: ConnectionTestRequest,
	): Promise<{ latencyMs: number; capabilities: ProviderCapabilities }> {
		const normalizedProfile = normalizeDraft(payload.profile)
		const resolvedSecret = await this.resolveTestSecret(payload)

		let lastError: unknown
		for (let attempt = 0; attempt < 2; attempt += 1) {
			try {
				return await withTimeout(
					this.cacheGateway.testConnection(normalizedProfile, resolvedSecret),
					normalizedProfile.timeoutMs,
				)
			} catch (error) {
				lastError = error
			}
		}

		if (lastError instanceof OperationFailure) {
			throw lastError
		}

		throw new OperationFailure(
			'CONNECTION_FAILED',
			'Connection test failed after retry.',
			true,
		)
	}

	public async getCapabilities(
		payload: ConnectionCapabilitiesRequest,
	): Promise<ProviderCapabilities> {
		const profile = await this.requireConnection(payload.connectionId)
		return this.cacheGateway.getCapabilities(profile)
	}

	public async listKeys(payload: KeyListRequest): Promise<KeyListResult> {
		const scope = await this.requireProfileWithSecretAndNamespace(
			payload.connectionId,
			payload.namespaceId,
		)
		const keyScope = this.createNamespaceKeyScope(scope.namespace)
		const namespacePrefix = this.resolveNamespacePrefix(scope.namespace)

		const { result } = await this.executeWithPolicy({
			profile: scope.profile,
			action: 'key.list',
			keyOrPattern: payload.cursor ?? '*',
			run: () =>
				namespacePrefix
					? this.cacheGateway.searchKeys(scope.profile, scope.secret, {
							pattern: `${namespacePrefix}*`,
							cursor: payload.cursor,
							limit: payload.limit,
						})
					: this.cacheGateway.listKeys(scope.profile, scope.secret, {
							cursor: payload.cursor,
							limit: payload.limit,
						}),
		})

		return {
			keys: keyScope.mapOutgoingKeys(result.keys),
			nextCursor: result.nextCursor,
		}
	}

	public async searchKeys(payload: KeySearchRequest): Promise<KeyListResult> {
		const scope = await this.requireProfileWithSecretAndNamespace(
			payload.connectionId,
			payload.namespaceId,
		)
		const keyScope = this.createNamespaceKeyScope(scope.namespace)
		const scopedPattern = keyScope.mapPatternForQuery(payload.pattern)

		const { result } = await this.executeWithPolicy({
			profile: scope.profile,
			action: 'key.search',
			keyOrPattern: payload.pattern,
			run: () =>
				this.cacheGateway.searchKeys(scope.profile, scope.secret, {
					pattern: scopedPattern,
					cursor: payload.cursor,
					limit: payload.limit,
				}),
		})

		return {
			keys: keyScope.mapOutgoingKeys(result.keys),
			nextCursor: result.nextCursor,
		}
	}

	public async countKeys(payload: KeyCountRequest): Promise<KeyCountResult> {
		const scope = await this.requireProfileWithSecretAndNamespace(
			payload.connectionId,
			payload.namespaceId,
		)
		const keyScope = this.createNamespaceKeyScope(scope.namespace)
		const namespacePrefix = this.resolveNamespacePrefix(scope.namespace)
		const trimmedPattern = payload.pattern?.trim()
		const hasPattern = Boolean(trimmedPattern && trimmedPattern.length > 0)

		if (!hasPattern) {
			if (namespacePrefix) {
				const scopedTotal = await this.cacheGateway.countKeysByPattern(
					scope.profile,
					scope.secret,
					{
						pattern: `${namespacePrefix}*`,
					},
				)
				return {
					totalKeys: scopedTotal.totalFoundKeys ?? 0,
				}
			}

			return this.cacheGateway.countKeys(scope.profile, scope.secret)
		}

		const pattern = trimmedPattern ?? ''
		if (namespacePrefix) {
			const [totalResult, foundResult] = await Promise.all([
				this.cacheGateway.countKeysByPattern(scope.profile, scope.secret, {
					pattern: `${namespacePrefix}*`,
				}),
				this.cacheGateway.countKeysByPattern(scope.profile, scope.secret, {
					pattern: keyScope.mapPatternForQuery(pattern),
				}),
			])

			return {
				totalKeys: totalResult.totalFoundKeys ?? 0,
				totalFoundKeys: foundResult.totalFoundKeys ?? 0,
			}
		}

		return this.cacheGateway.countKeysByPattern(scope.profile, scope.secret, {
			pattern,
		})
	}

	public async getKey(payload: KeyGetRequest): Promise<KeyValueRecord> {
		const scope = await this.requireProfileWithSecretAndNamespace(
			payload.connectionId,
			payload.namespaceId,
		)
		const keyScope = this.createNamespaceKeyScope(scope.namespace)
		const scopedKey = keyScope.mapKeyForMutation(payload.key)

		const { result } = await this.executeWithPolicy({
			profile: scope.profile,
			action: 'key.get',
			keyOrPattern: payload.key,
			run: () =>
				this.cacheGateway.getValue(scope.profile, scope.secret, scopedKey),
		})

		return result
	}

	public async setKey(payload: KeySetRequest): Promise<MutationResult> {
		const scope = await this.requireProfileWithSecretAndNamespace(
			payload.connectionId,
			payload.namespaceId,
		)
		const keyScope = this.createNamespaceKeyScope(scope.namespace)
		const scopedKey = keyScope.mapKeyForMutation(payload.key)

		await this.enforceWritable(scope.profile, 'key.set', payload.key)
		await this.captureSnapshot(
			scope.profile,
			scope.secret,
			payload.key,
			'set',
			scopedKey,
		)

		await this.executeWithPolicy({
			profile: scope.profile,
			action: 'key.set',
			keyOrPattern: payload.key,
			run: () =>
				this.cacheGateway.setValue(scope.profile, scope.secret, {
					key: scopedKey,
					value: payload.value,
					ttlSeconds: payload.ttlSeconds,
				}),
		})

		return {
			success: true,
		}
	}

	public async updateKey(payload: KeyUpdateRequest): Promise<MutationResult> {
		const scope = await this.requireProfileWithSecretAndNamespace(
			payload.connectionId,
			payload.namespaceId,
		)
		const keyScope = this.createNamespaceKeyScope(scope.namespace)
		const currentKey = payload.currentKey.trim()
		const nextKey = payload.key.trim()
		const currentScopedKey = keyScope.mapKeyForMutation(currentKey)
		const nextScopedKey = keyScope.mapKeyForMutation(nextKey)

		await this.enforceWritable(scope.profile, 'key.update', currentKey)
		if (nextKey !== currentKey) {
			await this.enforceWritable(scope.profile, 'key.update', nextKey)
			const existing = await this.cacheGateway.getValue(
				scope.profile,
				scope.secret,
				nextScopedKey,
			)
			const destinationExists =
				existing.keyType !== 'none' ||
				(existing.value !== null && existing.value !== undefined)
			if (destinationExists) {
				throw new OperationFailure(
					'CONFLICT',
					`Key "${nextKey}" already exists.`,
				)
			}
		}

		await this.captureSnapshot(
			scope.profile,
			scope.secret,
			currentKey,
			'set',
			currentScopedKey,
		)

		await this.executeWithPolicy({
			profile: scope.profile,
			action: 'key.update',
			keyOrPattern:
				currentKey === nextKey ? currentKey : `${currentKey} -> ${nextKey}`,
			run: async () => {
				await this.cacheGateway.setValue(scope.profile, scope.secret, {
					key: nextScopedKey,
					value: payload.value,
					ttlSeconds: payload.ttlSeconds,
				})

				if (nextScopedKey !== currentScopedKey) {
					await this.cacheGateway.deleteKey(
						scope.profile,
						scope.secret,
						currentScopedKey,
					)
				}
			},
		})

		return {
			success: true,
		}
	}

	public async deleteKey(payload: KeyDeleteRequest): Promise<MutationResult> {
		const scope = await this.requireProfileWithSecretAndNamespace(
			payload.connectionId,
			payload.namespaceId,
		)
		const keyScope = this.createNamespaceKeyScope(scope.namespace)
		const scopedKey = keyScope.mapKeyForMutation(payload.key)

		await this.enforceWritable(scope.profile, 'key.delete', payload.key)
		await this.enforceProdGuardrail(
			scope.profile,
			'key.delete',
			payload.key,
			payload.guardrailConfirmed,
		)
		await this.captureSnapshot(
			scope.profile,
			scope.secret,
			payload.key,
			'delete',
			scopedKey,
		)

		await this.executeWithPolicy({
			profile: scope.profile,
			action: 'key.delete',
			keyOrPattern: payload.key,
			run: () => this.cacheGateway.deleteKey(scope.profile, scope.secret, scopedKey),
		})

		return {
			success: true,
		}
	}

	public async flushCache(payload: CacheFlushRequest): Promise<MutationResult> {
		if (payload.scope === 'database') {
			const scope = await this.requireProfileWithSecretAndNamespace(
				payload.connectionId,
				payload.namespaceId,
			)

			await this.enforceWritable(scope.profile, 'cache.flush', 'database')
			await this.enforceProdGuardrail(
				scope.profile,
				'cache.flush',
				'database',
				payload.guardrailConfirmed,
			)

			await this.executeWithPolicy({
				profile: scope.profile,
				action: 'cache.flush',
				keyOrPattern: 'database',
				run: () =>
					this.cacheGateway.flush(scope.profile, scope.secret, {
						scope: 'database',
					}),
			})

			return {
				success: true,
			}
		}

		const scope = await this.requireProfileWithSecretAndNamespace(
			payload.connectionId,
			payload.namespaceId,
		)

		if (!scope.namespace) {
			throw new OperationFailure(
				'VALIDATION_ERROR',
				'Select a namespace before running a namespace flush.',
				false,
				{
					connectionId: payload.connectionId,
				},
			)
		}

		const namespaceTarget =
			scope.namespace.strategy === 'keyPrefix'
				? scope.namespace.keyPrefix ?? scope.namespace.name
				: scope.namespace.name

		await this.enforceWritable(scope.profile, 'cache.flush', namespaceTarget)
		await this.enforceProdGuardrail(
			scope.profile,
			'cache.flush',
			namespaceTarget,
			payload.guardrailConfirmed,
		)

		await this.executeWithPolicy({
			profile: scope.profile,
			action: 'cache.flush',
			keyOrPattern: namespaceTarget,
			run: () =>
				this.cacheGateway.flush(scope.profile, scope.secret, {
					scope: 'namespace',
					keyPrefix:
						scope.namespace?.strategy === 'keyPrefix'
							? scope.namespace.keyPrefix
							: undefined,
				}),
		})

		return {
			success: true,
		}
	}

	public async listSnapshots(
		payload: SnapshotListRequest,
	): Promise<SnapshotRecord[]> {
		await this.requireConnection(payload.connectionId)

		return this.snapshotRepository.list({
			connectionId: payload.connectionId,
			key: payload.key,
			limit: payload.limit,
		})
	}

	public async restoreSnapshot(
		payload: RollbackRestoreRequest,
	): Promise<MutationResult> {
		const scope = await this.requireProfileWithSecretAndNamespace(
			payload.connectionId,
			payload.namespaceId,
		)
		const keyScope = this.createNamespaceKeyScope(scope.namespace)
		const scopedKey = keyScope.mapKeyForMutation(payload.key)

		await this.enforceWritable(scope.profile, 'rollback.restore', payload.key)
		await this.enforceProdGuardrail(
			scope.profile,
			'rollback.restore',
			payload.key,
			payload.guardrailConfirmed,
		)

		const snapshot = payload.snapshotId
			? await this.snapshotRepository.findById(payload.snapshotId)
			: await this.snapshotRepository.findLatest({
					connectionId: payload.connectionId,
					key: payload.key,
				})

		if (
			!snapshot ||
			snapshot.connectionId !== payload.connectionId ||
			snapshot.key !== payload.key
		) {
			throw new OperationFailure(
				'VALIDATION_ERROR',
				'No rollback snapshot was found for this key.',
				false,
				{
					connectionId: payload.connectionId,
					key: payload.key,
					snapshotId: payload.snapshotId,
				},
			)
		}

		await this.executeWithPolicy({
			profile: scope.profile,
			action: 'rollback.restore',
			keyOrPattern: snapshot.key,
			run: async () => {
				if (snapshot.value === null) {
					await this.cacheGateway.deleteKey(scope.profile, scope.secret, scopedKey)
					return
				}

				await this.cacheGateway.setValue(scope.profile, scope.secret, {
					key: scopedKey,
					value: snapshot.value,
					ttlSeconds: snapshot.ttlSeconds,
				})
			},
		})

		return {
			success: true,
		}
	}

	public async listWorkflowTemplates(): Promise<WorkflowTemplate[]> {
		const templates = await this.workflowTemplateRepository.list()
		const merged = [...BUILTIN_WORKFLOW_TEMPLATES, ...templates]

		return merged.sort((left, right) => left.name.localeCompare(right.name))
	}

	public async createWorkflowTemplate(
		payload: WorkflowTemplateCreateRequest,
	): Promise<WorkflowTemplate> {
		const now = new Date().toISOString()
		const template: WorkflowTemplate = {
			id: uuidv4(),
			name: payload.template.name.trim(),
			kind: payload.template.kind,
			parameters: payload.template.parameters,
			requiresApprovalOnProd: payload.template.requiresApprovalOnProd,
			supportsDryRun: payload.template.supportsDryRun,
			createdAt: now,
			updatedAt: now,
		}

		await this.workflowTemplateRepository.save(template)

		return template
	}

	public async updateWorkflowTemplate(
		payload: WorkflowTemplateUpdateRequest,
	): Promise<WorkflowTemplate> {
		if (isBuiltinWorkflowId(payload.id)) {
			throw new OperationFailure(
				'UNAUTHORIZED',
				'Built-in workflow templates cannot be modified.',
				false,
			)
		}

		const existing = await this.workflowTemplateRepository.findById(payload.id)

		if (!existing) {
			throw new OperationFailure(
				'VALIDATION_ERROR',
				'Workflow template was not found.',
				false,
				{ id: payload.id },
			)
		}

		const template: WorkflowTemplate = {
			...existing,
			name: payload.template.name.trim(),
			kind: payload.template.kind,
			parameters: payload.template.parameters,
			requiresApprovalOnProd: payload.template.requiresApprovalOnProd,
			supportsDryRun: payload.template.supportsDryRun,
			updatedAt: new Date().toISOString(),
		}

		await this.workflowTemplateRepository.save(template)

		return template
	}

	public async deleteWorkflowTemplate(
		payload: WorkflowTemplateDeleteRequest,
	): Promise<MutationResult> {
		if (isBuiltinWorkflowId(payload.id)) {
			throw new OperationFailure(
				'UNAUTHORIZED',
				'Built-in workflow templates cannot be deleted.',
				false,
			)
		}

		await this.workflowTemplateRepository.delete(payload.id)

		return {
			success: true,
		}
	}

	public async previewWorkflow(
		payload: WorkflowTemplatePreviewRequest,
	): Promise<WorkflowDryRunPreview> {
		const scope = await this.requireProfileWithSecretAndNamespace(
			payload.connectionId,
			payload.namespaceId,
		)

		const { template, parameters } = await this.resolveWorkflowTemplate({
			templateId: payload.templateId,
			template: payload.template,
			parameterOverrides: payload.parameterOverrides,
		})

		return this.buildWorkflowPreview(
			scope.profile,
			scope.secret,
			template.kind,
			applyNamespaceToWorkflowParameters(
				template.kind,
				parameters,
				scope.namespace,
			),
			{
				cursor: payload.cursor,
				limit: payload.limit,
			},
		)
	}

	public async executeWorkflow(
		payload: WorkflowExecuteRequest,
	): Promise<WorkflowExecutionRecord> {
		const scope = await this.requireProfileWithSecretAndNamespace(
			payload.connectionId,
			payload.namespaceId,
		)
		const { profile, secret } = scope

		const { template, parameters } = await this.resolveWorkflowTemplate({
			templateId: payload.templateId,
			template: payload.template,
			parameterOverrides: payload.parameterOverrides,
		})
		const scopedParameters = applyNamespaceToWorkflowParameters(
			template.kind,
			parameters,
			scope.namespace,
		)

		if (!payload.dryRun) {
			await this.enforceWritable(profile, 'workflow.execute', template.name)
		}

		if (template.requiresApprovalOnProd) {
			await this.enforceProdGuardrail(
				profile,
				'workflow.execute',
				template.name,
				payload.guardrailConfirmed,
			)
		}

		const governanceContext = payload.dryRun
			? {
					policyPack: undefined,
					activeWindowId: undefined,
				}
			: await this.resolveGovernanceExecutionContext(profile, 'workflow.execute')
		const maxPreviewItems = governanceContext.policyPack
			? Math.min(500, governanceContext.policyPack.maxWorkflowItems)
			: 500

		const execution: WorkflowExecutionRecord = {
			id: uuidv4(),
			workflowTemplateId: payload.templateId,
			workflowName: template.name,
			workflowKind: template.kind,
			connectionId: profile.id,
			namespaceId: payload.namespaceId,
			startedAt: new Date().toISOString(),
			status: 'running',
			retryCount: 0,
			dryRun: Boolean(payload.dryRun),
			parameters: scopedParameters,
			stepResults: [],
			policyPackId: governanceContext.policyPack?.id,
			scheduleWindowId: governanceContext.activeWindowId,
		}

		await this.workflowExecutionRepository.save(execution)

		const preview = await this.buildWorkflowPreview(
			profile,
			secret,
			template.kind,
			scopedParameters,
			{
				limit: maxPreviewItems,
			},
		)

		if (payload.dryRun) {
			const now = new Date().toISOString()
			const completed: WorkflowExecutionRecord = {
				...execution,
				finishedAt: now,
				status: 'success',
				stepResults: [
					{
						step: 'dry-run',
						status: 'success',
						attempts: 1,
						durationMs: 0,
						message: `Previewed ${preview.estimatedCount} item(s).`,
					},
				],
			}

			await this.workflowExecutionRepository.save(completed)
			await this.enforceRetentionForDatasets(['workflowHistory'])
			return completed
		}

		const retryPolicy = this.resolveRetryPolicy(profile, payload.retryPolicy)
		if (governanceContext.policyPack) {
			retryPolicy.maxAttempts = Math.min(
				retryPolicy.maxAttempts,
				governanceContext.policyPack.maxRetryAttempts,
			)
		}

		const stepOutcome = await this.runWorkflowItems({
			profile,
			secret,
			items: preview.items,
			startIndex: 0,
			retryPolicy,
		})

		const now = new Date().toISOString()
		const retryCount = stepOutcome.stepResults.reduce(
			(accumulator, step) => accumulator + Math.max(0, step.attempts - 1),
			0,
		)

		const status =
			stepOutcome.errorCount === 0
				? 'success'
				: stepOutcome.aborted
					? 'aborted'
					: 'error'

		const result: WorkflowExecutionRecord = {
			...execution,
			finishedAt: now,
			status,
			retryCount,
			stepResults: stepOutcome.stepResults,
			checkpointToken:
				status === 'success' ? undefined : stepOutcome.checkpointToken,
			errorMessage:
				status === 'success'
					? undefined
					: status === 'aborted'
						? 'Workflow aborted by error-rate policy.'
						: 'One or more workflow steps failed.',
		}

		await this.workflowExecutionRepository.save(result)
		await this.enforceRetentionForDatasets(['workflowHistory'])

		if (status !== 'success') {
			await this.emitAlert({
				connectionId: profile.id,
				environment: profile.environment,
				severity: status === 'aborted' ? 'critical' : 'warning',
				title: `Workflow ${status}`,
				message: `${template.name} completed with status: ${status}.`,
				source: 'workflow',
			})
		}

		return result
	}

	public async rerunWorkflow(
		payload: WorkflowRerunRequest,
	): Promise<WorkflowExecutionRecord> {
		const execution = await this.workflowExecutionRepository.findById(
			payload.executionId,
		)

		if (!execution) {
			throw new OperationFailure(
				'VALIDATION_ERROR',
				'Workflow execution record was not found.',
				false,
				{ id: payload.executionId },
			)
		}

		const fallbackTemplate: WorkflowTemplateDraft = {
			name: execution.workflowName,
			kind: execution.workflowKind,
			parameters: execution.parameters,
			requiresApprovalOnProd: true,
			supportsDryRun: true,
		}

		return this.executeWorkflow({
			connectionId: execution.connectionId,
			namespaceId: execution.namespaceId,
			templateId: execution.workflowTemplateId,
			template: execution.workflowTemplateId ? undefined : fallbackTemplate,
			parameterOverrides: payload.parameterOverrides,
			dryRun: payload.dryRun,
			guardrailConfirmed: payload.guardrailConfirmed,
		})
	}

	public async listWorkflowExecutions(
		payload: WorkflowExecutionListRequest,
	): Promise<WorkflowExecutionRecord[]> {
		return this.workflowExecutionRepository.list(payload)
	}

	public async getWorkflowExecution(
		payload: WorkflowExecutionGetRequest,
	): Promise<WorkflowExecutionRecord> {
		const execution = await this.workflowExecutionRepository.findById(payload.id)

		if (!execution) {
			throw new OperationFailure(
				'VALIDATION_ERROR',
				'Workflow execution was not found.',
				false,
				{ id: payload.id },
			)
		}

		return execution
	}

	public async listHistory(
		payload: HistoryQueryRequest,
	): Promise<HistoryEvent[]> {
		return this.historyRepository.query(payload)
	}

	public async ingestEngineEvent(
		payload: EngineTimelineEventInput,
	): Promise<void> {
		const profile = await this.connectionRepository.findById(payload.connectionId)
		if (!profile) {
			return
		}

		const event: HistoryEvent = {
			id: uuidv4(),
			timestamp: payload.timestamp ?? new Date().toISOString(),
			source: 'engine',
			connectionId: payload.connectionId,
			environment: payload.environment ?? profile.environment,
			action: payload.action,
			keyOrPattern: payload.keyOrPattern,
			durationMs: Math.max(0, Math.round(payload.durationMs ?? 0)),
			status: payload.status,
			errorCode: payload.errorCode,
			retryable: payload.retryable,
			details: payload.details,
		}

		await this.historyRepository.append(event)
		await this.enforceRetentionForDatasets(['timelineEvents'])

		if (event.status === 'error') {
			await this.emitAlert({
				connectionId: event.connectionId,
				environment: event.environment,
				severity: 'warning',
				title: 'Engine event error',
				message: `${event.action} failed on ${event.keyOrPattern}.`,
				source: 'observability',
			})
		} else if (event.durationMs >= SLOW_OPERATION_THRESHOLD_MS) {
			await this.emitAlert({
				connectionId: event.connectionId,
				environment: event.environment,
				severity: 'info',
				title: 'Slow engine event detected',
				message: `${event.action} took ${event.durationMs}ms.`,
				source: 'observability',
			})
		}

		await this.evaluateAlertRulesForEvent({
			profile,
			timestamp: event.timestamp,
		})
	}

	public async getObservabilityDashboard(
		payload: ObservabilityDashboardRequest,
	): Promise<ObservabilityDashboard> {
		const now = new Date().toISOString()
		const sampleLimit = clampInteger(
			payload.limit,
			1,
			2000,
			DASHBOARD_DEFAULT_LIMIT,
		)

		const [connections, timelineSample, snapshotsSample] = await Promise.all([
			this.connectionRepository.list(),
			this.historyRepository.query({
				connectionId: payload.connectionId,
				from: payload.from,
				to: payload.to,
				limit: sampleLimit + 1,
			}),
			this.observabilityRepository.query({
				connectionId: payload.connectionId,
				from: payload.from,
				to: payload.to,
				limit: sampleLimit + 1,
			}),
		])
		const timeline = timelineSample.slice(0, sampleLimit)
		const snapshots = snapshotsSample.slice(0, sampleLimit)
		const truncated =
			timelineSample.length > sampleLimit || snapshotsSample.length > sampleLimit

		const latestByConnection = new Map<string, ObservabilitySnapshot>()
		for (const snapshot of snapshots) {
			if (!latestByConnection.has(snapshot.connectionId)) {
				latestByConnection.set(snapshot.connectionId, snapshot)
			}
		}

		const health = connections.map((connection) => {
			const snapshot = latestByConnection.get(connection.id)
			if (!snapshot) {
				return {
					connectionId: connection.id,
					connectionName: connection.name,
					environment: connection.environment,
					status: 'offline' as const,
					latencyP95Ms: 0,
					errorRate: 0,
					opsPerSecond: 0,
					slowOpCount: 0,
				}
			}

			const degraded =
				snapshot.errorRate >= 0.35 ||
				snapshot.latencyP95Ms >= SLOW_OPERATION_THRESHOLD_MS

			return {
				connectionId: connection.id,
				connectionName: connection.name,
				environment: connection.environment,
				status: degraded ? ('degraded' as const) : ('healthy' as const),
				latencyP95Ms: snapshot.latencyP95Ms,
				errorRate: snapshot.errorRate,
				opsPerSecond: snapshot.opsPerSecond,
				slowOpCount: snapshot.slowOpCount,
			}
		})

		const intervalMinutes = payload.intervalMinutes ?? 5
		const trendMap = new Map<
			string,
			{ operationCount: number; errorCount: number; totalDurationMs: number }
		>()

		for (const event of timeline) {
			const bucket = toTimeBucket(event.timestamp, intervalMinutes)
			const current = trendMap.get(bucket) ?? {
				operationCount: 0,
				errorCount: 0,
				totalDurationMs: 0,
			}

			current.operationCount += 1
			current.totalDurationMs += event.durationMs
			if (event.status === 'error') {
				current.errorCount += 1
			}

			trendMap.set(bucket, current)
		}

		const trends = Array.from(trendMap.entries())
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([bucket, value]) => ({
				bucket,
				operationCount: value.operationCount,
				errorCount: value.errorCount,
				avgDurationMs:
					value.operationCount === 0
						? 0
						: Math.round(value.totalDurationMs / value.operationCount),
			}))

		const heatmapMap = new Map<
			string,
			{
				connectionId: string
				environment: ConnectionProfile['environment']
				errorCount: number
			}
		>()
		for (const event of timeline) {
			if (event.status !== 'error') {
				continue
			}

			const key = `${event.connectionId}:${event.environment}`
			const current = heatmapMap.get(key) ?? {
				connectionId: event.connectionId,
				environment: event.environment,
				errorCount: 0,
			}
			current.errorCount += 1
			heatmapMap.set(key, current)
		}

		const heatmap = Array.from(heatmapMap.values()).sort(
			(left, right) => right.errorCount - left.errorCount,
		)

		const slowOperations = timeline.filter(
			(event) => event.durationMs >= SLOW_OPERATION_THRESHOLD_MS,
		)

		return {
			generatedAt: now,
			truncated,
			health,
			trends,
			heatmap,
			timeline,
			slowOperations,
		}
	}

	public async listAlerts(payload: AlertListRequest): Promise<AlertEvent[]> {
		return this.alertRepository.list(payload)
	}

	public async getUnreadAlertCount(): Promise<AlertUnreadCountResult> {
		return {
			unreadCount: await this.alertRepository.countUnread(),
		}
	}

	public async markAlertRead(
		payload: AlertMarkReadRequest,
	): Promise<MutationResult> {
		await this.alertRepository.markRead(payload.id)

		return {
			success: true,
		}
	}

	public async markAllAlertsRead(
		payload: AlertMarkAllReadRequest,
	): Promise<MutationResult> {
		void payload
		await this.alertRepository.markAllRead()

		return {
			success: true,
		}
	}

	public async deleteAllAlerts(): Promise<MutationResult> {
		await this.alertRepository.deleteAll()

		return {
			success: true,
		}
	}

	public async resumeWorkflow(
		payload: WorkflowResumeRequest,
	): Promise<WorkflowExecutionRecord> {
		const execution = await this.workflowExecutionRepository.findById(
			payload.executionId,
		)

		if (!execution) {
			throw new OperationFailure(
				'VALIDATION_ERROR',
				'Workflow execution record was not found.',
				false,
				{ id: payload.executionId },
			)
		}

		if (execution.status === 'success' || !execution.checkpointToken) {
			throw new OperationFailure(
				'CONFLICT',
				'This workflow execution does not have a resumable checkpoint.',
				false,
				{
					executionId: execution.id,
					status: execution.status,
				},
			)
		}

		const { profile, secret } = await this.requireProfileWithSecret(
			execution.connectionId,
		)

		await this.enforceWritable(profile, 'workflow.resume', execution.workflowName)
		await this.enforceProdGuardrail(
			profile,
			'workflow.resume',
			execution.workflowName,
			payload.guardrailConfirmed,
		)

		const governanceContext = await this.resolveGovernanceExecutionContext(
			profile,
			'workflow.resume',
		)
		const maxPreviewItems = governanceContext.policyPack
			? Math.min(500, governanceContext.policyPack.maxWorkflowItems)
			: 500
		const preview = await this.buildWorkflowPreview(
			profile,
			secret,
			execution.workflowKind,
			execution.parameters,
			{
				limit: maxPreviewItems,
			},
		)
		const startIndex = clampInteger(
			Number(execution.checkpointToken),
			0,
			preview.items.length,
			0,
		)

		if (startIndex >= preview.items.length) {
			throw new OperationFailure(
				'CONFLICT',
				'No workflow items are pending for this checkpoint.',
				false,
				{
					executionId: execution.id,
					checkpointToken: execution.checkpointToken,
				},
			)
		}

		const resumedExecution: WorkflowExecutionRecord = {
			id: uuidv4(),
			workflowTemplateId: execution.workflowTemplateId,
			workflowName: execution.workflowName,
			workflowKind: execution.workflowKind,
			connectionId: execution.connectionId,
			startedAt: new Date().toISOString(),
			status: 'running',
			retryCount: 0,
			dryRun: false,
			parameters: execution.parameters,
			stepResults: [],
			policyPackId: governanceContext.policyPack?.id ?? execution.policyPackId,
			scheduleWindowId:
				governanceContext.activeWindowId ?? execution.scheduleWindowId,
			resumedFromExecutionId: execution.id,
		}

		await this.workflowExecutionRepository.save(resumedExecution)

		const retryPolicy = this.resolveRetryPolicy(profile)
		if (governanceContext.policyPack) {
			retryPolicy.maxAttempts = Math.min(
				retryPolicy.maxAttempts,
				governanceContext.policyPack.maxRetryAttempts,
			)
		}

		const stepOutcome = await this.runWorkflowItems({
			profile,
			secret,
			items: preview.items,
			startIndex,
			retryPolicy,
		})

		const finishedAt = new Date().toISOString()
		const retryCount = stepOutcome.stepResults.reduce(
			(accumulator, step) => accumulator + Math.max(0, step.attempts - 1),
			0,
		)
		const status =
			stepOutcome.errorCount === 0
				? 'success'
				: stepOutcome.aborted
					? 'aborted'
					: 'error'

		const result: WorkflowExecutionRecord = {
			...resumedExecution,
			finishedAt,
			status,
			retryCount,
			stepResults: stepOutcome.stepResults,
			checkpointToken:
				status === 'success' ? undefined : stepOutcome.checkpointToken,
			errorMessage:
				status === 'success'
					? undefined
					: status === 'aborted'
						? 'Workflow aborted by error-rate policy.'
						: 'One or more workflow steps failed.',
		}

		await this.workflowExecutionRepository.save(result)
		await this.enforceRetentionForDatasets(['workflowHistory'])

		if (status !== 'success') {
			await this.emitAlert({
				connectionId: profile.id,
				environment: profile.environment,
				severity: status === 'aborted' ? 'critical' : 'warning',
				title: `Workflow ${status}`,
				message: `${execution.workflowName} completed with status: ${status}.`,
				source: 'workflow',
			})
		}

		return result
	}

	public async getKeyspaceActivity(
		payload: KeyspaceActivityRequest,
	): Promise<KeyspaceActivityView> {
		const sampleLimit = clampInteger(payload.limit, 1, 5000, 1000)
		const eventsSample = await this.historyRepository.query({
			connectionId: payload.connectionId,
			from: payload.from,
			to: payload.to,
			limit: sampleLimit + 1,
		})
		const events = eventsSample.slice(0, sampleLimit)
		const truncated = eventsSample.length > sampleLimit

		const patternMap = new Map<
			string,
			{ touchCount: number; errorCount: number; lastTouchedAt?: string }
		>()
		for (const event of events) {
			const pattern = toKeyspacePattern(event.keyOrPattern)
			const current = patternMap.get(pattern) ?? {
				touchCount: 0,
				errorCount: 0,
			}
			current.touchCount += 1
			if (event.status === 'error') {
				current.errorCount += 1
			}
			if (!current.lastTouchedAt || event.timestamp > current.lastTouchedAt) {
				current.lastTouchedAt = event.timestamp
			}
			patternMap.set(pattern, current)
		}

		const topPatterns: KeyspaceActivityPattern[] = Array.from(
			patternMap.entries(),
		)
			.map(([pattern, aggregate]) => ({
				pattern,
				touchCount: aggregate.touchCount,
				errorCount: aggregate.errorCount,
				lastTouchedAt: aggregate.lastTouchedAt,
			}))
			.sort((left, right) => {
				if (right.touchCount !== left.touchCount) {
					return right.touchCount - left.touchCount
				}
				if (right.errorCount !== left.errorCount) {
					return right.errorCount - left.errorCount
				}
				return left.pattern.localeCompare(right.pattern)
			})
			.slice(0, clampInteger(payload.limit, 1, 500, 50))

		const bucketMap = new Map<string, { touches: number; errors: number }>()
		const intervalMinutes = clampInteger(payload.intervalMinutes, 1, 1440, 5)
		for (const event of events) {
			const bucket = toTimeBucket(event.timestamp, intervalMinutes)
			const current = bucketMap.get(bucket) ?? {
				touches: 0,
				errors: 0,
			}

			current.touches += 1
			if (event.status === 'error') {
				current.errors += 1
			}

			bucketMap.set(bucket, current)
		}

		const distribution: KeyspaceActivityPoint[] = Array.from(bucketMap.entries())
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([bucket, aggregate]) => ({
				bucket,
				touches: aggregate.touches,
				errors: aggregate.errors,
			}))

		return {
			generatedAt: new Date().toISOString(),
			from: payload.from,
			to: payload.to,
			totalEvents: events.length,
			truncated,
			topPatterns,
			distribution,
		}
	}

	public async getFailedOperationDrilldown(
		payload: FailedOperationDrilldownRequest,
	): Promise<FailedOperationDrilldownResult> {
		const timelineSampleLimit = clampInteger(payload.limit, 1, 5000, 1000)
		const timelineSample = await this.historyRepository.query({
			connectionId: payload.connectionId,
			from: payload.from,
			to: payload.to,
			limit: timelineSampleLimit + 1,
		})
		const timeline = timelineSample.slice(0, timelineSampleLimit)
		const timelineTruncated = timelineSample.length > timelineSampleLimit

		const errorEvents = timeline.filter((event) => event.status === 'error')
		const diagnosticLimit = clampInteger(payload.limit, 1, 500, 50)
		const selectedEvents = payload.eventId
			? errorEvents.filter((event) => event.id === payload.eventId)
			: errorEvents.slice(0, diagnosticLimit)
		const diagnosticsTruncated =
			!payload.eventId && errorEvents.length > diagnosticLimit

		const diagnostics = await Promise.all(
			selectedEvents.map(async (event): Promise<FailedOperationDiagnostic> => {
				const eventTime = new Date(event.timestamp).getTime()
				const relatedEvents = timeline
					.filter((candidate) => {
						if (candidate.connectionId !== event.connectionId) {
							return false
						}

						if (candidate.keyOrPattern !== event.keyOrPattern) {
							return false
						}

						const candidateTime = new Date(candidate.timestamp).getTime()
						if (Number.isNaN(eventTime) || Number.isNaN(candidateTime)) {
							return false
						}

						return Math.abs(candidateTime - eventTime) <= 5 * 60 * 1000
					})
					.slice(0, 10)

				const snapshots = await this.observabilityRepository.query({
					connectionId: event.connectionId,
					to: event.timestamp,
					limit: 1,
				})

				return {
					event,
					retryAttempts:
						typeof event.details?.attempts === 'number'
							? Math.max(1, Math.trunc(event.details.attempts))
							: 1,
					relatedEvents,
					latestSnapshot: snapshots[0],
				}
			}),
		)

		return {
			generatedAt: new Date().toISOString(),
			totalErrorEvents: errorEvents.length,
			truncated: timelineTruncated || diagnosticsTruncated,
			diagnostics,
		}
	}

	public async comparePeriods(
		payload: ComparePeriodsRequest,
	): Promise<ComparePeriodsResult> {
		const baseline = await this.aggregatePeriodMetrics({
			connectionId: payload.connectionId,
			from: payload.baselineFrom,
			to: payload.baselineTo,
		})
		const compare = await this.aggregatePeriodMetrics({
			connectionId: payload.connectionId,
			from: payload.compareFrom,
			to: payload.compareTo,
		})

		const metrics: CompareMetricDelta[] = [
			buildCompareMetric({
				metric: 'operationCount',
				baseline: baseline.operationCount,
				compare: compare.operationCount,
				lowerIsBetter: false,
			}),
			buildCompareMetric({
				metric: 'errorRate',
				baseline: baseline.errorRate,
				compare: compare.errorRate,
				lowerIsBetter: true,
			}),
			buildCompareMetric({
				metric: 'latencyP95Ms',
				baseline: baseline.latencyP95Ms,
				compare: compare.latencyP95Ms,
				lowerIsBetter: true,
			}),
			buildCompareMetric({
				metric: 'slowOpCount',
				baseline: baseline.slowOpCount,
				compare: compare.slowOpCount,
				lowerIsBetter: true,
			}),
		]

		return {
			generatedAt: new Date().toISOString(),
			baselineLabel: `${payload.baselineFrom} -> ${payload.baselineTo}`,
			compareLabel: `${payload.compareFrom} -> ${payload.compareTo}`,
			baselineSampledEvents: baseline.sampledEvents,
			compareSampledEvents: compare.sampledEvents,
			truncated: baseline.truncated || compare.truncated,
			metrics,
		}
	}

	public async previewIncidentBundle(
		payload: IncidentBundlePreviewRequest,
	): Promise<IncidentBundlePreview> {
		const data = await this.collectIncidentBundleData(payload)
		return this.buildIncidentBundlePreview(payload, data)
	}

	public async listIncidentBundles(
		payload: IncidentBundleListRequest,
	): Promise<IncidentBundle[]> {
		return this.incidentBundleRepository.list(payload.limit)
	}

	public async exportIncidentBundle(
		payload: IncidentBundleExportRequest,
	): Promise<IncidentBundle> {
		const { bundle } = await this.runIncidentBundleExport(payload)
		return bundle
	}

	public async startIncidentBundleExport(
		payload: IncidentBundleExportStartRequest,
	): Promise<IncidentExportJob> {
		const id = uuidv4()
		const now = new Date().toISOString()
		const destinationPath =
			payload.destinationPath?.trim() ||
			path.join(os.tmpdir(), `volatile-incident-${id}.json`)

		const jobState: IncidentExportJobState = {
			job: {
				id,
				status: 'pending',
				stage: 'queued',
				progressPercent: 0,
				createdAt: now,
				updatedAt: now,
				request: {
					...payload,
					destinationPath,
				},
				destinationPath,
			},
			cancelRequested: false,
			execution: null,
		}

		this.incidentExportJobs.set(id, jobState)
		this.scheduleIncidentExportJob(jobState)

		return this.cloneIncidentExportJob(jobState.job)
	}

	public async cancelIncidentBundleExport(
		payload: IncidentBundleExportJobCancelRequest,
	): Promise<IncidentExportJob> {
		const jobState = this.requireIncidentExportJob(payload.jobId)

		if (jobState.job.status === 'success' || jobState.job.status === 'failed') {
			return this.cloneIncidentExportJob(jobState.job)
		}

		jobState.cancelRequested = true
		if (jobState.job.status === 'pending') {
			this.updateIncidentExportJob(jobState, {
				status: 'cancelled',
				stage: 'cancelled',
			})
		} else if (jobState.job.status !== 'cancelled') {
			this.updateIncidentExportJob(jobState, {
				status: 'cancelling',
			})
		}

		return this.cloneIncidentExportJob(jobState.job)
	}

	public async resumeIncidentBundleExport(
		payload: IncidentBundleExportJobResumeRequest,
	): Promise<IncidentExportJob> {
		const jobState = this.requireIncidentExportJob(payload.jobId)

		if (jobState.job.status !== 'cancelled' && jobState.job.status !== 'failed') {
			return this.cloneIncidentExportJob(jobState.job)
		}

		jobState.cancelRequested = false
		this.updateIncidentExportJob(jobState, {
			status: 'pending',
			stage: 'queued',
			progressPercent: 0,
			errorMessage: undefined,
			bundle: undefined,
			checksumPreview: undefined,
			truncated: undefined,
			manifest: undefined,
		})
		this.scheduleIncidentExportJob(jobState)

		return this.cloneIncidentExportJob(jobState.job)
	}

	public async getIncidentBundleExportJob(
		payload: IncidentBundleExportJobGetRequest,
	): Promise<IncidentExportJob> {
		const jobState = this.requireIncidentExportJob(payload.jobId)
		return this.cloneIncidentExportJob(jobState.job)
	}

	public async listAlertRules(): Promise<AlertRule[]> {
		return this.alertRuleRepository.list()
	}

	public async createAlertRule(
		payload: AlertRuleCreateRequest,
	): Promise<AlertRule> {
		const now = new Date().toISOString()
		const rule: AlertRule = {
			id: uuidv4(),
			name: payload.rule.name.trim(),
			metric: payload.rule.metric,
			threshold: payload.rule.threshold,
			lookbackMinutes: payload.rule.lookbackMinutes,
			severity: payload.rule.severity,
			connectionId: payload.rule.connectionId,
			environment: payload.rule.environment,
			enabled: payload.rule.enabled,
			createdAt: now,
			updatedAt: now,
		}

		await this.alertRuleRepository.save(rule)

		return rule
	}

	public async updateAlertRule(
		payload: AlertRuleUpdateRequest,
	): Promise<AlertRule> {
		const existing = await this.alertRuleRepository.findById(payload.id)
		if (!existing) {
			throw new OperationFailure(
				'VALIDATION_ERROR',
				'Alert rule was not found.',
				false,
				{ id: payload.id },
			)
		}

		const rule: AlertRule = {
			...existing,
			name: payload.rule.name.trim(),
			metric: payload.rule.metric,
			threshold: payload.rule.threshold,
			lookbackMinutes: payload.rule.lookbackMinutes,
			severity: payload.rule.severity,
			connectionId: payload.rule.connectionId,
			environment: payload.rule.environment,
			enabled: payload.rule.enabled,
			updatedAt: new Date().toISOString(),
		}

		await this.alertRuleRepository.save(rule)

		return rule
	}

	public async deleteAlertRule(
		payload: AlertRuleDeleteRequest,
	): Promise<MutationResult> {
		await this.alertRuleRepository.delete(payload.id)

		return {
			success: true,
		}
	}

	public async listGovernancePolicyPacks(): Promise<GovernancePolicyPack[]> {
		return this.governancePolicyPackRepository.list()
	}

	public async createGovernancePolicyPack(
		payload: GovernancePolicyPackCreateRequest,
	): Promise<GovernancePolicyPack> {
		const now = new Date().toISOString()
		const policyPack: GovernancePolicyPack = {
			id: uuidv4(),
			name: payload.policyPack.name.trim(),
			description: payload.policyPack.description?.trim() || undefined,
			environments: payload.policyPack.environments,
			maxWorkflowItems: clampInteger(
				payload.policyPack.maxWorkflowItems,
				1,
				10000,
				500,
			),
			maxRetryAttempts: clampInteger(
				payload.policyPack.maxRetryAttempts,
				1,
				10,
				1,
			),
			schedulingEnabled: payload.policyPack.schedulingEnabled,
			executionWindows: payload.policyPack.executionWindows,
			enabled: payload.policyPack.enabled,
			createdAt: now,
			updatedAt: now,
		}

		await this.governancePolicyPackRepository.save(policyPack)

		return policyPack
	}

	public async updateGovernancePolicyPack(
		payload: GovernancePolicyPackUpdateRequest,
	): Promise<GovernancePolicyPack> {
		const existing = await this.governancePolicyPackRepository.findById(
			payload.id,
		)
		if (!existing) {
			throw new OperationFailure(
				'VALIDATION_ERROR',
				'Governance policy pack was not found.',
				false,
				{ id: payload.id },
			)
		}

		const policyPack: GovernancePolicyPack = {
			...existing,
			name: payload.policyPack.name.trim(),
			description: payload.policyPack.description?.trim() || undefined,
			environments: payload.policyPack.environments,
			maxWorkflowItems: clampInteger(
				payload.policyPack.maxWorkflowItems,
				1,
				10000,
				existing.maxWorkflowItems,
			),
			maxRetryAttempts: clampInteger(
				payload.policyPack.maxRetryAttempts,
				1,
				10,
				existing.maxRetryAttempts,
			),
			schedulingEnabled: payload.policyPack.schedulingEnabled,
			executionWindows: payload.policyPack.executionWindows,
			enabled: payload.policyPack.enabled,
			updatedAt: new Date().toISOString(),
		}

		await this.governancePolicyPackRepository.save(policyPack)

		return policyPack
	}

	public async deleteGovernancePolicyPack(
		payload: GovernancePolicyPackDeleteRequest,
	): Promise<MutationResult> {
		await this.governancePolicyPackRepository.delete(payload.id)

		const assignments = await this.governanceAssignmentRepository.list({})
		await Promise.all(
			assignments
				.filter((assignment) => assignment.policyPackId === payload.id)
				.map((assignment) =>
					this.governanceAssignmentRepository.assign({
						connectionId: assignment.connectionId,
						policyPackId: undefined,
					}),
				),
		)

		return {
			success: true,
		}
	}

	public async assignGovernancePolicyPack(
		payload: GovernanceAssignmentRequest,
	): Promise<MutationResult> {
		await this.requireConnection(payload.connectionId)

		if (payload.policyPackId) {
			const policyPack = await this.governancePolicyPackRepository.findById(
				payload.policyPackId,
			)
			if (!policyPack) {
				throw new OperationFailure(
					'VALIDATION_ERROR',
					'Governance policy pack was not found.',
					false,
					{ id: payload.policyPackId },
				)
			}
		}

		await this.governanceAssignmentRepository.assign({
			connectionId: payload.connectionId,
			policyPackId: payload.policyPackId,
		})

		return {
			success: true,
		}
	}

	public async listGovernanceAssignments(
		payload: GovernanceAssignmentListRequest,
	): Promise<GovernanceAssignment[]> {
		return this.governanceAssignmentRepository.list(payload)
	}

	public async listRetentionPolicies(): Promise<RetentionPolicyListResult> {
		return {
			policies: await this.retentionRepository.listPolicies(),
		}
	}

	public async updateRetentionPolicy(
		payload: RetentionPolicyUpdateRequest,
	): Promise<RetentionPolicy> {
		const policy: RetentionPolicy = {
			dataset: payload.policy.dataset,
			retentionDays: clampInteger(payload.policy.retentionDays, 1, 3650, 30),
			storageBudgetMb: clampInteger(
				payload.policy.storageBudgetMb,
				1,
				100_000,
				512,
			),
			autoPurgeOldest: payload.policy.autoPurgeOldest,
		}

		await this.retentionRepository.savePolicy(policy)
		return policy
	}

	public async purgeRetentionData(
		payload: RetentionPurgeRequest,
	): Promise<RetentionPurgeResult> {
		return this.retentionRepository.purge(payload)
	}

	public async getStorageSummary(): Promise<StorageSummary> {
		const summary = await this.retentionRepository.getStorageSummary()
		await this.enforceRetentionForDatasets(
			summary.datasets.map((dataset) => dataset.dataset),
			summary,
		)
		return summary
	}

	private async enforceRetentionForDatasets(
		datasets: RetentionPolicy['dataset'][],
		summaryOverride?: StorageSummary,
	): Promise<void> {
		const uniqueDatasets = Array.from(new Set(datasets))
		if (uniqueDatasets.length === 0) {
			return
		}

		const [summary, policies] = await Promise.all([
			summaryOverride
				? Promise.resolve(summaryOverride)
				: this.retentionRepository.getStorageSummary(),
			this.retentionRepository.listPolicies(),
		])

		const policyByDataset = new Map(
			policies.map((policy) => [policy.dataset, policy]),
		)
		const summaryByDataset = new Map(
			summary.datasets.map((dataset) => [dataset.dataset, dataset]),
		)
		const nowMs = Date.now()

		for (const dataset of uniqueDatasets) {
			const policy = policyByDataset.get(dataset)
			const datasetSummary = summaryByDataset.get(dataset)
			if (!policy || !datasetSummary) {
				continue
			}

			const alertCooldownKey = `${dataset}:retention-budget`
			const lastAlertAt = this.retentionAlertCooldown.get(alertCooldownKey)
			const canEmitAlert =
				typeof lastAlertAt !== 'number' ||
				nowMs - lastAlertAt >= RETENTION_ALERT_COOLDOWN_MS

			if (datasetSummary.overBudget && policy.autoPurgeOldest) {
				const purgeResult = await this.retentionRepository.purge({
					dataset,
					dryRun: false,
				})

				if (purgeResult.deletedRows > 0 && canEmitAlert) {
					this.retentionAlertCooldown.set(alertCooldownKey, nowMs)
					await this.emitAlert({
						severity: 'warning',
						title: `Retention auto-purge executed (${dataset})`,
						message: `Freed ${purgeResult.freedBytes} bytes by deleting ${purgeResult.deletedRows} rows.`,
						source: 'policy',
					})
				}

				continue
			}

			if (datasetSummary.overBudget && canEmitAlert) {
				this.retentionAlertCooldown.set(alertCooldownKey, nowMs)
				await this.emitAlert({
					severity: 'warning',
					title: `Storage budget exceeded (${dataset})`,
					message: `Usage is ${Math.round(datasetSummary.usageRatio * 100)}% of configured budget.`,
					source: 'policy',
				})
				continue
			}

			if (
				datasetSummary.usageRatio >= RETENTION_BUDGET_WARN_RATIO &&
				canEmitAlert
			) {
				this.retentionAlertCooldown.set(alertCooldownKey, nowMs)
				await this.emitAlert({
					severity: 'info',
					title: `Storage budget warning (${dataset})`,
					message: `Usage reached ${Math.round(datasetSummary.usageRatio * 100)}% of configured budget.`,
					source: 'policy',
				})
			}
		}
	}

	private async resolveGovernanceExecutionContext(
		profile: ConnectionProfile,
		action: string,
	): Promise<{
		policyPack?: GovernancePolicyPack
		activeWindowId?: string
	}> {
		const assignment = (
			await this.governanceAssignmentRepository.list({
				connectionId: profile.id,
			})
		)[0]

		if (!assignment?.policyPackId) {
			return {}
		}

		const policyPack = await this.governancePolicyPackRepository.findById(
			assignment.policyPackId,
		)
		if (!policyPack || !policyPack.enabled) {
			return {}
		}

		if (!policyPack.environments.includes(profile.environment)) {
			throw new OperationFailure(
				'UNAUTHORIZED',
				'Assigned policy pack does not allow execution for this environment.',
				false,
				{
					connectionId: profile.id,
					action,
					policyPackId: policyPack.id,
					environment: profile.environment,
				},
			)
		}

		if (!policyPack.schedulingEnabled) {
			return {
				policyPack,
			}
		}

		const now = new Date()
		const activeWindowId = findActiveExecutionWindowId(
			policyPack.executionWindows,
			now,
		)
		if (!activeWindowId) {
			throw new OperationFailure(
				'UNAUTHORIZED',
				'Execution is outside approved schedule windows for this policy pack.',
				false,
				{
					connectionId: profile.id,
					action,
					policyPackId: policyPack.id,
				},
			)
		}

		return {
			policyPack,
			activeWindowId,
		}
	}

	private async runWorkflowItems(args: {
		profile: ConnectionProfile
		secret: ConnectionSecret
		items: WorkflowDryRunPreviewItem[]
		startIndex: number
		retryPolicy: RetryPolicy
	}): Promise<{
		stepResults: WorkflowStepResult[]
		errorCount: number
		aborted: boolean
		checkpointToken?: string
	}> {
		let errorCount = 0
		let aborted = false
		const stepResults: WorkflowStepResult[] = []
		let checkpointToken: string | undefined

		for (let index = args.startIndex; index < args.items.length; index += 1) {
			const item = args.items[index]
			const stepStartedAt = Date.now()

			try {
				const run = async (): Promise<void> => {
					if (item.action === 'delete') {
						await this.captureSnapshot(
							args.profile,
							args.secret,
							item.key,
							'workflow',
						)
						await this.cacheGateway.deleteKey(args.profile, args.secret, item.key)
						return
					}

					if (item.action === 'setTtl') {
						const value = await this.cacheGateway.getValue(
							args.profile,
							args.secret,
							item.key,
						)
						if (value.value === null) {
							return
						}

						await this.cacheGateway.setValue(args.profile, args.secret, {
							key: item.key,
							value: value.value,
							ttlSeconds: item.nextTtlSeconds ?? undefined,
						})
						return
					}

					await this.cacheGateway.setValue(args.profile, args.secret, {
						key: item.key,
						value: item.valuePreview ?? '',
						ttlSeconds: item.nextTtlSeconds ?? undefined,
					})
				}

				const telemetryAction =
					item.action === 'delete'
						? 'workflow.step.delete'
						: item.action === 'setTtl'
							? 'workflow.step.ttl'
							: 'workflow.step.warmup'

				const outcome = await this.executeWithPolicy({
					profile: args.profile,
					action: telemetryAction,
					keyOrPattern: item.key,
					run,
					retryPolicy: args.retryPolicy,
				})

				stepResults.push({
					step: `${item.action}:${item.key}`,
					status: 'success',
					attempts: outcome.attempts,
					durationMs: Date.now() - stepStartedAt,
				})
			} catch (error) {
				errorCount += 1

				const failure = this.toOperationFailure(error)
				const attempts =
					typeof failure.details?.attempts === 'number'
						? Number(failure.details.attempts)
						: args.retryPolicy.maxAttempts

				stepResults.push({
					step: `${item.action}:${item.key}`,
					status: 'error',
					attempts,
					durationMs: Date.now() - stepStartedAt,
					message: failure.message,
				})

				if (index + 1 < args.items.length) {
					checkpointToken = String(index + 1)
				}

				const completedStepCount = stepResults.length
				if (
					completedStepCount > 0 &&
					errorCount / completedStepCount > args.retryPolicy.abortOnErrorRate
				) {
					aborted = true
					break
				}
			}
		}

		return {
			stepResults,
			errorCount,
			aborted,
			checkpointToken,
		}
	}

	private buildIncidentBundlePreview(
		payload: IncidentBundlePreviewRequest,
		data: IncidentBundleCollection,
	): IncidentBundlePreview {
		const timelineCount = data.timeline.length
		const logCount = data.logs.length
		const diagnosticCount = data.diagnostics.length
		const metricCount = data.metrics.length
		const manifest: IncidentBundlePreview['manifest'] = {
			timelineEventIds: data.timeline.map((event) => event.id),
			logEventIds: data.logs.map((event) => event.id),
			diagnosticEventIds: data.diagnostics.map((entry) => entry.event.id),
			metricSnapshotIds: data.metrics.map((snapshot) => snapshot.id),
		}
		const estimatedSizeBytes =
			timelineCount * 520 +
			logCount * 340 +
			diagnosticCount * 780 +
			metricCount * 220

		const checksumPreview = createHash('sha256')
			.update(
				JSON.stringify({
					from: payload.from,
					to: payload.to,
					connectionIds: data.connectionIds,
					includes: payload.includes,
					redactionProfile: payload.redactionProfile,
					timelineCount,
					logCount,
					diagnosticCount,
					metricCount,
					truncated: data.truncated,
					manifest,
				}),
			)
			.digest('hex')

		return {
			from: payload.from,
			to: payload.to,
			connectionIds: data.connectionIds,
			includes: payload.includes,
			redactionProfile: payload.redactionProfile,
			timelineCount,
			logCount,
			diagnosticCount,
			metricCount,
			estimatedSizeBytes,
			checksumPreview,
			truncated: data.truncated,
			manifest,
		}
	}

	private async runIncidentBundleExport(
		payload: IncidentBundleExportRequest,
		options?: {
			shouldCancel?: () => boolean
			onStage?: (
				stage: IncidentExportJob['stage'],
				progressPercent: number,
			) => void
		},
	): Promise<{
		preview: IncidentBundlePreview
		bundle: IncidentBundle
	}> {
		options?.onStage?.('collecting', 10)
		this.ensureIncidentExportNotCancelled(options?.shouldCancel)

		const data = await this.collectIncidentBundleData(payload)
		const preview = this.buildIncidentBundlePreview(payload, data)

		options?.onStage?.('serializing', 45)
		this.ensureIncidentExportNotCancelled(options?.shouldCancel)

		const id = uuidv4()
		const createdAt = new Date().toISOString()
		const checksum = createHash('sha256')
			.update(
				JSON.stringify({
					id,
					createdAt,
					preview,
					timeline: data.timeline.map((event) => event.id),
					logs: data.logs.map((event) => event.id),
					diagnostics: data.diagnostics.map((item) => item.event.id),
					metrics: data.metrics.map((snapshot) => snapshot.id),
				}),
			)
			.digest('hex')

		const artifactPath =
			payload.destinationPath?.trim() ||
			path.join(os.tmpdir(), `volatile-incident-${id}.json`)

		const artifactPayload = this.buildIncidentBundleArtifactPayload({
			payload,
			id,
			createdAt,
			checksum,
			preview,
			data,
		})

		options?.onStage?.('writing', 70)
		this.ensureIncidentExportNotCancelled(options?.shouldCancel)
		try {
			fs.mkdirSync(path.dirname(artifactPath), { recursive: true })
			fs.writeFileSync(
				artifactPath,
				JSON.stringify(artifactPayload, null, 2),
				'utf8',
			)
		} catch (error) {
			throw new OperationFailure(
				'INTERNAL_ERROR',
				'Incident bundle could not be written to disk.',
				false,
				{
					artifactPath,
					cause: error instanceof Error ? error.message : 'unknown',
				},
			)
		}

		const bundle: IncidentBundle = {
			id,
			createdAt,
			from: payload.from,
			to: payload.to,
			connectionIds: data.connectionIds,
			includes: payload.includes,
			redactionProfile: payload.redactionProfile,
			checksum,
			artifactPath,
			timelineCount: preview.timelineCount,
			logCount: preview.logCount,
			diagnosticCount: preview.diagnosticCount,
			metricCount: preview.metricCount,
			truncated: preview.truncated,
		}

		options?.onStage?.('persisting', 90)
		this.ensureIncidentExportNotCancelled(options?.shouldCancel)
		await this.incidentBundleRepository.save(bundle)
		await this.enforceRetentionForDatasets(['incidentArtifacts'])

		options?.onStage?.('completed', 100)

		return {
			preview,
			bundle,
		}
	}

	private buildIncidentBundleArtifactPayload(args: {
		payload: IncidentBundleExportRequest
		id: string
		createdAt: string
		checksum: string
		preview: IncidentBundlePreview
		data: IncidentBundleCollection
	}): Record<string, unknown> {
		const { payload, id, createdAt, checksum, preview, data } = args
		return {
			metadata: {
				id,
				createdAt,
				from: payload.from,
				to: payload.to,
				connectionIds: data.connectionIds,
				includes: payload.includes,
				redactionProfile: payload.redactionProfile,
				checksum,
				checksumPreview: preview.checksumPreview,
				truncated: preview.truncated,
				manifest: preview.manifest,
			},
			timeline:
				payload.redactionProfile === 'strict'
					? data.timeline.map(
							(event): HistoryEvent => ({
								...event,
								details: undefined,
								redactedDiff: undefined,
							}),
						)
					: data.timeline,
			logs:
				payload.redactionProfile === 'strict'
					? data.logs.map((event) => ({
							...event,
							message: redactMessage(event.message),
						}))
					: data.logs,
			diagnostics:
				payload.redactionProfile === 'strict'
					? data.diagnostics.map(
							(entry): FailedOperationDiagnostic => ({
								...entry,
								event: {
									...entry.event,
									details: undefined,
									redactedDiff: undefined,
								},
								relatedEvents: entry.relatedEvents.map(
									(related): HistoryEvent => ({
										...related,
										details: undefined,
										redactedDiff: undefined,
									}),
								),
							}),
						)
					: data.diagnostics,
			metrics: data.metrics,
		}
	}

	private scheduleIncidentExportJob(jobState: IncidentExportJobState): void {
		if (jobState.execution) {
			return
		}

		jobState.execution = this.executeIncidentExportJob(jobState).finally(() => {
			jobState.execution = null
		})
	}

	private async executeIncidentExportJob(
		jobState: IncidentExportJobState,
	): Promise<void> {
		if (jobState.cancelRequested || jobState.job.status === 'cancelled') {
			this.updateIncidentExportJob(jobState, {
				status: 'cancelled',
				stage: 'cancelled',
			})
			return
		}

		this.updateIncidentExportJob(jobState, {
			status: 'running',
			stage: 'collecting',
			progressPercent: 5,
			errorMessage: undefined,
		})

		try {
			const { preview, bundle } = await this.runIncidentBundleExport(
				jobState.job.request,
				{
					shouldCancel: () => jobState.cancelRequested,
					onStage: (stage, progressPercent) => {
						this.updateIncidentExportJob(jobState, {
							status: jobState.job.status === 'cancelling' ? 'cancelling' : 'running',
							stage,
							progressPercent,
						})
					},
				},
			)

			this.updateIncidentExportJob(jobState, {
				status: 'success',
				stage: 'completed',
				progressPercent: 100,
				checksumPreview: preview.checksumPreview,
				manifest: preview.manifest,
				truncated: preview.truncated,
				bundle,
			})
		} catch (error) {
			if (error instanceof IncidentExportCancelledError) {
				this.updateIncidentExportJob(jobState, {
					status: 'cancelled',
					stage: 'cancelled',
				})
				return
			}

			this.updateIncidentExportJob(jobState, {
				status: 'failed',
				stage: 'failed',
				errorMessage: error instanceof Error ? error.message : 'Unknown error.',
			})
		} finally {
			jobState.cancelRequested = false
		}
	}

	private requireIncidentExportJob(jobId: string): IncidentExportJobState {
		const jobState = this.incidentExportJobs.get(jobId)
		if (!jobState) {
			throw new OperationFailure(
				'VALIDATION_ERROR',
				'Incident export job was not found.',
				false,
				{ jobId },
			)
		}

		return jobState
	}

	private updateIncidentExportJob(
		jobState: IncidentExportJobState,
		patch: Partial<IncidentExportJob>,
	): void {
		jobState.job = {
			...jobState.job,
			...patch,
			updatedAt: new Date().toISOString(),
		}
	}

	private cloneIncidentExportJob(job: IncidentExportJob): IncidentExportJob {
		return {
			...job,
			request: {
				...job.request,
				connectionIds: job.request.connectionIds
					? [...job.request.connectionIds]
					: undefined,
				includes: [...job.request.includes],
			},
			manifest: job.manifest
				? {
						timelineEventIds: [...job.manifest.timelineEventIds],
						logEventIds: [...job.manifest.logEventIds],
						diagnosticEventIds: [...job.manifest.diagnosticEventIds],
						metricSnapshotIds: [...job.manifest.metricSnapshotIds],
					}
				: undefined,
			bundle: job.bundle
				? {
						...job.bundle,
						connectionIds: [...job.bundle.connectionIds],
						includes: [...job.bundle.includes],
					}
				: undefined,
		}
	}

	private ensureIncidentExportNotCancelled(shouldCancel?: () => boolean): void {
		if (shouldCancel?.()) {
			throw new IncidentExportCancelledError()
		}
	}

	private async aggregatePeriodMetrics(args: {
		connectionId?: string
		from: string
		to: string
	}): Promise<{
		operationCount: number
		errorRate: number
		latencyP95Ms: number
		slowOpCount: number
		sampledEvents: number
		truncated: boolean
	}> {
		const eventsSample = await this.historyRepository.query({
			connectionId: args.connectionId,
			from: args.from,
			to: args.to,
			limit: INCIDENT_DATASET_SAMPLE_LIMIT + 1,
		})
		const events = eventsSample.slice(0, INCIDENT_DATASET_SAMPLE_LIMIT)
		const truncated = eventsSample.length > INCIDENT_DATASET_SAMPLE_LIMIT
		const operationCount = events.length
		const errorCount = events.filter((event) => event.status === 'error').length
		const slowOpCount = events.filter(
			(event) => event.durationMs >= SLOW_OPERATION_THRESHOLD_MS,
		).length
		const sortedDurations = events
			.map((event) => event.durationMs)
			.sort((left, right) => left - right)

		return {
			operationCount,
			errorRate:
				operationCount === 0 ? 0 : Number((errorCount / operationCount).toFixed(3)),
			latencyP95Ms: percentile(sortedDurations, 0.95),
			slowOpCount,
			sampledEvents: operationCount,
			truncated,
		}
	}

	private async collectIncidentBundleData(args: {
		from: string
		to: string
		connectionIds?: string[]
		includes: IncidentBundle['includes']
	}): Promise<IncidentBundleCollection> {
		const include = new Set(args.includes)
		const connectionFilter =
			args.connectionIds && args.connectionIds.length > 0
				? new Set(args.connectionIds)
				: null
		const sampleLimit = INCIDENT_DATASET_SAMPLE_LIMIT
		const queryLimit = sampleLimit + 1

		const shouldFilterConnection = (
			connectionId?: string,
		): connectionId is string => {
			if (!connectionFilter) {
				return true
			}

			if (!connectionId) {
				return false
			}

			return connectionFilter.has(connectionId)
		}

		const directConnectionFilter =
			args.connectionIds && args.connectionIds.length === 1
				? args.connectionIds[0]
				: undefined

		const baseTimelineSample = await this.historyRepository.query({
			connectionId: directConnectionFilter,
			from: args.from,
			to: args.to,
			limit: queryLimit,
		})
		const scopedTimelineSample = baseTimelineSample.filter((event) =>
			shouldFilterConnection(event.connectionId),
		)
		const scopedTimeline = scopedTimelineSample.slice(0, sampleLimit)

		const alertSample = await this.alertRepository.list({
			unreadOnly: false,
			limit: queryLimit,
		})
		const scopedLogSample = alertSample.filter((event) => {
			if (event.createdAt < args.from || event.createdAt > args.to) {
				return false
			}

			return shouldFilterConnection(event.connectionId)
		})
		const scopedLogs = scopedLogSample.slice(0, sampleLimit)

		const snapshotSample = await this.observabilityRepository.query({
			connectionId: directConnectionFilter,
			from: args.from,
			to: args.to,
			limit: queryLimit,
		})
		const scopedSnapshotSample = snapshotSample.filter((snapshot) =>
			shouldFilterConnection(snapshot.connectionId),
		)
		const scopedSnapshots = scopedSnapshotSample.slice(0, sampleLimit)

		const snapshotsByConnection = new Map<string, ObservabilitySnapshot[]>()
		for (const snapshot of scopedSnapshots) {
			const list = snapshotsByConnection.get(snapshot.connectionId) ?? []
			list.push(snapshot)
			snapshotsByConnection.set(snapshot.connectionId, list)
		}

		const diagnostics: FailedOperationDiagnostic[] = scopedTimeline
			.filter((event) => event.status === 'error')
			.map((event) => {
				const eventTime = new Date(event.timestamp).getTime()
				const relatedEvents = scopedTimeline
					.filter((candidate) => {
						if (candidate.connectionId !== event.connectionId) {
							return false
						}

						if (candidate.keyOrPattern !== event.keyOrPattern) {
							return false
						}

						const candidateTime = new Date(candidate.timestamp).getTime()
						if (Number.isNaN(eventTime) || Number.isNaN(candidateTime)) {
							return false
						}

						return Math.abs(candidateTime - eventTime) <= 5 * 60 * 1000
					})
					.slice(0, 10)

				const latestSnapshot = (snapshotsByConnection.get(event.connectionId) ?? [])
					.filter((snapshot) => snapshot.timestamp <= event.timestamp)
					.sort((left, right) => right.timestamp.localeCompare(left.timestamp))[0]

				return {
					event,
					retryAttempts:
						typeof event.details?.attempts === 'number'
							? Math.max(1, Math.trunc(event.details.attempts))
							: 1,
					relatedEvents,
					latestSnapshot,
				}
			})

		const resolvedConnectionIds = connectionFilter
			? Array.from(connectionFilter)
			: Array.from(
					new Set([
						...scopedTimeline.map((event) => event.connectionId),
						...scopedLogs
							.map((event) => event.connectionId)
							.filter((value): value is string => Boolean(value)),
						...scopedSnapshots.map((snapshot) => snapshot.connectionId),
					]),
				)
		const truncated =
			baseTimelineSample.length > sampleLimit ||
			scopedTimelineSample.length > sampleLimit ||
			alertSample.length > sampleLimit ||
			scopedLogSample.length > sampleLimit ||
			snapshotSample.length > sampleLimit ||
			scopedSnapshotSample.length > sampleLimit

		return {
			connectionIds: resolvedConnectionIds,
			timeline: include.has('timeline') ? scopedTimeline : [],
			logs: include.has('logs') ? scopedLogs : [],
			diagnostics: include.has('diagnostics') ? diagnostics : [],
			metrics: include.has('metrics') ? scopedSnapshots : [],
			truncated,
		}
	}

	private async requireConnection(id: string): Promise<ConnectionProfile> {
		const profile = await this.connectionRepository.findById(id)

		if (!profile) {
			throw new OperationFailure(
				'VALIDATION_ERROR',
				'Connection profile was not found.',
				false,
				{ id },
			)
		}

		return profile
	}

	private async requireProfileWithSecret(id: string): Promise<{
		profile: ConnectionProfile
		secret: ConnectionCreateRequest['secret']
	}> {
		const profile = await this.requireConnection(id)
		const secret = await this.secretStore.getSecret(id)

		return {
			profile,
			secret,
		}
	}

	private async requireProfileWithSecretAndNamespace(
		id: string,
		namespaceId?: string,
	): Promise<{
		profile: ConnectionProfile
		secret: ConnectionCreateRequest['secret']
		namespace: NamespaceProfile | null
	}> {
		const { profile, secret } = await this.requireProfileWithSecret(id)
		const namespace = namespaceId
			? await this.requireNamespaceForConnection(id, namespaceId)
			: null

		const scopedProfile: ConnectionProfile =
			isRedisFamilyEngine(profile.engine)
				? {
						...profile,
						dbIndex:
							namespace && namespace.strategy === 'redisLogicalDb'
								? namespace.dbIndex ?? 0
								: 0,
					}
				: {
						...profile,
						dbIndex: undefined,
					}

		return {
			profile: scopedProfile,
			secret,
			namespace,
		}
	}

	private createNamespaceKeyScope(namespace: NamespaceProfile | null): {
		mapKeyForMutation: (key: string) => string
		mapPatternForQuery: (pattern: string) => string
		mapOutgoingKeys: (keys: string[]) => string[]
	} {
		const prefix = this.resolveNamespacePrefix(namespace)

		if (!prefix) {
			return {
				mapKeyForMutation: (key) => key,
				mapPatternForQuery: (pattern) => pattern,
				mapOutgoingKeys: (keys) => keys,
			}
		}

		return {
			mapKeyForMutation: (key) => `${prefix}${key}`,
			mapPatternForQuery: (pattern) => `${prefix}${pattern}`,
			mapOutgoingKeys: (keys) =>
				keys
					.filter((key) => key.startsWith(prefix))
					.map((key) => key.slice(prefix.length)),
		}
	}

	private resolveNamespacePrefix(namespace: NamespaceProfile | null): string {
		if (!namespace || namespace.strategy !== 'keyPrefix') {
			return ''
		}

		return namespace.keyPrefix ?? ''
	}

	private async requireNamespaceForConnection(
		connectionId: string,
		namespaceId: string,
	): Promise<NamespaceProfile> {
		const namespace = await this.namespaceRepository.findById(namespaceId)
		if (!namespace || namespace.connectionId !== connectionId) {
			throw new OperationFailure(
				'VALIDATION_ERROR',
				'Namespace was not found for the selected connection.',
				false,
				{
					connectionId,
					namespaceId,
				},
			)
		}

		return namespace
	}

	private async resolveTestSecret(
		payload: ConnectionTestRequest,
	): Promise<ConnectionCreateRequest['secret']> {
		if (!payload.connectionId) {
			return payload.secret
		}

		await this.requireConnection(payload.connectionId)
		const storedSecret = await this.secretStore.getSecret(payload.connectionId)

		return mergeSecretOverlay(storedSecret, payload.secret)
	}

	private async enforceWritable(
		profile: ConnectionProfile,
		action: string,
		keyOrPattern: string,
	): Promise<void> {
		try {
			assertConnectionWritable(profile)
		} catch (error) {
			const failure = this.toOperationFailure(error)
			await this.recordOperation({
				profile,
				action,
				keyOrPattern,
				durationMs: 0,
				status: 'blocked',
				error: failure,
				attempts: 1,
			})
			throw failure
		}
	}

	private async enforceProdGuardrail(
		profile: ConnectionProfile,
		action: string,
		keyOrPattern: string,
		guardrailConfirmed?: boolean,
	): Promise<void> {
		if (profile.environment !== 'prod' || guardrailConfirmed) {
			return
		}

		const failure = new OperationFailure(
			'UNAUTHORIZED',
			'This action targets a prod-tagged connection and requires explicit confirmation.',
			false,
			{
				connectionId: profile.id,
				policy: 'prodGuardrail',
				action,
			},
		)

		await this.recordOperation({
			profile,
			action,
			keyOrPattern,
			durationMs: 0,
			status: 'blocked',
			error: failure,
			attempts: 1,
		})

		throw failure
	}

	private async captureSnapshot(
		profile: ConnectionProfile,
		secret: ConnectionSecret,
		key: string,
		reason: SnapshotRecord['reason'],
		resolvedKey: string = key,
	): Promise<void> {
		try {
			const valueRecord = await this.cacheGateway.getValue(
				profile,
				secret,
				resolvedKey,
			)

			if (valueRecord.value === null && valueRecord.ttlSeconds === null) {
				return
			}

			await this.snapshotRepository.save({
				id: uuidv4(),
				connectionId: profile.id,
				key,
				capturedAt: new Date().toISOString(),
				redactedValueHash: createHash('sha256')
					.update(valueRecord.value ?? '')
					.digest('hex'),
				value: valueRecord.value,
				ttlSeconds: valueRecord.ttlSeconds ?? undefined,
				reason,
			})
		} catch (error) {
			void error
		}
	}

	private async executeWithPolicy<T>(
		args: ExecuteWithPolicyArgs<T>,
	): Promise<ExecuteWithPolicyResult<T>> {
		const startedAt = Date.now()
		const timeoutMs = Math.max(100, args.profile.timeoutMs || DEFAULT_TIMEOUT_MS)
		const retryPolicy = args.retryPolicy ?? this.resolveRetryPolicy(args.profile)

		let attempts = 0
		let errorCount = 0
		let lastFailure: OperationFailure | null = null

		while (attempts < retryPolicy.maxAttempts) {
			attempts += 1

			try {
				const result = await withTimeout(args.run(), timeoutMs)
				const durationMs = Date.now() - startedAt

				if (!args.suppressTelemetry) {
					await this.recordOperation({
						profile: args.profile,
						action: args.action,
						keyOrPattern: args.keyOrPattern,
						durationMs,
						status: 'success',
						attempts,
					})
				}

				return {
					result,
					attempts,
					durationMs,
				}
			} catch (error) {
				const failure = this.toOperationFailure(error)
				errorCount += 1
				lastFailure = this.attachAttemptDetails(failure, attempts)

				const shouldRetry =
					attempts < retryPolicy.maxAttempts && lastFailure.retryable

				if (!shouldRetry) {
					break
				}

				const errorRate = errorCount / attempts
				if (errorRate > retryPolicy.abortOnErrorRate) {
					lastFailure = this.attachAttemptDetails(
						new OperationFailure(
							'CONNECTION_FAILED',
							`Operation "${args.action}" aborted by retry policy.`,
							false,
							{
								abortOnErrorRate: retryPolicy.abortOnErrorRate,
								observedErrorRate: Number(errorRate.toFixed(3)),
							},
						),
						attempts,
					)
					break
				}

				await delay(getBackoffMs(retryPolicy, attempts))
			}
		}

		const durationMs = Date.now() - startedAt
		const failure =
			lastFailure ??
			this.attachAttemptDetails(
				new OperationFailure(
					'INTERNAL_ERROR',
					`Operation "${args.action}" failed unexpectedly.`,
					false,
				),
				attempts,
			)

		if (!args.suppressTelemetry) {
			await this.recordOperation({
				profile: args.profile,
				action: args.action,
				keyOrPattern: args.keyOrPattern,
				durationMs,
				status: 'error',
				error: failure,
				attempts,
			})
		}

		throw failure
	}

	private resolveRetryPolicy(
		profile: ConnectionProfile,
		override?: WorkflowStepRetryPolicy,
	): RetryPolicy {
		if (override) {
			return {
				maxAttempts: clampInteger(override.maxAttempts, 1, 10, 1),
				backoffMs: clampInteger(override.backoffMs, 0, 120000, 0),
				backoffStrategy: override.backoffStrategy,
				abortOnErrorRate: clampNumber(override.abortOnErrorRate, 0, 1, 1),
			}
		}

		return {
			maxAttempts: clampInteger(
				profile.retryMaxAttempts,
				1,
				10,
				DEFAULT_RETRY_MAX_ATTEMPTS,
			),
			backoffMs: clampInteger(
				profile.retryBackoffMs,
				0,
				120000,
				DEFAULT_RETRY_BACKOFF_MS,
			),
			backoffStrategy: profile.retryBackoffStrategy ?? 'fixed',
			abortOnErrorRate: clampNumber(
				profile.retryAbortOnErrorRate,
				0,
				1,
				DEFAULT_RETRY_ABORT_ON_ERROR_RATE,
			),
		}
	}

	private attachAttemptDetails(
		failure: OperationFailure,
		attempts: number,
	): OperationFailure {
		return new OperationFailure(
			failure.code,
			failure.message,
			failure.retryable,
			{
				...failure.details,
				attempts,
			},
		)
	}

	private toOperationFailure(error: unknown): OperationFailure {
		if (error instanceof OperationFailure) {
			return error
		}

		if (
			error instanceof Error &&
			error.message.toLowerCase().includes('timed out')
		) {
			return new OperationFailure('TIMEOUT', error.message, true)
		}

		if (error instanceof Error) {
			return new OperationFailure('CONNECTION_FAILED', error.message, true)
		}

		return new OperationFailure(
			'INTERNAL_ERROR',
			'Unexpected operation failure.',
			false,
		)
	}

	private async recordOperation(args: {
		profile: ConnectionProfile
		action: string
		keyOrPattern: string
		durationMs: number
		status: OperationStatus
		attempts: number
		error?: OperationFailure
	}): Promise<void> {
		const event: HistoryEvent = {
			id: uuidv4(),
			timestamp: new Date().toISOString(),
			source: 'app',
			connectionId: args.profile.id,
			environment: args.profile.environment,
			action: args.action,
			keyOrPattern: args.keyOrPattern,
			durationMs: Math.max(0, Math.round(args.durationMs)),
			status: args.status,
			errorCode: args.error?.code,
			retryable: args.error?.retryable,
			details: {
				...(args.error?.details ?? {}),
				attempts: args.attempts,
			},
		}

		await this.historyRepository.append(event)

		const sample = {
			timestamp: Date.now(),
			durationMs: event.durationMs,
			status: event.status,
		}

		const samples = this.operationSamples.get(args.profile.id) ?? []
		samples.push(sample)

		if (samples.length > 500) {
			samples.shift()
		}

		this.operationSamples.set(args.profile.id, samples)

		const recentSamples = samples.filter(
			(candidate) => Date.now() - candidate.timestamp <= 60_000,
		)

		const durations = recentSamples
			.map((candidate) => candidate.durationMs)
			.sort((left, right) => left - right)

		const errorCount = recentSamples.filter(
			(candidate) => candidate.status === 'error',
		).length
		const slowCount = recentSamples.filter(
			(candidate) => candidate.durationMs >= SLOW_OPERATION_THRESHOLD_MS,
		).length

		const snapshot: ObservabilitySnapshot = {
			id: uuidv4(),
			connectionId: args.profile.id,
			timestamp: event.timestamp,
			latencyP50Ms: percentile(durations, 0.5),
			latencyP95Ms: percentile(durations, 0.95),
			errorRate:
				recentSamples.length === 0
					? 0
					: Number((errorCount / recentSamples.length).toFixed(3)),
			reconnectCount: 0,
			opsPerSecond: Number((recentSamples.length / 60).toFixed(3)),
			slowOpCount: slowCount,
		}

		await this.observabilityRepository.append(snapshot)
		await this.enforceRetentionForDatasets([
			'timelineEvents',
			'observabilitySnapshots',
		])

		if (event.status === 'error') {
			await this.emitAlert({
				connectionId: args.profile.id,
				environment: args.profile.environment,
				severity: 'warning',
				title: 'Operation failed',
				message: `${args.action} failed on ${args.keyOrPattern}.`,
				source: 'observability',
			})
		} else if (event.status === 'blocked') {
			await this.emitAlert({
				connectionId: args.profile.id,
				environment: args.profile.environment,
				severity: 'warning',
				title: 'Operation blocked by policy',
				message: `${args.action} was blocked by connection policy.`,
				source: 'policy',
			})
		} else if (event.durationMs >= SLOW_OPERATION_THRESHOLD_MS) {
			await this.emitAlert({
				connectionId: args.profile.id,
				environment: args.profile.environment,
				severity: 'info',
				title: 'Slow operation detected',
				message: `${args.action} took ${event.durationMs}ms.`,
				source: 'observability',
			})
		}

		await this.evaluateAlertRulesForEvent({
			profile: args.profile,
			timestamp: event.timestamp,
		})
	}

	private async evaluateAlertRulesForEvent(args: {
		profile: ConnectionProfile
		timestamp: string
	}): Promise<void> {
		const rules = await this.alertRuleRepository.list()
		if (rules.length === 0) {
			return
		}

		const eventTime = new Date(args.timestamp).getTime()
		const nowMs = Number.isNaN(eventTime) ? Date.now() : eventTime

		for (const rule of rules) {
			if (!rule.enabled) {
				continue
			}

			if (rule.connectionId && rule.connectionId !== args.profile.id) {
				continue
			}

			if (rule.environment && rule.environment !== args.profile.environment) {
				continue
			}

			const cooldownKey = `${rule.id}:${args.profile.id}`
			const lastTriggeredAt = this.alertRuleCooldown.get(cooldownKey)
			if (
				typeof lastTriggeredAt === 'number' &&
				nowMs - lastTriggeredAt < 60_000
			) {
				continue
			}

			const lookbackFrom = new Date(
				nowMs - rule.lookbackMinutes * 60 * 1000,
			).toISOString()
			const value = await this.computeAlertRuleMetric({
				rule,
				profile: args.profile,
				from: lookbackFrom,
				to: args.timestamp,
			})

			if (value <= rule.threshold) {
				continue
			}

			this.alertRuleCooldown.set(cooldownKey, nowMs)

			await this.emitAlert({
				connectionId: args.profile.id,
				environment: args.profile.environment,
				severity: rule.severity,
				title: `Alert rule triggered: ${rule.name}`,
				message: `${rule.metric}=${formatMetricValue(rule.metric, value)} exceeded ${formatMetricValue(rule.metric, rule.threshold)}.`,
				source: 'observability',
			})
		}
	}

	private async computeAlertRuleMetric(args: {
		rule: AlertRule
		profile: ConnectionProfile
		from: string
		to: string
	}): Promise<number> {
		if (args.rule.metric === 'latencyP95Ms') {
			const snapshots = await this.observabilityRepository.query({
				connectionId: args.profile.id,
				from: args.from,
				to: args.to,
				limit: 2000,
			})

			if (snapshots.length === 0) {
				return 0
			}

			const latest = snapshots.sort((left, right) =>
				right.timestamp.localeCompare(left.timestamp),
			)[0]
			return latest.latencyP95Ms
		}

		const events = await this.historyRepository.query({
			connectionId: args.profile.id,
			from: args.from,
			to: args.to,
			limit: 5000,
		})

		if (events.length === 0) {
			return 0
		}

		if (args.rule.metric === 'errorRate') {
			const errorCount = events.filter((event) => event.status === 'error').length
			return Number((errorCount / events.length).toFixed(3))
		}

		if (args.rule.metric === 'slowOperationCount') {
			return events.filter(
				(event) => event.durationMs >= SLOW_OPERATION_THRESHOLD_MS,
			).length
		}

		return events.filter((event) => event.status === 'error').length
	}

	private async emitAlert(args: {
		connectionId?: string
		environment?: ConnectionProfile['environment']
		severity: AlertEvent['severity']
		title: string
		message: string
		source: AlertEvent['source']
	}): Promise<void> {
		const event: AlertEvent = {
			id: uuidv4(),
			createdAt: new Date().toISOString(),
			connectionId: args.connectionId,
			environment: args.environment,
			severity: args.severity,
			title: args.title,
			message: args.message,
			source: args.source,
			read: false,
		}

		await this.alertRepository.append(event)
	}

	private async resolveWorkflowTemplate(args: {
		templateId?: string
		template?: WorkflowTemplateDraft
		parameterOverrides?: Record<string, unknown>
	}): Promise<{
		template: WorkflowTemplate
		parameters: Record<string, unknown>
	}> {
		const template = await this.resolveWorkflowTemplateEntity(
			args.templateId,
			args.template,
		)

		return {
			template,
			parameters: {
				...template.parameters,
				...(args.parameterOverrides ?? {}),
			},
		}
	}

	private async resolveWorkflowTemplateEntity(
		templateId?: string,
		inlineTemplate?: WorkflowTemplateDraft,
	): Promise<WorkflowTemplate> {
		if (templateId) {
			const builtin = BUILTIN_WORKFLOW_TEMPLATES.find(
				(template) => template.id === templateId,
			)

			if (builtin) {
				return builtin
			}

			const template = await this.workflowTemplateRepository.findById(templateId)
			if (!template) {
				throw new OperationFailure(
					'VALIDATION_ERROR',
					'Workflow template was not found.',
					false,
					{ id: templateId },
				)
			}

			return template
		}

		if (!inlineTemplate) {
			throw new OperationFailure(
				'VALIDATION_ERROR',
				'Either templateId or template must be provided.',
				false,
			)
		}

		return {
			id: `inline-${uuidv4()}`,
			name: inlineTemplate.name,
			kind: inlineTemplate.kind,
			parameters: inlineTemplate.parameters,
			requiresApprovalOnProd: inlineTemplate.requiresApprovalOnProd,
			supportsDryRun: inlineTemplate.supportsDryRun,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		}
	}

	private async buildWorkflowPreview(
		profile: ConnectionProfile,
		secret: ConnectionSecret,
		kind: WorkflowTemplate['kind'],
		parameters: Record<string, unknown>,
		options?: {
			cursor?: string
			limit?: number
		},
	): Promise<WorkflowDryRunPreview> {
		const previewLimit = clampInteger(options?.limit, 1, 500, 100)

		if (kind === 'warmupSet') {
			const entries = parseWarmupEntries(parameters)
			const startIndex = clampInteger(
				options?.cursor ? Number(options.cursor) : 0,
				0,
				entries.length,
				0,
			)
			const pageEntries = entries.slice(startIndex, startIndex + previewLimit)
			const nextCursor =
				startIndex + previewLimit < entries.length
					? String(startIndex + previewLimit)
					: undefined

			return {
				kind,
				estimatedCount: entries.length,
				truncated: Boolean(nextCursor),
				nextCursor,
				items: pageEntries.map((entry) => ({
					key: entry.key,
					action: 'setValue',
					valuePreview: entry.value,
					nextTtlSeconds: entry.ttlSeconds,
				})),
			}
		}

		const pattern = getString(parameters.pattern, '*')
		const templateLimit = clampInteger(parameters.limit, 1, 500, 100)
		const searchLimit = clampInteger(options?.limit, 1, 500, templateLimit)

		const searchResult = await this.cacheGateway.searchKeys(profile, secret, {
			pattern,
			cursor: options?.cursor,
			limit: searchLimit,
		})

		const items: WorkflowDryRunPreviewItem[] = []

		if (kind === 'deleteByPattern') {
			for (const key of searchResult.keys) {
				items.push({
					key,
					action: 'delete',
				})
			}
		} else {
			const ttlSeconds = clampInteger(parameters.ttlSeconds, 1, 31536000, 3600)

			for (const key of searchResult.keys) {
				const valueRecord = await this.cacheGateway.getValue(profile, secret, key)
				items.push({
					key,
					action: 'setTtl',
					currentTtlSeconds: valueRecord.ttlSeconds,
					nextTtlSeconds: ttlSeconds,
				})
			}
		}

		return {
			kind,
			estimatedCount: items.length,
			truncated: Boolean(searchResult.nextCursor),
			nextCursor: searchResult.nextCursor,
			items,
		}
	}
}

// Backward-compat alias removed; use `OperationsService` instead.

const buildCompareMetric = (args: {
	metric: CompareMetricDelta['metric']
	baseline: number
	compare: number
	lowerIsBetter: boolean
}): CompareMetricDelta => {
	const delta = Number((args.compare - args.baseline).toFixed(3))
	const deltaPercent =
		args.baseline === 0
			? args.compare === 0
				? 0
				: null
			: Number(((args.compare - args.baseline) / args.baseline).toFixed(3))

	let direction: CompareMetricDelta['direction'] = 'unchanged'
	if (delta !== 0) {
		const improved = args.lowerIsBetter ? delta < 0 : delta > 0
		direction = improved ? 'improved' : 'regressed'
	}

	return {
		metric: args.metric,
		baseline: Number(args.baseline.toFixed(3)),
		compare: Number(args.compare.toFixed(3)),
		delta,
		deltaPercent,
		direction,
	}
}

const toKeyspacePattern = (keyOrPattern: string): string => {
	if (keyOrPattern.includes('*')) {
		return keyOrPattern
	}

	const segments = keyOrPattern
		.split(':')
		.filter((segment) => segment.length > 0)
	if (segments.length <= 1) {
		return keyOrPattern
	}

	return `${segments[0]}:*`
}

const redactMessage = (message: string): string => {
	if (message.length <= 24) {
		return '[redacted]'
	}

	return `${message.slice(0, 8)}...[redacted]...${message.slice(-8)}`
}

const formatMetricValue = (
	metric: AlertRule['metric'],
	value: number,
): string => {
	if (metric === 'errorRate') {
		return `${(value * 100).toFixed(1)}%`
	}

	if (metric === 'latencyP95Ms') {
		return `${Math.round(value)}ms`
	}

	return String(Math.round(value))
}

const findActiveExecutionWindowId = (
	windows: GovernancePolicyPack['executionWindows'],
	now: Date,
): string | undefined => {
	const weekday = toGovernanceWeekday(now.getUTCDay())
	const currentMinutes = now.getUTCHours() * 60 + now.getUTCMinutes()

	for (const window of windows) {
		if (!window.weekdays.includes(weekday)) {
			continue
		}

		const startMinutes = parseWindowMinutes(window.startTime)
		const endMinutes = parseWindowMinutes(window.endTime)
		if (startMinutes === null || endMinutes === null) {
			continue
		}

		const inWindow =
			endMinutes >= startMinutes
				? currentMinutes >= startMinutes && currentMinutes <= endMinutes
				: currentMinutes >= startMinutes || currentMinutes <= endMinutes

		if (inWindow) {
			return window.id
		}
	}

	return undefined
}

const parseWindowMinutes = (value: string): number | null => {
	const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value)
	if (!match) {
		return null
	}

	const hours = Number(match[1])
	const minutes = Number(match[2])
	return hours * 60 + minutes
}

const toGovernanceWeekday = (
	utcWeekday: number,
): GovernancePolicyPack['executionWindows'][number]['weekdays'][number] => {
	switch (utcWeekday) {
		case 0:
			return 'sun'
		case 1:
			return 'mon'
		case 2:
			return 'tue'
		case 3:
			return 'wed'
		case 4:
			return 'thu'
		case 5:
			return 'fri'
		default:
			return 'sat'
	}
}

const isBuiltinWorkflowId = (id: string): boolean => id.startsWith('builtin-')

const normalizeDraft = (
	draft: ConnectionCreateRequest['profile'],
): Omit<ConnectionProfile, 'id' | 'secretRef' | 'createdAt' | 'updatedAt'> => ({
	name: draft.name.trim(),
	engine: draft.engine,
	host: draft.host.trim(),
	port: draft.port,
	dbIndex: undefined,
	tlsEnabled: draft.tlsEnabled,
	environment: draft.environment,
	tags: normalizeTags(draft.tags),
	readOnly: draft.readOnly,
	forceReadOnly: Boolean(draft.forceReadOnly),
	timeoutMs: clampInteger(draft.timeoutMs, 100, 120000, DEFAULT_TIMEOUT_MS),
	retryMaxAttempts: clampInteger(
		draft.retryMaxAttempts,
		1,
		10,
		DEFAULT_RETRY_MAX_ATTEMPTS,
	),
	retryBackoffMs: clampInteger(
		draft.retryBackoffMs,
		0,
		120000,
		DEFAULT_RETRY_BACKOFF_MS,
	),
	retryBackoffStrategy: draft.retryBackoffStrategy ?? 'fixed',
	retryAbortOnErrorRate: clampNumber(
		draft.retryAbortOnErrorRate,
		0,
		1,
		DEFAULT_RETRY_ABORT_ON_ERROR_RATE,
	),
})

const validateNamespaceDraft = (
	draft: NamespaceCreateRequest['namespace'],
	engine: ConnectionProfile['engine'],
): void => {
	const normalizedName = draft.name.trim()
	if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(normalizedName)) {
		throw new OperationFailure(
			'VALIDATION_ERROR',
			'Namespace name must be slug-like and 1-64 characters.',
			false,
		)
	}

	if (engine === 'memcached' && draft.strategy !== 'keyPrefix') {
		throw new OperationFailure(
			'VALIDATION_ERROR',
			'Memcached namespaces only support keyPrefix strategy.',
			false,
		)
	}

	if (draft.strategy === 'redisLogicalDb') {
		if (!isRedisFamilyEngine(engine)) {
			throw new OperationFailure(
				'VALIDATION_ERROR',
				'redisLogicalDb strategy is only available for Redis-family connections.',
				false,
			)
		}
		if (typeof draft.dbIndex !== 'number' || draft.dbIndex < 0 || draft.dbIndex > 15) {
			throw new OperationFailure(
				'VALIDATION_ERROR',
				'Redis logical-db namespaces require dbIndex in range 0-15.',
				false,
			)
		}
		return
	}

	if (!draft.keyPrefix || draft.keyPrefix.trim().length === 0) {
		throw new OperationFailure(
			'VALIDATION_ERROR',
			'Prefix namespaces require a key prefix value.',
			false,
		)
	}
}

const assertNamespaceNameUnique = (
	namespaces: NamespaceProfile[],
	name: string,
): void => {
	const needle = name.trim().toLowerCase()
	const conflict = namespaces.some(
		(namespace) => namespace.name.trim().toLowerCase() === needle,
	)
	if (conflict) {
		throw new OperationFailure(
			'CONFLICT',
			'A namespace with this name already exists for the connection.',
			false,
		)
	}
}

const applyNamespaceToWorkflowParameters = (
	kind: WorkflowKind,
	parameters: Record<string, unknown>,
	namespace: NamespaceProfile | null,
): Record<string, unknown> => {
	if (!namespace || namespace.strategy !== 'keyPrefix') {
		return parameters
	}

	const prefix = namespace.keyPrefix ?? ''
	if (!prefix) {
		return parameters
	}

	if (kind === 'deleteByPattern' || kind === 'ttlNormalize') {
		const rawPattern =
			typeof parameters.pattern === 'string' ? parameters.pattern : '*'
		return {
			...parameters,
			pattern: `${prefix}${rawPattern}`,
		}
	}

	if (kind === 'warmupSet' && Array.isArray(parameters.entries)) {
		return {
			...parameters,
			entries: parameters.entries.map((entry) => {
				if (
					!entry ||
					typeof entry !== 'object' ||
					!('key' in entry) ||
					typeof entry.key !== 'string'
				) {
					return entry
				}

				return {
					...(entry as Record<string, unknown>),
					key: `${prefix}${entry.key}`,
				}
			}),
		}
	}

	return parameters
}

const normalizeTags = (tags: string[]): string[] => {
	const normalized = tags
		.map((tag) => tag.trim())
		.filter((tag) => tag.length > 0)

	return Array.from(new Set(normalized))
}

const mergeSecretOverlay = (
	baseSecret: ConnectionCreateRequest['secret'],
	secretOverlay: ConnectionCreateRequest['secret'],
): ConnectionCreateRequest['secret'] => ({
	username:
		secretOverlay.username === undefined
			? baseSecret.username
			: secretOverlay.username,
	password:
		secretOverlay.password === undefined
			? baseSecret.password
			: secretOverlay.password,
	token:
		secretOverlay.token === undefined ? baseSecret.token : secretOverlay.token,
})

const delay = async (ms: number): Promise<void> => {
	if (ms <= 0) {
		return
	}

	await new Promise<void>((resolve) => {
		setTimeout(() => resolve(), ms)
	})
}

const withTimeout = async <T>(
	promise: Promise<T>,
	timeoutMs: number,
): Promise<T> => {
	let timeoutHandle: NodeJS.Timeout | undefined

	try {
		return await Promise.race([
			promise,
			new Promise<T>((_, reject) => {
				timeoutHandle = setTimeout(() => {
					reject(
						new OperationFailure(
							'TIMEOUT',
							`Operation timed out after ${timeoutMs}ms.`,
							true,
						),
					)
				}, timeoutMs)
			}),
		])
	} finally {
		if (timeoutHandle) {
			clearTimeout(timeoutHandle)
		}
	}
}

const getBackoffMs = (policy: RetryPolicy, attempt: number): number => {
	if (policy.backoffStrategy === 'fixed') {
		return policy.backoffMs
	}

	return policy.backoffMs * Math.max(1, 2 ** Math.max(0, attempt - 1))
}

const clampInteger = (
	value: unknown,
	min: number,
	max: number,
	fallback: number,
): number => {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return fallback
	}

	return Math.min(max, Math.max(min, Math.trunc(value)))
}

const clampNumber = (
	value: unknown,
	min: number,
	max: number,
	fallback: number,
): number => {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return fallback
	}

	return Math.min(max, Math.max(min, value))
}

const getString = (value: unknown, fallback: string): string => {
	if (typeof value !== 'string') {
		return fallback
	}

	const normalized = value.trim()
	return normalized.length > 0 ? normalized : fallback
}

const parseWarmupEntries = (
	parameters: Record<string, unknown>,
): Array<{ key: string; value: string; ttlSeconds?: number }> => {
	const rawEntries = parameters.entries
	if (!Array.isArray(rawEntries)) {
		return []
	}

	const entries: Array<{ key: string; value: string; ttlSeconds?: number }> = []

	for (const rawEntry of rawEntries) {
		if (typeof rawEntry !== 'object' || rawEntry === null) {
			continue
		}

		const candidate = rawEntry as Record<string, unknown>
		if (typeof candidate.key !== 'string') {
			continue
		}

		entries.push({
			key: candidate.key,
			value: typeof candidate.value === 'string' ? candidate.value : '',
			ttlSeconds:
				typeof candidate.ttlSeconds === 'number' && candidate.ttlSeconds > 0
					? Math.trunc(candidate.ttlSeconds)
					: undefined,
		})
	}

	return entries
}

const toTimeBucket = (timestamp: string, intervalMinutes: number): string => {
	const date = new Date(timestamp)

	if (Number.isNaN(date.getTime())) {
		return timestamp
	}

	const intervalMs = Math.max(1, intervalMinutes) * 60_000
	const bucket = Math.floor(date.getTime() / intervalMs) * intervalMs

	return new Date(bucket).toISOString()
}

const percentile = (samples: number[], point: number): number => {
	if (samples.length === 0) {
		return 0
	}

	const index = Math.min(
		samples.length - 1,
		Math.max(0, Math.floor(point * (samples.length - 1))),
	)

	return samples[index]
}
