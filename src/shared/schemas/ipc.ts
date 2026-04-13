import { z } from 'zod'
import { CACHE_ENGINES, isRedisFamilyEngine } from '../lib/cache-engines'

export const correlationIdSchema = z.string().min(1)

export const engineSchema = z.enum(CACHE_ENGINES)
export const namespaceStrategySchema = z.enum(['redisLogicalDb', 'keyPrefix'])
export const environmentSchema = z.enum(['dev', 'staging', 'prod'])
export const backoffStrategySchema = z.enum(['fixed', 'exponential'])
export const workflowKindSchema = z.enum([
  'deleteByPattern',
  'ttlNormalize',
  'warmupSet',
])
export const alertRuleMetricSchema = z.enum([
  'errorRate',
  'latencyP95Ms',
  'slowOperationCount',
  'failedOperationCount',
])
export const governanceWeekdaySchema = z.enum([
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
  'sun',
])
export const retentionDatasetSchema = z.enum([
  'timelineEvents',
  'observabilitySnapshots',
  'workflowHistory',
  'incidentArtifacts',
])
export const incidentBundleIncludeSchema = z.enum([
  'timeline',
  'logs',
  'diagnostics',
  'metrics',
])
export const redactionProfileSchema = z.enum(['default', 'strict'])

export const connectionSecretSchema = z
  .object({
    username: z.string().optional(),
    password: z.string().optional(),
    token: z.string().optional(),
  })
  .strict()

export const connectionDraftSchema = z
  .object({
    name: z.string().min(1),
    engine: engineSchema,
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    dbIndex: z.number().int().min(0).optional(),
    tlsEnabled: z.boolean(),
    environment: environmentSchema,
    tags: z.array(z.string()).max(20),
    readOnly: z.boolean(),
    forceReadOnly: z.boolean().optional().default(false),
    timeoutMs: z.number().int().min(100).max(120000),
    retryMaxAttempts: z.number().int().min(1).max(10).optional().default(1),
    retryBackoffMs: z.number().int().min(0).max(120000).optional().default(250),
    retryBackoffStrategy: backoffStrategySchema.optional().default('fixed'),
    retryAbortOnErrorRate: z.number().min(0).max(1).optional().default(1),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!isRedisFamilyEngine(value.engine) && typeof value.dbIndex === 'number') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dbIndex'],
        message: 'dbIndex is only supported by Redis-family profiles',
      })
    }
  })

const idSchema = z.string().min(1)

const connectionCreatePayloadSchema = z
  .object({
    profile: connectionDraftSchema,
    secret: connectionSecretSchema,
  })
  .strict()

const connectionUpdatePayloadSchema = z
  .object({
    id: idSchema,
    profile: connectionDraftSchema,
    secret: connectionSecretSchema.optional(),
  })
  .strict()

const connectionDeletePayloadSchema = z
  .object({
    id: idSchema,
  })
  .strict()

const connectionGetPayloadSchema = connectionDeletePayloadSchema

const namespaceDraftSchema = z
  .object({
    connectionId: idSchema,
    name: z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
    strategy: namespaceStrategySchema,
    dbIndex: z.number().int().min(0).max(15).optional(),
    keyPrefix: z.string().min(1).max(255).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.strategy === 'redisLogicalDb') {
      if (typeof value.dbIndex !== 'number') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['dbIndex'],
          message: 'dbIndex is required for redisLogicalDb strategy',
        })
      }
      if (typeof value.keyPrefix === 'string') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['keyPrefix'],
          message: 'keyPrefix is not supported for redisLogicalDb strategy',
        })
      }
      return
    }

    if (typeof value.keyPrefix !== 'string') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['keyPrefix'],
        message: 'keyPrefix is required for keyPrefix strategy',
      })
    }
    if (typeof value.dbIndex === 'number') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dbIndex'],
        message: 'dbIndex is not supported for keyPrefix strategy',
      })
    }
  })

const namespaceListPayloadSchema = z
  .object({
    connectionId: idSchema,
  })
  .strict()

const namespaceCreatePayloadSchema = z
  .object({
    namespace: namespaceDraftSchema,
  })
  .strict()

const namespaceUpdatePayloadSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  })
  .strict()

const namespaceDeletePayloadSchema = z
  .object({
    id: idSchema,
  })
  .strict()

