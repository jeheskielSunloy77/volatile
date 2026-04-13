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
	ComparePeriodsRequest,
	ComparePeriodsResult,
	ConnectionCapabilitiesRequest,
	CacheFlushRequest,
	ConnectionCreateRequest,
	ConnectionDeleteRequest,
	ConnectionGetRequest,
	NamespaceCreateRequest,
	NamespaceDeleteRequest,
	NamespaceListRequest,
	NamespaceProfile,
	NamespaceUpdateRequest,
	ConnectionProfile,
	ConnectionTestRequest,
	ConnectionTestResult,
	ConnectionUpdateRequest,
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
	KeyspaceActivityRequest,
	KeyspaceActivityView,
	KeyValueRecord,
	MutationResult,
	ObservabilityDashboard,
	ObservabilityDashboardRequest,
	OperationErrorCode,
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
	WorkflowExecuteRequest,
	WorkflowExecutionGetRequest,
	WorkflowExecutionListRequest,
	WorkflowExecutionRecord,
	WorkflowRerunRequest,
	WorkflowResumeRequest,
	WorkflowTemplate,
	WorkflowTemplateCreateRequest,
	WorkflowTemplateDeleteRequest,
	WorkflowTemplatePreviewRequest,
	WorkflowTemplateUpdateRequest,
} from '../contracts/cache'

export const APP_COMMAND_CHANNEL = 'app:command'
export const APP_QUERY_CHANNEL = 'app:query'

export type AppCommand =
	| 'connection.create'
	| 'connection.update'
	| 'connection.delete'
	| 'connection.test'
	| 'namespace.create'
	| 'namespace.update'
	| 'namespace.delete'
	| 'cache.flush'
	| 'key.set'
	| 'key.update'
	| 'key.delete'
	| 'rollback.restore'
	| 'workflow.template.create'
	| 'workflow.template.update'
	| 'workflow.template.delete'
	| 'workflow.execute'
	| 'workflow.rerun'
	| 'workflow.resume'
	| 'alert.markRead'
	| 'alert.markAllRead'
	| 'alert.deleteAll'
	| 'alert.rule.create'
	| 'alert.rule.update'
	| 'alert.rule.delete'
	| 'policy.pack.create'
	| 'policy.pack.update'
	| 'policy.pack.delete'
	| 'policy.pack.assign'
	| 'retention.policy.update'
	| 'retention.purge'
	| 'incident.bundle.export.start'
	| 'incident.bundle.export.cancel'
	| 'incident.bundle.export.resume'
	| 'incident.bundle.export'

export type AppQuery =
	| 'connection.list'
	| 'connection.get'
	| 'namespace.list'
	| 'provider.capabilities'
	| 'key.list'
	| 'key.search'
	| 'key.count'
	| 'key.get'
	| 'snapshot.list'
	| 'workflow.template.list'
	| 'workflow.preview'
	| 'workflow.execution.list'
	| 'workflow.execution.get'
	| 'history.list'
	| 'observability.dashboard'
	| 'observability.keyspaceActivity'
	| 'observability.failedOperations'
	| 'observability.comparePeriods'
	| 'alert.list'
	| 'alert.unread.count'
	| 'alert.rule.list'
	| 'policy.pack.list'
	| 'policy.pack.assignment.list'
	| 'retention.policy.list'
	| 'storage.summary'
	| 'incident.bundle.export.job.get'
	| 'incident.bundle.preview'
	| 'incident.bundle.list'

export interface CommandPayloadMap {
	'connection.create': ConnectionCreateRequest
	'connection.update': ConnectionUpdateRequest
	'connection.delete': ConnectionDeleteRequest
	'connection.test': ConnectionTestRequest
	'namespace.create': NamespaceCreateRequest
	'namespace.update': NamespaceUpdateRequest
	'namespace.delete': NamespaceDeleteRequest
	'cache.flush': CacheFlushRequest
	'key.set': KeySetRequest
	'key.update': KeyUpdateRequest
	'key.delete': KeyDeleteRequest
	'rollback.restore': RollbackRestoreRequest
	'workflow.template.create': WorkflowTemplateCreateRequest
	'workflow.template.update': WorkflowTemplateUpdateRequest
	'workflow.template.delete': WorkflowTemplateDeleteRequest
	'workflow.execute': WorkflowExecuteRequest
	'workflow.rerun': WorkflowRerunRequest
	'workflow.resume': WorkflowResumeRequest
	'alert.markRead': AlertMarkReadRequest
	'alert.markAllRead': AlertMarkAllReadRequest
	'alert.deleteAll': Record<string, never>
	'alert.rule.create': AlertRuleCreateRequest
	'alert.rule.update': AlertRuleUpdateRequest
	'alert.rule.delete': AlertRuleDeleteRequest
	'policy.pack.create': GovernancePolicyPackCreateRequest
	'policy.pack.update': GovernancePolicyPackUpdateRequest
	'policy.pack.delete': GovernancePolicyPackDeleteRequest
	'policy.pack.assign': GovernanceAssignmentRequest
	'retention.policy.update': RetentionPolicyUpdateRequest
	'retention.purge': RetentionPurgeRequest
	'incident.bundle.export.start': IncidentBundleExportStartRequest
	'incident.bundle.export.cancel': IncidentBundleExportJobCancelRequest
	'incident.bundle.export.resume': IncidentBundleExportJobResumeRequest
	'incident.bundle.export': IncidentBundleExportRequest
}

