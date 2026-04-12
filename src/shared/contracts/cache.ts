export type CacheEngine =
  | 'redis'
  | 'keydb'
  | 'dragonfly'
  | 'valkey'
  | 'memcached'
export type NamespaceStrategy = 'redisLogicalDb' | 'keyPrefix'
export type EnvironmentTag = 'dev' | 'staging' | 'prod'
export type EventSource = 'app' | 'engine'
export type BackoffStrategy = 'fixed' | 'exponential'
export type WorkflowKind = 'deleteByPattern' | 'ttlNormalize' | 'warmupSet'
export type WorkflowExecutionStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'error'
  | 'aborted'
export type AlertSeverity = 'info' | 'warning' | 'critical'
export type AlertRuleMetric =
  | 'errorRate'
  | 'latencyP95Ms'
  | 'slowOperationCount'
  | 'failedOperationCount'
export type GovernanceWeekday =
  | 'mon'
  | 'tue'
  | 'wed'
  | 'thu'
  | 'fri'
  | 'sat'
  | 'sun'
export type RetentionDataset =
  | 'timelineEvents'
  | 'observabilitySnapshots'
  | 'workflowHistory'
  | 'incidentArtifacts'
export type IncidentBundleInclude =
  | 'timeline'
  | 'logs'
  | 'diagnostics'
  | 'metrics'
export type RedactionProfile = 'default' | 'strict'
export type IncidentExportJobStatus =
  | 'pending'
  | 'running'
  | 'cancelling'
  | 'cancelled'
  | 'failed'
  | 'success'
export type CompareMetricDirection = 'improved' | 'regressed' | 'unchanged'
export type UpdatePhase =
  | 'unsupported'
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'no-update'
  | 'error'

export type OperationErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'TIMEOUT'
  | 'CONNECTION_FAILED'
  | 'NOT_SUPPORTED'
  | 'CONFLICT'
  | 'INTERNAL_ERROR'

export interface UpdateStatus {
  currentVersion: string
  phase: UpdatePhase
  message: string
  availableVersion?: string
  downloadedVersion?: string
  releaseDate?: string
  checkedAt?: string
  progressPercent?: number
  bytesPerSecond?: number
  transferredBytes?: number
  totalBytes?: number
}

export interface ProviderCapabilities {
  supportsTTL: boolean
  supportsMonitorStream: boolean
  supportsSlowLog: boolean
  supportsBulkDeletePreview: boolean
  supportsSnapshotRestore: boolean
  supportsPatternScan: boolean
}

export interface ConnectionProfile {
  id: string
  name: string
  engine: CacheEngine
  host: string
  port: number
  dbIndex?: number
  tlsEnabled: boolean
  environment: EnvironmentTag
  tags: string[]
  secretRef: string
  readOnly: boolean
  forceReadOnly?: boolean
  timeoutMs: number
  retryMaxAttempts?: number
  retryBackoffMs?: number
  retryBackoffStrategy?: BackoffStrategy
  retryAbortOnErrorRate?: number
  createdAt: string
  updatedAt: string
}

export interface ConnectionSecret {
  username?: string
  password?: string
  token?: string
}

export interface ConnectionDraft {
  name: string
  engine: CacheEngine
  host: string
  port: number
  dbIndex?: number
  tlsEnabled: boolean
  environment: EnvironmentTag
  tags: string[]
  readOnly: boolean
  forceReadOnly?: boolean
  timeoutMs: number
  retryMaxAttempts?: number
  retryBackoffMs?: number
  retryBackoffStrategy?: BackoffStrategy
  retryAbortOnErrorRate?: number
}

export interface ConnectionCreateRequest {
  profile: ConnectionDraft
  secret: ConnectionSecret
}

export interface ConnectionUpdateRequest {
  id: string
  profile: ConnectionDraft
  secret?: ConnectionSecret
}

export interface ConnectionDeleteRequest {
  id: string
}

export interface ConnectionGetRequest {
  id: string
}

export interface NamespaceProfile {
  id: string
  connectionId: string
  name: string
  engine: CacheEngine
  strategy: NamespaceStrategy
  dbIndex?: number
  keyPrefix?: string
  createdAt: string
  updatedAt: string
}

export interface NamespaceDraft {
  connectionId: string
  name: string
  strategy: NamespaceStrategy
  dbIndex?: number
  keyPrefix?: string
}

export interface NamespaceListRequest {
  connectionId: string
}

export interface NamespaceCreateRequest {
  namespace: NamespaceDraft
}

export interface NamespaceUpdateRequest {
  id: string
  name: string
}

export interface NamespaceDeleteRequest {
  id: string
}

export interface ConnectionTestRequest {
  connectionId?: string
  profile: ConnectionDraft
  secret: ConnectionSecret
}

export interface ConnectionTestResult {
  latencyMs: number
  capabilities: ProviderCapabilities
}