const connectionTestPayloadSchema = z
  .object({
    connectionId: idSchema.optional(),
    profile: connectionDraftSchema,
    secret: connectionSecretSchema,
  })
  .strict()

const capabilityPayloadSchema = z
  .object({
    connectionId: idSchema,
  })
  .strict()

const keyListPayloadSchema = z
  .object({
    connectionId: idSchema,
    namespaceId: idSchema.optional(),
    cursor: z.string().optional(),
    limit: z.number().int().min(1).max(500),
  })
  .strict()

const keySearchPayloadSchema = z
  .object({
    connectionId: idSchema,
    namespaceId: idSchema.optional(),
    pattern: z.string().min(1),
    cursor: z.string().optional(),
    limit: z.number().int().min(1).max(500),
  })
  .strict()

const keyCountPayloadSchema = z
  .object({
    connectionId: idSchema,
    namespaceId: idSchema.optional(),
    pattern: z.string().min(1).optional(),
  })
  .strict()

const keyGetPayloadSchema = z
  .object({
    connectionId: idSchema,
    namespaceId: idSchema.optional(),
    key: z.string().min(1),
  })
  .strict()

const keySetPayloadSchema = z
  .object({
    connectionId: idSchema,
    namespaceId: idSchema.optional(),
    key: z.string().min(1),
    value: z.string(),
    ttlSeconds: z.number().int().min(1).max(31536000).optional(),
  })
  .strict()

const keyDeletePayloadSchema = z
  .object({
    connectionId: idSchema,
    namespaceId: idSchema.optional(),
    key: z.string().min(1),
    guardrailConfirmed: z.boolean().optional(),
  })
  .strict()

const snapshotListPayloadSchema = z
  .object({
    connectionId: idSchema,
    namespaceId: idSchema.optional(),
    key: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(200),
  })
  .strict()

const rollbackRestorePayloadSchema = z
  .object({
    connectionId: idSchema,
    namespaceId: idSchema.optional(),
    key: z.string().min(1),
    snapshotId: idSchema.optional(),
    guardrailConfirmed: z.boolean().optional(),
  })
  .strict()

const workflowTemplateDraftSchema = z
  .object({
    name: z.string().min(1),
    kind: workflowKindSchema,
    parameters: z.record(z.string(), z.unknown()),
    requiresApprovalOnProd: z.boolean(),
    supportsDryRun: z.boolean(),
  })
  .strict()

const workflowTemplateCreatePayloadSchema = z
  .object({
    template: workflowTemplateDraftSchema,
  })
  .strict()

const workflowTemplateUpdatePayloadSchema = z
  .object({
    id: idSchema,
    template: workflowTemplateDraftSchema,
  })
  .strict()

const workflowTemplateDeletePayloadSchema = z
  .object({
    id: idSchema,
  })
  .strict()

const workflowRetryPolicySchema = z
  .object({
    maxAttempts: z.number().int().min(1).max(10),
    backoffMs: z.number().int().min(0).max(120000),
    backoffStrategy: backoffStrategySchema,
    abortOnErrorRate: z.number().min(0).max(1),
  })
  .strict()

const workflowPreviewPayloadSchema = z
  .object({
    connectionId: idSchema,
    namespaceId: idSchema.optional(),
    templateId: idSchema.optional(),
    template: workflowTemplateDraftSchema.optional(),
    parameterOverrides: z.record(z.string(), z.unknown()).optional(),
    cursor: z.string().optional(),
    limit: z.number().int().min(1).max(500).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.templateId && !value.template) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['templateId'],
        message: 'Either templateId or template must be provided',
      })
    }
  })

const workflowExecutePayloadSchema = z
  .object({
    connectionId: idSchema,
    namespaceId: idSchema.optional(),
    templateId: idSchema.optional(),
    template: workflowTemplateDraftSchema.optional(),
    parameterOverrides: z.record(z.string(), z.unknown()).optional(),
    dryRun: z.boolean().optional(),
    guardrailConfirmed: z.boolean().optional(),
    retryPolicy: workflowRetryPolicySchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.templateId && !value.template) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['templateId'],
        message: 'Either templateId or template must be provided',
      })
    }
  })

const workflowRerunPayloadSchema = z
  .object({
    executionId: idSchema,
    parameterOverrides: z.record(z.string(), z.unknown()).optional(),
    dryRun: z.boolean().optional(),
    guardrailConfirmed: z.boolean().optional(),
  })
  .strict()

