import type {
  AlertEvent,
  AlertListRequest,
  AlertRule,
  NamespaceProfile,
  ConnectionDraft,
  ConnectionProfile,
  ConnectionSecret,
  ConnectionTestResult,
  GovernanceAssignment,
  GovernanceAssignmentListRequest,
  GovernancePolicyPack,
  HistoryEvent,
  HistoryQueryRequest,
  IncidentBundle,
  KeyCountResult,
  CacheFlushScope,
  KeyListResult,
  KeySetRequest,
  KeyValueRecord,
  ObservabilitySnapshot,
  OperationErrorCode,
  ProviderCapabilities,
  RetentionPolicy,
  RetentionPurgeRequest,
  RetentionPurgeResult,
  SnapshotRecord,
  StorageSummary,
  WorkflowExecutionListRequest,
  WorkflowExecutionRecord,
  WorkflowTemplate,
} from '../../shared/contracts/cache'

export interface ConnectionRepository {
  list: () => Promise<ConnectionProfile[]>
  findById: (id: string) => Promise<ConnectionProfile | null>
  save: (profile: ConnectionProfile) => Promise<void>
  delete: (id: string) => Promise<void>
}

export interface NamespaceRepository {
  listByConnectionId: (connectionId: string) => Promise<NamespaceProfile[]>
  findById: (id: string) => Promise<NamespaceProfile | null>
  save: (namespace: NamespaceProfile) => Promise<void>
  delete: (id: string) => Promise<void>
}

export interface SecretStore {
  saveSecret: (profileId: string, secret: ConnectionSecret) => Promise<void>
  getSecret: (profileId: string) => Promise<ConnectionSecret>
  deleteSecret: (profileId: string) => Promise<void>
}

export interface MemcachedKeyIndexRepository {
  listKeys: (connectionId: string, limit: number) => Promise<string[]>
  countKeys: (connectionId: string) => Promise<number>
  searchKeys: (
    connectionId: string,
    pattern: string,
    limit: number,
    cursor?: string,
  ) => Promise<string[]>
  countKeysByPattern: (connectionId: string, pattern: string) => Promise<number>
  upsertKey: (connectionId: string, key: string) => Promise<void>
  removeKey: (connectionId: string, key: string) => Promise<void>
  deleteByConnectionId: (connectionId: string) => Promise<void>
}

export interface SnapshotRepository {
  save: (record: SnapshotRecord) => Promise<void>
  list: (args: {
    connectionId: string
    key?: string
    limit: number
  }) => Promise<SnapshotRecord[]>
  findLatest: (args: {
    connectionId: string
    key: string
  }) => Promise<SnapshotRecord | null>
  findById: (id: string) => Promise<SnapshotRecord | null>
}

export interface WorkflowTemplateRepository {
  save: (template: WorkflowTemplate) => Promise<void>
  list: () => Promise<WorkflowTemplate[]>
  findById: (id: string) => Promise<WorkflowTemplate | null>
  delete: (id: string) => Promise<void>
}

export interface WorkflowExecutionRepository {
  save: (record: WorkflowExecutionRecord) => Promise<void>
  list: (args: WorkflowExecutionListRequest) => Promise<WorkflowExecutionRecord[]>
  findById: (id: string) => Promise<WorkflowExecutionRecord | null>
}

export interface HistoryRepository {
  append: (event: HistoryEvent) => Promise<void>
  query: (args: HistoryQueryRequest) => Promise<HistoryEvent[]>
}

export interface ObservabilityRepository {
  append: (snapshot: ObservabilitySnapshot) => Promise<void>
  query: (args: {
    connectionId?: string
    from?: string
    to?: string
    limit: number
  }) => Promise<ObservabilitySnapshot[]>
}

export interface AlertRepository {
  append: (event: AlertEvent) => Promise<void>
  list: (request: AlertListRequest) => Promise<AlertEvent[]>
  countUnread: () => Promise<number>
  markRead: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
  deleteAll: () => Promise<void>
}

export interface AlertRuleRepository {
  list: () => Promise<AlertRule[]>
  findById: (id: string) => Promise<AlertRule | null>
  save: (rule: AlertRule) => Promise<void>
  delete: (id: string) => Promise<void>
}

export interface GovernancePolicyPackRepository {
  list: () => Promise<GovernancePolicyPack[]>
  findById: (id: string) => Promise<GovernancePolicyPack | null>
  save: (policyPack: GovernancePolicyPack) => Promise<void>
  delete: (id: string) => Promise<void>
}

export interface GovernanceAssignmentRepository {
  list: (args: GovernanceAssignmentListRequest) => Promise<GovernanceAssignment[]>
  assign: (args: { connectionId: string; policyPackId?: string }) => Promise<void>
}

export interface IncidentBundleRepository {
  save: (bundle: IncidentBundle) => Promise<void>
  list: (limit: number) => Promise<IncidentBundle[]>
}

export interface RetentionRepository {
  listPolicies: () => Promise<RetentionPolicy[]>
  savePolicy: (policy: RetentionPolicy) => Promise<void>
  purge: (request: RetentionPurgeRequest) => Promise<RetentionPurgeResult>
  getStorageSummary: () => Promise<StorageSummary>
}

export interface EngineTimelineEventInput {
  timestamp?: string
  connectionId: string
  environment?: ConnectionProfile['environment']
  action: string
  keyOrPattern: string
  durationMs?: number
  status: 'success' | 'error' | 'blocked'
  errorCode?: OperationErrorCode
  retryable?: boolean
  details?: Record<string, unknown>
}

export interface EngineEventPollResult {
  events: EngineTimelineEventInput[]
  nextCursor?: string
}

export interface EngineEventIngestor {
  start: (args: {
    onEvent: (event: EngineTimelineEventInput) => Promise<void>
  }) => Promise<void>
  stop: () => Promise<void>
}

export interface CacheGateway {
  testConnection: (
    profile: ConnectionDraft,
    secret: ConnectionSecret,
  ) => Promise<ConnectionTestResult>
  getCapabilities: (
    profile: Pick<ConnectionProfile, 'engine'>,
  ) => ProviderCapabilities
  listKeys: (
    profile: ConnectionProfile,
    secret: ConnectionSecret,
    args: { cursor?: string; limit: number },
  ) => Promise<KeyListResult>
  searchKeys: (
    profile: ConnectionProfile,
    secret: ConnectionSecret,
    args: { pattern: string; limit: number; cursor?: string },
  ) => Promise<KeyListResult>
  countKeys: (
    profile: ConnectionProfile,
    secret: ConnectionSecret,
  ) => Promise<KeyCountResult>
  countKeysByPattern: (
    profile: ConnectionProfile,
    secret: ConnectionSecret,
    args: { pattern: string },
  ) => Promise<KeyCountResult>
  getValue: (
    profile: ConnectionProfile,
    secret: ConnectionSecret,
    key: string,
  ) => Promise<KeyValueRecord>
  setValue: (
    profile: ConnectionProfile,
    secret: ConnectionSecret,
    args: { key: string; value: KeySetRequest['value']; ttlSeconds?: number },
  ) => Promise<void>
  deleteKey: (
    profile: ConnectionProfile,
    secret: ConnectionSecret,
    key: string,
  ) => Promise<void>
  flush: (
    profile: ConnectionProfile,
    secret: ConnectionSecret,
    args: { scope: CacheFlushScope; keyPrefix?: string },
  ) => Promise<void>
  pollEngineEvents: (
    profile: ConnectionProfile,
    secret: ConnectionSecret,
    args: { cursor?: string; limit: number },
  ) => Promise<EngineEventPollResult>
}
