import * as React from 'react'
import { toast } from 'sonner'

import { Button } from '@/renderer/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/renderer/components/ui/dialog'
import { Input } from '@/renderer/components/ui/input'
import { Label } from '@/renderer/components/ui/label'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/renderer/components/ui/select'
import { Switch } from '@/renderer/components/ui/switch'
import { unwrapResponse } from '@/renderer/features/common/ipc'
import type {
	CacheEngine,
	ConnectionDraft,
	ConnectionProfile,
	ConnectionSecret,
	NamespaceProfile,
} from '@/shared/contracts/cache'
import {
	getDefaultPortForEngine,
	isRedisFamilyEngine,
} from '@/shared/lib/cache-engines'
import { PlusIcon, SaveIcon, SearchCheck, Trash2Icon } from 'lucide-react'

const DEFAULT_TIMEOUT_MS = 5000

type ConnectionFormMode = 'create' | 'edit'

type ConnectionFormDialogProps = {
	open: boolean
	mode: ConnectionFormMode
	initialProfile?: ConnectionProfile | null
	onOpenChange: (open: boolean) => void
	onSaved: (profile: ConnectionProfile) => void
}

type FormState = {
	name: string
	engine: CacheEngine
	host: string
	port: string
	tlsEnabled: boolean
	environment: 'dev' | 'staging' | 'prod'
	tags: string
	readOnly: boolean
	forceReadOnly: boolean
	timeoutMs: string
	retryMaxAttempts: string
	retryBackoffMs: string
	retryBackoffStrategy: 'fixed' | 'exponential'
	retryAbortOnErrorRate: string
	username: string
	password: string
}

type NamespaceFormRow = {
	id?: string
	name: string
	strategy: 'redisLogicalDb' | 'keyPrefix'
	dbIndex: string
	keyPrefix: string
	originalName?: string
}

const createDefaultFormState = (): FormState => ({
	name: '',
	engine: 'redis',
	host: '127.0.0.1',
	port: String(getDefaultPortForEngine('redis')),
	tlsEnabled: false,
	environment: 'dev',
	tags: '',
	readOnly: false,
	forceReadOnly: false,
	timeoutMs: String(DEFAULT_TIMEOUT_MS),
	retryMaxAttempts: '1',
	retryBackoffMs: '250',
	retryBackoffStrategy: 'fixed',
	retryAbortOnErrorRate: '1',
	username: '',
	password: '',
})

const profileToFormState = (profile: ConnectionProfile): FormState => ({
	name: profile.name,
	engine: profile.engine,
	host: profile.host,
	port: String(profile.port),
	tlsEnabled: profile.tlsEnabled,
	environment: profile.environment,
	tags: profile.tags.join(', '),
	readOnly: profile.readOnly,
	forceReadOnly: Boolean(profile.forceReadOnly),
	timeoutMs: String(profile.timeoutMs),
	retryMaxAttempts: String(profile.retryMaxAttempts ?? 1),
	retryBackoffMs: String(profile.retryBackoffMs ?? 250),
	retryBackoffStrategy: profile.retryBackoffStrategy ?? 'fixed',
	retryAbortOnErrorRate: String(profile.retryAbortOnErrorRate ?? 1),
	username: '',
	password: '',
})

const namespaceToFormRow = (namespace: NamespaceProfile): NamespaceFormRow => ({
	id: namespace.id,
	name: namespace.name,
	strategy: namespace.strategy,
	dbIndex: String(namespace.dbIndex ?? 0),
	keyPrefix: namespace.keyPrefix ?? '',
	originalName: namespace.name,
})

