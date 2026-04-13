import { ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'

import type { DesktopApi } from '../../shared/contracts/api'
import type { UpdateStatus } from '../../shared/contracts/cache'
import type {
	CommandPayloadMap,
	CommandResultMap,
	IpcResponseEnvelope,
	QueryPayloadMap,
	QueryResultMap,
} from '../../shared/ipc/contracts'
import {
	APP_COMMAND_CHANNEL,
	APP_QUERY_CHANNEL,
} from '../../shared/ipc/contracts'
import {
	APP_UPDATER_APPLY_CHANNEL,
	APP_UPDATER_CHECK_CHANNEL,
	APP_UPDATER_EVENT_CHANNEL,
	APP_UPDATER_STATUS_CHANNEL,
} from '../../shared/ipc/updater'
import { commandEnvelopeSchema, queryEnvelopeSchema } from '../schemas/ipc'

const createCorrelationId = (): string => {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID()
	}

	return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const invokeCommand = async <TCommand extends keyof CommandPayloadMap>(
	command: TCommand,
	payload: CommandPayloadMap[TCommand],
): Promise<IpcResponseEnvelope<CommandResultMap[TCommand]>> => {
	const envelope = commandEnvelopeSchema.parse({
		command,
		payload,
		correlationId: createCorrelationId(),
	})

	return ipcRenderer.invoke(APP_COMMAND_CHANNEL, envelope)
}

const invokeQuery = async <TQuery extends keyof QueryPayloadMap>(
	query: TQuery,
	payload: QueryPayloadMap[TQuery],
): Promise<IpcResponseEnvelope<QueryResultMap[TQuery]>> => {
	const envelope = queryEnvelopeSchema.parse({
		query,
		payload,
		correlationId: createCorrelationId(),
	})

	return ipcRenderer.invoke(APP_QUERY_CHANNEL, envelope)
}

export const desktopApi: DesktopApi = {
	listConnections: () => invokeQuery('connection.list', {}),
	getConnection: (payload) => invokeQuery('connection.get', payload),
	listNamespaces: (payload) => invokeQuery('namespace.list', payload),
	createNamespace: (payload) => invokeCommand('namespace.create', payload),
	updateNamespace: (payload) => invokeCommand('namespace.update', payload),
	deleteNamespace: (payload) => invokeCommand('namespace.delete', payload),
	createConnection: (payload) => invokeCommand('connection.create', payload),
	updateConnection: (payload) => invokeCommand('connection.update', payload),
	deleteConnection: (payload) => invokeCommand('connection.delete', payload),
	testConnection: (payload) => invokeCommand('connection.test', payload),
	getCapabilities: (payload) => invokeQuery('provider.capabilities', payload),
	listKeys: (payload) => invokeQuery('key.list', payload),
	searchKeys: (payload) => invokeQuery('key.search', payload),
	countKeys: (payload) => invokeQuery('key.count', payload),
	getKey: (payload) => invokeQuery('key.get', payload),
	setKey: (payload) => invokeCommand('key.set', payload),
	updateKey: (payload) => invokeCommand('key.update', payload),
	deleteKey: (payload) => invokeCommand('key.delete', payload),
	listSnapshots: (payload) => invokeQuery('snapshot.list', payload),
	restoreSnapshot: (payload) => invokeCommand('rollback.restore', payload),
	listWorkflowTemplates: () => invokeQuery('workflow.template.list', {}),
	createWorkflowTemplate: (payload) =>
		invokeCommand('workflow.template.create', payload),
	updateWorkflowTemplate: (payload) =>
		invokeCommand('workflow.template.update', payload),
	deleteWorkflowTemplate: (payload) =>
		invokeCommand('workflow.template.delete', payload),
	previewWorkflow: (payload) => invokeQuery('workflow.preview', payload),
	executeWorkflow: (payload) => invokeCommand('workflow.execute', payload),
	rerunWorkflow: (payload) => invokeCommand('workflow.rerun', payload),
	resumeWorkflow: (payload) => invokeCommand('workflow.resume', payload),
	listWorkflowExecutions: (payload) =>
		invokeQuery('workflow.execution.list', payload),
	getWorkflowExecution: (payload) =>
		invokeQuery('workflow.execution.get', payload),
	listHistory: (payload) => invokeQuery('history.list', payload),
	getObservabilityDashboard: (payload) =>
		invokeQuery('observability.dashboard', payload),
	getKeyspaceActivity: (payload) =>
		invokeQuery('observability.keyspaceActivity', payload),
	getFailedOperationDrilldown: (payload) =>
		invokeQuery('observability.failedOperations', payload),
	comparePeriods: (payload) =>
		invokeQuery('observability.comparePeriods', payload),
	previewIncidentBundle: (payload) =>
		invokeQuery('incident.bundle.preview', payload),
	listIncidentBundles: (payload) => invokeQuery('incident.bundle.list', payload),
	exportIncidentBundle: (payload) =>
		invokeCommand('incident.bundle.export', payload),
	startIncidentBundleExport: (payload) =>
		invokeCommand('incident.bundle.export.start', payload),
	cancelIncidentBundleExportJob: (payload) =>
		invokeCommand('incident.bundle.export.cancel', payload),
	resumeIncidentBundleExportJob: (payload) =>
		invokeCommand('incident.bundle.export.resume', payload),
	getIncidentBundleExportJob: (payload) =>
		invokeQuery('incident.bundle.export.job.get', payload),
	listAlerts: (payload) => invokeQuery('alert.list', payload),
	getUnreadAlertCount: () => invokeQuery('alert.unread.count', {}),
	markAlertRead: (payload) => invokeCommand('alert.markRead', payload),
	markAllAlertsRead: () => invokeCommand('alert.markAllRead', {}),
	deleteAllAlerts: () => invokeCommand('alert.deleteAll', {}),
	listAlertRules: () => invokeQuery('alert.rule.list', {}),
	createAlertRule: (payload) => invokeCommand('alert.rule.create', payload),
	updateAlertRule: (payload) => invokeCommand('alert.rule.update', payload),
	deleteAlertRule: (payload) => invokeCommand('alert.rule.delete', payload),
	listPolicyPacks: () => invokeQuery('policy.pack.list', {}),
	createPolicyPack: (payload) => invokeCommand('policy.pack.create', payload),
	updatePolicyPack: (payload) => invokeCommand('policy.pack.update', payload),
	deletePolicyPack: (payload) => invokeCommand('policy.pack.delete', payload),
	assignPolicyPack: (payload) => invokeCommand('policy.pack.assign', payload),
	listPolicyPackAssignments: (payload) =>
		invokeQuery('policy.pack.assignment.list', payload),
	listRetentionPolicies: () => invokeQuery('retention.policy.list', {}),
	updateRetentionPolicy: (payload) =>
		invokeCommand('retention.policy.update', payload),
	purgeRetentionData: (payload) => invokeCommand('retention.purge', payload),
	getStorageSummary: () => invokeQuery('storage.summary', {}),
	getUpdateStatus: () => ipcRenderer.invoke(APP_UPDATER_STATUS_CHANNEL),
	checkForUpdates: () => ipcRenderer.invoke(APP_UPDATER_CHECK_CHANNEL),
	applyUpdateAndRestart: () => ipcRenderer.invoke(APP_UPDATER_APPLY_CHANNEL),
	onUpdateStatusChange: (listener) => {
		const handleStatusChange = (
			_event: IpcRendererEvent,
			status: UpdateStatus,
		): void => {
			listener(status)
		}

		ipcRenderer.on(APP_UPDATER_EVENT_CHANNEL, handleStatusChange)

		return () => {
			ipcRenderer.removeListener(APP_UPDATER_EVENT_CHANNEL, handleStatusChange)
		}
	},
}
