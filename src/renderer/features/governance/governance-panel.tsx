import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
	BoxIcon,
	Clock3Icon,
	FolderCogIcon,
	FileTextIcon,
	FolderArchiveIcon,
	HashIcon,
} from 'lucide-react'
import * as React from 'react'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
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
import { LoadingSkeletonLines } from '@/renderer/components/ui/loading-skeleton'
import { Input } from '@/renderer/components/ui/input'
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
import type {
	ConnectionProfile,
	GovernancePolicyPack,
	RetentionPolicy,
	RetentionPurgeResult,
} from '@/shared/contracts/cache'

type GovernancePanelProps = {
	connection?: ConnectionProfile | null
	mode?: 'connection' | 'admin'
}

type PolicyPackFormState = {
	name: string
	description: string
	environmentDev: boolean
	environmentStaging: boolean
	environmentProd: boolean
	maxWorkflowItems: string
	maxRetryAttempts: string
	schedulingEnabled: boolean
	executionWindowsText: string
	enabled: boolean
}

type RetentionDraftState = Record<
	RetentionPolicy['dataset'],
	{
		retentionDays: string
		storageBudgetMb: string
		autoPurgeOldest: boolean
	}
>

const retentionDatasetLabels = {
	timelineEvents: 'Timeline Events',
	observabilitySnapshots: 'Observability Snapshots',
	workflowHistory: 'Workflow History',
	incidentArtifacts: 'Incident Artifacts',
} as const

const defaultPolicyPackFormState: PolicyPackFormState = {
	name: '',
	description: '',
	environmentDev: true,
	environmentStaging: true,
	environmentProd: false,
	maxWorkflowItems: '500',
	maxRetryAttempts: '2',
	schedulingEnabled: false,
	executionWindowsText: JSON.stringify(
		[
			{
				id: 'window-default',
				weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'],
				startTime: '09:00',
				endTime: '17:00',
				timezone: 'UTC',
			},
		],
		null,
		2,
	),
	enabled: true,
}

const parsePolicyPackFormState = (form: PolicyPackFormState) => {
	const environments: Array<'dev' | 'staging' | 'prod'> = []
	if (form.environmentDev) {
		environments.push('dev')
	}
	if (form.environmentStaging) {
		environments.push('staging')
	}
	if (form.environmentProd) {
		environments.push('prod')
	}

	if (environments.length === 0) {
		throw new Error('Select at least one environment for the policy pack.')
	}

	let executionWindows: GovernancePolicyPack['executionWindows'] = []
	if (form.schedulingEnabled) {
		try {
			const parsed = JSON.parse(form.executionWindowsText) as unknown
			if (!Array.isArray(parsed)) {
				throw new Error('Execution windows must be a JSON array.')
			}
			executionWindows = parsed as GovernancePolicyPack['executionWindows']
		} catch (error) {
			throw new Error(
				error instanceof Error
					? error.message
					: 'Execution windows JSON is invalid.',
			)
		}
	}

	return {
		name: form.name.trim() || 'Untitled Policy Pack',
		description: form.description.trim() || undefined,
		environments,
		maxWorkflowItems: Math.max(1, Number(form.maxWorkflowItems) || 1),
		maxRetryAttempts: Math.max(1, Number(form.maxRetryAttempts) || 1),
		schedulingEnabled: form.schedulingEnabled,
		executionWindows,
		enabled: form.enabled,
	}
}

const toPolicyPackFormState = (
	policyPack: GovernancePolicyPack,
): PolicyPackFormState => ({
	name: policyPack.name,
	description: policyPack.description ?? '',
	environmentDev: policyPack.environments.includes('dev'),
	environmentStaging: policyPack.environments.includes('staging'),
	environmentProd: policyPack.environments.includes('prod'),
	maxWorkflowItems: String(policyPack.maxWorkflowItems),
	maxRetryAttempts: String(policyPack.maxRetryAttempts),
	schedulingEnabled: policyPack.schedulingEnabled,
	executionWindowsText: JSON.stringify(policyPack.executionWindows, null, 2),
	enabled: policyPack.enabled,
})

