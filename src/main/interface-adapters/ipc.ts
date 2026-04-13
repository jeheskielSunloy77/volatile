import { ipcMain } from 'electron'
import { ZodError } from 'zod'

import type {
	AnyCommandEnvelope,
	AnyQueryEnvelope,
	IpcResponseEnvelope,
	OperationError,
} from '../../shared/ipc/contracts'
import {
	APP_COMMAND_CHANNEL,
	APP_QUERY_CHANNEL,
} from '../../shared/ipc/contracts'
import {
	commandEnvelopeSchema,
	queryEnvelopeSchema,
} from '../../shared/schemas/ipc'

import type { OperationsService } from '../application/operations-service'
import { OperationFailure } from '../domain/operation-failure'

export const registerIpcHandlers = (service: OperationsService): void => {
	ipcMain.removeHandler(APP_COMMAND_CHANNEL)
	ipcMain.removeHandler(APP_QUERY_CHANNEL)

	ipcMain.handle(
		APP_COMMAND_CHANNEL,
		async (_event, rawEnvelope): Promise<IpcResponseEnvelope<unknown>> => {
			try {
				const envelope = commandEnvelopeSchema.parse(rawEnvelope)
				const data = await handleCommand(service, envelope)

				return {
					ok: true,
					correlationId: envelope.correlationId,
					data,
				}
			} catch (error) {
				return toErrorResponse(error, rawEnvelope)
			}
		},
	)

	ipcMain.handle(
		APP_QUERY_CHANNEL,
		async (_event, rawEnvelope): Promise<IpcResponseEnvelope<unknown>> => {
			try {
				const envelope = queryEnvelopeSchema.parse(rawEnvelope)
				const data = await handleQuery(service, envelope)

				return {
					ok: true,
					correlationId: envelope.correlationId,
					data,
				}
			} catch (error) {
				return toErrorResponse(error, rawEnvelope)
			}
		},
	)
}

const handleCommand = async (
	service: OperationsService,
	envelope: AnyCommandEnvelope,
): Promise<unknown> => {
	switch (envelope.command) {
		case 'connection.create':
			return service.createConnection(envelope.payload)
		case 'connection.update':
			return service.updateConnection(envelope.payload)
		case 'connection.delete':
			return service.deleteConnection(envelope.payload)
		case 'connection.test':
			return service.testConnection(envelope.payload)
		case 'namespace.create':
			return service.createNamespace(envelope.payload)
		case 'namespace.update':
			return service.updateNamespace(envelope.payload)
		case 'namespace.delete':
			return service.deleteNamespace(envelope.payload)
		case 'key.set':
			return service.setKey(envelope.payload)
		case 'key.update':
			return service.updateKey(envelope.payload)
		case 'key.delete':
			return service.deleteKey(envelope.payload)
		case 'rollback.restore':
			return service.restoreSnapshot(envelope.payload)
		case 'workflow.template.create':
			return service.createWorkflowTemplate(envelope.payload)
		case 'workflow.template.update':
			return service.updateWorkflowTemplate(envelope.payload)
		case 'workflow.template.delete':
			return service.deleteWorkflowTemplate(envelope.payload)
		case 'workflow.execute':
			return service.executeWorkflow(envelope.payload)
		case 'workflow.rerun':
			return service.rerunWorkflow(envelope.payload)
		case 'workflow.resume':
			return service.resumeWorkflow(envelope.payload)
		case 'alert.markRead':
			return service.markAlertRead(envelope.payload)
		case 'alert.markAllRead':
			return service.markAllAlertsRead(envelope.payload)
		case 'alert.deleteAll':
			return service.deleteAllAlerts()
		case 'alert.rule.create':
			return service.createAlertRule(envelope.payload)
		case 'alert.rule.update':
			return service.updateAlertRule(envelope.payload)
		case 'alert.rule.delete':
			return service.deleteAlertRule(envelope.payload)
		case 'policy.pack.create':
			return service.createGovernancePolicyPack(envelope.payload)
		case 'policy.pack.update':
			return service.updateGovernancePolicyPack(envelope.payload)
		case 'policy.pack.delete':
			return service.deleteGovernancePolicyPack(envelope.payload)
		case 'policy.pack.assign':
			return service.assignGovernancePolicyPack(envelope.payload)
		case 'retention.policy.update':
			return service.updateRetentionPolicy(envelope.payload)
		case 'retention.purge':
			return service.purgeRetentionData(envelope.payload)
		case 'incident.bundle.export.start':
			return service.startIncidentBundleExport(envelope.payload)
		case 'incident.bundle.export.cancel':
			return service.cancelIncidentBundleExport(envelope.payload)
		case 'incident.bundle.export.resume':
			return service.resumeIncidentBundleExport(envelope.payload)
		case 'incident.bundle.export':
			return service.exportIncidentBundle(envelope.payload)
		default:
			return assertNever(envelope)
	}
}

