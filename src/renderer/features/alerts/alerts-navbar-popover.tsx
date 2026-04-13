import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BellIcon } from 'lucide-react'
import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { Badge } from '@/renderer/components/ui/badge'
import { Button } from '@/renderer/components/ui/button'
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from '@/renderer/components/ui/empty'
import { LoadingSkeletonLines } from '@/renderer/components/ui/loading-skeleton'
import {
	Popover,
	PopoverContent,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
} from '@/renderer/components/ui/popover'
import { unwrapResponse } from '@/renderer/features/common/ipc'
import type { AlertEvent } from '@/shared/contracts/cache'

const ALERTS_POLL_MS = 15_000
const ALERTS_POPOVER_LIMIT = 10

const getSeverityVariant = (
	severity: AlertEvent['severity'],
): 'default' | 'outline' | 'destructive' => {
	if (severity === 'critical') {
		return 'destructive'
	}

	if (severity === 'warning') {
		return 'outline'
	}

	return 'default'
}

const formatTimestamp = (timestamp: string): string =>
	new Date(timestamp).toLocaleString()

export const AlertsNavbarPopover = () => {
	const navigate = useNavigate()
	const queryClient = useQueryClient()
	const [open, setOpen] = React.useState(false)

	const unreadCountQuery = useQuery({
		queryKey: ['alerts', 'unread-count'],
		queryFn: async () =>
			unwrapResponse(await window.desktopApi.getUnreadAlertCount()),
		refetchInterval: ALERTS_POLL_MS,
	})

	const unreadAlertsQuery = useQuery({
		queryKey: ['alerts', 'navbar-unread'],
		queryFn: async () =>
			unwrapResponse(
				await window.desktopApi.listAlerts({
					unreadOnly: true,
					limit: ALERTS_POPOVER_LIMIT,
				}),
			),
		enabled: open,
		refetchInterval: open ? ALERTS_POLL_MS : false,
	})

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

	const markAllReadMutation = useMutation({
		mutationFn: async () =>
			unwrapResponse(await window.desktopApi.markAllAlertsRead()),
		onSuccess: async () => {
			toast.success('All unread alerts marked as read.')
			await queryClient.invalidateQueries({ queryKey: ['alerts'] })
		},
		onError: (error) => {
			toast.error(
				error instanceof Error ? error.message : 'Unable to mark all alerts read.',
			)
		},
	})

	const unreadCount = unreadCountQuery.data?.unreadCount ?? 0
	const unreadCountLabel = unreadCount > 99 ? '99+' : String(unreadCount)
	const unreadAlerts = unreadAlertsQuery.data ?? []

	const openAlertsPage = React.useCallback(() => {
		setOpen(false)
		navigate('/global/alerts')
	}, [navigate])

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				render={
					<Button
						variant='ghost'
						size='icon-sm'
						className='relative'
						aria-label='Open unread alerts'
					/>
				}
			>
				<BellIcon className='size-4' />
				{unreadCount > 0 && (
					<span className='bg-destructive text-destructive-foreground pointer-events-none absolute -top-1 -right-1 min-w-4 rounded-none px-1 text-[10px] leading-4'>
						{unreadCountLabel}
					</span>
				)}
			</PopoverTrigger>

			<PopoverContent align='end' sideOffset={8} className='w-72'>
				<PopoverHeader className='gap-2 border-b pb-2'>
					<div className='flex items-center justify-between'>
						<PopoverTitle>Unread Alerts</PopoverTitle>
						<Button variant='outline' size='xs' onClick={openAlertsPage}>
							View all
						</Button>
					</div>
					{unreadCount > 0 && (
						<Button
							variant='ghost'
							size='xs'
							onClick={() => markAllReadMutation.mutate()}
							disabled={markAllReadMutation.isPending}
						>
							Mark all read
						</Button>
					)}
				</PopoverHeader>

				<div className='max-h-80 space-y-1 overflow-auto'>
					{unreadAlertsQuery.isLoading ? (
						<div className='space-y-2 p-1'>
							<LoadingSkeletonLines count={3} widths={['w-5/6', 'w-2/3', 'w-4/5']} />
						</div>
					) : unreadAlertsQuery.isError ? (
						<div className='space-y-2 p-1'>
							<p className='text-destructive text-xs'>Unable to load unread alerts.</p>
							<Button
								variant='outline'
								size='xs'
								onClick={() => void unreadAlertsQuery.refetch()}
							>
								Retry
							</Button>
						</div>
					) : unreadAlerts.length === 0 ? (
						<Empty className='bg-muted/50'>
							<EmptyHeader>
								<EmptyMedia variant='icon'>
									<BellIcon className='size-4' />
								</EmptyMedia>
								<EmptyTitle>All caught up</EmptyTitle>
								<EmptyDescription>No unread alerts.</EmptyDescription>
							</EmptyHeader>
						</Empty>
					) : (
						unreadAlerts.map((alert) => (
							<div
								key={alert.id}
								className='space-y-1 border-b py-2 text-xs last:border-0'
							>
								<div className='flex items-start gap-2'>
									<button
										type='button'
										className='min-w-0 flex-1 text-left'
										onClick={openAlertsPage}
									>
										<p className='truncate font-medium'>{alert.title}</p>
										<p className='text-muted-foreground truncate text-[11px]'>
											{formatTimestamp(alert.createdAt)}
										</p>
									</button>
									<div className='flex items-center gap-1'>
										<Badge variant={getSeverityVariant(alert.severity)}>
											{alert.severity}
										</Badge>
										<Button
											variant='ghost'
											size='xs'
											onClick={() => markReadMutation.mutate(alert.id)}
											disabled={markReadMutation.isPending}
										>
											Mark read
										</Button>
									</div>
								</div>
							</div>
						))
					)}
				</div>
			</PopoverContent>
		</Popover>
	)
}