export interface ConnectionCapabilitiesRequest {
  connectionId: string
}

export interface KeyListRequest {
  connectionId: string
  namespaceId?: string
  cursor?: string
  limit: number
}

export interface KeySearchRequest {
  connectionId: string
  namespaceId?: string
  pattern: string
  cursor?: string
  limit: number
}

export interface KeyCountRequest {
  connectionId: string
  namespaceId?: string
  pattern?: string
}

export interface KeyGetRequest {
  connectionId: string
  namespaceId?: string
  key: string
}

export interface KeySetRequest {
  connectionId: string
  namespaceId?: string
  key: string
  value: string
  ttlSeconds?: number
}

export interface KeyDeleteRequest {
  connectionId: string
  namespaceId?: string
  key: string
  guardrailConfirmed?: boolean
}

export interface KeyListResult {
  keys: string[]
  nextCursor?: string
}

export interface KeyCountResult {
  totalKeys: number
  totalFoundKeys?: number
}

export interface KeyValueRecord {
  key: string
  value: string | null
  ttlSeconds: number | null
  supportsTTL: boolean
  keyType?: 'string' | 'list' | 'set' | 'zset' | 'hash' | 'stream' | 'none' | 'unknown'
  isStringEditable?: boolean
}

export interface MutationResult {
  success: true
}

export interface SnapshotRecord {
  id: string
  connectionId: string
  key: string
  capturedAt: string
  redactedValueHash: string
  value: string | null
  ttlSeconds?: number
  reason: 'set' | 'delete' | 'workflow'
}

export interface SnapshotListRequest {
  connectionId: string
  namespaceId?: string
  key?: string
  limit: number
}

export interface RollbackRestoreRequest {
  connectionId: string
  namespaceId?: string
  key: string
  snapshotId?: string
  guardrailConfirmed?: boolean
}

export interface WorkflowTemplate {
  id: string
  name: string
  kind: WorkflowKind
  parameters: Record<string, unknown>
  requiresApprovalOnProd: boolean
  supportsDryRun: boolean
  createdAt: string
  updatedAt: string
}

export interface WorkflowTemplateDraft {
  name: string
  kind: WorkflowKind
  parameters: Record<string, unknown>
  requiresApprovalOnProd: boolean
  supportsDryRun: boolean
}

export interface WorkflowTemplateCreateRequest {
  template: WorkflowTemplateDraft
}

export interface WorkflowTemplateUpdateRequest {
  id: string
  template: WorkflowTemplateDraft
}

export interface WorkflowTemplateDeleteRequest {
  id: string
}

export interface WorkflowTemplatePreviewRequest {
  connectionId: string
  namespaceId?: string
  templateId?: string
  template?: WorkflowTemplateDraft
  parameterOverrides?: Record<string, unknown>
  cursor?: string
  limit?: number
}

export interface WorkflowStepRetryPolicy {
  maxAttempts: number
  backoffMs: number
  backoffStrategy: BackoffStrategy
  abortOnErrorRate: number
}

export interface WorkflowDryRunPreviewItem {
  key: string
  action: 'delete' | 'setTtl' | 'setValue'
  currentTtlSeconds?: number | null
  nextTtlSeconds?: number | null
  valuePreview?: string
}

export interface WorkflowDryRunPreview {
  kind: WorkflowKind
  estimatedCount: number
  truncated: boolean
  nextCursor?: string
  items: WorkflowDryRunPreviewItem[]
}

export interface WorkflowStepResult {
  step: string
  status: 'success' | 'error' | 'skipped'
  attempts: number
  durationMs: number
  message?: string
}

export interface WorkflowExecutionRecord {
  id: string
  workflowTemplateId?: string
  workflowName: string
  workflowKind: WorkflowKind
  connectionId: string
  namespaceId?: string
  startedAt: string
  finishedAt?: string
  status: WorkflowExecutionStatus
  retryCount: number
  dryRun: boolean
  parameters: Record<string, unknown>
  stepResults: WorkflowStepResult[]
  errorMessage?: string
  checkpointToken?: string
  policyPackId?: string
  scheduleWindowId?: string
  resumedFromExecutionId?: string
}

export interface WorkflowExecuteRequest {
  connectionId: string
  namespaceId?: string
  templateId?: string
  template?: WorkflowTemplateDraft
  parameterOverrides?: Record<string, unknown>
  dryRun?: boolean
  guardrailConfirmed?: boolean
  retryPolicy?: WorkflowStepRetryPolicy
}

export interface WorkflowRerunRequest {
  executionId: string
  parameterOverrides?: Record<string, unknown>
  dryRun?: boolean
  guardrailConfirmed?: boolean
}

export interface WorkflowResumeRequest {
  executionId: string
  guardrailConfirmed?: boolean
}

