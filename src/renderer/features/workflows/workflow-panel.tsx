import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
	BoxesIcon,
	FileCode2Icon,
	GaugeIcon,
	HashIcon,
	TimerResetIcon,
	WorkflowIcon,
} from 'lucide-react'
import * as React from 'react'
import {
	Bar,
	BarChart,
	CartesianGrid,
	Cell,
	Pie,
	PieChart,
	XAxis,
	YAxis,
} from 'recharts'
import { toast } from 'sonner'

import { Badge } from '@/renderer/components/ui/badge'
import { Button } from '@/renderer/components/ui/button'
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from '@/renderer/components/ui/card'
import {
	ChartConfig,
	ChartContainer,
	ChartLegend,
	ChartLegendContent,
	ChartTooltip,
	ChartTooltipContent,
} from '@/renderer/components/ui/chart'
import { Checkbox } from '@/renderer/components/ui/checkbox'
import {
	DashboardChartCard,
	DashboardStats,
} from '@/renderer/components/ui/dashboard'
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
} from '@/renderer/components/ui/input-group'
import { Label } from '@/renderer/components/ui/label'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/renderer/components/ui/select'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/renderer/components/ui/table'
import { Textarea } from '@/renderer/components/ui/textarea'
import { useStartupGateReady } from '@/renderer/app/startup-gate'
import { unwrapResponse } from '@/renderer/features/common/ipc'
import { useUiStore } from '@/renderer/state/ui-store'
import type {
	ConnectionProfile,
	WorkflowDryRunPreview,
	WorkflowTemplate,
	WorkflowTemplateDraft,
} from '@/shared/contracts/cache'

type WorkflowPanelProps = {
	connection?: ConnectionProfile | null
	mode?: 'connection' | 'templates'
}

const PREVIEW_PAGE_SIZE = 100

const createEmptyTemplate = (): WorkflowTemplateDraft => ({
	name: 'Custom Workflow',
	kind: 'deleteByPattern',
	parameters: {
		pattern: '*',
		limit: 100,
	},
	requiresApprovalOnProd: true,
	supportsDryRun: true,
})

const isBuiltinTemplate = (templateId: string): boolean =>
	templateId.startsWith('builtin-')

const workflowKindLabels = {
	deleteByPattern: 'Delete by pattern',
	ttlNormalize: 'TTL normalize',
	warmupSet: 'Warmup set',
} as const

const workflowRetryStrategyLabels = {
	fixed: 'Fixed',
	exponential: 'Exponential',
} as const

const getStatusBadgeVariant = (
	status: string,
): 'default' | 'outline' | 'destructive' => {
	if (status === 'success') {
		return 'default'
	}

	if (status === 'error' || status === 'aborted') {
		return 'destructive'
	}

	return 'outline'
}

