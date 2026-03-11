import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as React from 'react'
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
import { Checkbox } from '@/renderer/components/ui/checkbox'
import { Input } from '@/renderer/components/ui/input'
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

const incidentIncludeOptions: IncidentBundleInclude[] = [
	'timeline',
	'logs',
	'diagnostics',
	'metrics',
]

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
											<SelectValue />
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
										Refresh
									</Button>
								</div>
							</div>
						</CardHeader>
						<CardContent className="space-y-3">
							{dashboardQuery.isLoading ? (
								<p className="text-muted-foreground text-xs">
									Loading dashboard...
								</p>
							) : dashboard ? (
								<div className="space-y-2">
									{dashboard.truncated && (
										<p className="text-muted-foreground text-xs">
											Dashboard is sampled; refine filters for complete
											coverage.
										</p>
									)}
									<div className="grid gap-3 md:grid-cols-2">
										{dashboard.health.map((health) => (
											<div
												key={health.connectionId}
												className="space-y-2 border p-2 text-xs"
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
													<span>
														error: {(health.errorRate * 100).toFixed(1)}%
													</span>
													<span>ops/s: {health.opsPerSecond.toFixed(2)}</span>
													<span>slow ops: {health.slowOpCount}</span>
												</div>
											</div>
										))}
									</div>
								</div>
							) : (
								<p className="text-muted-foreground text-xs">
									No dashboard data yet.
								</p>
							)}
						</CardContent>
					</Card>

					<div className="grid min-h-0 gap-3 xl:grid-cols-2">
						<Card className="min-h-0">
							<CardHeader>
								<CardTitle>Operation Trends</CardTitle>
								<CardDescription>
									Aggregated operation counts and errors over time.
								</CardDescription>
							</CardHeader>
							<CardContent className="max-h-64 overflow-auto">
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Bucket</TableHead>
											<TableHead>Ops</TableHead>
											<TableHead>Errors</TableHead>
											<TableHead>Avg Duration</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{(dashboard?.trends ?? []).map((trend) => (
											<TableRow key={trend.bucket}>
												<TableCell>
													{new Date(trend.bucket).toLocaleTimeString()}
												</TableCell>
												<TableCell>{trend.operationCount}</TableCell>
												<TableCell>{trend.errorCount}</TableCell>
												<TableCell>{trend.avgDurationMs}ms</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							</CardContent>
						</Card>

						<Card className="min-h-0">
							<CardHeader>
								<CardTitle>Error Heatmap</CardTitle>
								<CardDescription>
									Error volume by connection and environment.
								</CardDescription>
							</CardHeader>
							<CardContent className="max-h-64 overflow-auto">
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Connection</TableHead>
											<TableHead>Environment</TableHead>
											<TableHead>Errors</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{(dashboard?.heatmap ?? []).map((cell) => (
											<TableRow
												key={`${cell.connectionId}:${cell.environment}`}
											>
												<TableCell>{cell.connectionId}</TableCell>
												<TableCell>{cell.environment}</TableCell>
												<TableCell>{cell.errorCount}</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							</CardContent>
						</Card>
					</div>

					<div className="grid min-h-0 gap-3 xl:grid-cols-2">
						<Card className="min-h-0">
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

						<Card className="min-h-0">
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

					<div className="grid min-h-0 gap-3 xl:grid-cols-2">
						<Card className="min-h-0">
							<CardHeader>
								<CardTitle>Keyspace Activity</CardTitle>
								<CardDescription>
									Top touched key patterns and temporal distribution.
								</CardDescription>
							</CardHeader>
							<CardContent className="space-y-3">
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
										<Label htmlFor="activity-interval">
											Interval (minutes)
										</Label>
										<Input
											id="activity-interval"
											value={activityIntervalMinutes}
											onChange={(event) =>
												setActivityIntervalMinutes(event.target.value)
											}
										/>
									</div>
								</div>

								{keyspaceQuery.isLoading ? (
									<p className="text-muted-foreground text-xs">
										Loading keyspace activity...
									</p>
								) : keyspaceQuery.isError ? (
									<p className="text-destructive text-xs">
										{keyspaceQuery.error instanceof Error
											? keyspaceQuery.error.message
											: 'Failed to load keyspace activity.'}
									</p>
								) : (
									<div className="space-y-2">
										<p className="text-muted-foreground text-xs">
											sampled events: {keyspaceQuery.data?.totalEvents ?? 0}
											{keyspaceQuery.data?.truncated ? ' (truncated)' : ''}
										</p>
										<div className="grid gap-3 lg:grid-cols-2">
											<div className="max-h-64 overflow-auto border">
												<Table>
													<TableHeader>
														<TableRow>
															<TableHead>Pattern</TableHead>
															<TableHead>Touches</TableHead>
															<TableHead>Errors</TableHead>
														</TableRow>
													</TableHeader>
													<TableBody>
														{(keyspaceQuery.data?.topPatterns ?? []).map(
															(pattern) => (
																<TableRow key={pattern.pattern}>
																	<TableCell>{pattern.pattern}</TableCell>
																	<TableCell>{pattern.touchCount}</TableCell>
																	<TableCell>{pattern.errorCount}</TableCell>
																</TableRow>
															),
														)}
													</TableBody>
												</Table>
											</div>
											<div className="max-h-64 overflow-auto border">
												<Table>
													<TableHeader>
														<TableRow>
															<TableHead>Bucket</TableHead>
															<TableHead>Touches</TableHead>
															<TableHead>Errors</TableHead>
														</TableRow>
													</TableHeader>
													<TableBody>
														{(keyspaceQuery.data?.distribution ?? []).map(
															(point) => (
																<TableRow key={point.bucket}>
																	<TableCell>
																		{new Date(point.bucket).toLocaleString()}
																	</TableCell>
																	<TableCell>{point.touches}</TableCell>
																	<TableCell>{point.errors}</TableCell>
																</TableRow>
															),
														)}
													</TableBody>
												</Table>
											</div>
										</div>
									</div>
								)}
							</CardContent>
						</Card>

						<Card className="min-h-0">
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
										<Input
											id="failed-limit"
											value={failedLimit}
											onChange={(event) => setFailedLimit(event.target.value)}
										/>
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
					</div>

					<Card>
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
									<div className="max-h-72 overflow-auto border">
										<Table>
											<TableHeader>
												<TableRow>
													<TableHead>Metric</TableHead>
													<TableHead>Baseline</TableHead>
													<TableHead>Compare</TableHead>
													<TableHead>Delta</TableHead>
													<TableHead>Direction</TableHead>
												</TableRow>
											</TableHeader>
											<TableBody>
												{(compareQuery.data?.metrics ?? []).map((metric) => (
													<TableRow key={metric.metric}>
														<TableCell>{metric.metric}</TableCell>
														<TableCell>{metric.baseline}</TableCell>
														<TableCell>{metric.compare}</TableCell>
														<TableCell>
															{metric.delta} (
															{metric.deltaPercent === null
																? 'n/a'
																: `${metric.deltaPercent}%`}
															)
														</TableCell>
														<TableCell>
															<Badge
																variant={getDirectionVariant(metric.direction)}
															>
																{metric.direction}
															</Badge>
														</TableCell>
													</TableRow>
												))}
											</TableBody>
										</Table>
									</div>
								</div>
							)}
						</CardContent>
					</Card>
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
										<SelectValue />
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
