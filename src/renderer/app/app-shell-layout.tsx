import { useQuery } from '@tanstack/react-query'
import {
	ActivityIcon,
	ChevronDownIcon,
	DatabaseIcon,
	GaugeIcon,
	ServerIcon,
	Settings2Icon,
	ShieldIcon,
	WorkflowIcon,
} from 'lucide-react'
import * as React from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'

import { Badge } from '@/renderer/components/ui/badge'
import { Button } from '@/renderer/components/ui/button'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu'
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarInset,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarProvider,
	SidebarRail,
	SidebarSeparator,
	SidebarTrigger,
} from '@/renderer/components/ui/sidebar'
import { useStartupGateReady } from '@/renderer/app/startup-gate'
import { AlertsNavbarPopover } from '@/renderer/features/alerts/alerts-navbar-popover'
import { unwrapResponse } from '@/renderer/features/common/ipc'
import { useUiStore } from '@/renderer/state/ui-store'
import { LogoWordmark } from '../components/logos'

type NavItem = {
	label: string
	path: string
	icon: React.ComponentType<{ className?: string }>
}

const workspaceItem: NavItem = {
	label: 'Workspace',
	path: '/workspace?tab=workspace',
	icon: ServerIcon,
}

const globalItems: NavItem[] = [
	{
		label: 'Workflow Templates',
		path: '/global/workflow-templates',
		icon: WorkflowIcon,
	},
	{
		label: 'Incident Bundles',
		path: '/global/incident-bundles',
		icon: ActivityIcon,
	},
	{
		label: 'Governance Admin',
		path: '/global/governance-admin',
		icon: ShieldIcon,
	},
]

const managementItems: NavItem[] = [
	{ label: 'Connections', path: '/connections', icon: DatabaseIcon },
]

const getPageTitle = (pathname: string): string => {
	if (pathname === '/connections') {
		return 'Connections'
	}
	if (pathname === '/global/alerts') {
		return 'Alerts'
	}
	if (pathname === '/global/workflow-templates') {
		return 'Workflow Templates'
	}
	if (pathname === '/global/incident-bundles') {
		return 'Incident Bundles'
	}
	if (pathname === '/global/governance-admin') {
		return 'Governance Admin'
	}
	if (pathname === '/workspace') {
		return 'Workspace'
	}

	return 'Volatile'
}

const isActivePath = (currentPath: string, targetPath: string): boolean => {
	const [baseTargetPath] = targetPath.split('?')

	if (baseTargetPath === '/workspace') {
		return currentPath === '/workspace'
	}

	return currentPath === baseTargetPath
}