const workflowResumePayloadSchema = z
  .object({
    executionId: idSchema,
    guardrailConfirmed: z.boolean().optional(),
  })
  .strict()

const alertRuleDraftSchema = z
  .object({
    name: z.string().min(1),
    metric: alertRuleMetricSchema,
    threshold: z.number().finite(),
    lookbackMinutes: z.number().int().min(1).max(1440),
    severity: z.enum(['info', 'warning', 'critical']),
    connectionId: idSchema.optional(),
    environment: environmentSchema.optional(),
    enabled: z.boolean(),
  })
  .strict()

const alertRuleCreatePayloadSchema = z
  .object({
    rule: alertRuleDraftSchema,
  })
  .strict()

const alertRuleUpdatePayloadSchema = z
  .object({
    id: idSchema,
    rule: alertRuleDraftSchema,
  })
  .strict()

const alertRuleDeletePayloadSchema = z
  .object({
    id: idSchema,
  })
  .strict()

const hhmmTimeSchema = z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/)

const workflowScheduleWindowSchema = z
  .object({
    id: idSchema,
    weekdays: z.array(governanceWeekdaySchema).min(1),
    startTime: hhmmTimeSchema,
    endTime: hhmmTimeSchema,
    timezone: z.literal('UTC'),
  })
  .strict()

const governancePolicyPackDraftSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    environments: z.array(environmentSchema).min(1),
    maxWorkflowItems: z.number().int().min(1).max(10000),
    maxRetryAttempts: z.number().int().min(1).max(10),
    schedulingEnabled: z.boolean(),
    executionWindows: z.array(workflowScheduleWindowSchema).max(64),
    enabled: z.boolean(),
  })
  .strict()

const governancePolicyPackCreatePayloadSchema = z
  .object({
    policyPack: governancePolicyPackDraftSchema,
  })
  .strict()

const governancePolicyPackUpdatePayloadSchema = z
  .object({
    id: idSchema,
    policyPack: governancePolicyPackDraftSchema,
  })
  .strict()

const governancePolicyPackDeletePayloadSchema = z
  .object({
    id: idSchema,
  })
  .strict()

const governanceAssignmentPayloadSchema = z
  .object({
    connectionId: idSchema,
    policyPackId: idSchema.optional(),
  })
  .strict()

const retentionPolicySchema = z
  .object({
    dataset: retentionDatasetSchema,
    retentionDays: z.number().int().min(1).max(3650),
    storageBudgetMb: z.number().int().min(1).max(100_000),
    autoPurgeOldest: z.boolean(),
  })
  .strict()

const retentionPolicyUpdatePayloadSchema = z
  .object({
    policy: retentionPolicySchema,
  })
  .strict()

const retentionPurgePayloadSchema = z
  .object({
    dataset: retentionDatasetSchema,
    olderThan: z.string().optional(),
    dryRun: z.boolean().optional(),
  })
  .strict()

const incidentBundleBasePayloadSchema = z
  .object({
    from: z.string().min(1),
    to: z.string().min(1),
    connectionIds: z.array(idSchema).optional(),
    namespaceId: idSchema.optional(),
    includes: z.array(incidentBundleIncludeSchema).min(1),
    redactionProfile: redactionProfileSchema,
  })
  .strict()

const incidentBundlePreviewPayloadSchema = incidentBundleBasePayloadSchema

const incidentBundleExportPayloadSchema = incidentBundleBasePayloadSchema
  .extend({
    destinationPath: z.string().min(1).optional(),
  })
  .strict()

const incidentBundleExportStartPayloadSchema = incidentBundleExportPayloadSchema

const incidentBundleExportJobPayloadSchema = z
  .object({
    jobId: idSchema,
  })
  .strict()

const workflowExecutionListPayloadSchema = z
  .object({
    connectionId: idSchema.optional(),
    namespaceId: idSchema.optional(),
    templateId: idSchema.optional(),
    limit: z.number().int().min(1).max(500),
  })
  .strict()

const workflowExecutionGetPayloadSchema = z
  .object({
    id: idSchema,
  })
  .strict()

const historyListPayloadSchema = z
  .object({
    connectionId: idSchema.optional(),
    namespaceId: idSchema.optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    limit: z.number().int().min(1).max(1000),
  })
  .strict()

