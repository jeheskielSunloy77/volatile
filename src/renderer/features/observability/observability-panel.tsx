import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as React from 'react'
import { Clock3Icon, HashIcon, RefreshCwIcon, ShieldAlertIcon } from 'lucide-react'
import {
	Area,
	AreaChart,
	Bar,
	BarChart,
	CartesianGrid,
	Cell,
	Line,
	LineChart,
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
	DashboardSection,
	DashboardStats,
} from '@/renderer/components/ui/dashboard'
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
import { useStartupGateReady } from '@/renderer/app/startup-gate'
import { unwrapResponse } from '@/renderer/features/common/ipc'
import { useUiStore } from '@/renderer/state/ui-store'
import type {
	ConnectionProfile,
	IncidentBundleInclude,
	IncidentExportJob,
} from '@/shared/contracts/cache'

type ObservabilityPanelProps = {
	connection: ConnectionProfile
	mode?: 'connection' | 'incident'
}

const ONE_HOUR_MS = 60 * 60 * 1000
const wholeNumberFormatter = new Intl.NumberFormat('en-US')

const incidentIncludeOptions: IncidentBundleInclude[] = [
	'timeline',
	'logs',
	'diagnostics',
	'metrics',
]
const intervalMinuteLabels: Record<string, string> = {
	'1': '1m buckets',
	'5': '5m buckets',
	'15': '15m buckets',
}
const redactionProfileLabels = {
	default: 'Default',
	strict: 'Strict',
} as const

const toLocalDateTimeValue = (value: Date): string => {
	const offsetMs = value.getTimezoneOffset() * 60_000
	return new Date(value.getTime() - offsetMs).toISOString().slice(0, 16)
}

const toIsoOrFallback = (value: string, fallback: Date): string => {
	const parsed = new Date(value)
	if (Number.isNaN(parsed.getTime())) {
		return fallback.toISOString()
	}

	return parsed.toISOString()
}

const getHealthVariant = (
	status: 'healthy' | 'degraded' | 'offline',
): 'default' | 'outline' | 'destructive' => {
	if (status === 'healthy') {
		return 'default'
	}

	if (status === 'degraded') {
		return 'destructive'
	}

	return 'outline'
}

const getDirectionVariant = (
	direction: 'improved' | 'regressed' | 'unchanged',
): 'default' | 'outline' | 'destructive' => {
	if (direction === 'regressed') {
		return 'destructive'
	}

	if (direction === 'improved') {
		return 'default'
	}

	return 'outline'
}

const formatBucketLabel = (value: string): string =>
	new Date(value).toLocaleTimeString([], {
		hour: '2-digit',
		minute: '2-digit',
	})

const formatCompact = (value: number): string =>
	wholeNumberFormatter.format(Math.round(value))

const formatPercent = (value: number): string => `${(value * 100).toFixed(1)}%`