const createRetentionDrafts = (
	policies: RetentionPolicy[],
): RetentionDraftState => {
	const fallback = () => ({
		retentionDays: '30',
		storageBudgetMb: '512',
		autoPurgeOldest: true,
	})

	const map = new Map(policies.map((policy) => [policy.dataset, policy]))

	return {
		timelineEvents: map.get('timelineEvents')
			? {
					retentionDays: String(map.get('timelineEvents')?.retentionDays ?? 30),
					storageBudgetMb: String(map.get('timelineEvents')?.storageBudgetMb ?? 512),
					autoPurgeOldest: Boolean(map.get('timelineEvents')?.autoPurgeOldest),
				}
			: fallback(),
		observabilitySnapshots: map.get('observabilitySnapshots')
			? {
					retentionDays: String(
						map.get('observabilitySnapshots')?.retentionDays ?? 30,
					),
					storageBudgetMb: String(
						map.get('observabilitySnapshots')?.storageBudgetMb ?? 512,
					),
					autoPurgeOldest: Boolean(
						map.get('observabilitySnapshots')?.autoPurgeOldest,
					),
				}
			: fallback(),
		workflowHistory: map.get('workflowHistory')
			? {
					retentionDays: String(map.get('workflowHistory')?.retentionDays ?? 30),
					storageBudgetMb: String(
						map.get('workflowHistory')?.storageBudgetMb ?? 512,
					),
					autoPurgeOldest: Boolean(map.get('workflowHistory')?.autoPurgeOldest),
				}
			: fallback(),
		incidentArtifacts: map.get('incidentArtifacts')
			? {
					retentionDays: String(map.get('incidentArtifacts')?.retentionDays ?? 30),
					storageBudgetMb: String(
						map.get('incidentArtifacts')?.storageBudgetMb ?? 512,
					),
					autoPurgeOldest: Boolean(map.get('incidentArtifacts')?.autoPurgeOldest),
				}
			: fallback(),
	}
}