const observabilityDashboardPayloadSchema = z
  .object({
    connectionId: idSchema.optional(),
    namespaceId: idSchema.optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    intervalMinutes: z.number().int().min(1).max(1440).optional(),
    limit: z.number().int().min(1).max(2000).optional(),
  })
  .strict()

const keyspaceActivityPayloadSchema = z
  .object({
    connectionId: idSchema.optional(),
    namespaceId: idSchema.optional(),
    from: z.string().min(1),
    to: z.string().min(1),
    intervalMinutes: z.number().int().min(1).max(1440).optional(),
    limit: z.number().int().min(1).max(500).optional(),
  })
  .strict()

const failedOperationDrilldownPayloadSchema = z
  .object({
    connectionId: idSchema.optional(),
    namespaceId: idSchema.optional(),
    eventId: idSchema.optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    limit: z.number().int().min(1).max(500),
  })
  .strict()

const comparePeriodsPayloadSchema = z
  .object({
    connectionId: idSchema.optional(),
    namespaceId: idSchema.optional(),
    baselineFrom: z.string().min(1),
    baselineTo: z.string().min(1),
    compareFrom: z.string().min(1),
    compareTo: z.string().min(1),
  })
  .strict()

const alertListPayloadSchema = z
  .object({
    unreadOnly: z.boolean().optional(),
    limit: z.number().int().min(1).max(200),
  })
  .strict()

const alertMarkReadPayloadSchema = z
  .object({
    id: idSchema,
  })
  .strict()

const alertMarkAllReadPayloadSchema = z.object({}).strict()

const alertDeleteAllPayloadSchema = z.object({}).strict()

const alertUnreadCountPayloadSchema = z.object({}).strict()

const governanceAssignmentListPayloadSchema = z
  .object({
    connectionId: idSchema.optional(),
  })
  .strict()

const incidentBundleListPayloadSchema = z
  .object({
    limit: z.number().int().min(1).max(500),
    namespaceId: idSchema.optional(),
  })
  .strict()