export const ConnectionFormDialog = ({
	open,
	mode,
	initialProfile,
	onOpenChange,
	onSaved,
}: ConnectionFormDialogProps) => {
	const [form, setForm] = React.useState<FormState>(createDefaultFormState())
	const [namespaceRows, setNamespaceRows] = React.useState<NamespaceFormRow[]>(
		[],
	)
	const [deletedNamespaceIds, setDeletedNamespaceIds] = React.useState<string[]>(
		[],
	)
	const [isLoadingNamespaces, setIsLoadingNamespaces] = React.useState(false)
	const [isSaving, setIsSaving] = React.useState(false)
	const [isTesting, setIsTesting] = React.useState(false)

	React.useEffect(() => {
		if (!open) {
			return
		}

		setForm(
			mode === 'edit' && initialProfile
				? profileToFormState(initialProfile)
				: createDefaultFormState(),
		)
		setDeletedNamespaceIds([])
		if (mode === 'create') {
			setNamespaceRows([])
			return
		}
		if (!initialProfile) {
			setNamespaceRows([])
			return
		}

		setIsLoadingNamespaces(true)
		void window.desktopApi
			.listNamespaces({ connectionId: initialProfile.id })
			.then((response) => unwrapResponse(response))
			.then((namespaces) => {
				setNamespaceRows(namespaces.map(namespaceToFormRow))
			})
			.catch(() => {
				setNamespaceRows([])
			})
			.finally(() => setIsLoadingNamespaces(false))
	}, [mode, open, initialProfile])

	const draft = React.useMemo<ConnectionDraft>(() => {
		const parsedPort = Number(form.port)
		const parsedTimeoutMs = Number(form.timeoutMs)
		const parsedRetryMaxAttempts = Number(form.retryMaxAttempts)
		const parsedRetryBackoffMs = Number(form.retryBackoffMs)
		const parsedRetryAbortOnErrorRate = Number(form.retryAbortOnErrorRate)

		return {
			name: form.name.trim(),
			engine: form.engine,
			host: form.host.trim(),
			port: Number.isFinite(parsedPort) ? parsedPort : 0,
			tlsEnabled: form.tlsEnabled,
			environment: form.environment,
			tags: form.tags
				.split(',')
				.map((tag) => tag.trim())
				.filter(Boolean),
			readOnly: form.readOnly,
			forceReadOnly: form.forceReadOnly,
			timeoutMs: Number.isFinite(parsedTimeoutMs)
				? parsedTimeoutMs
				: DEFAULT_TIMEOUT_MS,
			retryMaxAttempts: Number.isFinite(parsedRetryMaxAttempts)
				? parsedRetryMaxAttempts
				: 1,
			retryBackoffMs: Number.isFinite(parsedRetryBackoffMs)
				? parsedRetryBackoffMs
				: 250,
			retryBackoffStrategy: form.retryBackoffStrategy,
			retryAbortOnErrorRate: Number.isFinite(parsedRetryAbortOnErrorRate)
				? parsedRetryAbortOnErrorRate
				: 1,
		}
	}, [form])

	const secret = React.useMemo<ConnectionSecret>(
		() => ({
			username: form.username.trim() || undefined,
			password: form.password || undefined,
		}),
		[form.username, form.password],
	)

	const canSave =
		draft.name.length > 0 &&
		draft.host.length > 0 &&
		Number.isInteger(draft.port) &&
		draft.port > 0

	const onFieldChange = <T extends keyof FormState>(
		key: T,
		value: FormState[T],
	): void => {
		setForm((previous) => ({
			...previous,
			[key]: value,
		}))
	}

	const addNamespaceRow = (): void => {
		setNamespaceRows((previous) => [
			...previous,
			{
				name: '',
				strategy: form.engine === 'memcached' ? 'keyPrefix' : 'redisLogicalDb',
				dbIndex: '0',
				keyPrefix: '',
			},
		])
	}

	const updateNamespaceRow = (
		index: number,
		patch: Partial<NamespaceFormRow>,
	): void => {
		setNamespaceRows((previous) =>
			previous.map((row, rowIndex) =>
				rowIndex === index
					? {
							...row,
							...patch,
						}
					: row,
			),
		)
	}

	const removeNamespaceRow = (index: number): void => {
		setNamespaceRows((previous) => {
			const row = previous[index]
			if (row?.id) {
				setDeletedNamespaceIds((existing) => [...existing, row.id as string])
			}
			return previous.filter((_row, rowIndex) => rowIndex !== index)
		})
	}

	const syncNamespaces = async (
		connectionId: string,
		engine: ConnectionProfile['engine'],
	): Promise<void> => {
		for (const namespaceId of deletedNamespaceIds) {
			unwrapResponse(await window.desktopApi.deleteNamespace({ id: namespaceId }))
		}

		for (const row of namespaceRows) {
			const normalizedName = row.name.trim()
			if (!normalizedName) {
				continue
			}

			if (row.id) {
				if (normalizedName !== (row.originalName ?? '').trim()) {
					unwrapResponse(
						await window.desktopApi.updateNamespace({
							id: row.id,
							name: normalizedName,
						}),
					)
				}
				continue
			}

			unwrapResponse(
				await window.desktopApi.createNamespace({
					namespace: {
						connectionId,
						name: normalizedName,
						strategy: engine === 'memcached' ? 'keyPrefix' : row.strategy,
						dbIndex:
							isRedisFamilyEngine(engine) && row.strategy === 'redisLogicalDb'
								? Number(row.dbIndex)
								: undefined,
						keyPrefix:
							engine === 'memcached' || row.strategy === 'keyPrefix'
								? row.keyPrefix
								: undefined,
					},
				}),
			)
		}
	}

	const handleTestConnection = async (): Promise<void> => {
		setIsTesting(true)
		try {
			const result = unwrapResponse(
				await window.desktopApi.testConnection({
					connectionId:
						mode === 'edit' && initialProfile ? initialProfile.id : undefined,
					profile: draft,
					secret,
				}),
			)

			toast.success(`Connected in ${result.latencyMs}ms`)
		} catch (error) {
			const message =
				error instanceof Error ? error.message : 'Connection test failed.'
			toast.error(message)
		} finally {
			setIsTesting(false)
		}
	}

	const handleSave = async (): Promise<void> => {
		if (!canSave) {
			toast.error('Please provide valid connection details.')
			return
		}

		setIsSaving(true)

		try {
			if (mode === 'create') {
				const profile = unwrapResponse(
					await window.desktopApi.createConnection({
						profile: draft,
						secret,
					}),
				)
				await syncNamespaces(profile.id, profile.engine)

				toast.success('Connection profile created.')
				onSaved(profile)
			} else if (initialProfile) {
				const includeSecret = Boolean(secret.username || secret.password)

				const profile = unwrapResponse(
					await window.desktopApi.updateConnection({
						id: initialProfile.id,
						profile: draft,
						secret: includeSecret ? secret : undefined,
					}),
				)
				await syncNamespaces(profile.id, profile.engine)

				toast.success('Connection profile updated.')
				onSaved(profile)
			}

			onOpenChange(false)
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Save failed.'
			toast.error(message)
		} finally {
			setIsSaving(false)
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className='sm:max-w-5xl'>
				<DialogHeader>
					<DialogTitle>
						{mode === 'create' ? 'New Connection' : 'Edit Connection'}
					</DialogTitle>
					<DialogDescription>
						{mode === 'create'
							? 'Configure Redis-family or Memcached profile settings and credentials.'
							: 'Configure profile settings. Leave credentials blank to test using the stored secret.'}
					</DialogDescription>
				</DialogHeader>

				<div className='grid gap-3 md:grid-cols-2'>
					<div className='space-y-1.5'>
						<Label htmlFor='connection-name'>Name</Label>
						<Input
							id='connection-name'
							value={form.name}
							onChange={(event) => onFieldChange('name', event.target.value)}
							placeholder='Primary Redis'
						/>
					</div>

					<div className='space-y-1.5'>
						<Label htmlFor='connection-engine'>Engine</Label>
						<Select
							value={form.engine}
							onValueChange={(value) => {
								const nextEngine = value as FormState['engine']
								onFieldChange('engine', nextEngine)
								onFieldChange('port', String(getDefaultPortForEngine(nextEngine)))
								setNamespaceRows((previous) =>
									previous.map((row) =>
										nextEngine === 'memcached'
											? {
													...row,
													strategy: 'keyPrefix',
												}
											: row,
									),
								)
							}}
						>
							<SelectTrigger id='connection-engine' className='w-full'>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value='redis'>Redis</SelectItem>
								<SelectItem value='keydb'>KeyDB</SelectItem>
								<SelectItem value='dragonfly'>Dragonfly</SelectItem>
								<SelectItem value='valkey'>Valkey</SelectItem>
								<SelectItem value='memcached'>Memcached</SelectItem>
							</SelectContent>
						</Select>
					</div>

					<div className='space-y-1.5'>
						<Label htmlFor='connection-host'>Host</Label>
						<Input
							id='connection-host'
							value={form.host}
							onChange={(event) => onFieldChange('host', event.target.value)}
							placeholder='127.0.0.1'
						/>
					</div>

					<div className='space-y-1.5'>
						<Label htmlFor='connection-port'>Port</Label>
						<Input
							id='connection-port'
							value={form.port}
							onChange={(event) => onFieldChange('port', event.target.value)}
							placeholder={String(getDefaultPortForEngine(form.engine))}
						/>
					</div>

					<div className='space-y-1.5'>
						<Label htmlFor='connection-environment'>Environment</Label>
						<Select
							value={form.environment}
							onValueChange={(value) =>
								onFieldChange(
									'environment',
									value as FormState['environment'],
								)
							}
						>
							<SelectTrigger id='connection-environment' className='w-full'>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value='dev'>dev</SelectItem>
								<SelectItem value='staging'>staging</SelectItem>
								<SelectItem value='prod'>prod</SelectItem>
							</SelectContent>
						</Select>
					</div>

					<div className='space-y-1.5'>
						<Label htmlFor='connection-timeout'>Timeout (ms)</Label>
						<Input
							id='connection-timeout'
							value={form.timeoutMs}
							onChange={(event) => onFieldChange('timeoutMs', event.target.value)}
						/>
					</div>

					<div className='space-y-1.5'>
						<Label htmlFor='connection-retry-max'>Retry max attempts</Label>
						<Input
							id='connection-retry-max'
							value={form.retryMaxAttempts}
							onChange={(event) =>
								onFieldChange('retryMaxAttempts', event.target.value)
							}
						/>
					</div>

					<div className='space-y-1.5'>
						<Label htmlFor='connection-retry-backoff'>Retry backoff (ms)</Label>
						<Input
							id='connection-retry-backoff'
							value={form.retryBackoffMs}
							onChange={(event) => onFieldChange('retryBackoffMs', event.target.value)}
						/>
					</div>

					<div className='space-y-1.5'>
						<Label htmlFor='connection-retry-strategy'>Backoff strategy</Label>
						<Select
							value={form.retryBackoffStrategy}
							onValueChange={(value) =>
								onFieldChange(
									'retryBackoffStrategy',
									value as FormState['retryBackoffStrategy'],
								)
							}
						>
							<SelectTrigger id='connection-retry-strategy' className='w-full'>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value='fixed'>fixed</SelectItem>
								<SelectItem value='exponential'>exponential</SelectItem>
							</SelectContent>
						</Select>
					</div>

					<div className='space-y-1.5'>
						<Label htmlFor='connection-retry-abort'>Abort on error rate (0-1)</Label>
						<Input
							id='connection-retry-abort'
							value={form.retryAbortOnErrorRate}
							onChange={(event) =>
								onFieldChange('retryAbortOnErrorRate', event.target.value)
							}
						/>
					</div>

					<div className='space-y-1.5'>
						<Label htmlFor='connection-tags'>Tags (comma separated)</Label>
						<Input
							id='connection-tags'
							value={form.tags}
							onChange={(event) => onFieldChange('tags', event.target.value)}
							placeholder='local, cache'
						/>
					</div>

					<div className='space-y-1.5'>
						<Label htmlFor='connection-username'>Username</Label>
						<Input
							id='connection-username'
							value={form.username}
							onChange={(event) => onFieldChange('username', event.target.value)}
							placeholder='Optional'
						/>
					</div>

					<div className='space-y-1.5'>
						<Label htmlFor='connection-password'>Password</Label>
						<Input
							id='connection-password'
							type='password'
							value={form.password}
							onChange={(event) => onFieldChange('password', event.target.value)}
							placeholder={
								mode === 'edit' ? 'Leave blank to keep current secret' : 'Optional'
							}
						/>
					</div>

					<div className='flex items-center justify-between rounded-none border p-2.5 text-xs'>
						<span>TLS</span>
						<Switch
							checked={form.tlsEnabled}
							onCheckedChange={(checked) => onFieldChange('tlsEnabled', checked)}
						/>
					</div>

					<div className='flex items-center justify-between rounded-none border p-2.5 text-xs'>
						<span>Read-only mode</span>
						<Switch
							checked={form.readOnly}
							onCheckedChange={(checked) => onFieldChange('readOnly', checked)}
						/>
					</div>

					<div className='flex items-center justify-between rounded-none border p-2.5 text-xs'>
						<span>Force read-only policy</span>
						<Switch
							checked={form.forceReadOnly}
							onCheckedChange={(checked) => onFieldChange('forceReadOnly', checked)}
						/>
					</div>
				</div>

				<div className='space-y-2 border-t pt-3'>
					<div className='flex items-center justify-between'>
						<div>
							<p className='text-sm font-medium'>Namespaces</p>
							<p className='text-muted-foreground text-xs'>
								Manage data partitions for this connection.
							</p>
						</div>
						<Button variant='outline' size='sm' onClick={addNamespaceRow}>
							<PlusIcon />
							Add Namespace
						</Button>
					</div>

					{isLoadingNamespaces && (
						<p className='text-muted-foreground text-xs'>Loading namespaces...</p>
					)}

					{namespaceRows.length === 0 && !isLoadingNamespaces && (
						<p className='text-muted-foreground text-xs'>
							No namespaces configured. All Data mode will be used by default.
						</p>
					)}

					{namespaceRows.map((row, index) => {
						const isExisting = Boolean(row.id)
						return (
							<div
								key={row.id ?? `new-${index}`}
								className='flex items-center gap-2 p-2'
							>
								<div>#{index + 1}</div>
								<Input
									value={row.name}
									onChange={(event) =>
										updateNamespaceRow(index, { name: event.target.value })
									}
									placeholder='team-a'
								/>
								<Select
									value={row.strategy}
									disabled={form.engine === 'memcached' || isExisting}
									onValueChange={(value) =>
										updateNamespaceRow(index, {
											strategy: value as 'redisLogicalDb' | 'keyPrefix',
										})
									}
								>
								<SelectTrigger className='w-full disabled:opacity-60'>
									<SelectValue />
								</SelectTrigger>
									<SelectContent>
										{isRedisFamilyEngine(form.engine) && (
											<SelectItem value='redisLogicalDb'>
												Redis Logical DB
											</SelectItem>
										)}
										<SelectItem value='keyPrefix'>Key Prefix</SelectItem>
									</SelectContent>
								</Select>
								{(form.engine === 'memcached' || row.strategy === 'keyPrefix') && (
									<Input
										value={row.keyPrefix}
										onChange={(event) =>
											updateNamespaceRow(index, {
												keyPrefix: event.target.value,
											})
										}
										disabled={isExisting}
										placeholder='tenant:'
									/>
								)}
								{isRedisFamilyEngine(form.engine) &&
									row.strategy === 'redisLogicalDb' && (
									<Input
										value={row.dbIndex}
										onChange={(event) =>
											updateNamespaceRow(index, {
												dbIndex: event.target.value,
											})
										}
										disabled={isExisting}
										placeholder='0'
									/>
								)}
								<Button
									variant='destructive'
									size='icon'
									onClick={() => removeNamespaceRow(index)}
								>
									<Trash2Icon />
								</Button>
							</div>
						)
					})}
				</div>

				<DialogFooter>
					<Button
						variant='outline'
						onClick={handleTestConnection}
						disabled={isTesting}
					>
						<SearchCheck />
						{isTesting ? 'Testing...' : 'Test Connection'}
					</Button>
					<Button onClick={handleSave} disabled={!canSave || isSaving}>
						<SaveIcon />
						{isSaving
							? 'Saving...'
							: mode === 'create'
								? 'Create Profile'
								: 'Save Changes'}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