export interface WorkflowExecutionListRequest {
  connectionId?: string
  namespaceId?: string
  templateId?: string
  limit: number
}

export interface WorkflowExecutionGetRequest {
  id: string
}

export interface HistoryEvent {
  id: string
  timestamp: string
  source: EventSource
  connectionId: string
  environment: EnvironmentTag
  action: string
  keyOrPattern: string
  durationMs: number
  status: 'success' | 'error' | 'blocked'
  redactedDiff?: string
  errorCode?: OperationErrorCode
  retryable?: boolean
  details?: Record<string, unknown>
}

export interface HistoryQueryRequest {
  connectionId?: string
  namespaceId?: string
  from?: string
  to?: string
  limit: number
}

export interface ObservabilitySnapshot {
  id: string
  connectionId: string
  timestamp: string
  latencyP50Ms: number
  latencyP95Ms: number
  errorRate: number
  reconnectCount: number
  opsPerSecond: number
  slowOpCount: number
}

export interface ConnectionHealthSummary {
  connectionId: string
  connectionName: string
  environment: EnvironmentTag
  status: 'healthy' | 'degraded' | 'offline'
  latencyP95Ms: number
  errorRate: number
  opsPerSecond: number
  slowOpCount: number
}

export interface OperationTrendPoint {
  bucket: string
  operationCount: number
  errorCount: number
  avgDurationMs: number
}

export interface ErrorHeatmapCell {
  connectionId: string
  environment: EnvironmentTag
  errorCount: number
}

export interface ObservabilityDashboard {
  generatedAt: string
  truncated: boolean
  health: ConnectionHealthSummary[]
  trends: OperationTrendPoint[]
  heatmap: ErrorHeatmapCell[]
  timeline: HistoryEvent[]
  slowOperations: HistoryEvent[]
}

export interface ObservabilityDashboardRequest {
  connectionId?: string
  namespaceId?: string
  from?: string
  to?: string
  intervalMinutes?: number
  limit?: number
}

export interface KeyspaceActivityRequest {
  connectionId?: string
  namespaceId?: string
  from: string
  to: string
  intervalMinutes?: number
  limit?: number
}

export interface KeyspaceActivityPattern {
  pattern: string
  touchCount: number
  errorCount: number
  lastTouchedAt?: string
}

export interface KeyspaceActivityPoint {
  bucket: string
  touches: number
  errors: number
}

export interface KeyspaceActivityView {
  generatedAt: string
  from: string
  to: string
  totalEvents: number
  truncated: boolean
  topPatterns: KeyspaceActivityPattern[]
  distribution: KeyspaceActivityPoint[]
}

export interface FailedOperationDrilldownRequest {
  connectionId?: string
  namespaceId?: string
  eventId?: string
  from?: string
  to?: string
  limit: number
}

export interface FailedOperationDiagnostic {
  event: HistoryEvent
  retryAttempts: number
  relatedEvents: HistoryEvent[]
  latestSnapshot?: ObservabilitySnapshot
}

export interface FailedOperationDrilldownResult {
  generatedAt: string
  totalErrorEvents: number
  truncated: boolean
  diagnostics: FailedOperationDiagnostic[]
}

export interface ComparePeriodsRequest {
  connectionId?: string
  namespaceId?: string
  baselineFrom: string
  baselineTo: string
  compareFrom: string
  compareTo: string
}

export interface CompareMetricDelta {
  metric: 'operationCount' | 'errorRate' | 'latencyP95Ms' | 'slowOpCount'
  baseline: number
  compare: number
  delta: number
  deltaPercent: number | null
  direction: CompareMetricDirection
}

export interface ComparePeriodsResult {
  generatedAt: string
  baselineLabel: string
  compareLabel: string
  baselineSampledEvents: number
  compareSampledEvents: number
  truncated: boolean
  metrics: CompareMetricDelta[]
}

export interface IncidentBundle {
  id: string
  createdAt: string
  from: string
  to: string
  connectionIds: string[]
  includes: IncidentBundleInclude[]
  redactionProfile: RedactionProfile
  checksum: string
  artifactPath: string
  timelineCount: number
  logCount: number
  diagnosticCount: number
  metricCount: number
  truncated: boolean
}

export interface IncidentBundlePreviewRequest {
  from: string
  to: string
  connectionIds?: string[]
  namespaceId?: string
  includes: IncidentBundleInclude[]
  redactionProfile: RedactionProfile
}

export interface IncidentBundlePreview {
  from: string
  to: string
  connectionIds: string[]
  includes: IncidentBundleInclude[]
  redactionProfile: RedactionProfile
  timelineCount: number
  logCount: number
  diagnosticCount: number
  metricCount: number
  estimatedSizeBytes: number
  checksumPreview: string
  truncated: boolean
  manifest: {
    timelineEventIds: string[]
    logEventIds: string[]
    diagnosticEventIds: string[]
    metricSnapshotIds: string[]
  }
}

