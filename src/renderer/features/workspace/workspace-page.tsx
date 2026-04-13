import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
	ActivityIcon,
	DatabaseIcon,
	PlusIcon,
	ShieldIcon,
	WorkflowIcon,
} from 'lucide-react'
import * as React from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/renderer/components/ui/alert-dialog'
import { Badge } from '@/renderer/components/ui/badge'
import { Button } from '@/renderer/components/ui/button'
import { Card, CardContent } from '@/renderer/components/ui/card'
import { Checkbox } from '@/renderer/components/ui/checkbox'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/renderer/components/ui/dialog'
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from '@/renderer/components/ui/resizable'
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from '@/renderer/components/ui/tabs'
import { isWorkspaceStartupReady } from '@/renderer/app/startup-readiness'
import { useStartupGateReady } from '@/renderer/app/startup-gate'
import { LoadingSkeletonLines } from '@/renderer/components/ui/loading-skeleton'
import {
	RendererOperationError,
	unwrapResponse,
} from '@/renderer/features/common/ipc'
import { GovernancePanel } from '@/renderer/features/governance/governance-panel'
import { ObservabilityPanel } from '@/renderer/features/observability/observability-panel'
import { WorkflowPanel } from '@/renderer/features/workflows/workflow-panel'
import { KeyDetailCard } from '@/renderer/features/workspace/key-detail-card'
import { KeyListCard } from '@/renderer/features/workspace/key-list-card'
import {
	createEmptyKeyEditorDraft,
	createKeyEditorDraftFromRecord,
	KeyUpsertDialog,
	parseKeyEditorDraftFromJson,
	serializeKeyEditorDraftToJson,
	serializeKeyEditorDraft,
	validateRawJsonForDraftKind,
	validateKeyEditorDraft,
	type KeyEditorMode,
	type KeyEditorDraft,
} from '@/renderer/features/workspace/key-upsert-dialog'
import { useIsMobile } from '@/renderer/hooks/use-mobile'
import { useUiStore } from '@/renderer/state/ui-store'
import type {
	KeyListResult,
	KeyValueRecord,
	ProviderCapabilities,
	SnapshotRecord,
} from '@/shared/contracts/cache'

const DEFAULT_PAGE_SIZE = 100
const WORKSPACE_PANEL_LAYOUT_STORAGE_KEY = 'workspace-key-panels-layout-v1'

type WorkspaceTab = 'workspace' | 'workflows' | 'observability' | 'governance'

const isWorkspaceTab = (value: string | null): value is WorkspaceTab =>
	value === 'workspace' ||
	value === 'workflows' ||
	value === 'observability' ||
	value === 'governance'

const defaultKeyListResult: KeyListResult = {
	keys: [],
	nextCursor: undefined,
}

const defaultCapabilities: ProviderCapabilities = {
	supportsTTL: true,
	supportsMonitorStream: false,
	supportsSlowLog: false,
	supportsBulkDeletePreview: false,
	supportsSnapshotRestore: false,
	supportsPatternScan: true,
}

type QueryErrorState = {
	message: string
	retryable: boolean
}

const getQueryErrorState = (error: unknown): QueryErrorState | undefined => {
	if (!error) {
		return undefined
	}

	if (error instanceof RendererOperationError) {
		return {
			message: error.message,
			retryable: Boolean(error.retryable),
		}
	}

	if (error instanceof Error) {
		return {
			message: error.message,
			retryable: false,
		}
	}

	return {
		message: 'Operation failed.',
		retryable: false,
	}
}

const readWorkspacePanelLayout = (): { left: number; right: number } => {
	if (typeof window === 'undefined') {
		return { left: 60, right: 40 }
	}

	const serializedLayout = window.localStorage.getItem(
		WORKSPACE_PANEL_LAYOUT_STORAGE_KEY,
	)
	if (!serializedLayout) {
		return { left: 60, right: 40 }
	}

	try {
		const parsed = JSON.parse(serializedLayout) as {
			left?: number
			right?: number
		}
		if (
			typeof parsed.left !== 'number' ||
			typeof parsed.right !== 'number' ||
			parsed.left <= 0 ||
			parsed.right <= 0
		) {
			return { left: 60, right: 40 }
		}

		return {
			left: parsed.left,
			right: parsed.right,
		}
	} catch {
		return { left: 60, right: 40 }
	}
}