const handleQuery = async (
	service: OperationsService,
	envelope: AnyQueryEnvelope,
): Promise<unknown> => {
	switch (envelope.query) {
		case 'connection.list':
			return service.listConnections()
		case 'connection.get':
			return service.getConnection(envelope.payload)
		case 'namespace.list':
			return service.listNamespaces(envelope.payload)
		case 'provider.capabilities':
			return service.getCapabilities(envelope.payload)
		case 'key.list':
			return service.listKeys(envelope.payload)
		case 'key.search':
			return service.searchKeys(envelope.payload)
		case 'key.count':
			return service.countKeys(envelope.payload)
		case 'key.get':
			return service.getKey(envelope.payload)
		case 'snapshot.list':
			return service.listSnapshots(envelope.payload)
		case 'workflow.template.list':
			return service.listWorkflowTemplates()
		case 'workflow.preview':
			return service.previewWorkflow(envelope.payload)
		case 'workflow.execution.list':
			return service.listWorkflowExecutions(envelope.payload)
		case 'workflow.execution.get':
			return service.getWorkflowExecution(envelope.payload)
		case 'history.list':
			return service.listHistory(envelope.payload)
		case 'observability.dashboard':
			return service.getObservabilityDashboard(envelope.payload)
		case 'observability.keyspaceActivity':
			return service.getKeyspaceActivity(envelope.payload)
		case 'observability.failedOperations':
			return service.getFailedOperationDrilldown(envelope.payload)
		case 'observability.comparePeriods':
			return service.comparePeriods(envelope.payload)
		case 'alert.list':
			return service.listAlerts(envelope.payload)
		case 'alert.unread.count':
			return service.getUnreadAlertCount()
		case 'alert.rule.list':
			return service.listAlertRules()
		case 'policy.pack.list':
			return service.listGovernancePolicyPacks()
		case 'policy.pack.assignment.list':
			return service.listGovernanceAssignments(envelope.payload)
		case 'retention.policy.list':
			return service.listRetentionPolicies()
		case 'storage.summary':
			return service.getStorageSummary()
		case 'incident.bundle.export.job.get':
			return service.getIncidentBundleExportJob(envelope.payload)
		case 'incident.bundle.preview':
			return service.previewIncidentBundle(envelope.payload)
		case 'incident.bundle.list':
			return service.listIncidentBundles(envelope.payload)
		default:
			return assertNever(envelope)
	}
}

const toErrorResponse = (
	error: unknown,
	rawEnvelope: unknown,
): IpcResponseEnvelope<unknown> => {
	const correlationId = getCorrelationId(rawEnvelope)
	const operationError = toOperationError(error)

	return {
		ok: false,
		correlationId,
		error: operationError,
	}
}

const getCorrelationId = (rawEnvelope: unknown): string => {
	if (
		typeof rawEnvelope === 'object' &&
		rawEnvelope !== null &&
		'correlationId' in rawEnvelope &&
		typeof rawEnvelope.correlationId === 'string'
	) {
		return rawEnvelope.correlationId
	}

	return `invalid-${Date.now()}`
}

const toOperationError = (error: unknown): OperationError => {
	if (error instanceof OperationFailure) {
		return {
			code: error.code,
			message: error.message,
			retryable: error.retryable,
			details: error.details,
		}
	}

	if (error instanceof ZodError) {
		return {
			code: 'VALIDATION_ERROR',
			message: 'Invalid request payload.',
			retryable: false,
			details: {
				issues: error.issues,
			},
		}
	}

	return {
		code: 'INTERNAL_ERROR',
		message:
			error instanceof Error ? error.message : 'Unexpected internal error.',
		retryable: false,
	}
}

const assertNever = (value: never): never => {
	throw new OperationFailure(
		'INTERNAL_ERROR',
		`Unsupported IPC route: ${JSON.stringify(value)}`,
		false,
	)
}