export const GovernancePanel = ({
	connection = null,
	mode = 'connection',
}: GovernancePanelProps) => {
	const queryClient = useQueryClient()
	const isConnectionMode = mode === 'connection'
	const isAdminMode = mode === 'admin'
	const connectionId = connection?.id ?? null

	const [editingPolicyPackId, setEditingPolicyPackId] = React.useState<
		string | null
	>(null)
	const [policyPackForm, setPolicyPackForm] =
		React.useState<PolicyPackFormState>(defaultPolicyPackFormState)
	const [selectedAssignedPolicyPackId, setSelectedAssignedPolicyPackId] =
		React.useState<string>('none')
	const [retentionDrafts, setRetentionDrafts] =
		React.useState<RetentionDraftState>({
			timelineEvents: {
				retentionDays: '30',
				storageBudgetMb: '512',
				autoPurgeOldest: true,
			},
			observabilitySnapshots: {
				retentionDays: '30',
				storageBudgetMb: '512',
				autoPurgeOldest: true,
			},
			workflowHistory: {
				retentionDays: '30',
				storageBudgetMb: '512',
				autoPurgeOldest: true,
			},
			incidentArtifacts: {
				retentionDays: '30',
				storageBudgetMb: '512',
				autoPurgeOldest: true,
			},
		})
	const [purgeDataset, setPurgeDataset] =
		React.useState<RetentionPolicy['dataset']>('timelineEvents')
	const [purgeOlderThan, setPurgeOlderThan] = React.useState('')
	const [purgePreviewResult, setPurgePreviewResult] =
		React.useState<RetentionPurgeResult | null>(null)
	const [purgePreviewSignature, setPurgePreviewSignature] = React.useState<
		string | null
	>(null)
	const [purgeConfirmationText, setPurgeConfirmationText] = React.useState('')
	const [lastPurgeResult, setLastPurgeResult] =
		React.useState<RetentionPurgeResult | null>(null)

	const purgeRequestSignature = React.useMemo(
		() => `${purgeDataset}::${purgeOlderThan.trim()}`,
		[purgeDataset, purgeOlderThan],
	)
	const requiredPurgeConfirmation = React.useMemo(
		() => `PURGE ${purgeDataset}`,
		[purgeDataset],
	)

	const resolvePurgeOlderThanIso = React.useCallback((): string | undefined => {
		if (purgeOlderThan.trim().length === 0) {
			return undefined
		}

		const parsed = new Date(purgeOlderThan)
		if (Number.isNaN(parsed.getTime())) {
			throw new Error('Please provide a valid purge cutoff date/time.')
		}

		return parsed.toISOString()
	}, [purgeOlderThan])

	React.useEffect(() => {
		setPurgePreviewResult(null)
		setPurgePreviewSignature(null)
		setPurgeConfirmationText('')
	}, [purgeRequestSignature])

	const policyPacksQuery = useQuery({
		queryKey: ['policy-packs'],
		queryFn: async () => unwrapResponse(await window.desktopApi.listPolicyPacks()),
	})

	const assignmentsQuery = useQuery({
		queryKey: ['policy-pack-assignments', connectionId],
		enabled: isConnectionMode && Boolean(connectionId),
		queryFn: async () =>
			unwrapResponse(
				await window.desktopApi.listPolicyPackAssignments({
					connectionId: connectionId ?? '',
				}),
			),
	})

	const retentionPoliciesQuery = useQuery({
		queryKey: ['retention-policies'],
		enabled: isAdminMode,
		queryFn: async () =>
			unwrapResponse(await window.desktopApi.listRetentionPolicies()),
	})

	const storageSummaryQuery = useQuery({
		queryKey: ['storage-summary'],
		enabled: isAdminMode,
		queryFn: async () => unwrapResponse(await window.desktopApi.getStorageSummary()),
	})
	useStartupGateReady(
		'governance-admin-page',
		isAdminMode &&
			!policyPacksQuery.isLoading &&
			(!isConnectionMode || !connectionId || !assignmentsQuery.isLoading) &&
			(!isAdminMode || !retentionPoliciesQuery.isLoading) &&
			(!isAdminMode || !storageSummaryQuery.isLoading),
	)

	React.useEffect(() => {
		if (!isConnectionMode) {
			return
		}

		const assignment = assignmentsQuery.data?.[0]
		setSelectedAssignedPolicyPackId(assignment?.policyPackId ?? 'none')
	}, [assignmentsQuery.data, isConnectionMode])

	React.useEffect(() => {
		if (!isAdminMode) {
			return
		}

		if (!retentionPoliciesQuery.data?.policies) {
			return
		}

			setRetentionDrafts(
				createRetentionDrafts(retentionPoliciesQuery.data.policies),
			)
	}, [retentionPoliciesQuery.data, isAdminMode])

	const savePolicyPackMutation = useMutation({
		mutationFn: async () => {
			const policyPack = parsePolicyPackFormState(policyPackForm)

			if (editingPolicyPackId) {
				return unwrapResponse(
					await window.desktopApi.updatePolicyPack({
						id: editingPolicyPackId,
						policyPack,
					}),
				)
			}

			return unwrapResponse(
				await window.desktopApi.createPolicyPack({
					policyPack,
				}),
			)
		},
		onSuccess: async (policyPack) => {
			setEditingPolicyPackId(policyPack.id)
			setPolicyPackForm(toPolicyPackFormState(policyPack))
			toast.success('Governance policy pack saved.')
			await queryClient.invalidateQueries({ queryKey: ['policy-packs'] })
		},
		onError: (error) => {
			toast.error(
				error instanceof Error ? error.message : 'Unable to save policy pack.',
			)
		},
	})

	const deletePolicyPackMutation = useMutation({
		mutationFn: async (id: string) =>
			unwrapResponse(await window.desktopApi.deletePolicyPack({ id })),
			onSuccess: async () => {
				setEditingPolicyPackId(null)
				setPolicyPackForm(defaultPolicyPackFormState)
				toast.success('Governance policy pack deleted.')
				await queryClient.invalidateQueries({ queryKey: ['policy-packs'] })
				if (connectionId) {
					await queryClient.invalidateQueries({
						queryKey: ['policy-pack-assignments', connectionId],
					})
				}
			},
		onError: (error) => {
			toast.error(
				error instanceof Error ? error.message : 'Unable to delete policy pack.',
			)
		},
	})

	const assignPolicyPackMutation = useMutation({
		mutationFn: async () => {
			if (!connectionId) {
				throw new Error('Select a connection first.')
			}

			return unwrapResponse(
				await window.desktopApi.assignPolicyPack({
					connectionId,
					policyPackId:
						selectedAssignedPolicyPackId === 'none'
							? undefined
							: selectedAssignedPolicyPackId,
				}),
			)
		},
		onSuccess: async () => {
			toast.success('Governance assignment updated.')
			if (connectionId) {
				await queryClient.invalidateQueries({
					queryKey: ['policy-pack-assignments', connectionId],
				})
			}
		},
		onError: (error) => {
			toast.error(
				error instanceof Error ? error.message : 'Unable to assign policy pack.',
			)
		},
	})

	const updateRetentionPolicyMutation = useMutation({
		mutationFn: async (dataset: RetentionPolicy['dataset']) =>
			unwrapResponse(
				await window.desktopApi.updateRetentionPolicy({
					policy: {
						dataset,
						retentionDays: Math.max(
							1,
							Number(retentionDrafts[dataset].retentionDays) || 1,
						),
						storageBudgetMb: Math.max(
							1,
							Number(retentionDrafts[dataset].storageBudgetMb) || 1,
						),
						autoPurgeOldest: retentionDrafts[dataset].autoPurgeOldest,
					},
				}),
			),
		onSuccess: async () => {
			toast.success('Retention policy saved.')
			await queryClient.invalidateQueries({ queryKey: ['retention-policies'] })
			await queryClient.invalidateQueries({ queryKey: ['storage-summary'] })
		},
		onError: (error) => {
			toast.error(
				error instanceof Error ? error.message : 'Unable to save retention policy.',
			)
		},
	})

	const purgePreviewMutation = useMutation({
		mutationFn: async () =>
			unwrapResponse(
				await window.desktopApi.purgeRetentionData({
					dataset: purgeDataset,
					olderThan: resolvePurgeOlderThanIso(),
					dryRun: true,
				}),
			),
		onSuccess: async (result) => {
			setPurgePreviewResult(result)
			setPurgePreviewSignature(purgeRequestSignature)
			toast.success('Purge impact preview generated.')
			await queryClient.invalidateQueries({ queryKey: ['storage-summary'] })
		},
		onError: (error) => {
			toast.error(
				error instanceof Error ? error.message : 'Unable to preview purge impact.',
			)
		},
	})

	const purgeExecuteMutation = useMutation({
		mutationFn: async () => {
			if (!purgePreviewResult || purgePreviewSignature !== purgeRequestSignature) {
				throw new Error(
					'Preview purge impact first for the current dataset/cutoff before executing.',
				)
			}

			if (purgeConfirmationText.trim() !== requiredPurgeConfirmation) {
				throw new Error(
					`Type "${requiredPurgeConfirmation}" to confirm this purge operation.`,
				)
			}

			return unwrapResponse(
				await window.desktopApi.purgeRetentionData({
					dataset: purgeDataset,
					olderThan: resolvePurgeOlderThanIso(),
					dryRun: false,
				}),
			)
		},
		onSuccess: async (result) => {
			setLastPurgeResult(result)
			setPurgePreviewResult(null)
			setPurgePreviewSignature(null)
			setPurgeConfirmationText('')
			toast.success('Retention purge completed.')
			await queryClient.invalidateQueries({ queryKey: ['storage-summary'] })
		},
		onError: (error) => {
			toast.error(
				error instanceof Error ? error.message : 'Unable to purge retention data.',
			)
		},
		})
	const policyPacks = policyPacksQuery.data ?? []
	const storageDatasets = storageSummaryQuery.data?.datasets ?? []
	const storageChartData = storageDatasets.map((dataset) => ({
		dataset: dataset.dataset,
		usageMb: Number((dataset.totalBytes / (1024 * 1024)).toFixed(1)),
		budgetMb: Number((dataset.budgetBytes / (1024 * 1024)).toFixed(1)),
	}))
	const environmentCoverageData = ['dev', 'staging', 'prod'].map((environment) => ({
		environment,
		packs: policyPacks.filter((pack) => pack.environments.includes(environment as 'dev' | 'staging' | 'prod')).length,
		enabled: policyPacks.filter(
			(pack) =>
				pack.enabled &&
				pack.environments.includes(environment as 'dev' | 'staging' | 'prod'),
		).length,
	}))
	const overBudgetCount = storageDatasets.filter((dataset) => dataset.overBudget).length
	const chartConfig = {
		usageMb: { label: 'Usage MB', color: 'var(--chart-4)' },
		budgetMb: { label: 'Budget MB', color: 'var(--chart-2)' },
		packs: { label: 'Policy Packs', color: 'var(--chart-1)' },
		enabled: { label: 'Enabled Packs', color: 'var(--chart-2)' },
	} satisfies ChartConfig

	if (isConnectionMode) {
		if (!connection) {
			return (
				<Card>
					<CardContent className='p-4 text-xs text-muted-foreground'>
						Select a connection to manage governance assignment.
					</CardContent>
				</Card>
			)
		}

		return (
			<Card className='max-w-2xl'>
				<CardHeader>
					<CardTitle>Connection Governance Assignment</CardTitle>
					<CardDescription>
						Choose which policy pack applies to the active connection.
					</CardDescription>
				</CardHeader>
				<CardContent className='space-y-3'>
					<p className='text-xs'>
						<span className='font-medium'>Connection:</span> {connection.name}
					</p>
					<Select
						value={selectedAssignedPolicyPackId}
						onValueChange={setSelectedAssignedPolicyPackId}
					>
						<SelectTrigger className='w-full'>
							<FolderCogIcon className='size-3.5' />
							<SelectValue>
								{selectedAssignedPolicyPackId === 'none'
									? 'No policy pack assigned'
									: (policyPacksQuery.data ?? []).find(
											(policyPack) =>
												policyPack.id === selectedAssignedPolicyPackId,
										)?.name ?? 'Select policy pack'}
							</SelectValue>
						</SelectTrigger>
						<SelectContent>
							<SelectItem value='none'>No policy pack assigned</SelectItem>
							{(policyPacksQuery.data ?? []).map((policyPack) => (
								<SelectItem key={policyPack.id} value={policyPack.id}>
									{policyPack.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>

					<div className='flex flex-wrap gap-2'>
						<Button
							size='sm'
							variant='outline'
							onClick={() => assignPolicyPackMutation.mutate()}
							disabled={assignPolicyPackMutation.isPending}
						>
							Apply Assignment
						</Button>
						<Button
							size='sm'
							variant='outline'
							onClick={() => {
								void assignmentsQuery.refetch()
							}}
							disabled={assignPolicyPackMutation.isPending}
						>
							Refresh
						</Button>
					</div>

					{assignmentsQuery.isLoading ? (
						<div className='space-y-2'>
							<LoadingSkeletonLines count={2} widths={['w-1/2', 'w-1/3']} />
						</div>
					) : (
						<p className='text-muted-foreground text-xs'>
							Current assignment:{' '}
							{assignmentsQuery.data?.[0]?.policyPackId ?? 'none'}
						</p>
					)}
				</CardContent>
			</Card>
		)
	}

	return (
		<div className='grid min-h-0 gap-3'>
			<DashboardStats
				items={[
					{
						label: 'Policy Packs',
						value: policyPacks.length,
						description: 'Saved governance policy definitions',
					},
					{
						label: 'Enabled Packs',
						value: policyPacks.filter((pack) => pack.enabled).length,
						description: 'Actively enforceable policy packs',
					},
					{
						label: 'Storage Used',
						value: `${((storageSummaryQuery.data?.totalBytes ?? 0) / (1024 * 1024)).toFixed(1)} MB`,
						description: `${storageDatasets.length} tracked datasets`,
					},
					{
						label: 'Over Budget',
						value: overBudgetCount,
						description: 'Datasets exceeding configured retention budget',
						tone: overBudgetCount > 0 ? 'danger' : 'positive',
					},
				]}
			/>

			<div className='grid gap-3 xl:grid-cols-2'>
				<DashboardChartCard
					title='Storage Usage vs Budget'
					description='Dataset footprint compared against configured storage budgets.'
					loading={storageSummaryQuery.isLoading}
					error={
						storageSummaryQuery.isError
							? storageSummaryQuery.error instanceof Error
								? storageSummaryQuery.error.message
								: 'Failed to load storage summary.'
							: undefined
					}
					empty={
						storageChartData.length === 0
							? 'No storage summary data available yet.'
							: undefined
					}
				>
					<ChartContainer config={chartConfig} className='min-h-[16rem] w-full'>
						<BarChart accessibilityLayer data={storageChartData}>
							<CartesianGrid vertical={false} />
							<XAxis dataKey='dataset' tickLine={false} axisLine={false} tickMargin={8} />
							<YAxis tickLine={false} axisLine={false} width={44} />
							<ChartTooltip content={<ChartTooltipContent />} />
							<ChartLegend content={<ChartLegendContent />} />
							<Bar dataKey='usageMb' fill='var(--color-usageMb)' radius={0} />
							<Bar dataKey='budgetMb' fill='var(--color-budgetMb)' radius={0} />
						</BarChart>
					</ChartContainer>
				</DashboardChartCard>

				<DashboardChartCard
					title='Environment Coverage'
					description='How many policy packs cover each environment and how many are enabled.'
					loading={policyPacksQuery.isLoading}
					error={
						policyPacksQuery.isError
							? policyPacksQuery.error instanceof Error
								? policyPacksQuery.error.message
								: 'Failed to load policy packs.'
							: undefined
					}
					empty={
						environmentCoverageData.every((item) => item.packs === 0)
							? 'No policy packs configured yet.'
							: undefined
					}
				>
					<ChartContainer config={chartConfig} className='min-h-[16rem] w-full'>
						<BarChart accessibilityLayer data={environmentCoverageData}>
							<CartesianGrid vertical={false} />
							<XAxis dataKey='environment' tickLine={false} axisLine={false} tickMargin={8} />
							<YAxis tickLine={false} axisLine={false} width={36} />
							<ChartTooltip content={<ChartTooltipContent />} />
							<ChartLegend content={<ChartLegendContent />} />
							<Bar dataKey='packs' fill='var(--color-packs)' radius={0} />
							<Bar dataKey='enabled' fill='var(--color-enabled)' radius={0} />
						</BarChart>
					</ChartContainer>
				</DashboardChartCard>
			</div>

		<div className='grid min-h-0 gap-3 xl:grid-cols-2'>
			<Card className='min-h-0'>
				<CardHeader>
					<CardTitle>Governance Policy Packs</CardTitle>
					<CardDescription>
						Define workflow limits, scheduling windows, and environment-level
						automation controls.
					</CardDescription>
				</CardHeader>
				<CardContent className='space-y-3'>
					<div className='space-y-1.5'>
						<Label htmlFor='policy-pack-name'>Policy Pack Name</Label>
						<InputGroup>
							<InputGroupAddon>
								<FolderArchiveIcon className='size-3.5' />
							</InputGroupAddon>
							<InputGroupInput
								id='policy-pack-name'
								value={policyPackForm.name}
								onChange={(event) =>
									setPolicyPackForm((current) => ({
										...current,
										name: event.target.value,
									}))
								}
							/>
						</InputGroup>
					</div>
					<div className='space-y-1.5'>
						<Label htmlFor='policy-pack-description'>Description</Label>
						<InputGroup>
							<InputGroupAddon>
								<FileTextIcon className='size-3.5' />
							</InputGroupAddon>
							<InputGroupInput
								id='policy-pack-description'
								value={policyPackForm.description}
								onChange={(event) =>
									setPolicyPackForm((current) => ({
										...current,
										description: event.target.value,
									}))
								}
							/>
						</InputGroup>
					</div>

					<div className='space-y-2 rounded-none border p-2 text-xs'>
						<p className='font-medium'>Environments</p>
						<label className='flex items-center gap-2'>
							<Checkbox
								checked={policyPackForm.environmentDev}
								onCheckedChange={(checked) =>
									setPolicyPackForm((current) => ({
										...current,
										environmentDev: Boolean(checked),
									}))
								}
							/>
							dev
						</label>
						<label className='flex items-center gap-2'>
							<Checkbox
								checked={policyPackForm.environmentStaging}
								onCheckedChange={(checked) =>
									setPolicyPackForm((current) => ({
										...current,
										environmentStaging: Boolean(checked),
									}))
								}
							/>
							staging
						</label>
						<label className='flex items-center gap-2'>
							<Checkbox
								checked={policyPackForm.environmentProd}
								onCheckedChange={(checked) =>
									setPolicyPackForm((current) => ({
										...current,
										environmentProd: Boolean(checked),
									}))
								}
							/>
							prod
						</label>
					</div>

					<div className='grid gap-3 md:grid-cols-2'>
						<div className='space-y-1.5'>
							<Label htmlFor='policy-pack-max-items'>Max Workflow Items</Label>
							<InputGroup>
								<InputGroupAddon>
									<BoxIcon className='size-3.5' />
								</InputGroupAddon>
								<InputGroupInput
									id='policy-pack-max-items'
									value={policyPackForm.maxWorkflowItems}
									onChange={(event) =>
										setPolicyPackForm((current) => ({
											...current,
											maxWorkflowItems: event.target.value,
										}))
									}
								/>
							</InputGroup>
						</div>
						<div className='space-y-1.5'>
							<Label htmlFor='policy-pack-max-retry'>Max Retry Attempts</Label>
							<InputGroup>
								<InputGroupAddon>
									<HashIcon className='size-3.5' />
								</InputGroupAddon>
								<InputGroupInput
									id='policy-pack-max-retry'
									value={policyPackForm.maxRetryAttempts}
									onChange={(event) =>
										setPolicyPackForm((current) => ({
											...current,
											maxRetryAttempts: event.target.value,
										}))
									}
								/>
							</InputGroup>
						</div>
					</div>

					<div className='space-y-2 rounded-none border p-2 text-xs'>
						<label className='flex items-center gap-2'>
							<Checkbox
								checked={policyPackForm.schedulingEnabled}
								onCheckedChange={(checked) =>
									setPolicyPackForm((current) => ({
										...current,
										schedulingEnabled: Boolean(checked),
									}))
								}
							/>
							Scheduling enabled
						</label>
						<label className='flex items-center gap-2'>
							<Checkbox
								checked={policyPackForm.enabled}
								onCheckedChange={(checked) =>
									setPolicyPackForm((current) => ({
										...current,
										enabled: Boolean(checked),
									}))
								}
							/>
							Policy pack enabled
						</label>
					</div>

					<div className='space-y-1.5'>
						<Label htmlFor='policy-pack-windows'>Execution Windows (JSON)</Label>
						<Textarea
							id='policy-pack-windows'
							className='min-h-32 font-mono'
							value={policyPackForm.executionWindowsText}
							onChange={(event) =>
								setPolicyPackForm((current) => ({
									...current,
									executionWindowsText: event.target.value,
								}))
							}
							disabled={!policyPackForm.schedulingEnabled}
						/>
					</div>

					<div className='flex flex-wrap gap-2'>
						<Button
							variant='outline'
							onClick={() => savePolicyPackMutation.mutate()}
							disabled={savePolicyPackMutation.isPending}
						>
							{editingPolicyPackId ? 'Update Policy Pack' : 'Create Policy Pack'}
						</Button>
						<Button
							variant='outline'
							onClick={() => {
								setEditingPolicyPackId(null)
								setPolicyPackForm(defaultPolicyPackFormState)
							}}
							disabled={savePolicyPackMutation.isPending}
						>
							New Policy Pack
						</Button>
						<Button
							variant='outline'
							onClick={() => {
								if (editingPolicyPackId) {
									deletePolicyPackMutation.mutate(editingPolicyPackId)
								}
							}}
							disabled={!editingPolicyPackId || deletePolicyPackMutation.isPending}
						>
							Delete Policy Pack
						</Button>
					</div>

						<div className='max-h-56 space-y-2 overflow-auto border p-2'>
						{(policyPacksQuery.data?.length ?? 0) === 0 ? (
							<p className='text-muted-foreground text-xs'>
								No governance policy packs configured.
							</p>
						) : (
							policyPacksQuery.data?.map((policyPack) => (
								<button
									key={policyPack.id}
									type='button'
									className='w-full space-y-1 border p-2 text-left text-xs hover:bg-muted/40'
									onClick={() => {
										setEditingPolicyPackId(policyPack.id)
										setPolicyPackForm(toPolicyPackFormState(policyPack))
									}}
								>
									<div className='flex items-center justify-between gap-2'>
										<p className='truncate font-medium'>{policyPack.name}</p>
										<Badge variant={policyPack.enabled ? 'default' : 'outline'}>
											{policyPack.enabled ? 'enabled' : 'disabled'}
										</Badge>
									</div>
									<p className='text-muted-foreground truncate'>
										env: {policyPack.environments.join(', ')}
									</p>
									<p className='text-muted-foreground truncate'>
										max items: {policyPack.maxWorkflowItems} | max retry:{' '}
										{policyPack.maxRetryAttempts}
									</p>
									<p className='text-muted-foreground truncate'>
										scheduling: {policyPack.schedulingEnabled ? 'enabled' : 'disabled'} |
										windows: {policyPack.executionWindows.length}
									</p>
								</button>
							))
						)}
					</div>
				</CardContent>
			</Card>
			<div className='grid min-h-0 gap-3'>
				<Card>
					<CardHeader>
						<CardTitle>Retention Policies</CardTitle>
						<CardDescription>
							Configure retention windows and storage budgets by dataset class.
						</CardDescription>
					</CardHeader>
					<CardContent className='space-y-3'>
						{(Object.keys(retentionDrafts) as Array<RetentionPolicy['dataset']>).map(
							(dataset) => (
								<div key={dataset} className='space-y-2 border p-2 text-xs'>
									<p className='font-medium'>{dataset}</p>
									<div className='grid gap-2 md:grid-cols-3'>
										<InputGroup>
											<InputGroupAddon>
												<Clock3Icon className='size-3.5' />
											</InputGroupAddon>
											<InputGroupInput
												value={retentionDrafts[dataset].retentionDays}
												onChange={(event) =>
													setRetentionDrafts((current) => ({
														...current,
														[dataset]: {
															...current[dataset],
															retentionDays: event.target.value,
														},
													}))
												}
												placeholder='Retention days'
											/>
										</InputGroup>
										<InputGroup>
											<InputGroupAddon>
												<BoxIcon className='size-3.5' />
											</InputGroupAddon>
											<InputGroupInput
												value={retentionDrafts[dataset].storageBudgetMb}
												onChange={(event) =>
													setRetentionDrafts((current) => ({
														...current,
														[dataset]: {
															...current[dataset],
															storageBudgetMb: event.target.value,
														},
													}))
												}
												placeholder='Storage budget (MB)'
											/>
										</InputGroup>
										<label className='flex items-center gap-2'>
											<Checkbox
												checked={retentionDrafts[dataset].autoPurgeOldest}
												onCheckedChange={(checked) =>
													setRetentionDrafts((current) => ({
														...current,
														[dataset]: {
															...current[dataset],
															autoPurgeOldest: Boolean(checked),
														},
													}))
												}
											/>
											auto purge oldest
										</label>
									</div>
									<Button
										size='sm'
										variant='outline'
										onClick={() => updateRetentionPolicyMutation.mutate(dataset)}
										disabled={updateRetentionPolicyMutation.isPending}
									>
										Save {dataset}
									</Button>
								</div>
							),
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Storage Budget Controls</CardTitle>
						<CardDescription>
							Inspect usage by dataset and run manual purge operations.
						</CardDescription>
					</CardHeader>
					<CardContent className='space-y-3'>
						<div className='grid gap-3 md:grid-cols-3'>
							<Select
								value={purgeDataset}
								onValueChange={(value) =>
									setPurgeDataset(value as RetentionPolicy['dataset'])
								}
							>
								<SelectTrigger className='w-full'>
									<BoxIcon className='size-3.5' />
									<SelectValue>{retentionDatasetLabels[purgeDataset]}</SelectValue>
								</SelectTrigger>
								<SelectContent>
									<SelectItem value='timelineEvents'>timelineEvents</SelectItem>
									<SelectItem value='observabilitySnapshots'>
										observabilitySnapshots
									</SelectItem>
									<SelectItem value='workflowHistory'>workflowHistory</SelectItem>
									<SelectItem value='incidentArtifacts'>incidentArtifacts</SelectItem>
								</SelectContent>
							</Select>
							<Input
								type='datetime-local'
								value={purgeOlderThan}
								onChange={(event) => setPurgeOlderThan(event.target.value)}
							/>
							<Input
								value={purgeConfirmationText}
								onChange={(event) => setPurgeConfirmationText(event.target.value)}
								placeholder={`Type "${requiredPurgeConfirmation}"`}
							/>
						</div>
						<p className='text-muted-foreground text-xs'>
							Run impact preview first, then type{' '}
							<strong>{requiredPurgeConfirmation}</strong> to enable destructive purge
							execution.
						</p>
						<div className='flex flex-wrap gap-2'>
							<Button
								variant='outline'
								onClick={() => purgePreviewMutation.mutate()}
								disabled={
									purgePreviewMutation.isPending || purgeExecuteMutation.isPending
								}
							>
								Preview Impact
							</Button>
							<Button
								variant='outline'
								onClick={() => purgeExecuteMutation.mutate()}
								disabled={
									purgeExecuteMutation.isPending ||
									purgePreviewMutation.isPending ||
									!purgePreviewResult ||
									purgePreviewSignature !== purgeRequestSignature ||
									purgePreviewResult.deletedRows === 0 ||
									purgeConfirmationText.trim() !== requiredPurgeConfirmation
								}
							>
								Execute Purge
							</Button>
							<Button
								variant='outline'
								onClick={() => {
									void storageSummaryQuery.refetch()
								}}
							>
								Refresh Summary
							</Button>
						</div>

						{purgePreviewResult && (
							<div className='rounded-none border p-2 text-xs'>
								<p className='font-medium'>Impact Preview</p>
								<p>dataset: {purgePreviewResult.dataset}</p>
								<p>cutoff: {new Date(purgePreviewResult.cutoff).toLocaleString()}</p>
								<p>deleted rows: {purgePreviewResult.deletedRows}</p>
								<p>freed bytes: {purgePreviewResult.freedBytes}</p>
								{purgePreviewResult.deletedRows === 0 ? (
									<p className='text-muted-foreground'>
										No matching rows found for this purge filter.
									</p>
								) : null}
							</div>
						)}

						{lastPurgeResult && (
							<div className='rounded-none border p-2 text-xs'>
								<p className='font-medium'>Last Purge Execution</p>
								<p>dataset: {lastPurgeResult.dataset}</p>
								<p>cutoff: {new Date(lastPurgeResult.cutoff).toLocaleString()}</p>
								<p>deleted rows: {lastPurgeResult.deletedRows}</p>
								<p>freed bytes: {lastPurgeResult.freedBytes}</p>
							</div>
						)}

						<div className='max-h-56 overflow-auto border'>
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Dataset</TableHead>
										<TableHead>Rows</TableHead>
										<TableHead>Total Bytes</TableHead>
										<TableHead>Usage</TableHead>
										<TableHead>Status</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{(storageSummaryQuery.data?.datasets ?? []).map((dataset) => (
										<TableRow key={dataset.dataset}>
											<TableCell>{dataset.dataset}</TableCell>
											<TableCell>{dataset.rowCount}</TableCell>
											<TableCell>{dataset.totalBytes}</TableCell>
											<TableCell>{(dataset.usageRatio * 100).toFixed(1)}%</TableCell>
											<TableCell>
												<Badge variant={dataset.overBudget ? 'destructive' : 'outline'}>
													{dataset.overBudget ? 'over budget' : 'ok'}
												</Badge>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
					</CardContent>
				</Card>
			</div>
			</div>
		</div>
	)
}