export const ObservabilityPanel = ({
	connection,
	mode = 'connection',
}: ObservabilityPanelProps) => {
	const queryClient = useQueryClient()
	const { selectedNamespaceIdByConnection } = useUiStore()
	const selectedNamespaceId =
		selectedNamespaceIdByConnection[connection.id] ?? null
	const showConnectionSections = mode === 'connection'
	const showIncidentSection = mode === 'incident'

	const [intervalMinutes, setIntervalMinutes] = React.useState('5')

	const [activityFrom, setActivityFrom] = React.useState(() =>
		toLocalDateTimeValue(new Date(Date.now() - ONE_HOUR_MS)),
	)
	const [activityTo, setActivityTo] = React.useState(() =>
		toLocalDateTimeValue(new Date()),
	)
	const [activityIntervalMinutes, setActivityIntervalMinutes] =
		React.useState('5')

	const [failedFrom, setFailedFrom] = React.useState(() =>
		toLocalDateTimeValue(new Date(Date.now() - ONE_HOUR_MS)),
	)
	const [failedTo, setFailedTo] = React.useState(() =>
		toLocalDateTimeValue(new Date()),
	)
	const [failedLimit, setFailedLimit] = React.useState('50')

	const [baselineFrom, setBaselineFrom] = React.useState(() =>
		toLocalDateTimeValue(new Date(Date.now() - ONE_HOUR_MS * 2)),
	)
	const [baselineTo, setBaselineTo] = React.useState(() =>
		toLocalDateTimeValue(new Date(Date.now() - ONE_HOUR_MS)),
	)
	const [compareFrom, setCompareFrom] = React.useState(() =>
		toLocalDateTimeValue(new Date(Date.now() - ONE_HOUR_MS)),
	)
	const [compareTo, setCompareTo] = React.useState(() =>
		toLocalDateTimeValue(new Date()),
	)

	const [incidentFrom, setIncidentFrom] = React.useState(() =>
		toLocalDateTimeValue(new Date(Date.now() - ONE_HOUR_MS)),
	)
	const [incidentTo, setIncidentTo] = React.useState(() =>
		toLocalDateTimeValue(new Date()),
	)
	const [incidentRedactionProfile, setIncidentRedactionProfile] =
		React.useState<'default' | 'strict'>('default')
	const [incidentDestinationPath, setIncidentDestinationPath] =
		React.useState('')
	const [incidentIncludeState, setIncidentIncludeState] = React.useState<
		Record<IncidentBundleInclude, boolean>
	>({
		timeline: true,
		logs: true,
		diagnostics: true,
		metrics: true,
	})
	const [incidentPreview, setIncidentPreview] = React.useState<{
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
	} | null>(null)
	const [incidentExportJobId, setIncidentExportJobId] = React.useState<
		string | null
	>(null)

	const selectedIncidentIncludes = React.useMemo(
		() =>
			incidentIncludeOptions.filter((include) => incidentIncludeState[include]),
		[incidentIncludeState],
	)

	const dashboardQuery = useQuery({
		queryKey: [
			'observability-dashboard',
			connection.id,
			selectedNamespaceId,
			intervalMinutes,
		],
		enabled: showConnectionSections,
		queryFn: async () =>
			unwrapResponse(
				await window.desktopApi.getObservabilityDashboard({
					connectionId: connection.id,
					namespaceId: selectedNamespaceId ?? undefined,
					intervalMinutes: Math.max(1, Number(intervalMinutes) || 5),
					limit: 300,
				}),
			),
	})

	const keyspaceQuery = useQuery({
		queryKey: [
			'observability-keyspace',
			connection.id,
			selectedNamespaceId,
			activityFrom,
			activityTo,
			activityIntervalMinutes,
		],
		enabled: showConnectionSections,
		queryFn: async () =>
			unwrapResponse(
				await window.desktopApi.getKeyspaceActivity({
					connectionId: connection.id,
					namespaceId: selectedNamespaceId ?? undefined,
					from: toIsoOrFallback(
						activityFrom,
						new Date(Date.now() - ONE_HOUR_MS),
					),
					to: toIsoOrFallback(activityTo, new Date()),
					intervalMinutes: Math.max(1, Number(activityIntervalMinutes) || 5),
					limit: 200,
				}),
			),
	})

	const failedQuery = useQuery({
		queryKey: [
			'observability-failures',
			connection.id,
			selectedNamespaceId,
			failedFrom,
			failedTo,
			failedLimit,
		],
		enabled: showConnectionSections,
		queryFn: async () =>
			unwrapResponse(
				await window.desktopApi.getFailedOperationDrilldown({
					connectionId: connection.id,
					namespaceId: selectedNamespaceId ?? undefined,
					from: toIsoOrFallback(failedFrom, new Date(Date.now() - ONE_HOUR_MS)),
					to: toIsoOrFallback(failedTo, new Date()),
					limit: Math.max(1, Number(failedLimit) || 50),
				}),
			),
	})

	const compareQuery = useQuery({
		queryKey: [
			'observability-compare',
			connection.id,
			selectedNamespaceId,
			baselineFrom,
			baselineTo,
			compareFrom,
			compareTo,
		],
		enabled: showConnectionSections,
		queryFn: async () =>
			unwrapResponse(
				await window.desktopApi.comparePeriods({
					connectionId: connection.id,
					namespaceId: selectedNamespaceId ?? undefined,
					baselineFrom: toIsoOrFallback(
						baselineFrom,
						new Date(Date.now() - ONE_HOUR_MS * 2),
					),
					baselineTo: toIsoOrFallback(
						baselineTo,
						new Date(Date.now() - ONE_HOUR_MS),
					),
					compareFrom: toIsoOrFallback(
						compareFrom,
						new Date(Date.now() - ONE_HOUR_MS),
					),
					compareTo: toIsoOrFallback(compareTo, new Date()),
				}),
			),
	})

	const incidentBundlesQuery = useQuery({
		queryKey: ['incident-bundles'],
		enabled: showIncidentSection,
		queryFn: async () =>
			unwrapResponse(
				await window.desktopApi.listIncidentBundles({
					limit: 20,
				}),
			),
	})

	const incidentExportJobQuery = useQuery({
		queryKey: ['incident-export-job', incidentExportJobId],
		queryFn: async () =>
			unwrapResponse(
				await window.desktopApi.getIncidentBundleExportJob({
					jobId: incidentExportJobId ?? '',
				}),
			),
		enabled: showIncidentSection && Boolean(incidentExportJobId),
		refetchInterval: (query): number | false => {
			const status = (query.state.data as IncidentExportJob | undefined)?.status
			if (
				status === 'success' ||
				status === 'failed' ||
				status === 'cancelled'
			) {
				return false
			}

			return 1000
		},
	})
	useStartupGateReady(
		'incident-bundles-page',
		showIncidentSection &&
		(
			showIncidentSection
			? !incidentBundlesQuery.isLoading
			: !dashboardQuery.isLoading &&
				!keyspaceQuery.isLoading &&
				!failedQuery.isLoading &&
				!compareQuery.isLoading
		),
	)

	const buildIncidentRequest = React.useCallback(() => {
		if (selectedIncidentIncludes.length === 0) {
			throw new Error('Select at least one incident artifact include option.')
		}

		return {
			from: toIsoOrFallback(incidentFrom, new Date(Date.now() - ONE_HOUR_MS)),
			to: toIsoOrFallback(incidentTo, new Date()),
			connectionIds: [connection.id],
			namespaceId: selectedNamespaceId ?? undefined,
			includes: selectedIncidentIncludes,
			redactionProfile: incidentRedactionProfile,
		}
	}, [
		selectedIncidentIncludes,
		incidentFrom,
		incidentTo,
		connection.id,
		selectedNamespaceId,
		incidentRedactionProfile,
	])

	const incidentPreviewMutation = useMutation({
		mutationFn: async () =>
			unwrapResponse(
				await window.desktopApi.previewIncidentBundle(buildIncidentRequest()),
			),
		onSuccess: (preview) => {
			setIncidentPreview({
				timelineCount: preview.timelineCount,
				logCount: preview.logCount,
				diagnosticCount: preview.diagnosticCount,
				metricCount: preview.metricCount,
				estimatedSizeBytes: preview.estimatedSizeBytes,
				checksumPreview: preview.checksumPreview,
				truncated: preview.truncated,
				manifest: preview.manifest,
			})
			toast.success('Incident bundle preview generated.')
		},
		onError: (error) => {
			toast.error(
				error instanceof Error
					? error.message
					: 'Unable to preview incident bundle.',
			)
		},
	})

	const incidentExportMutation = useMutation({
		mutationFn: async () =>
			unwrapResponse(
				await window.desktopApi.startIncidentBundleExport({
					...buildIncidentRequest(),
					destinationPath:
						incidentDestinationPath.trim().length > 0
							? incidentDestinationPath.trim()
							: undefined,
				}),
			),
		onSuccess: (job) => {
			setIncidentExportJobId(job.id)
			toast.success('Incident bundle export started.')
		},
		onError: (error) => {
			toast.error(
				error instanceof Error
					? error.message
					: 'Unable to export incident bundle.',
			)
		},
	})

	const incidentCancelMutation = useMutation({
		mutationFn: async () => {
			if (!incidentExportJobId) {
				return null
			}

			return unwrapResponse(
				await window.desktopApi.cancelIncidentBundleExportJob({
					jobId: incidentExportJobId,
				}),
			)
		},
		onSuccess: (job) => {
			if (job) {
				toast.success(`Export job ${job.status}.`)
			}
		},
		onError: (error) => {
			toast.error(
				error instanceof Error ? error.message : 'Unable to cancel export job.',
			)
		},
	})

	const incidentResumeMutation = useMutation({
		mutationFn: async () => {
			if (!incidentExportJobId) {
				return null
			}

			return unwrapResponse(
				await window.desktopApi.resumeIncidentBundleExportJob({
					jobId: incidentExportJobId,
				}),
			)
		},
		onSuccess: (job) => {
			if (job) {
				toast.success('Incident export job resumed.')
			}
		},
		onError: (error) => {
			toast.error(
				error instanceof Error ? error.message : 'Unable to resume export job.',
			)
		},
	})

	const incidentNotifiedStatusRef = React.useRef<string | null>(null)
	React.useEffect(() => {
		const job = incidentExportJobQuery.data
		if (!job) {
			return
		}

		const statusKey = `${job.id}:${job.status}`
		if (incidentNotifiedStatusRef.current === statusKey) {
			return
		}

		if (job.status === 'success') {
			incidentNotifiedStatusRef.current = statusKey
			toast.success(`Incident bundle exported to ${job.destinationPath}.`)
			void queryClient.invalidateQueries({ queryKey: ['incident-bundles'] })
			return
		}

		if (job.status === 'failed') {
			incidentNotifiedStatusRef.current = statusKey
			toast.error(job.errorMessage ?? 'Incident export job failed.')
			return
		}

		if (job.status === 'cancelled') {
			incidentNotifiedStatusRef.current = statusKey
			toast('Incident export job cancelled.')
		}
	}, [incidentExportJobQuery.data, queryClient])

	const dashboard = dashboardQuery.data
	const totalOperationCount = React.useMemo(
		() =>
			(dashboard?.trends ?? []).reduce(
				(total, point) => total + point.operationCount,
				0,
			),
		[dashboard?.trends],
	)
	const totalErrorCount = React.useMemo(
		() =>
			(dashboard?.trends ?? []).reduce((total, point) => total + point.errorCount, 0),
		[dashboard?.trends],
	)
	const maxLatencyP95 = React.useMemo(
		() =>
			Math.max(
				0,
				...(dashboard?.health ?? []).map((health) => health.latencyP95Ms),
			),
		[dashboard?.health],
	)
	const degradedConnectionCount = React.useMemo(
		() =>
			(dashboard?.health ?? []).filter((health) => health.status !== 'healthy')
				.length,
		[dashboard?.health],
	)
	const healthChartData = React.useMemo(
		() => [
			{
				status: 'healthy',
				value: (dashboard?.health ?? []).filter((item) => item.status === 'healthy')
					.length,
				fill: 'var(--color-healthy)',
			},
			{
				status: 'degraded',
				value: (dashboard?.health ?? []).filter((item) => item.status === 'degraded')
					.length,
				fill: 'var(--color-degraded)',
			},
			{
				status: 'offline',
				value: (dashboard?.health ?? []).filter((item) => item.status === 'offline')
					.length,
				fill: 'var(--color-offline)',
			},
		].filter((item) => item.value > 0),
		[dashboard?.health],
	)
	const trendChartData = React.useMemo(
		() =>
			(dashboard?.trends ?? []).map((trend) => ({
				bucket: formatBucketLabel(trend.bucket),
				operations: trend.operationCount,
				errors: trend.errorCount,
				duration: trend.avgDurationMs,
			})),
		[dashboard?.trends],
	)
	const errorHeatmapData = React.useMemo(() => {
		const healthNameById = new Map(
			(dashboard?.health ?? []).map((health) => [
				health.connectionId,
				health.connectionName,
			]),
		)

		return (dashboard?.heatmap ?? []).map((cell) => ({
			connection: healthNameById.get(cell.connectionId) ?? cell.connectionId,
			label: `${healthNameById.get(cell.connectionId) ?? cell.connectionId} (${cell.environment})`,
			errors: cell.errorCount,
		}))
	}, [dashboard?.health, dashboard?.heatmap])
	const keyspacePatternData = React.useMemo(
		() =>
			(keyspaceQuery.data?.topPatterns ?? []).slice(0, 6).map((pattern) => ({
				pattern: pattern.pattern,
				touches: pattern.touchCount,
				errors: pattern.errorCount,
			})),
		[keyspaceQuery.data?.topPatterns],
	)
	const keyspaceDistributionData = React.useMemo(
		() =>
			(keyspaceQuery.data?.distribution ?? []).map((point) => ({
				bucket: formatBucketLabel(point.bucket),
				touches: point.touches,
				errors: point.errors,
			})),
		[keyspaceQuery.data?.distribution],
	)
	const compareMetrics = compareQuery.data?.metrics ?? []
	const observabilitySummaryItems = [
		{
			label: 'Sampled Ops',
			value: formatCompact(totalOperationCount),
			description: `${formatCompact(totalErrorCount)} errors in current range`,
		},
		{
			label: 'Peak P95',
			value: `${formatCompact(maxLatencyP95)}ms`,
			description: `${degradedConnectionCount} non-healthy connections`,
			tone:
				degradedConnectionCount > 0
					? ('danger' as const)
					: ('positive' as const),
		},
		{
			label: 'Keyspace Events',
			value: formatCompact(keyspaceQuery.data?.totalEvents ?? 0),
			description:
				keyspaceQuery.data?.truncated
					? 'Activity window is truncated'
					: 'Current keyspace sample volume',
		},
		{
			label: 'Error Rate',
			value:
				totalOperationCount === 0
					? '0.0%'
					: formatPercent(totalErrorCount / totalOperationCount),
			description: dashboard?.truncated
				? 'Dashboard data is sampled'
				: 'Based on current trend buckets',
			tone: totalErrorCount > 0 ? ('danger' as const) : ('default' as const),
		},
	] satisfies React.ComponentProps<typeof DashboardStats>['items']
	const observabilityChartConfig = {
		operations: { label: 'Ops', color: 'var(--chart-1)' },
		errors: { label: 'Errors', color: 'var(--destructive)' },
		duration: { label: 'Avg Duration', color: 'var(--chart-3)' },
		healthy: { label: 'Healthy', color: 'var(--chart-2)' },
		degraded: { label: 'Degraded', color: 'var(--chart-4)' },
		offline: { label: 'Offline', color: 'var(--chart-5)' },
		touches: { label: 'Touches', color: 'var(--chart-1)' },
	} satisfies ChartConfig

	return (
		<div className="grid min-h-0 gap-3">
			{showConnectionSections && (
				<>
					<Card>
						<CardHeader>
							<div className="flex items-center justify-between gap-2">
								<div>
									<CardTitle>Connection Health Dashboard</CardTitle>
									<CardDescription>
										Tracks operation trends, error heatmap, unified timeline,
										and slow operation feed.
									</CardDescription>
								</div>
								<div className="flex items-center gap-2">
									<Select
										value={intervalMinutes}
										onValueChange={setIntervalMinutes}
									>
										<SelectTrigger className="w-28">
											<Clock3Icon className="size-3.5" />
											<SelectValue>
												{intervalMinuteLabels[intervalMinutes] ?? intervalMinutes}
											</SelectValue>
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="1">1m buckets</SelectItem>
											<SelectItem value="5">5m buckets</SelectItem>
											<SelectItem value="15">15m buckets</SelectItem>
										</SelectContent>
									</Select>
									<Button
										variant="outline"
										size="sm"
										onClick={() => {
											void dashboardQuery.refetch()
										}}
									>
										<RefreshCwIcon className="size-3.5" />
										Refresh
									</Button>
								</div>
							</div>
						</CardHeader>
						<CardContent className="space-y-3">
							<DashboardSection>
								<DashboardStats items={observabilitySummaryItems} />
								<div className="grid gap-3 xl:grid-cols-[1.3fr_0.7fr]">
									<DashboardChartCard
										title="Operation Trends"
										description="Operations, errors, and average duration over the selected bucket interval."
										loading={dashboardQuery.isLoading}
										error={
											dashboardQuery.isError
												? dashboardQuery.error instanceof Error
													? dashboardQuery.error.message
													: 'Failed to load dashboard.'
												: undefined
										}
										empty={
											!dashboard || trendChartData.length === 0
												? 'No dashboard data yet.'
												: undefined
										}
									>
										<ChartContainer
											config={observabilityChartConfig}
											className="min-h-[18rem] w-full"
										>
											<LineChart accessibilityLayer data={trendChartData}>
												<CartesianGrid vertical={false} />
												<XAxis
													dataKey="bucket"
													tickLine={false}
													axisLine={false}
													tickMargin={8}
												/>
												<YAxis tickLine={false} axisLine={false} width={36} />
												<ChartTooltip content={<ChartTooltipContent />} />
												<ChartLegend content={<ChartLegendContent />} />
												<Line
													type="monotone"
													dataKey="operations"
													stroke="var(--color-operations)"
													strokeWidth={2}
													dot={false}
												/>
												<Line
													type="monotone"
													dataKey="errors"
													stroke="var(--color-errors)"
													strokeWidth={2}
													dot={false}
												/>
												<Line
													type="monotone"
													dataKey="duration"
													stroke="var(--color-duration)"
													strokeDasharray="4 4"
													strokeWidth={1.5}
													dot={false}
												/>
											</LineChart>
										</ChartContainer>
									</DashboardChartCard>

									<DashboardChartCard
										title="Connection Health Mix"
										description="Distribution of healthy, degraded, and offline connections in the active sample."
										loading={dashboardQuery.isLoading}
										error={
											dashboardQuery.isError
												? dashboardQuery.error instanceof Error
													? dashboardQuery.error.message
													: 'Failed to load dashboard.'
												: undefined
										}
										empty={
											!dashboard || healthChartData.length === 0
												? 'No health summary available.'
												: undefined
										}
										contentClassName="flex items-center"
									>
										<ChartContainer
											config={observabilityChartConfig}
											className="mx-auto min-h-[18rem] w-full max-w-[20rem]"
										>
											<PieChart accessibilityLayer>
												<ChartTooltip
													content={<ChartTooltipContent nameKey="status" />}
												/>
												<Pie
													data={healthChartData}
													dataKey="value"
													nameKey="status"
													innerRadius={54}
													outerRadius={84}
												>
													{healthChartData.map((entry) => (
														<Cell key={entry.status} fill={entry.fill} />
													))}
												</Pie>
												<ChartLegend content={<ChartLegendContent nameKey="status" />} />
											</PieChart>
										</ChartContainer>
									</DashboardChartCard>
								</div>

								<div className="grid gap-3 xl:grid-cols-2">
									<DashboardChartCard
										title="Error Hotspots"
										description="Grouped error counts by connection and environment."
										loading={dashboardQuery.isLoading}
										error={
											dashboardQuery.isError
												? dashboardQuery.error instanceof Error
													? dashboardQuery.error.message
													: 'Failed to load dashboard.'
												: undefined
										}
										empty={
											!dashboard || errorHeatmapData.length === 0
												? 'No error heatmap data yet.'
												: undefined
										}
									>
										<ChartContainer
											config={{
												errors: {
													label: 'Errors',
													color: 'var(--destructive)',
												},
											}}
											className="min-h-[18rem] w-full"
										>
											<BarChart accessibilityLayer data={errorHeatmapData}>
												<CartesianGrid vertical={false} />
												<XAxis
													dataKey="connection"
													tickLine={false}
													axisLine={false}
													tickMargin={8}
												/>
												<YAxis tickLine={false} axisLine={false} width={36} />
												<ChartTooltip
													content={<ChartTooltipContent labelKey="label" />}
												/>
												<Bar
													dataKey="errors"
													fill="var(--color-errors)"
													radius={0}
												/>
											</BarChart>
										</ChartContainer>
									</DashboardChartCard>

									<Card className="rounded-none border shadow-none">
										<CardHeader className="pb-2">
											<CardTitle>Connection Health Strip</CardTitle>
											<CardDescription>
												Per-connection status and latency snapshot for the active
												window.
											</CardDescription>
										</CardHeader>
										<CardContent className="grid gap-3 md:grid-cols-2">
											{dashboardQuery.isLoading ? (
												<p className="text-muted-foreground text-xs">
													Loading connection health...
												</p>
											) : (dashboard?.health ?? []).length === 0 ? (
												<p className="text-muted-foreground text-xs">
													No connection health records found.
												</p>
											) : (
												dashboard?.health.map((health) => (
													<div
														key={health.connectionId}
														className="space-y-2 border border-border/70 p-3 text-xs"
													>
														<div className="flex items-center justify-between gap-2">
															<p className="truncate font-medium">
																{health.connectionName}
															</p>
															<Badge variant={getHealthVariant(health.status)}>
																{health.status}
															</Badge>
														</div>
														<div className="text-muted-foreground grid grid-cols-2 gap-1">
															<span>env: {health.environment}</span>
															<span>p95: {health.latencyP95Ms}ms</span>
															<span>error: {formatPercent(health.errorRate)}</span>
															<span>ops/s: {health.opsPerSecond.toFixed(2)}</span>
															<span>slow ops: {health.slowOpCount}</span>
														</div>
													</div>
												))
											)}
										</CardContent>
									</Card>
								</div>
							</DashboardSection>
						</CardContent>
					</Card>

					<div className="grid min-h-0 gap-3 xl:grid-cols-2">
						<DashboardChartCard
							title="Keyspace Activity"
							description="Top touched patterns in the selected activity window."
							loading={keyspaceQuery.isLoading}
							error={
								keyspaceQuery.isError
									? keyspaceQuery.error instanceof Error
										? keyspaceQuery.error.message
										: 'Failed to load keyspace activity.'
									: undefined
							}
							empty={
								keyspacePatternData.length === 0
									? 'No keyspace pattern activity in this window.'
									: undefined
							}
							contentClassName="space-y-3"
						>
							<div className="grid gap-3 md:grid-cols-3">
								<div className="space-y-1.5">
									<Label htmlFor="activity-from">From</Label>
									<Input
										id="activity-from"
										type="datetime-local"
										value={activityFrom}
										onChange={(event) => setActivityFrom(event.target.value)}
									/>
								</div>
								<div className="space-y-1.5">
									<Label htmlFor="activity-to">To</Label>
									<Input
										id="activity-to"
										type="datetime-local"
										value={activityTo}
										onChange={(event) => setActivityTo(event.target.value)}
									/>
								</div>
							<div className="space-y-1.5">
								<Label htmlFor="activity-interval">Interval (minutes)</Label>
								<InputGroup>
									<InputGroupAddon>
										<Clock3Icon className="size-3.5" />
									</InputGroupAddon>
									<InputGroupInput
										id="activity-interval"
										value={activityIntervalMinutes}
										onChange={(event) =>
											setActivityIntervalMinutes(event.target.value)
										}
									/>
								</InputGroup>
							</div>
							</div>
							<p className="text-muted-foreground text-xs">
								sampled events: {keyspaceQuery.data?.totalEvents ?? 0}
								{keyspaceQuery.data?.truncated ? ' (truncated)' : ''}
							</p>
							<ChartContainer
								config={{
									touches: { label: 'Touches', color: 'var(--chart-1)' },
									errors: { label: 'Errors', color: 'var(--destructive)' },
								}}
								className="min-h-[16rem] w-full"
							>
								<BarChart accessibilityLayer data={keyspacePatternData}>
									<CartesianGrid vertical={false} />
									<XAxis
										dataKey="pattern"
										tickLine={false}
										axisLine={false}
										tickMargin={8}
									/>
									<YAxis tickLine={false} axisLine={false} width={36} />
									<ChartTooltip content={<ChartTooltipContent />} />
									<ChartLegend content={<ChartLegendContent />} />
									<Bar dataKey="touches" fill="var(--color-touches)" radius={0} />
									<Bar dataKey="errors" fill="var(--color-errors)" radius={0} />
								</BarChart>
							</ChartContainer>
						</DashboardChartCard>

						<DashboardChartCard
							title="Keyspace Distribution"
							description="Touch and error distribution across the selected time buckets."
							loading={keyspaceQuery.isLoading}
							error={
								keyspaceQuery.isError
									? keyspaceQuery.error instanceof Error
										? keyspaceQuery.error.message
										: 'Failed to load keyspace activity.'
									: undefined
							}
							empty={
								keyspaceDistributionData.length === 0
									? 'No distribution data in this window.'
									: undefined
							}
						>
							<ChartContainer
								config={{
									touches: { label: 'Touches', color: 'var(--chart-1)' },
									errors: { label: 'Errors', color: 'var(--destructive)' },
								}}
								className="min-h-[18rem] w-full"
							>
								<AreaChart accessibilityLayer data={keyspaceDistributionData}>
									<CartesianGrid vertical={false} />
									<XAxis
										dataKey="bucket"
										tickLine={false}
										axisLine={false}
										tickMargin={8}
									/>
									<YAxis tickLine={false} axisLine={false} width={36} />
									<ChartTooltip content={<ChartTooltipContent />} />
									<ChartLegend content={<ChartLegendContent />} />
									<Area
										type="monotone"
										dataKey="touches"
										fill="var(--color-touches)"
										fillOpacity={0.2}
										stroke="var(--color-touches)"
										strokeWidth={2}
									/>
									<Area
										type="monotone"
										dataKey="errors"
										fill="var(--color-errors)"
										fillOpacity={0.16}
										stroke="var(--color-errors)"
										strokeWidth={2}
									/>
								</AreaChart>
							</ChartContainer>
						</DashboardChartCard>
					</div>

					<div className="grid min-h-0 gap-3 xl:grid-cols-2">
						<Card className="min-h-0 rounded-none border shadow-none">
							<CardHeader>
								<CardTitle>Failed Operation Drilldown</CardTitle>
								<CardDescription>
									Links failed events to retry context, related timeline events,
									and latest snapshots.
								</CardDescription>
							</CardHeader>
							<CardContent className="space-y-3">
								<div className="grid gap-3 md:grid-cols-3">
									<div className="space-y-1.5">
										<Label htmlFor="failed-from">From</Label>
										<Input
											id="failed-from"
											type="datetime-local"
											value={failedFrom}
											onChange={(event) => setFailedFrom(event.target.value)}
										/>
									</div>
									<div className="space-y-1.5">
										<Label htmlFor="failed-to">To</Label>
										<Input
											id="failed-to"
											type="datetime-local"
											value={failedTo}
											onChange={(event) => setFailedTo(event.target.value)}
										/>
									</div>
									<div className="space-y-1.5">
										<Label htmlFor="failed-limit">Limit</Label>
										<InputGroup>
											<InputGroupAddon>
												<HashIcon className="size-3.5" />
											</InputGroupAddon>
											<InputGroupInput
												id="failed-limit"
												value={failedLimit}
												onChange={(event) => setFailedLimit(event.target.value)}
											/>
										</InputGroup>
									</div>
								</div>

								{failedQuery.isLoading ? (
									<p className="text-muted-foreground text-xs">
										Loading diagnostics...
									</p>
								) : failedQuery.isError ? (
									<p className="text-destructive text-xs">
										{failedQuery.error instanceof Error
											? failedQuery.error.message
											: 'Failed to load failed-operation diagnostics.'}
									</p>
								) : (failedQuery.data?.diagnostics.length ?? 0) === 0 ? (
									<p className="text-muted-foreground text-xs">
										No failed-operation diagnostics in this window.
									</p>
								) : (
									<div className="space-y-2">
										<p className="text-muted-foreground text-xs">
											error events: {failedQuery.data?.totalErrorEvents ?? 0}
											{failedQuery.data?.truncated ? ' (truncated)' : ''}
										</p>
										<div className="max-h-72 space-y-2 overflow-auto">
											{failedQuery.data?.diagnostics.map((diagnostic) => (
												<div
													key={diagnostic.event.id}
													className="space-y-1 border p-2 text-xs"
												>
													<div className="flex items-center justify-between gap-2">
														<p className="truncate font-medium">
															{diagnostic.event.action}
														</p>
														<Badge variant="destructive">
															{diagnostic.event.status}
														</Badge>
													</div>
													<p className="text-muted-foreground truncate">
														{diagnostic.event.keyOrPattern}
													</p>
													<div className="text-muted-foreground flex flex-wrap gap-2">
														<span>retries: {diagnostic.retryAttempts}</span>
														<span>
															related events: {diagnostic.relatedEvents.length}
														</span>
														<span>
															occurred:{' '}
															{new Date(
																diagnostic.event.timestamp,
															).toLocaleString()}
														</span>
													</div>
												</div>
											))}
										</div>
									</div>
								)}
							</CardContent>
						</Card>

						<Card className="min-h-0 rounded-none border shadow-none">
							<CardHeader>
								<CardTitle>Compare Period Analytics</CardTitle>
								<CardDescription>
									Compare baseline and current windows to highlight regressions.
								</CardDescription>
							</CardHeader>
							<CardContent className="space-y-3">
								<div className="grid gap-3 md:grid-cols-4">
									<div className="space-y-1.5">
										<Label htmlFor="baseline-from">Baseline From</Label>
										<Input
											id="baseline-from"
											type="datetime-local"
											value={baselineFrom}
											onChange={(event) => setBaselineFrom(event.target.value)}
										/>
									</div>
									<div className="space-y-1.5">
										<Label htmlFor="baseline-to">Baseline To</Label>
										<Input
											id="baseline-to"
											type="datetime-local"
											value={baselineTo}
											onChange={(event) => setBaselineTo(event.target.value)}
										/>
									</div>
									<div className="space-y-1.5">
										<Label htmlFor="compare-from">Compare From</Label>
										<Input
											id="compare-from"
											type="datetime-local"
											value={compareFrom}
											onChange={(event) => setCompareFrom(event.target.value)}
										/>
									</div>
									<div className="space-y-1.5">
										<Label htmlFor="compare-to">Compare To</Label>
										<Input
											id="compare-to"
											type="datetime-local"
											value={compareTo}
											onChange={(event) => setCompareTo(event.target.value)}
										/>
									</div>
								</div>

								{compareQuery.isLoading ? (
									<p className="text-muted-foreground text-xs">
										Comparing periods...
									</p>
								) : compareQuery.isError ? (
									<p className="text-destructive text-xs">
										{compareQuery.error instanceof Error
											? compareQuery.error.message
											: 'Failed to compare periods.'}
									</p>
								) : (
									<div className="space-y-2">
										<p className="text-muted-foreground text-xs">
											sampled baseline events:{' '}
											{compareQuery.data?.baselineSampledEvents ?? 0}
											{' | '}
											sampled compare events:{' '}
											{compareQuery.data?.compareSampledEvents ?? 0}
											{compareQuery.data?.truncated ? ' (truncated)' : ''}
										</p>
										<div className="grid gap-3 md:grid-cols-2">
											{compareMetrics.map((metric) => (
												<div
													key={metric.metric}
													className="space-y-2 border border-border/70 p-3 text-xs"
												>
													<div className="flex items-center justify-between gap-2">
														<p className="font-medium">{metric.metric}</p>
														<Badge
															variant={getDirectionVariant(metric.direction)}
														>
															{metric.direction}
														</Badge>
													</div>
													<div className="text-muted-foreground grid grid-cols-2 gap-1">
														<span>baseline: {formatCompact(metric.baseline)}</span>
														<span>compare: {formatCompact(metric.compare)}</span>
														<span>
															delta: {formatCompact(metric.delta)}
														</span>
														<span>
															percent:{' '}
															{metric.deltaPercent === null
																? 'n/a'
																: `${metric.deltaPercent}%`}
														</span>
													</div>
												</div>
											))}
										</div>
									</div>
								)}
							</CardContent>
						</Card>
					</div>

					<div className="grid min-h-0 gap-3 xl:grid-cols-2">
						<Card className="min-h-0 rounded-none border shadow-none">
							<CardHeader>
								<CardTitle>Unified Timeline</CardTitle>
								<CardDescription>
									Combined app audit and operation events.
								</CardDescription>
							</CardHeader>
							<CardContent className="max-h-72 overflow-auto">
								{(dashboard?.timeline ?? []).length === 0 ? (
									<p className="text-muted-foreground text-xs">
										No timeline events found.
									</p>
								) : (
									<div className="space-y-2">
										{dashboard?.timeline.slice(0, 80).map((event) => (
											<div
												key={event.id}
												className="space-y-1 border p-2 text-xs"
											>
												<div className="flex items-center justify-between gap-2">
													<p className="truncate font-medium">{event.action}</p>
													<Badge
														variant={
															event.status === 'error'
																? 'destructive'
																: 'outline'
														}
													>
														{event.status}
													</Badge>
												</div>
												<p className="text-muted-foreground truncate">
													{event.keyOrPattern}
												</p>
												<p className="text-muted-foreground">
													{new Date(event.timestamp).toLocaleString()} |{' '}
													{event.durationMs}ms
												</p>
											</div>
										))}
									</div>
								)}
							</CardContent>
						</Card>

						<Card className="min-h-0 rounded-none border shadow-none">
							<CardHeader>
								<CardTitle>Slow Operation Panel</CardTitle>
								<CardDescription>
									Operations at or above the configured slow threshold.
								</CardDescription>
							</CardHeader>
							<CardContent className="max-h-72 overflow-auto">
								{(dashboard?.slowOperations ?? []).length === 0 ? (
									<p className="text-muted-foreground text-xs">
										No slow operations found.
									</p>
								) : (
									<div className="space-y-2">
										{dashboard?.slowOperations.slice(0, 80).map((event) => (
											<div
												key={event.id}
												className="space-y-1 border p-2 text-xs"
											>
												<div className="flex items-center justify-between gap-2">
													<p className="truncate font-medium">{event.action}</p>
													<Badge variant="destructive">
														{event.durationMs}ms
													</Badge>
												</div>
												<p className="text-muted-foreground truncate">
													{event.keyOrPattern}
												</p>
											</div>
										))}
									</div>
								)}
							</CardContent>
						</Card>
					</div>
				</>
			)}

			{showIncidentSection && (
				<Card>
					<CardHeader>
						<CardTitle>Incident Bundle Preview and Export</CardTitle>
						<CardDescription>
							Preview timeline/log/diagnostic/metric payloads and export with
							checksum and redaction profile metadata.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-3">
						<div className="grid gap-3 md:grid-cols-4">
							<div className="space-y-1.5">
								<Label htmlFor="incident-from">From</Label>
								<Input
									id="incident-from"
									type="datetime-local"
									value={incidentFrom}
									onChange={(event) => setIncidentFrom(event.target.value)}
								/>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="incident-to">To</Label>
								<Input
									id="incident-to"
									type="datetime-local"
									value={incidentTo}
									onChange={(event) => setIncidentTo(event.target.value)}
								/>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="incident-redaction">Redaction Profile</Label>
								<Select
									value={incidentRedactionProfile}
									onValueChange={(value) =>
										setIncidentRedactionProfile(
											value as 'default' | 'strict',
										)
									}
								>
									<SelectTrigger id="incident-redaction" className="w-full">
										<ShieldAlertIcon className="size-3.5" />
										<SelectValue>
											{redactionProfileLabels[incidentRedactionProfile]}
										</SelectValue>
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="default">default</SelectItem>
										<SelectItem value="strict">strict</SelectItem>
									</SelectContent>
								</Select>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="incident-destination">
									Destination Path (optional)
								</Label>
								<Input
									id="incident-destination"
									value={incidentDestinationPath}
									onChange={(event) =>
										setIncidentDestinationPath(event.target.value)
									}
									placeholder="/tmp/volatile-incident.json"
								/>
							</div>
						</div>

						<div className="space-y-2 rounded-none border p-2 text-xs">
							<p className="font-medium">Includes</p>
							<div className="grid gap-2 md:grid-cols-4">
								{incidentIncludeOptions.map((include) => (
									<label key={include} className="flex items-center gap-2">
										<Checkbox
											checked={incidentIncludeState[include]}
											onCheckedChange={(checked) =>
												setIncidentIncludeState((current) => ({
													...current,
													[include]: Boolean(checked),
												}))
											}
										/>
										{include}
									</label>
								))}
							</div>
						</div>

						<div className="flex flex-wrap gap-2">
							<Button
								variant="outline"
								onClick={() => incidentPreviewMutation.mutate()}
								disabled={incidentPreviewMutation.isPending}
							>
								Preview Bundle
							</Button>
							<Button
								onClick={() => incidentExportMutation.mutate()}
								disabled={incidentExportMutation.isPending}
							>
								Start Export
							</Button>
							<Button
								variant="outline"
								onClick={() => incidentCancelMutation.mutate()}
								disabled={
									!incidentExportJobId || incidentCancelMutation.isPending
								}
							>
								Cancel Export
							</Button>
							<Button
								variant="outline"
								onClick={() => incidentResumeMutation.mutate()}
								disabled={
									!incidentExportJobId || incidentResumeMutation.isPending
								}
							>
								Resume Export
							</Button>
						</div>

						{incidentExportJobQuery.data && (
							<div className="grid gap-2 rounded-none border p-2 text-xs md:grid-cols-4">
								<span>job: {incidentExportJobQuery.data.id}</span>
								<span>status: {incidentExportJobQuery.data.status}</span>
								<span>stage: {incidentExportJobQuery.data.stage}</span>
								<span>
									progress: {incidentExportJobQuery.data.progressPercent}%
								</span>
							</div>
						)}

						{incidentPreview && (
							<div className="grid gap-2 rounded-none border p-2 text-xs md:grid-cols-3">
								<span>timeline: {incidentPreview.timelineCount}</span>
								<span>logs: {incidentPreview.logCount}</span>
								<span>diagnostics: {incidentPreview.diagnosticCount}</span>
								<span>metrics: {incidentPreview.metricCount}</span>
								<span>size: {incidentPreview.estimatedSizeBytes} bytes</span>
								<span className="truncate">
									checksum: {incidentPreview.checksumPreview}
								</span>
								<span>
									truncated: {incidentPreview.truncated ? 'yes' : 'no'}
								</span>
								<span>
									manifest timeline IDs:{' '}
									{incidentPreview.manifest.timelineEventIds.length}
								</span>
								<span>
									manifest snapshot IDs:{' '}
									{incidentPreview.manifest.metricSnapshotIds.length}
								</span>
							</div>
						)}

						<div className="space-y-2">
							<p className="text-xs font-medium">Recent Incident Bundles</p>
							{incidentBundlesQuery.isLoading ? (
								<p className="text-muted-foreground text-xs">
									Loading incident bundles...
								</p>
							) : (incidentBundlesQuery.data?.length ?? 0) === 0 ? (
								<p className="text-muted-foreground text-xs">
									No incident bundles exported yet.
								</p>
							) : (
								<div className="max-h-56 overflow-auto border">
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>Created</TableHead>
												<TableHead>Redaction</TableHead>
												<TableHead>Artifacts</TableHead>
												<TableHead>Truncated</TableHead>
												<TableHead>Checksum</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{incidentBundlesQuery.data?.map((bundle) => (
												<TableRow key={bundle.id}>
													<TableCell>
														{new Date(bundle.createdAt).toLocaleString()}
													</TableCell>
													<TableCell>{bundle.redactionProfile}</TableCell>
													<TableCell>
														{bundle.timelineCount}/{bundle.logCount}/
														{bundle.diagnosticCount}/{bundle.metricCount}
													</TableCell>
													<TableCell>
														{bundle.truncated ? 'yes' : 'no'}
													</TableCell>
													<TableCell className="max-w-56 truncate">
														{bundle.checksum}
													</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>
								</div>
							)}
						</div>
					</CardContent>
				</Card>
			)}
		</div>
	)
}