export const commandEnvelopeSchema = z.discriminatedUnion('command', [
  z
    .object({
      command: z.literal('connection.create'),
      payload: connectionCreatePayloadSchema,
      correlationId: correlationIdSchema,
    })
    .strict(),
  z
    .object({
      command: z.literal('connection.update'),
      payload: connectionUpdatePayloadSchema,
      correlationId: correlationIdSchema,
    })
    .strict(),
  z
    .object({
      command: z.literal('connection.delete'),
      payload: connectionDeletePayloadSchema,
      correlationId: correlationIdSchema,
    })
    .strict(),
  z
    .object({
      command: z.literal('connection.test'),
      payload: connectionTestPayloadSchema,
      correlationId: correlationIdSchema,
    })
    .strict(),
  z
    .object({
      command: z.literal('namespace.create'),
      payload: namespaceCreatePayloadSchema,
      correlationId: correlationIdSchema,
    })
    .strict(),
  z
    .object({
      command: z.literal('namespace.update'),
      payload: namespaceUpdatePayloadSchema,
      correlationId: correlationIdSchema,
    })
    .strict(),
  z
    .object({
      command: z.literal('namespace.delete'),
      payload: namespaceDeletePayloadSchema,
      correlationId: correlationIdSchema,
    })
    .strict(),
  z
    .object({
      command: z.literal('key.set'),
      payload: keySetPayloadSchema,
      correlationId: correlationIdSchema,
    })
    .strict(),
  z
    .object({
      command: z.literal('key.delete'),
      payload: keyDeletePayloadSchema,
      correlationId: correlationIdSchema,
    })
    .strict(),
  z
    .object({
      command: z.literal('rollback.restore'),
      payload: rollbackRestorePayloadSchema,
      correlationId: correlationIdSchema,
    })
    .strict(),
  z
    .object({
      command: z.literal('workflow.template.create'),
      payload: workflowTemplateCreatePayloadSchema,
      correlationId: correlationIdSchema,
    })
    .strict(),
  z
    .object({
      command: z.literal('workflow.template.update'),
      payload: workflowTemplateUpdatePayloadSchema,
      correlationId: correlationIdSchema,
    })
    .strict(),
  z
    .object({
      command: z.literal('workflow.template.delete'),
      payload: workflowTemplateDeletePayloadSchema,
      correlationId: correlationIdSchema,
    })
    .strict(),
  z
    .object({
      command: z.literal('workflow.execute'),
      payload: workflowExecutePayloadSchema,
      correlationId: correlationIdSchema,
    })
    .strict(),
  z
    .object({
      command: z.literal('workflow.rerun'),
      payload: workflowRerunPayloadSchema,
      correlationId: correlationIdSchema,
    })
    .strict(),
  z
    .object({
      command: z.literal('workflow.resume'),
      payload: workflowResumePayloadSchema,
      correlationId: correlationIdSchema,
    })
    .strict(),
  z
    .object({
      command: z.literal('alert.markRead'),
      payload: alertMarkReadPayloadSchema,
      correlationId: correlationIdSchema,
    })
    .strict(),
  z
    .object({
      command: z.literal('alert.markAllRead'),
      payload: alertMarkAllReadPayloadSchema,
      correlationId: correlationIdSchema,
    })
    .strict(),
  z
    .object({
      command: z.literal('alert.deleteAll'),
      payload: alertDeleteAllPayloadSchema,
      correlationId: correlationIdSchema,
    })
    .strict(),
  z
    .object({
      command: z.literal('alert.rule.create'),
      payload: alertRuleCreatePayloadSchema,
      correlationId: correlationIdSchema,
    })
    .strict(),
  z
    .object({
      command: z.literal('alert.rule.update'),
      payload: alertRuleUpdatePayloadSchema,
      correlationId: correlationIdSchema,
    })
    .strict(),
  z
    .object({
      command: z.literal('alert.rule.delete'),
      payload: alertRuleDeletePayloadSchema,
      correlationId: correlationIdSchema,
    })
    .strict(),
  z
    .object({
      command: z.literal('policy.pack.create'),
      payload: governancePolicyPackCreatePayloadSchema,
      correlationId: correlationIdSchema,
    })
    .strict(),
  z
    .object({
      command: z.literal('policy.pack.update'),
      payload: governancePolicyPackUpdatePayloadSchema,
      correlationId: correlationIdSchema,
    })
    .strict(),
  z
    .object({
      command: z.literal('policy.pack.delete'),
      payload: governancePolicyPackDeletePayloadSchema,
      correlationId: correlationIdSchema,
    })
    .strict(),
  z
    .object({
      command: z.literal('policy.pack.assign'),
      payload: governanceAssignmentPayloadSchema,
      correlationId: correlationIdSchema,
    })
    .strict(),
  z
    .object({
      command: z.literal('retention.policy.update'),
      payload: retentionPolicyUpdatePayloadSchema,
      correlationId: correlationIdSchema,
    })
    .strict(),
  z
    .object({
      command: z.literal('retention.purge'),
      payload: retentionPurgePayloadSchema,
      correlationId: correlationIdSchema,
    })
    .strict(),
  z
    .object({
      command: z.literal('incident.bundle.export.start'),
      payload: incidentBundleExportStartPayloadSchema,
      correlationId: correlationIdSchema,
    })
    .strict(),
  z
    .object({
      command: z.literal('incident.bundle.export.cancel'),
      payload: incidentBundleExportJobPayloadSchema,
      correlationId: correlationIdSchema,
    })
    .strict(),
  z
    .object({
      command: z.literal('incident.bundle.export.resume'),
      payload: incidentBundleExportJobPayloadSchema,
      correlationId: correlationIdSchema,
    })
    .strict(),
  z
    .object({
      command: z.literal('incident.bundle.export'),
      payload: incidentBundleExportPayloadSchema,
      correlationId: correlationIdSchema,
    })
    .strict(),
])

