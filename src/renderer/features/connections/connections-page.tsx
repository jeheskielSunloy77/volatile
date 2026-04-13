import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
	ArrowRightIcon,
	DatabaseIcon,
	Edit2Icon,
	PlusIcon,
	SearchIcon,
	ServerIcon,
	Trash2Icon,
	XIcon,
} from 'lucide-react'
import * as React from 'react'
import { useNavigate } from 'react-router-dom'
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
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from '@/renderer/components/ui/card'
import { LoadingSkeletonLines } from '@/renderer/components/ui/loading-skeleton'
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from '@/renderer/components/ui/empty'
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupInput,
	InputGroupText,
} from '@/renderer/components/ui/input-group'
import { Separator } from '@/renderer/components/ui/separator'
import { isConnectionsStartupReady } from '@/renderer/app/startup-readiness'
import { useStartupGateReady } from '@/renderer/app/startup-gate'
import { unwrapResponse } from '@/renderer/features/common/ipc'
import { ConnectionFormDialog } from '@/renderer/features/connections/connection-form-dialog'
import {
	filterConnections,
	type ConnectionEngineFilter,
} from '@/renderer/features/connections/filter-connections'
import { useUiStore } from '@/renderer/state/ui-store'
import type { ConnectionProfile } from '@/shared/contracts/cache'
import { getCacheEngineLabel } from '@/shared/lib/cache-engines'

type ConnectionDialogState = {
	open: boolean
	mode: 'create' | 'edit'
	profile: ConnectionProfile | null
}

const defaultDialogState: ConnectionDialogState = {
	open: false,
	mode: 'create',
	profile: null,
}

const engineFilterOptions: Array<{
	value: ConnectionEngineFilter
	label: string
}> = [
	{ value: 'all', label: 'All' },
	{ value: 'redisFamily', label: 'Redis Family' },
	{ value: 'memcached', label: 'Memcached' },
]

const formatUpdatedAt = (value: string): string => {
	const date = new Date(value)

	if (Number.isNaN(date.getTime())) {
		return 'Updated recently'
	}

	return `Updated ${date.toLocaleDateString()}`
}