export const WorkspacePage = () => {
	const queryClient = useQueryClient()
	const [searchParams, setSearchParams] = useSearchParams()
	const isMobile = useIsMobile()

	const {
		selectedConnectionId,
		selectedNamespaceIdByConnection,
		selectedKey,
		setSelectedConnectionId,
		setSelectedKey,
	} = useUiStore()
	const selectedNamespaceId = selectedConnectionId
		? (selectedNamespaceIdByConnection[selectedConnectionId] ?? null)
		: null

	const rawTab = searchParams.get('tab')
	const activeTab: WorkspaceTab = isWorkspaceTab(rawTab) ? rawTab : 'workspace'
	const [keyPendingDelete, setKeyPendingDelete] = React.useState<string | null>(
		null,
	)
	const [prodDeleteConfirmed, setProdDeleteConfirmed] = React.useState(false)

	const [isRollbackOpen, setIsRollbackOpen] = React.useState(false)
	const [prodRollbackConfirmed, setProdRollbackConfirmed] = React.useState(false)

	const [searchPattern, setSearchPattern] = React.useState('')
	const [cursor, setCursor] = React.useState<string | undefined>(undefined)

	const [isUpsertOpen, setIsUpsertOpen] = React.useState(false)
	const [upsertMode, setUpsertMode] = React.useState<'create' | 'edit'>('create')
	const [upsertTargetKey, setUpsertTargetKey] = React.useState<string | null>(
		null,
	)
	const [upsertPrefilledForKey, setUpsertPrefilledForKey] = React.useState<
		string | null
	>(null)
	const [upsertKeyName, setUpsertKeyName] = React.useState('')
	const [upsertDraft, setUpsertDraft] = React.useState<KeyEditorDraft>(
		createEmptyKeyEditorDraft(),
	)
	const [upsertEditorMode, setUpsertEditorMode] =
		React.useState<KeyEditorMode>('json')
	const [upsertRawJsonValue, setUpsertRawJsonValue] = React.useState('')
	const [upsertTtlSeconds, setUpsertTtlSeconds] = React.useState('')
	const [workspacePanelLayout, setWorkspacePanelLayout] = React.useState(
		readWorkspacePanelLayout,
	)

	const openCreateKeyModal = React.useCallback(() => {
		setUpsertMode('create')
		setUpsertTargetKey(null)
		setUpsertPrefilledForKey(null)
		setUpsertKeyName('')
		const nextDraft = createEmptyKeyEditorDraft()
		setUpsertDraft(nextDraft)
		setUpsertEditorMode('json')
		setUpsertRawJsonValue(serializeKeyEditorDraftToJson(nextDraft))
		setUpsertTtlSeconds('')
		setIsUpsertOpen(true)
	}, [])

	const openEditKeyModal = React.useCallback(
		(
			key: string,
			keyDetailData?: KeyValueRecord,
			preloadedForKey?: string | null,
		) => {
			setSelectedKey(key)
			setUpsertMode('edit')
			setUpsertTargetKey(key)
			setUpsertPrefilledForKey(null)

			if (preloadedForKey === key && keyDetailData) {
				const nextDraft = createKeyEditorDraftFromRecord(keyDetailData)
				setUpsertKeyName(key)
				setUpsertDraft(nextDraft)
				setUpsertEditorMode('json')
				setUpsertRawJsonValue(serializeKeyEditorDraftToJson(nextDraft))
				setUpsertTtlSeconds(
					keyDetailData.ttlSeconds === null ? '' : String(keyDetailData.ttlSeconds),
				)
				setUpsertPrefilledForKey(key)
			}

			setIsUpsertOpen(true)
		},
		[setSelectedKey],
	)

	React.useEffect(() => {
		if (isWorkspaceTab(rawTab)) {
			return
		}

		const nextSearchParams = new URLSearchParams(searchParams)
		nextSearchParams.set('tab', 'workspace')
		setSearchParams(nextSearchParams, { replace: true })
	}, [rawTab, searchParams, setSearchParams])

	const connectionsQuery = useQuery({
		queryKey: ['connections'],
		queryFn: async () => unwrapResponse(await window.desktopApi.listConnections()),
	})

	const connections = connectionsQuery.data ?? []

	const selectedConnection = React.useMemo(
		() =>
			connections.find((connection) => connection.id === selectedConnectionId) ??
			null,
		[connections, selectedConnectionId],
	)
	const isSelectedConnectionReadOnly = Boolean(
		selectedConnection?.readOnly || selectedConnection?.forceReadOnly,
	)

	React.useEffect(() => {
		if (connections.length === 0) {
			setSelectedConnectionId(null)
			return
		}

		if (
			!selectedConnectionId ||
			!connections.some((connection) => connection.id === selectedConnectionId)
		) {
			setSelectedConnectionId(connections[0].id)
		}
	}, [connections, selectedConnectionId, setSelectedConnectionId])

	React.useEffect(() => {
		setCursor(undefined)
		setSearchPattern('')
		setSelectedKey(null)
		setIsUpsertOpen(false)
		setUpsertPrefilledForKey(null)
	}, [selectedConnectionId, selectedNamespaceId, setSelectedKey])

	const namespacesQuery = useQuery({
		queryKey: ['workspace-namespaces', selectedConnectionId],
		enabled: Boolean(selectedConnectionId),
		queryFn: async () => {
			if (!selectedConnectionId) {
				return []
			}

			return unwrapResponse(
				await window.desktopApi.listNamespaces({
					connectionId: selectedConnectionId,
				}),
			)
		},
	})

	const keyPrefixNamespaces = React.useMemo(() => {
		if (selectedNamespaceId) {
			return []
		}

		return (namespacesQuery.data ?? [])
			.filter(
				(namespace) =>
					namespace.strategy === 'keyPrefix' &&
					typeof namespace.keyPrefix === 'string' &&
					namespace.keyPrefix.length > 0,
			)
			.sort(
				(left, right) =>
					(right.keyPrefix?.length ?? 0) - (left.keyPrefix?.length ?? 0),
			)
	}, [namespacesQuery.data, selectedNamespaceId])

	const resolveNamespaceBadge = React.useCallback(
		(key: string): string | undefined => {
			for (const namespace of keyPrefixNamespaces) {
				const prefix = namespace.keyPrefix ?? ''
				if (prefix.length > 0 && key.startsWith(prefix)) {
					return namespace.name
				}
			}

			return undefined
		},
		[keyPrefixNamespaces],
	)

	const capabilitiesQuery = useQuery({
		queryKey: ['capabilities', selectedConnectionId],
		enabled: Boolean(selectedConnectionId),
		queryFn: async () => {
			if (!selectedConnectionId) {
				throw new Error('Connection is required to load capabilities.')
			}

			return unwrapResponse(
				await window.desktopApi.getCapabilities({
					connectionId: selectedConnectionId,
				}),
			)
		},
	})

	const capabilities = capabilitiesQuery.data ?? defaultCapabilities
	const trimmedSearchPattern = searchPattern.trim()

	const keyListQuery = useQuery({
		queryKey: [
			'keys',
			selectedConnectionId,
			selectedNamespaceId,
			trimmedSearchPattern,
			cursor,
		],
		enabled: Boolean(selectedConnectionId),
		queryFn: async () => {
			if (!selectedConnectionId) {
				return defaultKeyListResult
			}

			if (trimmedSearchPattern.length > 0) {
				return unwrapResponse(
					await window.desktopApi.searchKeys({
						connectionId: selectedConnectionId,
						namespaceId: selectedNamespaceId ?? undefined,
						pattern: trimmedSearchPattern,
						cursor,
						limit: DEFAULT_PAGE_SIZE,
					}),
				)
			}

			return unwrapResponse(
				await window.desktopApi.listKeys({
					connectionId: selectedConnectionId,
					namespaceId: selectedNamespaceId ?? undefined,
					cursor,
					limit: DEFAULT_PAGE_SIZE,
				}),
			)
		},
	})

	const keyCountQuery = useQuery({
		queryKey: [
			'key-count',
			selectedConnectionId,
			selectedNamespaceId,
			trimmedSearchPattern,
		],
		enabled: Boolean(selectedConnectionId),
		queryFn: async () => {
			if (!selectedConnectionId) {
				return {
					totalKeys: 0,
				}
			}

			return unwrapResponse(
				await window.desktopApi.countKeys({
					connectionId: selectedConnectionId,
					namespaceId: selectedNamespaceId ?? undefined,
					pattern: trimmedSearchPattern || undefined,
				}),
			)
		},
	})

	const keyList = keyListQuery.data ?? defaultKeyListResult

	const keyDetailQuery = useQuery({
		queryKey: ['key', selectedConnectionId, selectedNamespaceId, selectedKey],
		enabled: Boolean(selectedConnectionId && selectedKey),
		queryFn: async (): Promise<KeyValueRecord> => {
			if (!selectedConnectionId || !selectedKey) {
				throw new Error('Connection and key are required to load key detail.')
			}

			return unwrapResponse(
				await window.desktopApi.getKey({
					connectionId: selectedConnectionId,
					namespaceId: selectedNamespaceId ?? undefined,
					key: selectedKey,
				}),
			)
		},
	})
	const selectedKeyType = keyDetailQuery.data?.keyType

	React.useEffect(() => {
		if (!isUpsertOpen || upsertMode !== 'edit' || !upsertTargetKey) {
			return
		}

		if (upsertPrefilledForKey === upsertTargetKey) {
			return
		}

		if (selectedKey !== upsertTargetKey || !keyDetailQuery.data) {
			return
		}

		setUpsertKeyName(upsertTargetKey)
		const nextDraft = createKeyEditorDraftFromRecord(keyDetailQuery.data)
		setUpsertDraft(nextDraft)
		setUpsertRawJsonValue(serializeKeyEditorDraftToJson(nextDraft))
		setUpsertTtlSeconds(
			keyDetailQuery.data.ttlSeconds === null
				? ''
				: String(keyDetailQuery.data.ttlSeconds),
		)
		setUpsertPrefilledForKey(upsertTargetKey)
	}, [
		isUpsertOpen,
		upsertMode,
		upsertTargetKey,
		upsertPrefilledForKey,
		selectedKey,
		keyDetailQuery.data,
	])

	const snapshotsQuery = useQuery({
		queryKey: [
			'snapshots',
			selectedConnectionId,
			selectedNamespaceId,
			selectedKey,
		],
		enabled: Boolean(selectedConnectionId && selectedKey && isRollbackOpen),
		queryFn: async (): Promise<SnapshotRecord[]> => {
			if (!selectedConnectionId || !selectedKey) {
				return []
			}

			return unwrapResponse(
				await window.desktopApi.listSnapshots({
					connectionId: selectedConnectionId,
					namespaceId: selectedNamespaceId ?? undefined,
					key: selectedKey,
					limit: 25,
				}),
			)
		},
	})

	const capabilitiesError = getQueryErrorState(capabilitiesQuery.error)
	const keyListError = getQueryErrorState(keyListQuery.error)
	const keyDetailError = getQueryErrorState(keyDetailQuery.error)
	const isStartupReady = isWorkspaceStartupReady({
		connectionsLoading: connectionsQuery.isLoading,
		connectionsCount: connections.length,
		selectedConnectionId,
		hasSelectedConnection: Boolean(selectedConnection),
		namespacesLoading: namespacesQuery.isLoading,
		capabilitiesLoading: capabilitiesQuery.isLoading,
		keyListLoading: keyListQuery.isLoading,
		keyCountLoading: keyCountQuery.isLoading,
	})
	useStartupGateReady('workspace-page', isStartupReady)

	const lastQueryErrorToastRef = React.useRef({
		capabilities: 0,
		keyList: 0,
		keyDetail: 0,
	})

	React.useEffect(() => {
		if (!capabilitiesError || capabilitiesQuery.errorUpdatedAt === 0) {
			return
		}

		if (
			lastQueryErrorToastRef.current.capabilities ===
			capabilitiesQuery.errorUpdatedAt
		) {
			return
		}

		lastQueryErrorToastRef.current.capabilities = capabilitiesQuery.errorUpdatedAt
		toast.error(capabilitiesError.message)
	}, [capabilitiesError, capabilitiesQuery.errorUpdatedAt])

	React.useEffect(() => {
		if (!keyListError || keyListQuery.errorUpdatedAt === 0) {
			return
		}

		if (lastQueryErrorToastRef.current.keyList === keyListQuery.errorUpdatedAt) {
			return
		}

		lastQueryErrorToastRef.current.keyList = keyListQuery.errorUpdatedAt
		toast.error(keyListError.message)
	}, [keyListError, keyListQuery.errorUpdatedAt])

	React.useEffect(() => {
		if (!keyDetailError || keyDetailQuery.errorUpdatedAt === 0) {
			return
		}

		if (
			lastQueryErrorToastRef.current.keyDetail === keyDetailQuery.errorUpdatedAt
		) {
			return
		}

		lastQueryErrorToastRef.current.keyDetail = keyDetailQuery.errorUpdatedAt
		toast.error(keyDetailError.message)
	}, [keyDetailError, keyDetailQuery.errorUpdatedAt])

	const saveKeyMutation = useMutation({
		mutationFn: async () => {
			if (!selectedConnectionId) {
				throw new Error('Select a connection first.')
			}

			const normalizedKey = upsertKeyName.trim()
			if (!normalizedKey) {
				throw new Error('Key name is required.')
			}

			const ttl = Number(upsertTtlSeconds)
			const ttlSeconds =
				upsertTtlSeconds.trim().length > 0 && Number.isFinite(ttl) && ttl > 0
					? ttl
					: undefined
			const effectiveDraft =
				upsertEditorMode === 'json'
					? parseKeyEditorDraftFromJson(upsertDraft.kind, upsertRawJsonValue)
					: upsertDraft
			const validationMessage =
				upsertEditorMode === 'json'
					? validateRawJsonForDraftKind(upsertDraft.kind, upsertRawJsonValue)
					: validateKeyEditorDraft(upsertDraft)
			if (validationMessage) {
				throw new Error(validationMessage)
			}

			if (upsertMode === 'edit' && upsertTargetKey) {
				return unwrapResponse(
					await window.desktopApi.updateKey({
						connectionId: selectedConnectionId,
						namespaceId: selectedNamespaceId ?? undefined,
						currentKey: upsertTargetKey,
						key: normalizedKey,
						value: serializeKeyEditorDraft(effectiveDraft),
						ttlSeconds,
					}),
				)
			}

			return unwrapResponse(
				await window.desktopApi.setKey({
					connectionId: selectedConnectionId,
					namespaceId: selectedNamespaceId ?? undefined,
					key: normalizedKey,
					value: serializeKeyEditorDraft(effectiveDraft),
					ttlSeconds,
				}),
			)
		},
		onSuccess: async () => {
			const normalizedKey = upsertKeyName.trim()
			toast.success('Key saved.')
			await queryClient.invalidateQueries({
				queryKey: ['keys', selectedConnectionId, selectedNamespaceId],
			})
			await queryClient.invalidateQueries({
				queryKey: ['key-count', selectedConnectionId, selectedNamespaceId],
			})
			await queryClient.invalidateQueries({
				queryKey: ['key', selectedConnectionId, selectedNamespaceId, normalizedKey],
			})
			await queryClient.invalidateQueries({ queryKey: ['alerts'] })
			await queryClient.invalidateQueries({
				queryKey: [
					'observability-dashboard',
					selectedConnectionId,
					selectedNamespaceId,
				],
			})
			setSelectedKey(normalizedKey)
			setIsUpsertOpen(false)
			setUpsertPrefilledForKey(null)
			setUpsertEditorMode('json')
		},
		onError: (error) => {
			toast.error(error instanceof Error ? error.message : 'Save failed.')
		},
	})

	const deleteKeyMutation = useMutation({
		mutationFn: async (args: { key: string; guardrailConfirmed?: boolean }) => {
			if (!selectedConnectionId) {
				throw new Error('Select a connection first.')
			}

			return unwrapResponse(
				await window.desktopApi.deleteKey({
					connectionId: selectedConnectionId,
					namespaceId: selectedNamespaceId ?? undefined,
					key: args.key,
					guardrailConfirmed: args.guardrailConfirmed,
				}),
			)
		},
		onSuccess: async (_result, args) => {
			toast.success('Key deleted.')
			await queryClient.invalidateQueries({
				queryKey: ['keys', selectedConnectionId, selectedNamespaceId],
			})
			await queryClient.invalidateQueries({
				queryKey: ['key-count', selectedConnectionId, selectedNamespaceId],
			})
			await queryClient.invalidateQueries({ queryKey: ['alerts'] })
			await queryClient.invalidateQueries({
				queryKey: [
					'observability-dashboard',
					selectedConnectionId,
					selectedNamespaceId,
				],
			})
			if (selectedKey === args.key) {
				setSelectedKey(null)
			}
		},
		onError: (error) => {
			toast.error(error instanceof Error ? error.message : 'Delete failed.')
		},
	})

	const restoreSnapshotMutation = useMutation({
		mutationFn: async (snapshotId?: string) => {
			if (!selectedConnectionId || !selectedKey) {
				throw new Error('Select a key first.')
			}

			return unwrapResponse(
				await window.desktopApi.restoreSnapshot({
					connectionId: selectedConnectionId,
					namespaceId: selectedNamespaceId ?? undefined,
					key: selectedKey,
					snapshotId,
					guardrailConfirmed: prodRollbackConfirmed,
				}),
			)
		},
		onSuccess: async () => {
			toast.success('Snapshot restored.')
			await queryClient.invalidateQueries({
				queryKey: ['key', selectedConnectionId, selectedNamespaceId, selectedKey],
			})
			await queryClient.invalidateQueries({ queryKey: ['alerts'] })
			await queryClient.invalidateQueries({
				queryKey: [
					'observability-dashboard',
					selectedConnectionId,
					selectedNamespaceId,
				],
			})
			setIsRollbackOpen(false)
		},
		onError: (error) => {
			toast.error(error instanceof Error ? error.message : 'Rollback failed.')
		},
	})

	if (!connectionsQuery.isLoading && connections.length === 0) {
		return <Navigate to='/connections' replace />
	}

	return (
		<div className='bg-background text-foreground h-full min-h-0 overflow-hidden p-4'>
			{connectionsQuery.isLoading ? (
				<div className='grid h-full place-items-center'>
					<Card>
						<CardContent className='space-y-3 p-6'>
					<LoadingSkeletonLines count={3} widths={['w-1/2', 'w-2/3', 'w-1/3']} />
				</CardContent>
			</Card>
		</div>
			) : selectedConnection ? (
				<div className='grid h-full min-h-0 gap-3'>
					{capabilitiesError && activeTab === 'workspace' && (
						<Card>
							<CardContent className='flex items-center justify-between gap-3 p-3'>
								<div className='text-xs'>
									<p className='text-destructive font-medium'>
										Unable to load provider capabilities.
									</p>
									<p className='text-muted-foreground'>{capabilitiesError.message}</p>
								</div>
								{capabilitiesError.retryable && (
									<Button
										variant='outline'
										size='sm'
										onClick={() => {
											void capabilitiesQuery.refetch()
										}}
									>
										Retry
									</Button>
								)}
							</CardContent>
						</Card>
					)}

					<Tabs
						value={activeTab}
						onValueChange={(value) => {
							const nextTab = value as WorkspaceTab
							const nextSearchParams = new URLSearchParams(searchParams)
							nextSearchParams.set('tab', nextTab)
							setSearchParams(nextSearchParams, { replace: true })
						}}
						className='grid min-h-0 grid-rows-[auto_1fr] gap-3'
					>
						<div className='flex items-center justify-between gap-2'>
							<TabsList>
								<TabsTrigger value='workspace'>
									<DatabaseIcon className='size-3.5' />
									Workspace
								</TabsTrigger>
								<TabsTrigger value='workflows'>
									<WorkflowIcon className='size-3.5' />
									Workflows
								</TabsTrigger>
								<TabsTrigger value='observability'>
									<ActivityIcon className='size-3.5' />
									Observability
								</TabsTrigger>
								<TabsTrigger value='governance'>
									<ShieldIcon className='size-3.5' />
									Governance
								</TabsTrigger>
							</TabsList>
							<Button
								size='sm'
								onClick={openCreateKeyModal}
								disabled={isSelectedConnectionReadOnly}
							>
								<PlusIcon className='size-3.5' />
								New Key
							</Button>
						</div>

						<TabsContent value='workspace' className='min-h-0'>
							<ResizablePanelGroup
								orientation={isMobile ? 'vertical' : 'horizontal'}
								defaultLayout={{
									keyBrowser: workspacePanelLayout.left,
									keyDetail: workspacePanelLayout.right,
								}}
								onLayoutChanged={(layout) => {
									const nextLayout = {
										left: typeof layout.keyBrowser === 'number' ? layout.keyBrowser : 75,
										right: typeof layout.keyDetail === 'number' ? layout.keyDetail : 25,
									}

									setWorkspacePanelLayout(nextLayout)
									window.localStorage.setItem(
										WORKSPACE_PANEL_LAYOUT_STORAGE_KEY,
										JSON.stringify(nextLayout),
									)
								}}
								className='h-full min-h-0'
							>
								<ResizablePanel
									id='keyBrowser'
									minSize={isMobile ? 35 : 30}
									className='min-h-0'
								>
									<KeyListCard
										title='Key Browser'
										keys={keyList.keys}
										selectedKey={selectedKey}
										searchPattern={searchPattern}
										isLoading={keyListQuery.isLoading}
										errorMessage={keyListError?.message}
										isRetryableError={keyListError?.retryable}
										readOnly={isSelectedConnectionReadOnly}
										hasNextPage={Boolean(keyList.nextCursor)}
										totalKeys={keyCountQuery.data?.totalKeys}
										totalFoundKeys={keyCountQuery.data?.totalFoundKeys}
										isCountLoading={keyCountQuery.isLoading}
										getNamespaceBadge={
											selectedNamespaceId ? undefined : resolveNamespaceBadge
										}
										onSearchPatternChange={(value) => {
											setSearchPattern(value)
											setCursor(undefined)
										}}
										onSelectKey={(key) => setSelectedKey(key)}
										onEditKey={(key) =>
											openEditKeyModal(key, keyDetailQuery.data, selectedKey)
										}
										onDeleteKey={(key) => {
											setProdDeleteConfirmed(false)
											setKeyPendingDelete(key)
										}}
										onRefresh={() =>
											toast.promise(
												queryClient.invalidateQueries(
													{
														queryKey: ['keys', selectedConnectionId, selectedNamespaceId],
													},
													{ throwOnError: true },
												),
												{
													loading: 'Refreshing keys...',
													success: 'Keys refreshed.',
													error: 'Failed to refresh keys.',
												},
											)
										}
										onRetry={() => {
											void keyListQuery.refetch()
										}}
										onLoadNextPage={() => setCursor(keyList.nextCursor)}
									/>
								</ResizablePanel>

								<ResizableHandle withHandle />

								<ResizablePanel
									id='keyDetail'
									minSize={isMobile ? 25 : 20}
									className='min-h-0'
								>
									<KeyDetailCard
										keyName={selectedKey}
										value={keyDetailQuery.data?.value ?? null}
										ttlSeconds={keyDetailQuery.data?.ttlSeconds ?? null}
										keyType={selectedKeyType}
										readOnly={isSelectedConnectionReadOnly}
										supportsTTL={capabilities.supportsTTL}
										isLoading={Boolean(selectedKey) && keyDetailQuery.isLoading}
										errorMessage={keyDetailError?.message}
										isRetryableError={keyDetailError?.retryable}
										canRollback={Boolean(selectedKey)}
										onRollback={() => {
											setProdRollbackConfirmed(false)
											setIsRollbackOpen(true)
										}}
										onRetry={() => {
											void keyDetailQuery.refetch()
										}}
										onEdit={() => {
											if (!selectedKey) {
												return
											}

											openEditKeyModal(selectedKey, keyDetailQuery.data, selectedKey)
										}}
										onDelete={() => {
											if (selectedKey) {
												setProdDeleteConfirmed(false)
												setKeyPendingDelete(selectedKey)
											}
										}}
									/>
								</ResizablePanel>
							</ResizablePanelGroup>
						</TabsContent>

						<TabsContent value='workflows' className='min-h-0 overflow-auto'>
							<WorkflowPanel connection={selectedConnection} mode='connection' />
						</TabsContent>

						<TabsContent value='observability' className='min-h-0 overflow-auto'>
							<ObservabilityPanel connection={selectedConnection} mode='connection' />
						</TabsContent>

						<TabsContent value='governance' className='min-h-0 overflow-auto'>
							<GovernancePanel connection={selectedConnection} mode='connection' />
						</TabsContent>
					</Tabs>
				</div>
			) : (
				<div className='grid h-full place-items-center'>
					<Card>
						<CardContent className='p-6 text-xs'>
							Select a connection profile to continue.
						</CardContent>
					</Card>
				</div>
			)}

			<KeyUpsertDialog
				open={isUpsertOpen}
				mode={upsertMode}
				readOnly={isSelectedConnectionReadOnly}
				supportsTTL={capabilities.supportsTTL}
				isRedisConnection={Boolean(
					selectedConnection && selectedConnection.engine !== 'memcached',
				)}
				isLoading={
					upsertMode === 'edit' &&
					Boolean(upsertTargetKey) &&
					upsertPrefilledForKey !== upsertTargetKey &&
					!keyDetailError
				}
				isSaving={saveKeyMutation.isPending}
				errorMessage={
					upsertMode === 'edit' &&
					selectedKey === upsertTargetKey &&
					upsertPrefilledForKey !== upsertTargetKey
						? keyDetailError?.message
						: undefined
				}
				isRetryableError={keyDetailError?.retryable}
				keyName={upsertKeyName}
				draft={upsertDraft}
				editorMode={upsertEditorMode}
				rawJsonValue={upsertRawJsonValue}
				validationMessage={
					upsertEditorMode === 'json'
						? validateRawJsonForDraftKind(upsertDraft.kind, upsertRawJsonValue)
						: validateKeyEditorDraft(upsertDraft)
				}
				ttlSeconds={upsertTtlSeconds}
				onOpenChange={(open) => {
					setIsUpsertOpen(open)
					if (!open) {
						setUpsertPrefilledForKey(null)
						setUpsertEditorMode('json')
					}
				}}
				onKeyNameChange={setUpsertKeyName}
				onDraftChange={(draft) => {
					setUpsertDraft(draft)
					if (upsertEditorMode === 'json') {
						setUpsertRawJsonValue(serializeKeyEditorDraftToJson(draft))
					}
				}}
				onEditorModeChange={(mode) => {
					if (mode === upsertEditorMode) {
						return
					}

					if (mode === 'json') {
						setUpsertRawJsonValue(serializeKeyEditorDraftToJson(upsertDraft))
						setUpsertEditorMode('json')
						return
					}

					const validationMessage = validateRawJsonForDraftKind(
						upsertDraft.kind,
						upsertRawJsonValue,
					)
					if (validationMessage) {
						toast.error(validationMessage)
						return
					}

					try {
						setUpsertDraft(
							parseKeyEditorDraftFromJson(upsertDraft.kind, upsertRawJsonValue),
						)
						setUpsertEditorMode('structured')
					} catch (error) {
						toast.error(
							error instanceof Error ? error.message : 'Invalid raw JSON.',
						)
					}
				}}
				onRawJsonValueChange={setUpsertRawJsonValue}
				onTtlChange={setUpsertTtlSeconds}
				onRetry={() => {
					void keyDetailQuery.refetch()
				}}
				onSave={() => saveKeyMutation.mutate()}
			/>

			<AlertDialog
				open={Boolean(keyPendingDelete)}
				onOpenChange={(open) => {
					if (!open) {
						setKeyPendingDelete(null)
						setProdDeleteConfirmed(false)
					}
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete Key?</AlertDialogTitle>
						<AlertDialogDescription>
							This action cannot be undone and immediately removes the key.
						</AlertDialogDescription>
					</AlertDialogHeader>
					{selectedConnection?.environment === 'prod' && (
						<label className='flex items-center gap-2 text-xs text-destructive'>
							<Checkbox
								checked={prodDeleteConfirmed}
								onCheckedChange={(checked) => setProdDeleteConfirmed(Boolean(checked))}
							/>
							Confirm destructive action on prod connection
						</label>
					)}
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								if (keyPendingDelete) {
									deleteKeyMutation.mutate({
										key: keyPendingDelete,
										guardrailConfirmed: prodDeleteConfirmed,
									})
									setKeyPendingDelete(null)
									setProdDeleteConfirmed(false)
								}
							}}
							disabled={
								selectedConnection?.environment === 'prod' && !prodDeleteConfirmed
							}
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			<Dialog open={isRollbackOpen} onOpenChange={setIsRollbackOpen}>
				<DialogContent className='max-w-2xl'>
					<DialogHeader>
						<DialogTitle>Rollback Helper</DialogTitle>
						<DialogDescription>
							Restore a recent snapshot for the selected key.
						</DialogDescription>
					</DialogHeader>

					{selectedConnection?.environment === 'prod' && (
						<label className='flex items-center gap-2 text-xs text-destructive'>
							<Checkbox
								checked={prodRollbackConfirmed}
								onCheckedChange={(checked) =>
									setProdRollbackConfirmed(Boolean(checked))
								}
							/>
							Confirm rollback on prod connection
						</label>
					)}

					<div className='max-h-72 space-y-2 overflow-auto'>
						{snapshotsQuery.isLoading ? (
							<div className='space-y-2'>
								<LoadingSkeletonLines
									count={4}
									widths={['w-1/3', 'w-1/2', 'w-2/3', 'w-1/4']}
								/>
							</div>
						) : (snapshotsQuery.data?.length ?? 0) === 0 ? (
							<p className='text-muted-foreground text-xs'>
								No snapshots were found for this key.
							</p>
						) : (
							snapshotsQuery.data?.map((snapshot) => (
								<div key={snapshot.id} className='space-y-2 border p-2 text-xs'>
									<div className='flex items-center justify-between gap-2'>
										<div>
											<p className='font-medium'>{snapshot.key}</p>
											<p className='text-muted-foreground'>
												{new Date(snapshot.capturedAt).toLocaleString()}
											</p>
										</div>
										<Badge variant='outline'>{snapshot.reason}</Badge>
									</div>
									<div className='text-muted-foreground'>
										<p>TTL: {snapshot.ttlSeconds ?? '-'}</p>
										<p className='break-all'>hash: {snapshot.redactedValueHash}</p>
									</div>
									<Button
										size='sm'
										variant='outline'
										onClick={() => restoreSnapshotMutation.mutate(snapshot.id)}
										disabled={
											restoreSnapshotMutation.isPending ||
											(selectedConnection?.environment === 'prod' &&
												!prodRollbackConfirmed)
										}
									>
										Restore Snapshot
									</Button>
								</div>
							))
						)}
					</div>
				</DialogContent>
			</Dialog>
		</div>
	)
}