export const queryEnvelopeSchema = z.discriminatedUnion('query', [
  z
    .object({
      query: z.literal('connection.list'),
      payload: z.object({}).strict(),
      correlationId: correlationIdSchema,
    })
    .strict(),
  z
    .object({
      query: z.literal('connection.get'),
      payload: connectionGetPayloadSchema,
      correlationId: correlationIdSchema,
    })
    .strict(),
  z
    .object({
      query: z.literal('namespace.list'),
      payload: namespaceListPayloadSchema,
      correlationId: correlationIdSchema,
    })
    .strict(),
  z
    .object({
      query: z.literal('provider.capabilities'),
      payload: capabilityPayloadSchema,
      correlationId: correlationIdSchema,
    })
    .strict(),
  z
    .object({
      query: z.literal('key.list'),
      payload: keyListPayloadSchema,
      correlationId: correlationIdSchema,
    })
    .strict(),
  z
    .object({
      query: z.literal('key.search'),
      payload: keySearchPayloadSchema,
      correlationId: correlationIdSchema,
    })
    .strict(),
  z
    .object({
      query: z.literal('key.count'),
      payload: keyCountPayloadSchema,
      correlationId: correlationIdSchema,
    })
    .strict(),
  z
    .object({
      query: z.literal('key.get'),
      payload: keyGetPayloadSchema,
      correlationId: correlationIdSchema,
    })
    .strict(),
  z
    .object({
      query: z.literal('snapshot.list'),
      payload: snapshotListPayloadSchema,
      correlationId: correlationIdSchema,
    })
    .strict(),
  z
    .object({
      query: z.literal('workflow.template.list'),
      payload: z.object({}).strict(),
      correlationId: correlationIdSchema,
    })
    .strict(),
  z
    .object({
      query: z.literal('workflow.preview'),
      payload: workflowPreviewPayloadSchema,
      correlationId: correlationIdSchema,
    })
    .strict(),
  z
    .object({
      query: z.literal('workflow.execution.list'),
      payload: workflowExecutionListPayloadSchema,
      correlationId: correlationIdSchema,
    })
    .strict(),
  z
    .object({
      query: z.literal('workflow.execution.get'),
      payload: workflowExecutionGetPayloadSchema,
      correlationId: correlationIdSchema,
    })
    .strict(),
  z
    .object({
      query: z.literal('history.list'),
      payload: historyListPayloadSchema,
      correlationId: correlationIdSchema,
    })
    .strict(),
  z
    .object({
      query: z.literal('observability.dashboard'),
      payload: observabilityDashboardPayloadSchema,
      correlationId: correlationIdSchema,
    })
    .strict(),
  z
    .object({
      query: z.literal('observability.keyspaceActivity'),
      payload: keyspaceActivityPayloadSchema,
      correlationId: correlationIdSchema,
    })
    .strict(),
  z
    .object({
      query: z.literal('observability.failedOperations'),
      payload: failedOperationDrilldownPayloadSchema,
      correlationId: correlationIdSchema,
    })
    .strict(),
  z
    .object({
      query: z.literal('observability.comparePeriods'),
      payload: comparePeriodsPayloadSchema,
      correlationId: correlationIdSchema,
    })
    .strict(),
  z
    .object({
      query: z.literal('alert.list'),
      payload: alertListPayloadSchema,
      correlationId: correlationIdSchema,
    })
    .strict(),
  z
    .object({
      query: z.literal('alert.unread.count'),
      payload: alertUnreadCountPayloadSchema,
      correlationId: correlationIdSchema,
    })
    .strict(),
  z
    .object({
      query: z.literal('alert.rule.list'),
      payload: z.object({}).strict(),
      correlationId: correlationIdSchema,
    })
    .strict(),
  z
    .object({
      query: z.literal('policy.pack.list'),
      payload: z.object({}).strict(),
      correlationId: correlationIdSchema,
    })
    .strict(),
  z
    .object({
      query: z.literal('policy.pack.assignment.list'),
      payload: governanceAssignmentListPayloadSchema,
      correlationId: correlationIdSchema,
    })
    .strict(),
  z
    .object({
      query: z.literal('retention.policy.list'),
      payload: z.object({}).strict(),
      correlationId: correlationIdSchema,
    })
    .strict(),
  z
    .object({
      query: z.literal('storage.summary'),
      payload: z.object({}).strict(),
      correlationId: correlationIdSchema,
    })
    .strict(),
  z
    .object({
      query: z.literal('incident.bundle.export.job.get'),
      payload: incidentBundleExportJobPayloadSchema,
      correlationId: correlationIdSchema,
    })
    .strict(),
  z
    .object({
      query: z.literal('incident.bundle.preview'),
      payload: incidentBundlePreviewPayloadSchema,
      correlationId: correlationIdSchema,
    })
    .strict(),
  z
    .object({
      query: z.literal('incident.bundle.list'),
      payload: incidentBundleListPayloadSchema,
      correlationId: correlationIdSchema,
    })
    .strict(),
])

export type ParsedCommandEnvelope = z.infer<typeof commandEnvelopeSchema>
export type ParsedQueryEnvelope = z.infer<typeof queryEnvelopeSchema>
