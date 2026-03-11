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
import { useStartupGateReady } from '@/renderer/app/startup-gate'
import { unwrapResponse } from '@/renderer/features/common/ipc'
import type { AlertRule, ConnectionProfile } from '@/shared/contracts/cache'

type AlertsPanelProps = {
	connection: ConnectionProfile | null
}

const getSeverityVariant = (
	severity: 'info' | 'warning' | 'critical',
): 'default' | 'outline' | 'destructive' => {
	if (severity === 'critical') {
		return 'destructive'
	}

	if (severity === 'warning') {
		return 'outline'
	}

	return 'default'
}

type RuleFormState = {
	name: string
	metric: AlertRule['metric']
	threshold: string
	lookbackMinutes: string
	severity: AlertRule['severity']
	connectionScoped: boolean
	connectionId: string
	environment: '' | 'dev' | 'staging' | 'prod'
	enabled: boolean
}

const createDefaultRuleForm = (
	connection: ConnectionProfile | null,
): RuleFormState => ({
	name: '',
	metric: 'errorRate',
	threshold: '0.2',
	lookbackMinutes: '5',
	severity: 'warning',
	connectionScoped: Boolean(connection),
	connectionId: connection?.id ?? '',
	environment: connection?.environment ?? '',
	enabled: true,
})

const toRuleDraft = (form: RuleFormState) => {
	const threshold = Number(form.threshold)
	if (!Number.isFinite(threshold)) {
		throw new Error('Threshold must be a valid number.')
	}

	const lookbackMinutes = Math.max(1, Number(form.lookbackMinutes) || 1)

	if (form.connectionScoped && form.connectionId.trim().length === 0) {
		throw new Error('Connection ID is required when connection scope is enabled.')
	}

	return {
		name: form.name.trim() || 'Untitled Rule',
		metric: form.metric,
		threshold,
		lookbackMinutes,
		severity: form.severity,
		connectionId: form.connectionScoped ? form.connectionId.trim() : undefined,
		environment: form.environment || undefined,
		enabled: form.enabled,
	}
}

const toRuleFormState = (rule: AlertRule): RuleFormState => ({
	name: rule.name,
	metric: rule.metric,
	threshold: String(rule.threshold),
	lookbackMinutes: String(rule.lookbackMinutes),
	severity: rule.severity,
	connectionScoped: Boolean(rule.connectionId),
	connectionId: rule.connectionId ?? '',
	environment: rule.environment ?? '',
	enabled: rule.enabled,
})