export interface QueryPayloadMap {
	'connection.list': Record<string, never>
	'connection.get': ConnectionGetRequest
	'namespace.list': NamespaceListRequest
	'provider.capabilities': ConnectionCapabilitiesRequest
	'key.list': KeyListRequest
	'key.search': KeySearchRequest
	'key.count': KeyCountRequest
	'key.get': KeyGetRequest
	'snapshot.list': SnapshotListRequest
	'workflow.template.list': Record<string, never>
	'workflow.preview': WorkflowTemplatePreviewRequest
	'workflow.execution.list': WorkflowExecutionListRequest
	'workflow.execution.get': WorkflowExecutionGetRequest
	'history.list': HistoryQueryRequest
	'observability.dashboard': ObservabilityDashboardRequest
	'observability.keyspaceActivity': KeyspaceActivityRequest
	'observability.failedOperations': FailedOperationDrilldownRequest
	'observability.comparePeriods': ComparePeriodsRequest
	'alert.list': AlertListRequest
	'alert.unread.count': Record<string, never>
	'alert.rule.list': Record<string, never>
	'policy.pack.list': Record<string, never>
	'policy.pack.assignment.list': GovernanceAssignmentListRequest
	'retention.policy.list': Record<string, never>
	'storage.summary': Record<string, never>
	'incident.bundle.export.job.get': IncidentBundleExportJobGetRequest
	'incident.bundle.preview': IncidentBundlePreviewRequest
	'incident.bundle.list': IncidentBundleListRequest
}

export interface CommandResultMap {
	'connection.create': ConnectionProfile
	'connection.update': ConnectionProfile
	'connection.delete': MutationResult
	'connection.test': ConnectionTestResult
	'namespace.create': NamespaceProfile
	'namespace.update': NamespaceProfile
	'namespace.delete': MutationResult
	'cache.flush': MutationResult
	'key.set': MutationResult
	'key.update': MutationResult
	'key.delete': MutationResult
	'rollback.restore': MutationResult
	'workflow.template.create': WorkflowTemplate
	'workflow.template.update': WorkflowTemplate
	'workflow.template.delete': MutationResult
	'workflow.execute': WorkflowExecutionRecord
	'workflow.rerun': WorkflowExecutionRecord
	'workflow.resume': WorkflowExecutionRecord
	'alert.markRead': MutationResult
	'alert.markAllRead': MutationResult
	'alert.deleteAll': MutationResult
	'alert.rule.create': AlertRule
	'alert.rule.update': AlertRule
	'alert.rule.delete': MutationResult
	'policy.pack.create': GovernancePolicyPack
	'policy.pack.update': GovernancePolicyPack
	'policy.pack.delete': MutationResult
	'policy.pack.assign': MutationResult
	'retention.policy.update': RetentionPolicy
	'retention.purge': RetentionPurgeResult
	'incident.bundle.export.start': IncidentExportJob
	'incident.bundle.export.cancel': IncidentExportJob
	'incident.bundle.export.resume': IncidentExportJob
	'incident.bundle.export': IncidentBundle
}

export interface QueryResultMap {
	'connection.list': ConnectionProfile[]
	'connection.get': ConnectionProfile
	'namespace.list': NamespaceProfile[]
	'provider.capabilities': ProviderCapabilities
	'key.list': KeyListResult
	'key.search': KeyListResult
	'key.count': KeyCountResult
	'key.get': KeyValueRecord
	'snapshot.list': SnapshotRecord[]
	'workflow.template.list': WorkflowTemplate[]
	'workflow.preview': WorkflowDryRunPreview
	'workflow.execution.list': WorkflowExecutionRecord[]
	'workflow.execution.get': WorkflowExecutionRecord
	'history.list': HistoryEvent[]
	'observability.dashboard': ObservabilityDashboard
	'observability.keyspaceActivity': KeyspaceActivityView
	'observability.failedOperations': FailedOperationDrilldownResult
	'observability.comparePeriods': ComparePeriodsResult
	'alert.list': AlertEvent[]
	'alert.unread.count': AlertUnreadCountResult
	'alert.rule.list': AlertRule[]
	'policy.pack.list': GovernancePolicyPack[]
	'policy.pack.assignment.list': GovernanceAssignment[]
	'retention.policy.list': RetentionPolicyListResult
	'storage.summary': StorageSummary
	'incident.bundle.export.job.get': IncidentExportJob
	'incident.bundle.preview': IncidentBundlePreview
	'incident.bundle.list': IncidentBundle[]
}

export interface OperationError {
	code: OperationErrorCode
	message: string
	retryable: boolean
	details?: Record<string, unknown>
}

export interface IpcCommandEnvelope<
	TPayload,
	TCommand extends AppCommand = AppCommand,
> {
	command: TCommand
	payload: TPayload
	correlationId: string
}

export interface IpcQueryEnvelope<
	TPayload,
	TQuery extends AppQuery = AppQuery,
> {
	query: TQuery
	payload: TPayload
	correlationId: string
}

export interface IpcResponseEnvelope<TData> {
	ok: boolean
	correlationId: string
	data?: TData
	error?: OperationError
}

export type AnyCommandEnvelope = {
	[K in keyof CommandPayloadMap]: IpcCommandEnvelope<CommandPayloadMap[K], K>
}[keyof CommandPayloadMap]

export type AnyQueryEnvelope = {
	[K in keyof QueryPayloadMap]: IpcQueryEnvelope<QueryPayloadMap[K], K>
}[keyof QueryPayloadMap]