export const WorkflowPanel = ({
	connection = null,
	mode = 'connection',
}: WorkflowPanelProps) => {
	const queryClient = useQueryClient()
	const isConnectionMode = mode === 'connection'
	const isTemplatesMode = mode === 'templates'
	const connectionId = connection?.id ?? null
	const { selectedNamespaceIdByConnection } = useUiStore()
	const selectedNamespaceId = connectionId
		? selectedNamespaceIdByConnection[connectionId] ?? null
		: null

	const [selectedTemplateId, setSelectedTemplateId] = React.useState<string>('')
	const [templateName, setTemplateName] = React.useState('')
	const [templateKind, setTemplateKind] =
		React.useState<WorkflowTemplateDraft['kind']>('deleteByPattern')
	const [templateParametersText, setTemplateParametersText] =
		React.useState('{}')
	const [requiresApprovalOnProd, setRequiresApprovalOnProd] =
		React.useState(true)
	const [supportsDryRun, setSupportsDryRun] = React.useState(true)
	const [preview, setPreview] = React.useState<WorkflowDryRunPreview | null>(
		null,
	)
	const [prodGuardrailConfirmed, setProdGuardrailConfirmed] =
		React.useState(false)

	const [retryMaxAttempts, setRetryMaxAttempts] = React.useState('1')
	const [retryBackoffMs, setRetryBackoffMs] = React.useState('250')
	const [retryStrategy, setRetryStrategy] = React.useState<
		'fixed' | 'exponential'
	>('fixed')
	const [retryAbortOnErrorRate, setRetryAbortOnErrorRate] = React.useState('1')

	const templatesQuery = useQuery({
		queryKey: ['workflow-templates'],
		queryFn: async () =>
			unwrapResponse(await window.desktopApi.listWorkflowTemplates()),
	})

	const executionsQuery = useQuery({
		queryKey: ['workflow-executions', connectionId, selectedNamespaceId],
		enabled: isConnectionMode && Boolean(connectionId),
		queryFn: async () =>
			unwrapResponse(
				await window.desktopApi.listWorkflowExecutions({
					connectionId: connectionId ?? '',
					namespaceId: selectedNamespaceId ?? undefined,
					limit: 50,
				}),
			),
	})
	useStartupGateReady(
		'workflow-templates-page',
		isTemplatesMode &&
			!templatesQuery.isLoading &&
			(!isConnectionMode || !connectionId || !executionsQuery.isLoading),
	)

	React.useEffect(() => {
		if (!templatesQuery.data || templatesQuery.data.length === 0) {
			const emptyTemplate = createEmptyTemplate()
			setSelectedTemplateId('inline')
			setTemplateName(emptyTemplate.name)
			setTemplateKind(emptyTemplate.kind)
			setTemplateParametersText(
				JSON.stringify(emptyTemplate.parameters, null, 2),
			)
			setRequiresApprovalOnProd(emptyTemplate.requiresApprovalOnProd)
			setSupportsDryRun(emptyTemplate.supportsDryRun)
			return
		}

		if (!selectedTemplateId) {
			const firstTemplate = templatesQuery.data[0]
			setSelectedTemplateId(firstTemplate.id)
			setTemplateName(firstTemplate.name)
			setTemplateKind(firstTemplate.kind)
			setTemplateParametersText(
				JSON.stringify(firstTemplate.parameters, null, 2),
			)
			setRequiresApprovalOnProd(firstTemplate.requiresApprovalOnProd)
			setSupportsDryRun(firstTemplate.supportsDryRun)
		}
	}, [selectedTemplateId, templatesQuery.data])

	const hydrateTemplateEditor = React.useCallback(
		(template: WorkflowTemplate | WorkflowTemplateDraft) => {
			setTemplateName(template.name)
			setTemplateKind(template.kind)
			setTemplateParametersText(JSON.stringify(template.parameters, null, 2))
			setRequiresApprovalOnProd(template.requiresApprovalOnProd)
			setSupportsDryRun(template.supportsDryRun)
		},
		[],
	)

	const parseParameters = React.useCallback((): Record<string, unknown> => {
		try {
			const parsed = JSON.parse(templateParametersText) as unknown
			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
				throw new Error('Template parameters must be a JSON object.')
			}

			return parsed as Record<string, unknown>
		} catch (error) {
			throw new Error(
				error instanceof Error
					? error.message
					: 'Template parameters are not valid JSON.',
			)
		}
	}, [templateParametersText])

	const buildTemplateDraft = React.useCallback((): WorkflowTemplateDraft => {
		return {
			name: templateName.trim() || 'Untitled Workflow',
			kind: templateKind,
			parameters: parseParameters(),
			requiresApprovalOnProd,
			supportsDryRun,
		}
	}, [
		parseParameters,
		requiresApprovalOnProd,
		supportsDryRun,
		templateKind,
		templateName,
	])

	const buildTemplateSource = React.useCallback(() => {
		const draft = buildTemplateDraft()

		if (selectedTemplateId && selectedTemplateId !== 'inline') {
			return {
				templateId: selectedTemplateId,
				parameterOverrides: draft.parameters,
			}
		}

		return {
			template: draft,
		}
	}, [buildTemplateDraft, selectedTemplateId])

	const saveTemplateMutation = useMutation({
		mutationFn: async () => {
			const template = buildTemplateDraft()

			if (
				selectedTemplateId &&
				selectedTemplateId !== 'inline' &&
				!isBuiltinTemplate(selectedTemplateId)
			) {
				return unwrapResponse(
					await window.desktopApi.updateWorkflowTemplate({
						id: selectedTemplateId,
						template,
					}),
				)
			}

			return unwrapResponse(
				await window.desktopApi.createWorkflowTemplate({
					template,
				}),
			)
		},
		onSuccess: async (template) => {
			toast.success('Workflow template saved.')
			setSelectedTemplateId(template.id)
			await queryClient.invalidateQueries({ queryKey: ['workflow-templates'] })
		},
		onError: (error) => {
			toast.error(
				error instanceof Error ? error.message : 'Template save failed.',
			)
		},
	})

	const deleteTemplateMutation = useMutation({
		mutationFn: async () => {
			if (!selectedTemplateId || selectedTemplateId === 'inline') {
				throw new Error('Select a saved custom template first.')
			}

			return unwrapResponse(
				await window.desktopApi.deleteWorkflowTemplate({
					id: selectedTemplateId,
				}),
			)
		},
		onSuccess: async () => {
			toast.success('Workflow template deleted.')
			setSelectedTemplateId('inline')
			hydrateTemplateEditor(createEmptyTemplate())
			await queryClient.invalidateQueries({ queryKey: ['workflow-templates'] })
		},
		onError: (error) => {
			toast.error(
				error instanceof Error ? error.message : 'Template delete failed.',
			)
		},
	})

	const previewMutation = useMutation({
		mutationFn: async (args?: { cursor?: string }) => {
			if (!connectionId) {
				throw new Error('Select a connection first.')
			}

			return unwrapResponse(
				await window.desktopApi.previewWorkflow({
					connectionId,
					namespaceId: selectedNamespaceId ?? undefined,
					...buildTemplateSource(),
					cursor: args?.cursor,
					limit: PREVIEW_PAGE_SIZE,
				}),
			)
		},
		onSuccess: (result) => {
			setPreview(result)
			toast.success('Dry-run preview ready.')
		},
		onError: (error) => {
			toast.error(error instanceof Error ? error.message : 'Preview failed.')
		},
	})

	const executeMutation = useMutation({
		mutationFn: async (dryRun: boolean) => {
			if (!connectionId) {
				throw new Error('Select a connection first.')
			}

			return unwrapResponse(
				await window.desktopApi.executeWorkflow({
					connectionId,
					namespaceId: selectedNamespaceId ?? undefined,
					...buildTemplateSource(),
					dryRun,
					guardrailConfirmed: prodGuardrailConfirmed,
					retryPolicy: {
						maxAttempts: Math.max(1, Number(retryMaxAttempts) || 1),
						backoffMs: Math.max(0, Number(retryBackoffMs) || 0),
						backoffStrategy: retryStrategy,
						abortOnErrorRate: Math.min(
							1,
							Math.max(0, Number(retryAbortOnErrorRate) || 1),
						),
					},
				}),
			)
		},
		onSuccess: async (result) => {
			toast.success(`Workflow ${result.status}.`)
			if (connectionId) {
				await queryClient.invalidateQueries({
					queryKey: ['workflow-executions', connectionId, selectedNamespaceId],
				})
				await queryClient.invalidateQueries({
					queryKey: [
						'observability-dashboard',
						connectionId,
						selectedNamespaceId,
					],
				})
			}
			await queryClient.invalidateQueries({ queryKey: ['alerts'] })
		},
		onError: (error) => {
			toast.error(
				error instanceof Error ? error.message : 'Workflow execution failed.',
			)
		},
	})

	const rerunMutation = useMutation({
		mutationFn: async (args: { executionId: string; withEdits: boolean }) => {
			return unwrapResponse(
				await window.desktopApi.rerunWorkflow({
					executionId: args.executionId,
					parameterOverrides: args.withEdits ? parseParameters() : undefined,
					guardrailConfirmed: prodGuardrailConfirmed,
				}),
			)
		},
		onSuccess: async (result) => {
			toast.success(`Workflow rerun ${result.status}.`)
			if (connectionId) {
				await queryClient.invalidateQueries({
					queryKey: ['workflow-executions', connectionId],
				})
			}
			await queryClient.invalidateQueries({ queryKey: ['alerts'] })
		},
		onError: (error) => {
			toast.error(
				error instanceof Error ? error.message : 'Workflow rerun failed.',
			)
		},
	})

	const resumeMutation = useMutation({
		mutationFn: async (executionId: string) =>
			unwrapResponse(
				await window.desktopApi.resumeWorkflow({
					executionId,
					guardrailConfirmed: prodGuardrailConfirmed,
				}),
			),
		onSuccess: async (result) => {
			toast.success(`Workflow resume ${result.status}.`)
			if (connectionId) {
				await queryClient.invalidateQueries({
					queryKey: ['workflow-executions', connectionId],
				})
				await queryClient.invalidateQueries({
					queryKey: ['observability-dashboard', connectionId],
				})
			}
			await queryClient.invalidateQueries({ queryKey: ['alerts'] })
		},
		onError: (error) => {
			toast.error(
				error instanceof Error ? error.message : 'Workflow resume failed.',
			)
		},
	})

	const isBusy =
		saveTemplateMutation.isPending ||
		deleteTemplateMutation.isPending ||
		previewMutation.isPending ||
		executeMutation.isPending ||
		rerunMutation.isPending ||
		resumeMutation.isPending
	const executions = executionsQuery.data ?? []
	const statusData = ['success', 'running', 'pending', 'error', 'aborted'].map(
		(status) => ({
			status,
			value: executions.filter((execution) => execution.status === status).length,
			fill:
				status === 'success'
					? 'var(--chart-2)'
					: status === 'error' || status === 'aborted'
						? 'var(--destructive)'
						: status === 'running'
							? 'var(--chart-1)'
							: 'var(--chart-5)',
		}),
	).filter((item) => item.value > 0)
	const executionTrendData = executions
		.slice()
		.reverse()
		.slice(0, 8)
		.map((execution) => ({
			label: new Date(execution.startedAt).toLocaleTimeString([], {
				hour: '2-digit',
				minute: '2-digit',
			}),
			retries: execution.retryCount,
			steps: execution.stepResults.length,
		}))
	const successCount = executions.filter(
		(execution) => execution.status === 'success',
	).length
	const resumableCount = executions.filter(
		(execution) => Boolean(execution.checkpointToken) && execution.status !== 'success',
	).length
	const chartConfig = {
		value: { label: 'Executions', color: 'var(--chart-1)' },
		retries: { label: 'Retries', color: 'var(--chart-4)' },
		steps: { label: 'Steps', color: 'var(--chart-2)' },
	} satisfies ChartConfig

	if (isConnectionMode && !connection) {
		return (
			<Card>
				<CardContent className="p-4 text-xs text-muted-foreground">
					Select a connection to run workflows.
				</CardContent>
			</Card>
		)
	}

	return (
		<div className="grid min-h-0 gap-3">
			{isConnectionMode && (
				<>
					<DashboardStats
						items={[
							{
								label: 'Recent Executions',
								value: executions.length,
								description: 'Workflow history rows in the active connection scope',
							},
							{
								label: 'Success Rate',
								value:
									executions.length === 0
										? '0%'
										: `${Math.round((successCount / executions.length) * 100)}%`,
								description: `${successCount} successful runs`,
								tone: successCount === executions.length ? 'positive' : 'default',
							},
							{
								label: 'Dry Runs',
								value: executions.filter((execution) => execution.dryRun).length,
								description: 'Non-destructive executions in recent history',
							},
							{
								label: 'Resumable',
								value: resumableCount,
								description: 'Executions with checkpoints available',
								tone: resumableCount > 0 ? 'warning' : 'default',
							},
						]}
					/>
					<div className="grid gap-3 xl:grid-cols-2">
						<DashboardChartCard
							title="Execution Status Mix"
							description="Recent execution outcomes for the selected connection."
							loading={executionsQuery.isLoading}
							error={
								executionsQuery.isError
									? executionsQuery.error instanceof Error
										? executionsQuery.error.message
										: 'Failed to load executions.'
									: undefined
							}
							empty={statusData.length === 0 ? 'No executions to visualize yet.' : undefined}
						>
							<ChartContainer config={chartConfig} className="mx-auto min-h-[16rem] w-full max-w-[20rem]">
								<PieChart accessibilityLayer>
									<ChartTooltip content={<ChartTooltipContent nameKey="status" />} />
									<Pie data={statusData} dataKey="value" nameKey="status" innerRadius={48} outerRadius={78}>
										{statusData.map((entry) => (
											<Cell key={entry.status} fill={entry.fill} />
										))}
									</Pie>
									<ChartLegend content={<ChartLegendContent nameKey="status" />} />
								</PieChart>
							</ChartContainer>
						</DashboardChartCard>

						<DashboardChartCard
							title="Retry Pressure"
							description="Retries and step counts across the latest executions."
							loading={executionsQuery.isLoading}
							error={
								executionsQuery.isError
									? executionsQuery.error instanceof Error
										? executionsQuery.error.message
										: 'Failed to load executions.'
									: undefined
							}
							empty={
								executionTrendData.length === 0
									? 'No execution trend data yet.'
									: undefined
							}
						>
							<ChartContainer config={chartConfig} className="min-h-[16rem] w-full">
								<BarChart accessibilityLayer data={executionTrendData}>
									<CartesianGrid vertical={false} />
									<XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
									<YAxis tickLine={false} axisLine={false} width={36} />
									<ChartTooltip content={<ChartTooltipContent />} />
									<ChartLegend content={<ChartLegendContent />} />
									<Bar dataKey="steps" fill="var(--color-steps)" radius={0} />
									<Bar dataKey="retries" fill="var(--color-retries)" radius={0} />
								</BarChart>
							</ChartContainer>
						</DashboardChartCard>
					</div>
				</>
			)}
			<div className="grid min-h-0 gap-3 xl:grid-cols-[1fr_1fr]">
			<Card>
				<CardHeader>
					<CardTitle>
						{isTemplatesMode ? 'Workflow Templates' : 'Workflow Runner'}
					</CardTitle>
					<CardDescription>
						{isTemplatesMode
							? 'Create, update, and retire reusable workflow templates.'
							: 'Run workflow templates against the selected connection with dry-run and retry controls.'}
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-3">
					<div className="space-y-1.5">
						<Label htmlFor="workflow-template-select">Template</Label>
						<Select
							value={selectedTemplateId}
							onValueChange={(nextId) => {
								setSelectedTemplateId(nextId)
								setPreview(null)

								if (nextId === 'inline') {
									hydrateTemplateEditor(createEmptyTemplate())
									return
								}

								const template = templatesQuery.data?.find(
									(candidate) => candidate.id === nextId,
								)

								if (template) {
									hydrateTemplateEditor(template)
								}
							}}
						>
							<SelectTrigger id="workflow-template-select" className="w-full">
								<WorkflowIcon className='size-3.5' />
								<SelectValue>
									{selectedTemplateId === 'inline'
										? 'Inline template'
										: (templatesQuery.data ?? []).find(
												(template) => template.id === selectedTemplateId,
											)?.name ??
											'Select template'}
								</SelectValue>
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="inline">Inline template</SelectItem>
								{(templatesQuery.data ?? []).map((template) => (
									<SelectItem key={template.id} value={template.id}>
										{template.name}
										{isBuiltinTemplate(template.id) ? ' (built-in)' : ''}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					<div className="grid gap-3 md:grid-cols-2">
						<div className="space-y-1.5">
							<Label htmlFor="workflow-template-name">Template Name</Label>
							<InputGroup>
								<InputGroupAddon>
									<FileCode2Icon className='size-3.5' />
								</InputGroupAddon>
								<InputGroupInput
									id="workflow-template-name"
									value={templateName}
									onChange={(event) => setTemplateName(event.target.value)}
								/>
							</InputGroup>
						</div>

						<div className="space-y-1.5">
							<Label htmlFor="workflow-template-kind">Template Kind</Label>
							<Select
								value={templateKind}
								onValueChange={(value) =>
									setTemplateKind(value as WorkflowTemplateDraft['kind'])
								}
							>
								<SelectTrigger id="workflow-template-kind" className="w-full">
									<BoxesIcon className='size-3.5' />
									<SelectValue>{workflowKindLabels[templateKind]}</SelectValue>
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="deleteByPattern">
										Delete by pattern
									</SelectItem>
									<SelectItem value="ttlNormalize">TTL normalize</SelectItem>
									<SelectItem value="warmupSet">Warmup set</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</div>

					<div className="space-y-1.5">
						<Label htmlFor="workflow-template-parameters">
							Parameters (JSON)
						</Label>
						<Textarea
							id="workflow-template-parameters"
							className="min-h-32 font-mono"
							value={templateParametersText}
							onChange={(event) =>
								setTemplateParametersText(event.target.value)
							}
						/>
					</div>

					{isConnectionMode && (
						<div className="grid gap-3 md:grid-cols-2">
							<div className="space-y-1.5">
								<Label htmlFor="workflow-retry-max">Retry max attempts</Label>
								<InputGroup>
									<InputGroupAddon>
										<HashIcon className='size-3.5' />
									</InputGroupAddon>
									<InputGroupInput
										id="workflow-retry-max"
										value={retryMaxAttempts}
										onChange={(event) => setRetryMaxAttempts(event.target.value)}
									/>
								</InputGroup>
							</div>

							<div className="space-y-1.5">
								<Label htmlFor="workflow-retry-backoff">
									Retry backoff (ms)
								</Label>
								<InputGroup>
									<InputGroupAddon>
										<TimerResetIcon className='size-3.5' />
									</InputGroupAddon>
									<InputGroupInput
										id="workflow-retry-backoff"
										value={retryBackoffMs}
										onChange={(event) => setRetryBackoffMs(event.target.value)}
									/>
								</InputGroup>
							</div>

							<div className="space-y-1.5">
								<Label htmlFor="workflow-retry-strategy">
									Backoff strategy
								</Label>
								<Select
									value={retryStrategy}
									onValueChange={(value) =>
										setRetryStrategy(value as 'fixed' | 'exponential')
									}
								>
									<SelectTrigger id="workflow-retry-strategy" className="w-full">
										<TimerResetIcon className='size-3.5' />
										<SelectValue>
											{workflowRetryStrategyLabels[retryStrategy]}
										</SelectValue>
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="fixed">Fixed</SelectItem>
										<SelectItem value="exponential">Exponential</SelectItem>
									</SelectContent>
								</Select>
							</div>

							<div className="space-y-1.5">
								<Label htmlFor="workflow-retry-abort">
									Abort on error rate (0-1)
								</Label>
								<InputGroup>
									<InputGroupAddon>
										<GaugeIcon className='size-3.5' />
									</InputGroupAddon>
									<InputGroupInput
										id="workflow-retry-abort"
										value={retryAbortOnErrorRate}
										onChange={(event) =>
											setRetryAbortOnErrorRate(event.target.value)
										}
									/>
								</InputGroup>
							</div>
						</div>
					)}

					<div className="space-y-2 rounded-none border p-2 text-xs">
						<label className="flex items-center gap-2">
							<Checkbox
								checked={requiresApprovalOnProd}
								onCheckedChange={(checked) =>
									setRequiresApprovalOnProd(Boolean(checked))
								}
							/>
							Require explicit approval on prod
						</label>
						<label className="flex items-center gap-2">
							<Checkbox
								checked={supportsDryRun}
								onCheckedChange={(checked) =>
									setSupportsDryRun(Boolean(checked))
								}
							/>
							Supports dry-run preview
						</label>
						{isConnectionMode && connection?.environment === 'prod' && (
							<label className="flex items-center gap-2 text-destructive">
								<Checkbox
									checked={prodGuardrailConfirmed}
									onCheckedChange={(checked) =>
										setProdGuardrailConfirmed(Boolean(checked))
									}
								/>
								Confirm guardrail override for prod execution
							</label>
						)}
					</div>

					<div className="flex flex-wrap gap-2">
						{isTemplatesMode ? (
							<>
								<Button
									variant="outline"
									onClick={() => saveTemplateMutation.mutate()}
									disabled={isBusy}
								>
									Save Template
								</Button>
								<Button
									variant="outline"
									onClick={() => {
										setSelectedTemplateId('inline')
										hydrateTemplateEditor(createEmptyTemplate())
									}}
									disabled={isBusy}
								>
									New Template
								</Button>
								<Button
									variant="outline"
									onClick={() => deleteTemplateMutation.mutate()}
									disabled={
										isBusy ||
										!selectedTemplateId ||
										selectedTemplateId === 'inline' ||
										isBuiltinTemplate(selectedTemplateId)
									}
								>
									Delete Template
								</Button>
							</>
						) : (
							<>
								<Button
									variant="outline"
									onClick={() => previewMutation.mutate({ cursor: undefined })}
									disabled={isBusy}
								>
									Preview
								</Button>
								<Button
									variant="outline"
									onClick={() => executeMutation.mutate(true)}
									disabled={isBusy}
								>
									Dry Run
								</Button>
								<Button
									onClick={() => executeMutation.mutate(false)}
									disabled={isBusy}
								>
									Execute
								</Button>
							</>
						)}
					</div>
				</CardContent>
			</Card>

			{isConnectionMode ? (
				<div className="grid min-h-0 gap-3">
					<Card>
						<CardHeader>
							<CardTitle>Dry-Run Preview</CardTitle>
							<CardDescription>
								Review affected keys before executing the workflow.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-3">
							{!preview ? (
								<p className="text-muted-foreground text-xs">
									Run preview to inspect estimated changes.
								</p>
							) : (
								<>
									<div className="flex items-center gap-2 text-xs">
										<Badge variant="outline">{preview.kind}</Badge>
										<Badge variant="outline">
											estimate: {preview.estimatedCount}
										</Badge>
										<Badge variant="outline">
											page: {preview.items.length}
										</Badge>
										{preview.truncated && (
											<Badge variant="destructive">truncated</Badge>
										)}
										{preview.nextCursor && (
											<Badge variant="outline">
												cursor: {preview.nextCursor}
											</Badge>
										)}
									</div>

									<div className="max-h-56 overflow-auto border">
										<Table>
											<TableHeader>
												<TableRow>
													<TableHead>Action</TableHead>
													<TableHead>Key</TableHead>
													<TableHead>Next TTL</TableHead>
												</TableRow>
											</TableHeader>
											<TableBody>
												{preview.items.slice(0, 50).map((item) => (
													<TableRow key={`${item.action}-${item.key}`}>
														<TableCell>{item.action}</TableCell>
														<TableCell className="max-w-52 truncate">
															{item.key}
														</TableCell>
														<TableCell>
															{item.nextTtlSeconds === undefined
																? '-'
																: item.nextTtlSeconds}
														</TableCell>
													</TableRow>
												))}
											</TableBody>
										</Table>
									</div>
									{preview.nextCursor && (
										<Button
											size="sm"
											variant="outline"
											onClick={() =>
												previewMutation.mutate({
													cursor: preview.nextCursor,
												})
											}
											disabled={previewMutation.isPending}
										>
											Load Next Preview Page
										</Button>
									)}
								</>
							)}
						</CardContent>
					</Card>

					<Card className="min-h-0">
						<CardHeader>
							<CardTitle>Execution History</CardTitle>
							<CardDescription>
								Rerun previous executions directly or rerun with current
								parameter edits.
							</CardDescription>
						</CardHeader>
						<CardContent className="max-h-72 overflow-auto">
							{executionsQuery.isLoading ? (
								<p className="text-muted-foreground text-xs">
									Loading executions...
								</p>
							) : (executionsQuery.data?.length ?? 0) === 0 ? (
								<p className="text-muted-foreground text-xs">
									No workflow executions yet.
								</p>
							) : (
								<div className="space-y-2">
									{executionsQuery.data?.map((execution) => (
										<div
											key={execution.id}
											className="space-y-2 border p-2 text-xs"
										>
											<div className="flex items-center justify-between gap-2">
												<div className="min-w-0">
													<p className="truncate font-medium">
														{execution.workflowName}
													</p>
													<p className="text-muted-foreground truncate">
														{new Date(execution.startedAt).toLocaleString()}
													</p>
												</div>
												<Badge
													variant={getStatusBadgeVariant(execution.status)}
												>
													{execution.status}
												</Badge>
											</div>
											<div className="text-muted-foreground flex items-center gap-2">
												<span>steps: {execution.stepResults.length}</span>
												<span>retries: {execution.retryCount}</span>
												{execution.dryRun && <span>dry-run</span>}
												{execution.policyPackId && (
													<span>policy: {execution.policyPackId}</span>
												)}
												{execution.scheduleWindowId && (
													<span>window: {execution.scheduleWindowId}</span>
												)}
												{execution.checkpointToken && (
													<span>checkpoint: {execution.checkpointToken}</span>
												)}
											</div>
											{execution.errorMessage && (
												<p className="text-muted-foreground">
													{execution.errorMessage}
												</p>
											)}
											<div className="flex flex-wrap gap-2">
												<Button
													size="sm"
													variant="outline"
													onClick={() =>
														rerunMutation.mutate({
															executionId: execution.id,
															withEdits: false,
														})
													}
													disabled={isBusy}
												>
													Rerun
												</Button>
												<Button
													size="sm"
													variant="outline"
													onClick={() =>
														rerunMutation.mutate({
															executionId: execution.id,
															withEdits: true,
														})
													}
													disabled={isBusy}
												>
													Rerun With Edits
												</Button>
												{execution.checkpointToken &&
													execution.status !== 'success' && (
														<Button
															size="sm"
															variant="outline"
															onClick={() =>
																resumeMutation.mutate(execution.id)
															}
															disabled={isBusy}
														>
															Resume From Checkpoint
														</Button>
													)}
											</div>
										</div>
									))}
								</div>
							)}
						</CardContent>
					</Card>
				</div>
			) : (
				<Card className="min-h-0">
					<CardHeader>
						<CardTitle>Saved Templates</CardTitle>
						<CardDescription>
							Inspect current templates and choose one to edit.
						</CardDescription>
					</CardHeader>
					<CardContent className="max-h-[32rem] space-y-2 overflow-auto">
						{templatesQuery.isLoading ? (
							<p className="text-muted-foreground text-xs">
								Loading templates...
							</p>
						) : (templatesQuery.data?.length ?? 0) === 0 ? (
							<p className="text-muted-foreground text-xs">
								No workflow templates have been saved yet.
							</p>
						) : (
							(templatesQuery.data ?? []).map((template) => (
								<button
									key={template.id}
									type="button"
									className="w-full space-y-1 border p-2 text-left text-xs hover:bg-muted/40"
									onClick={() => {
										setSelectedTemplateId(template.id)
										hydrateTemplateEditor(template)
									}}
								>
									<div className="flex items-center justify-between gap-2">
										<p className="truncate font-medium">{template.name}</p>
										<Badge variant="outline">{template.kind}</Badge>
									</div>
									<p className="text-muted-foreground truncate">
										id: {template.id}
										{isBuiltinTemplate(template.id) ? ' (built-in)' : ''}
									</p>
								</button>
							))
						)}
					</CardContent>
				</Card>
			)}
			</div>
		</div>
	)
}