export const AlertsPanel = ({ connection }: AlertsPanelProps) => {
	const queryClient = useQueryClient()
	const [unreadOnly, setUnreadOnly] = React.useState(false)
	const [editingRuleId, setEditingRuleId] = React.useState<string | null>(null)
	const [ruleForm, setRuleForm] = React.useState<RuleFormState>(() =>
		createDefaultRuleForm(connection),
	)

	React.useEffect(() => {
		if (editingRuleId) {
			return
		}

		setRuleForm((current) => ({
			...current,
			connectionId: connection?.id ?? '',
			environment: current.environment || connection?.environment || '',
		}))
	}, [connection, editingRuleId])

	const alertsQuery = useQuery({
		queryKey: ['alerts', unreadOnly],
		queryFn: async () =>
			unwrapResponse(
				await window.desktopApi.listAlerts({
					unreadOnly,
					limit: 100,
				}),
			),
	})

	const rulesQuery = useQuery({
		queryKey: ['alert-rules'],
		queryFn: async () => unwrapResponse(await window.desktopApi.listAlertRules()),
	})
	useStartupGateReady('alerts-page', !alertsQuery.isLoading && !rulesQuery.isLoading)

	const markReadMutation = useMutation({
		mutationFn: async (id: string) =>
			unwrapResponse(
				await window.desktopApi.markAlertRead({
					id,
				}),
			),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ['alerts'] })
		},
		onError: (error) => {
			toast.error(
				error instanceof Error ? error.message : 'Unable to mark alert read.',
			)
		},
	})

	const saveRuleMutation = useMutation({
		mutationFn: async () => {
			const rule = toRuleDraft(ruleForm)

			if (editingRuleId) {
				return unwrapResponse(
					await window.desktopApi.updateAlertRule({
						id: editingRuleId,
						rule,
					}),
				)
			}

			return unwrapResponse(
				await window.desktopApi.createAlertRule({
					rule,
				}),
			)
		},
		onSuccess: async (rule) => {
			setEditingRuleId(rule.id)
			setRuleForm(toRuleFormState(rule))
			toast.success('Alert rule saved.')
			await queryClient.invalidateQueries({ queryKey: ['alert-rules'] })
		},
		onError: (error) => {
			toast.error(
				error instanceof Error ? error.message : 'Unable to save alert rule.',
			)
		},
	})

	const deleteRuleMutation = useMutation({
		mutationFn: async (id: string) =>
			unwrapResponse(
				await window.desktopApi.deleteAlertRule({
					id,
				}),
			),
		onSuccess: async () => {
			setEditingRuleId(null)
			setRuleForm(createDefaultRuleForm(connection))
			toast.success('Alert rule deleted.')
			await queryClient.invalidateQueries({ queryKey: ['alert-rules'] })
		},
		onError: (error) => {
			toast.error(
				error instanceof Error ? error.message : 'Unable to delete alert rule.',
			)
		},
	})

	const resetRuleForm = React.useCallback(() => {
		setEditingRuleId(null)
		setRuleForm(createDefaultRuleForm(connection))
	}, [connection])

	return (
		<div className='grid min-h-0 gap-3 xl:grid-cols-2'>
			<Card className='min-h-0'>
				<CardHeader>
					<CardTitle>Alert Rule Builder</CardTitle>
					<CardDescription>
						Configure threshold and rate-based rules for operational signals.
					</CardDescription>
				</CardHeader>
				<CardContent className='space-y-3'>
					<div className='grid gap-3 md:grid-cols-2'>
						<div className='space-y-1.5'>
							<Label htmlFor='alert-rule-name'>Rule Name</Label>
							<Input
								id='alert-rule-name'
								value={ruleForm.name}
								onChange={(event) =>
									setRuleForm((current) => ({
										...current,
										name: event.target.value,
									}))
								}
								placeholder='High error rate'
							/>
						</div>
						<div className='space-y-1.5'>
							<Label htmlFor='alert-rule-metric'>Metric</Label>
							<Select
								value={ruleForm.metric}
								onValueChange={(value) =>
									setRuleForm((current) => ({
										...current,
										metric: value as AlertRule['metric'],
									}))
								}
							>
								<SelectTrigger id='alert-rule-metric' className='w-full'>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value='errorRate'>errorRate</SelectItem>
									<SelectItem value='latencyP95Ms'>latencyP95Ms</SelectItem>
									<SelectItem value='slowOperationCount'>slowOperationCount</SelectItem>
									<SelectItem value='failedOperationCount'>
										failedOperationCount
									</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div className='space-y-1.5'>
							<Label htmlFor='alert-rule-threshold'>Threshold</Label>
							<Input
								id='alert-rule-threshold'
								value={ruleForm.threshold}
								onChange={(event) =>
									setRuleForm((current) => ({
										...current,
										threshold: event.target.value,
									}))
								}
							/>
						</div>
						<div className='space-y-1.5'>
							<Label htmlFor='alert-rule-lookback'>Lookback (minutes)</Label>
							<Input
								id='alert-rule-lookback'
								value={ruleForm.lookbackMinutes}
								onChange={(event) =>
									setRuleForm((current) => ({
										...current,
										lookbackMinutes: event.target.value,
									}))
								}
							/>
						</div>
						<div className='space-y-1.5'>
							<Label htmlFor='alert-rule-severity'>Severity</Label>
							<Select
								value={ruleForm.severity}
								onValueChange={(value) =>
									setRuleForm((current) => ({
										...current,
										severity: value as AlertRule['severity'],
									}))
								}
							>
								<SelectTrigger id='alert-rule-severity' className='w-full'>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value='info'>info</SelectItem>
									<SelectItem value='warning'>warning</SelectItem>
									<SelectItem value='critical'>critical</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div className='space-y-1.5'>
							<Label htmlFor='alert-rule-environment'>Environment Scope</Label>
							<Select
								value={ruleForm.environment}
								onValueChange={(value) =>
									setRuleForm((current) => ({
										...current,
										environment: value as RuleFormState['environment'],
									}))
								}
							>
								<SelectTrigger id='alert-rule-environment' className='w-full'>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value=''>all</SelectItem>
									<SelectItem value='dev'>dev</SelectItem>
									<SelectItem value='staging'>staging</SelectItem>
									<SelectItem value='prod'>prod</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</div>

					<div className='space-y-2 rounded-none border p-2 text-xs'>
						<label className='flex items-center gap-2'>
							<Checkbox
								checked={ruleForm.connectionScoped}
								onCheckedChange={(checked) =>
									setRuleForm((current) => ({
										...current,
										connectionScoped: Boolean(checked),
									}))
								}
							/>
							Scope to a specific connection
						</label>
						{ruleForm.connectionScoped && (
							<div className='space-y-1.5'>
								<Label htmlFor='alert-rule-connection-id'>Connection ID</Label>
								<Input
									id='alert-rule-connection-id'
									value={ruleForm.connectionId}
									onChange={(event) =>
										setRuleForm((current) => ({
											...current,
											connectionId: event.target.value,
										}))
									}
								/>
							</div>
						)}
						<label className='flex items-center gap-2'>
							<Checkbox
								checked={ruleForm.enabled}
								onCheckedChange={(checked) =>
									setRuleForm((current) => ({
										...current,
										enabled: Boolean(checked),
									}))
								}
							/>
							Rule enabled
						</label>
					</div>

					<div className='flex flex-wrap gap-2'>
						<Button
							variant='outline'
							onClick={() => saveRuleMutation.mutate()}
							disabled={saveRuleMutation.isPending}
						>
							{editingRuleId ? 'Update Rule' : 'Create Rule'}
						</Button>
						<Button
							variant='outline'
							onClick={resetRuleForm}
							disabled={saveRuleMutation.isPending}
						>
							New Rule
						</Button>
						<Button
							variant='outline'
							onClick={() => {
								if (editingRuleId) {
									deleteRuleMutation.mutate(editingRuleId)
								}
							}}
							disabled={!editingRuleId || deleteRuleMutation.isPending}
						>
							Delete Rule
						</Button>
					</div>

					<div className='max-h-56 space-y-2 overflow-auto border p-2'>
						{(rulesQuery.data?.length ?? 0) === 0 ? (
							<p className='text-muted-foreground text-xs'>
								No alert rules configured yet.
							</p>
						) : (
							rulesQuery.data?.map((rule) => (
								<button
									key={rule.id}
									type='button'
									className='w-full space-y-1 border p-2 text-left text-xs hover:bg-muted/40'
									onClick={() => {
										setEditingRuleId(rule.id)
										setRuleForm(toRuleFormState(rule))
									}}
								>
									<div className='flex items-center justify-between gap-2'>
										<p className='truncate font-medium'>{rule.name}</p>
										<div className='flex items-center gap-1'>
											<Badge variant={getSeverityVariant(rule.severity)}>
												{rule.severity}
											</Badge>
											<Badge variant={rule.enabled ? 'default' : 'outline'}>
												{rule.enabled ? 'enabled' : 'disabled'}
											</Badge>
										</div>
									</div>
									<p className='text-muted-foreground'>
										{rule.metric} &gt; {rule.threshold} | {rule.lookbackMinutes}m
									</p>
									<p className='text-muted-foreground truncate'>
										connection: {rule.connectionId ?? 'all'} | env:{' '}
										{rule.environment ?? 'all'}
									</p>
								</button>
							))
						)}
					</div>
				</CardContent>
			</Card>

			<Card className='min-h-0'>
				<CardHeader>
					<div className='flex items-center justify-between gap-2'>
						<div>
							<CardTitle>Alerts</CardTitle>
							<CardDescription>
								In-app alert feed.
							</CardDescription>
						</div>
						<label className='flex items-center gap-2 text-xs'>
							<Checkbox
								checked={unreadOnly}
								onCheckedChange={(checked) => setUnreadOnly(Boolean(checked))}
							/>
							Unread only
						</label>
					</div>
				</CardHeader>
				<CardContent className='max-h-[calc(100vh-360px)] space-y-2 overflow-auto'>
					{alertsQuery.isLoading ? (
						<p className='text-muted-foreground text-xs'>Loading alerts...</p>
					) : (alertsQuery.data?.length ?? 0) === 0 ? (
						<p className='text-muted-foreground text-xs'>No alerts to display.</p>
					) : (
						alertsQuery.data?.map((alert) => (
							<div key={alert.id} className='space-y-2 border p-2 text-xs'>
								<div className='flex items-center justify-between gap-2'>
									<div className='min-w-0'>
										<p className='truncate font-medium'>{alert.title}</p>
										<p className='text-muted-foreground truncate'>
											{new Date(alert.createdAt).toLocaleString()}
										</p>
									</div>
									<div className='flex items-center gap-2'>
										<Badge variant={getSeverityVariant(alert.severity)}>
											{alert.severity}
										</Badge>
										{alert.read ? <Badge variant='outline'>read</Badge> : null}
									</div>
								</div>

								<p>{alert.message}</p>

								<div className='text-muted-foreground flex items-center gap-2'>
									<span>source: {alert.source}</span>
									{alert.environment && <span>env: {alert.environment}</span>}
									{alert.connectionId && <span>connection: {alert.connectionId}</span>}
								</div>

								{!alert.read && (
									<Button
										size='sm'
										variant='outline'
										onClick={() => markReadMutation.mutate(alert.id)}
										disabled={markReadMutation.isPending}
									>
										Mark As Read
									</Button>
								)}
							</div>
						))
					)}
				</CardContent>
			</Card>
		</div>
	)
}