export const ConnectionsPage = () => {
	const queryClient = useQueryClient()
	const navigate = useNavigate()
	const {
		selectedConnectionId,
		setSelectedConnectionId,
		clearConnectionNamespaceSelection,
	} = useUiStore()

	const [searchText, setSearchText] = React.useState('')
	const [engineFilter, setEngineFilter] =
		React.useState<ConnectionEngineFilter>('all')
	const [connectionDialog, setConnectionDialog] =
		React.useState<ConnectionDialogState>(defaultDialogState)
	const [connectionIdPendingDelete, setConnectionIdPendingDelete] =
		React.useState<string | null>(null)

	const connectionsQuery = useQuery({
		queryKey: ['connections'],
		queryFn: async () => unwrapResponse(await window.desktopApi.listConnections()),
	})
	useStartupGateReady(
		'connections-page',
		isConnectionsStartupReady(connectionsQuery.isLoading),
	)

	const connections = connectionsQuery.data ?? []
	const filteredConnections = React.useMemo(
		() =>
			filterConnections({
				connections,
				searchText,
				engineFilter,
			}),
		[connections, engineFilter, searchText],
	)
	const hasActiveFilters =
		searchText.trim().length > 0 || engineFilter !== 'all'

	const deleteConnectionMutation = useMutation({
		mutationFn: async (connectionId: string) =>
			unwrapResponse(await window.desktopApi.deleteConnection({ id: connectionId })),
		onSuccess: async (_result, connectionId) => {
			clearConnectionNamespaceSelection(connectionId)
			if (selectedConnectionId === connectionId) {
				setSelectedConnectionId(null)
			}

			await queryClient.invalidateQueries({ queryKey: ['connections'] })
			toast.success('Connection profile deleted.')
		},
		onError: (error) => {
			toast.error(error instanceof Error ? error.message : 'Delete failed.')
		},
	})

	const openCreateConnectionDialog = (): void => {
		setConnectionDialog({
			open: true,
			mode: 'create',
			profile: null,
		})
	}

	const openEditConnectionDialog = (profile: ConnectionProfile): void => {
		setConnectionDialog({
			open: true,
			mode: 'edit',
			profile,
		})
	}

	const onConnectionSaved = async (profile: ConnectionProfile): Promise<void> => {
		const mode = connectionDialog.mode
		setSelectedConnectionId(profile.id)
		await queryClient.invalidateQueries({ queryKey: ['connections'] })

		if (mode === 'create') {
			navigate('/workspace')
		}
	}

	const openWorkspace = (connectionId: string): void => {
		setSelectedConnectionId(connectionId)
		navigate('/workspace')
	}

	const clearFilters = (): void => {
		setSearchText('')
		setEngineFilter('all')
	}

	const queryErrorMessage =
		connectionsQuery.error instanceof Error
			? connectionsQuery.error.message
			: 'Unable to load connections.'

	return (
		<div className='bg-background text-foreground h-full min-h-0 overflow-auto p-6'>
			<div className='mx-auto flex w-full max-w-5xl flex-col gap-4'>
				<Card>
					<CardHeader className='pb-3'>
						<div className='flex flex-wrap items-center justify-between gap-3'>
								<div>
									<CardTitle>Connection Management</CardTitle>
									<CardDescription>
										Manage saved Redis-family and Memcached profiles.
									</CardDescription>
								</div>
								<div className='flex items-center gap-2'>
									<Button onClick={openCreateConnectionDialog}>
										<PlusIcon className='size-3.5' />
									Add Connection
								</Button>
							</div>
						</div>
					</CardHeader>
					<CardContent className='space-y-4'>
						<Separator />
						<div className='grid gap-3 md:grid-cols-[1fr_auto] md:items-end'>
							<div className='space-y-1'>
								<p className='text-muted-foreground text-xs'>Search</p>
								<InputGroup>
									<InputGroupAddon>
										<SearchIcon className='size-3.5' />
									</InputGroupAddon>
									<InputGroupInput
										value={searchText}
										onChange={(event) => setSearchText(event.target.value)}
										placeholder='Search name, host, port, or tags'
									/>
									<InputGroupAddon align='inline-end'>
										{searchText.trim().length > 0 ? (
											<InputGroupButton
												size='icon-xs'
												onClick={() => setSearchText('')}
											>
												<XIcon className='size-3.5' />
											</InputGroupButton>
										) : (
											<InputGroupText>Search</InputGroupText>
										)}
									</InputGroupAddon>
								</InputGroup>
							</div>
							<div className='space-y-1'>
								<p className='text-muted-foreground text-xs'>Engine</p>
								<div className='flex items-center gap-2'>
									{engineFilterOptions.map((option) => (
										<Button
											key={option.value}
											variant={
												engineFilter === option.value ? 'default' : 'outline'
											}
											size='sm'
											onClick={() => setEngineFilter(option.value)}
										>
											{option.label}
										</Button>
									))}
								</div>
							</div>
						</div>
						<div className='flex flex-wrap items-center justify-between gap-2 border-t pt-3'>
							<p className='text-muted-foreground text-xs'>
								Showing {filteredConnections.length} of {connections.length}{' '}
								connection profiles
							</p>
							{hasActiveFilters && (
								<Button variant='ghost' size='xs' onClick={clearFilters}>
									Clear filters
								</Button>
							)}
						</div>
					</CardContent>
				</Card>

				{connectionsQuery.isLoading && (
					<Card>
						<CardContent className='space-y-3 p-4'>
							<LoadingSkeletonLines count={4} widths={['w-5/6', 'w-2/3', 'w-3/4', 'w-1/2']} />
						</CardContent>
					</Card>
				)}

				{connectionsQuery.isError && (
					<Card>
						<CardContent className='flex items-center justify-between gap-3 p-4'>
							<p className='text-xs text-destructive'>{queryErrorMessage}</p>
							<Button
								variant='outline'
								size='sm'
								onClick={() => {
									void connectionsQuery.refetch()
								}}
							>
								Retry
							</Button>
						</CardContent>
					</Card>
				)}

				{!connectionsQuery.isLoading && !connectionsQuery.isError && connections.length === 0 && (
					<Card>
						<CardContent className='p-6'>
							<Empty className='min-h-[260px]'>
								<EmptyHeader>
									<EmptyMedia variant='icon'>
										<DatabaseIcon className='size-4' />
									</EmptyMedia>
									<EmptyTitle>No connections yet</EmptyTitle>
									<EmptyDescription>
										Create your first Redis-family or Memcached profile to start
										using the workspace.
									</EmptyDescription>
								</EmptyHeader>
								<EmptyContent>
									<Button onClick={openCreateConnectionDialog}>
										<PlusIcon className='size-3.5' />
										Add First Connection
									</Button>
								</EmptyContent>
							</Empty>
						</CardContent>
					</Card>
				)}

				{!connectionsQuery.isLoading &&
					!connectionsQuery.isError &&
					connections.length > 0 &&
					filteredConnections.length === 0 && (
						<Card>
							<CardContent className='p-6'>
								<Empty className='min-h-[200px]'>
									<EmptyHeader>
										<EmptyTitle>No matching connections</EmptyTitle>
										<EmptyDescription>
											Try a different search query or engine filter.
										</EmptyDescription>
									</EmptyHeader>
									<EmptyContent>
										<Button variant='outline' onClick={clearFilters}>
											Clear filters
										</Button>
									</EmptyContent>
								</Empty>
							</CardContent>
						</Card>
					)}

				{!connectionsQuery.isLoading &&
					!connectionsQuery.isError &&
					filteredConnections.length > 0 && (
						<div className='grid gap-3'>
							{filteredConnections.map((connection) => {
								const isSelected = connection.id === selectedConnectionId

								return (
									<Card
										key={connection.id}
										className={isSelected ? 'border-primary bg-primary/5' : ''}
									>
										<CardContent className='flex flex-wrap items-center justify-between gap-3 p-3'>
											<div className='min-w-0 space-y-1'>
												<div className='flex items-center gap-2'>
													<ServerIcon className='size-4' />
													<p className='truncate text-sm font-medium'>
														{connection.name}
													</p>
													{isSelected && <Badge variant='default'>Selected</Badge>}
												</div>
												<p className='text-muted-foreground text-xs'>
													{connection.host}:{connection.port}
												</p>
												<p className='text-muted-foreground text-xs'>
													{formatUpdatedAt(connection.updatedAt)}
												</p>
												<div className='flex flex-wrap items-center gap-1.5'>
													<Badge variant='outline'>
														{getCacheEngineLabel(connection.engine)}
													</Badge>
													<Badge variant='outline'>{connection.environment}</Badge>
													{connection.readOnly && (
														<Badge variant='destructive'>Read-only</Badge>
													)}
													{connection.forceReadOnly && (
														<Badge variant='destructive'>Policy RO</Badge>
													)}
													{connection.tags.length === 0 && (
														<Badge variant='outline'>untagged</Badge>
													)}
												</div>
											</div>
											<div className='flex flex-wrap items-center gap-2'>
												<Button size='sm' onClick={() => openWorkspace(connection.id)}>
													<ArrowRightIcon className='size-3.5' />
													Open Workspace
												</Button>
												<Button
													variant='outline'
													size='icon-sm'
													aria-label='Edit connection'
													title='Edit connection'
													onClick={() => openEditConnectionDialog(connection)}
												>
													<Edit2Icon className='size-4' />
												</Button>
												<Button
													variant='destructive'
													size='icon-sm'
													aria-label='Delete connection'
													title='Delete connection'
													onClick={() => setConnectionIdPendingDelete(connection.id)}
												>
													<Trash2Icon className='size-4' />
												</Button>
											</div>
										</CardContent>
									</Card>
								)
							})}
						</div>
					)}
			</div>

			<ConnectionFormDialog
				open={connectionDialog.open}
				mode={connectionDialog.mode}
				initialProfile={connectionDialog.profile}
				onOpenChange={(open) =>
					setConnectionDialog((current) => ({
						...current,
						open,
					}))
				}
				onSaved={onConnectionSaved}
			/>

			<AlertDialog
				open={Boolean(connectionIdPendingDelete)}
				onOpenChange={(open) => {
					if (!open) {
						setConnectionIdPendingDelete(null)
					}
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete Connection?</AlertDialogTitle>
						<AlertDialogDescription>
							This removes the saved profile and keychain secret reference.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								if (connectionIdPendingDelete) {
									deleteConnectionMutation.mutate(connectionIdPendingDelete)
									setConnectionIdPendingDelete(null)
								}
							}}
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	)
}