const NavMenu = ({
	items,
	currentPath,
	onNavigate,
}: {
	items: NavItem[]
	currentPath: string
	onNavigate: (path: string) => void
}) => {
	return (
		<SidebarMenu>
			{items.map((item) => {
				const Icon = item.icon

				return (
					<SidebarMenuItem key={item.path}>
						<SidebarMenuButton
							isActive={isActivePath(currentPath, item.path)}
							onClick={() => onNavigate(item.path)}
						>
							<Icon className='size-4' />
							<span>{item.label}</span>
						</SidebarMenuButton>
					</SidebarMenuItem>
				)
			})}
		</SidebarMenu>
	)
}
export const AppShellLayout = () => {
	const navigate = useNavigate()
	const location = useLocation()
	const {
		selectedConnectionId,
		selectedNamespaceIdByConnection,
		setSelectedConnectionId,
		setSelectedNamespaceId,
		setSettingsOpen,
	} = useUiStore()

	const connectionsQuery = useQuery({
		queryKey: ['connections'],
		queryFn: async () =>
			unwrapResponse(await window.desktopApi.listConnections()),
	})
	useStartupGateReady('app-shell', !connectionsQuery.isLoading)

	const connections = connectionsQuery.data ?? []
	const selectedConnection = React.useMemo(
		() =>
			connections.find((connection) => connection.id === selectedConnectionId) ??
			null,
		[connections, selectedConnectionId],
	)
	const selectedNamespaceId = selectedConnectionId
		? (selectedNamespaceIdByConnection[selectedConnectionId] ?? null)
		: null

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

	const selectedConnectionNamespacesQuery = useQuery({
		queryKey: ['namespaces', selectedConnectionId],
		enabled: Boolean(selectedConnectionId),
		queryFn: async () =>
			unwrapResponse(
				await window.desktopApi.listNamespaces({
					connectionId: selectedConnectionId ?? '',
				}),
			),
	})

	const allNamespacesQuery = useQuery({
		queryKey: [
			'namespaces-by-connection',
			connections.map((c) => c.id).join(','),
		],
		enabled: connections.length > 0,
		queryFn: async () => {
			const entries = await Promise.all(
				connections.map(async (connection) => {
					const namespaces = unwrapResponse(
						await window.desktopApi.listNamespaces({
							connectionId: connection.id,
						}),
					)
					return [connection.id, namespaces] as const
				}),
			)
			return Object.fromEntries(entries)
		},
	})

	const selectedNamespace = React.useMemo(
		() =>
			(selectedConnectionNamespacesQuery.data ?? []).find(
				(namespace) => namespace.id === selectedNamespaceId,
			) ?? null,
		[selectedConnectionNamespacesQuery.data, selectedNamespaceId],
	)

	const pageTitle = getPageTitle(location.pathname)

	return (
		<SidebarProvider defaultOpen>
			<Sidebar>
				<SidebarHeader>
					<div className='bg-muted py-1 h-10 text-sm font-medium w-full flex items-center justify-between px-2'>
						<LogoWordmark className='h-full' />
						<span className='text-[10px] text-muted-foreground'>v1.2.1</span>
					</div>
				</SidebarHeader>

				<SidebarSeparator />

				<SidebarContent>
					<SidebarGroup>
						<DropdownMenu>
							<DropdownMenuTrigger
								className='w-full'
								render={
									<Button variant='outline' className='w-full h-fit justify-start py-2'>
										<div className='font-medium flex items-start gap-2 w-full'>
											<GaugeIcon className='mt-0.5 size-3.5 shrink-0' />
											{selectedConnection ? (
												<div className='flex w-full items-start justify-between gap-2'>
													<div className='min-w-0'>
														<p className='truncate w-fit font-bold'>
															{selectedConnection.name}
														</p>
														<div className='flex items-center gap-1 mt-0.5'>
															<Badge
																className='text-[11px] px-1.5'
																variant={
																	selectedConnection.environment === 'prod'
																		? 'destructive'
																		: 'default'
																}
															>
																{selectedConnection.environment}
															</Badge>
															<Badge variant='outline' className='text-[11px] px-1.5'>
																{selectedNamespace ? selectedNamespace.name : 'All Data'}
															</Badge>
														</div>
													</div>
													<ChevronDownIcon className='size-3.5 shrink-0' />
												</div>
											) : (
												<p>No Connection Selected</p>
											)}
										</div>
									</Button>
								}
							></DropdownMenuTrigger>
							<DropdownMenuContent className='w-64'>
								<DropdownMenuGroup>
									<DropdownMenuLabel>Saved Connections</DropdownMenuLabel>
									{connections.map((connection) => (
										<DropdownMenuSub key={connection.id}>
											<DropdownMenuSubTrigger
												onClick={() => setSelectedConnectionId(connection.id)}
											>
												{connection.name}
											</DropdownMenuSubTrigger>
											<DropdownMenuSubContent>
												<DropdownMenuItem
													onClick={() => {
														setSelectedConnectionId(connection.id)
														setSelectedNamespaceId(connection.id, null)
													}}
												>
													All Data
												</DropdownMenuItem>
												{(allNamespacesQuery.data?.[connection.id] ?? []).map(
													(namespace) => (
														<DropdownMenuItem
															key={namespace.id}
															onClick={() => {
																setSelectedConnectionId(connection.id)
																setSelectedNamespaceId(connection.id, namespace.id)
															}}
														>
															{namespace.name}
														</DropdownMenuItem>
													),
												)}
											</DropdownMenuSubContent>
										</DropdownMenuSub>
									))}
								</DropdownMenuGroup>
							</DropdownMenuContent>
						</DropdownMenu>
					</SidebarGroup>
					<SidebarGroup>
						<SidebarGroupLabel>Workspace</SidebarGroupLabel>
						<SidebarGroupContent>
							<NavMenu
								items={[workspaceItem]}
								currentPath={location.pathname}
								onNavigate={(path) => navigate(path)}
							/>
						</SidebarGroupContent>
					</SidebarGroup>

					<SidebarGroup>
						<SidebarGroupLabel>Global</SidebarGroupLabel>
						<SidebarGroupContent>
							<NavMenu
								items={globalItems}
								currentPath={location.pathname}
								onNavigate={(path) => navigate(path)}
							/>
						</SidebarGroupContent>
					</SidebarGroup>

					<SidebarGroup>
						<SidebarGroupLabel>Management</SidebarGroupLabel>
						<SidebarGroupContent>
							<NavMenu
								items={managementItems}
								currentPath={location.pathname}
								onNavigate={(path) => navigate(path)}
							/>
						</SidebarGroupContent>
					</SidebarGroup>
				</SidebarContent>

				<SidebarFooter>
					<Button variant='outline' onClick={() => setSettingsOpen(true)}>
						<Settings2Icon className='size-3.5' />
						Settings
					</Button>
				</SidebarFooter>

				<SidebarRail />
			</Sidebar>

			<SidebarInset className='h-svh min-h-0 overflow-hidden'>
				<header className='bg-background border-b px-3 py-2'>
					<div className='flex items-center justify-between gap-2'>
						<div className='flex items-center gap-2'>
							<SidebarTrigger />
							<p className='text-sm font-medium'>{pageTitle}</p>
						</div>
						<AlertsNavbarPopover />
					</div>
				</header>
				<div className='bg-background min-h-0 flex-1 overflow-auto'>
					<Outlet />
				</div>
			</SidebarInset>
		</SidebarProvider>
	)
}