export interface IncidentBundleExportRequest {
  from: string
  to: string
  connectionIds?: string[]
  namespaceId?: string
  includes: IncidentBundleInclude[]
  redactionProfile: RedactionProfile
  destinationPath?: string
}

export type IncidentBundleExportStartRequest = IncidentBundleExportRequest

export interface IncidentBundleExportJobGetRequest {
  jobId: string
}

export interface IncidentBundleExportJobCancelRequest {
  jobId: string
}

export interface IncidentBundleExportJobResumeRequest {
  jobId: string
}

export interface IncidentExportJob {
  id: string
  status: IncidentExportJobStatus
  stage:
    | 'queued'
    | 'collecting'
    | 'serializing'
    | 'writing'
    | 'persisting'
    | 'completed'
    | 'cancelled'
    | 'failed'
  progressPercent: number
  createdAt: string
  updatedAt: string
  request: IncidentBundleExportRequest
  destinationPath: string
  checksumPreview?: string
  truncated?: boolean
  manifest?: IncidentBundlePreview['manifest']
  bundle?: IncidentBundle
  errorMessage?: string
}

export interface IncidentBundleListRequest {
  limit: number
  namespaceId?: string
}

export interface AlertEvent {
  id: string
  createdAt: string
  connectionId?: string
  environment?: EnvironmentTag
  severity: AlertSeverity
  title: string
  message: string
  source: 'app' | 'policy' | 'workflow' | 'observability'
  read: boolean
}

export interface AlertListRequest {
  unreadOnly?: boolean
  limit: number
}

export interface AlertMarkReadRequest {
  id: string
}

export type AlertMarkAllReadRequest = Record<string, never>

export interface AlertUnreadCountResult {
  unreadCount: number
}

export interface AlertRule {
  id: string
  name: string
  metric: AlertRuleMetric
  threshold: number
  lookbackMinutes: number
  severity: AlertSeverity
  connectionId?: string
  environment?: EnvironmentTag
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface AlertRuleDraft {
  name: string
  metric: AlertRuleMetric
  threshold: number
  lookbackMinutes: number
  severity: AlertSeverity
  connectionId?: string
  environment?: EnvironmentTag
  enabled: boolean
}

export interface AlertRuleCreateRequest {
  rule: AlertRuleDraft
}

export interface AlertRuleUpdateRequest {
  id: string
  rule: AlertRuleDraft
}

export interface AlertRuleDeleteRequest {
  id: string
}

export interface WorkflowScheduleWindow {
  id: string
  weekdays: GovernanceWeekday[]
  startTime: string
  endTime: string
  timezone: 'UTC'
}

export interface GovernancePolicyPack {
  id: string
  name: string
  description?: string
  environments: EnvironmentTag[]
  maxWorkflowItems: number
  maxRetryAttempts: number
  schedulingEnabled: boolean
  executionWindows: WorkflowScheduleWindow[]
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface GovernancePolicyPackDraft {
  name: string
  description?: string
  environments: EnvironmentTag[]
  maxWorkflowItems: number
  maxRetryAttempts: number
  schedulingEnabled: boolean
  executionWindows: WorkflowScheduleWindow[]
  enabled: boolean
}

export interface GovernancePolicyPackCreateRequest {
  policyPack: GovernancePolicyPackDraft
}

export interface GovernancePolicyPackUpdateRequest {
  id: string
  policyPack: GovernancePolicyPackDraft
}

export interface GovernancePolicyPackDeleteRequest {
  id: string
}

export interface GovernanceAssignmentRequest {
  connectionId: string
  policyPackId?: string
}

export interface GovernanceAssignment {
  connectionId: string
  policyPackId?: string
}

export interface GovernanceAssignmentListRequest {
  connectionId?: string
}

export interface RetentionPolicy {
  dataset: RetentionDataset
  retentionDays: number
  storageBudgetMb: number
  autoPurgeOldest: boolean
}

export interface RetentionPolicyUpdateRequest {
  policy: RetentionPolicy
}

export interface RetentionPolicyListResult {
  policies: RetentionPolicy[]
}

export interface StorageDatasetSummary {
  dataset: RetentionDataset
  rowCount: number
  totalBytes: number
  budgetBytes: number
  usageRatio: number
  overBudget: boolean
  oldestTimestamp?: string
  newestTimestamp?: string
}

export interface StorageSummary {
  generatedAt: string
  datasets: StorageDatasetSummary[]
  totalBytes: number
}

export interface RetentionPurgeRequest {
  dataset: RetentionDataset
  olderThan?: string
  dryRun?: boolean
}

export interface RetentionPurgeResult {
  dataset: RetentionDataset
  cutoff: string
  dryRun: boolean
  deletedRows: number
  freedBytes: number
}
