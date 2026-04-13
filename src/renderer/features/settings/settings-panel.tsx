import * as React from 'react'

import { useTheme } from 'next-themes'
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
import { LoadingSkeletonLines } from '@/renderer/components/ui/loading-skeleton'
import { Separator } from '@/renderer/components/ui/separator'
import type { UpdateStatus } from '@/shared/contracts/cache'

type SettingsPanelProps = {
	open: boolean
	onOpenChange: (open: boolean) => void
}

export const SettingsPanel = ({ open, onOpenChange }: SettingsPanelProps) => {
	const { theme, setTheme } = useTheme()
	const [updateStatus, setUpdateStatus] = React.useState<UpdateStatus | null>(
		null,
	)
	const previousPhaseRef = React.useRef<UpdateStatus['phase'] | null>(null)

	React.useEffect(() => {
		let active = true

		void window.desktopApi.getUpdateStatus().then((status) => {
			if (active) {
				setUpdateStatus(status)
			}
		})

		const unsubscribe = window.desktopApi.onUpdateStatusChange((status) => {
			if (active) {
				setUpdateStatus(status)
			}
		})

		return () => {
			active = false
			unsubscribe()
		}
	}, [])

	React.useEffect(() => {
		if (!updateStatus) {
			return
		}

		if (
			updateStatus.phase === 'downloaded' &&
			previousPhaseRef.current !== 'downloaded'
		) {
			toast.success('Update downloaded. Restart Volatile to apply it.')
		}

		if (updateStatus.phase === 'error' && previousPhaseRef.current !== 'error') {
			toast.error(updateStatus.message)
		}

		previousPhaseRef.current = updateStatus.phase
	}, [updateStatus])

	const handleCheckForUpdates = async () => {
		toast.promise(window.desktopApi.checkForUpdates(), {
			loading: 'Checking for updates...',
			success: (status) => {
				setUpdateStatus(status)
				return status.availableVersion
					? `Update ${status.availableVersion} is available!`
					: 'You are on the latest version.'
			},
			error: (error) =>
				error instanceof Error ? error.message : 'Failed to check for updates.',
		})
	}

	const handleApplyUpdate = async (): Promise<void> => {
		try {
			await window.desktopApi.applyUpdateAndRestart()
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : 'Failed to restart for update.',
			)
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className='max-w-lg'>
				<DialogHeader>
					<DialogTitle>Settings</DialogTitle>
					<DialogDescription>
						Personalize appearance and local workflow defaults.
					</DialogDescription>
				</DialogHeader>

				<div className='space-y-3'>
					<div className='space-y-1.5'>
						<p className='text-xs font-medium'>Theme</p>
						<div className='flex gap-2'>
							<Button
								variant={theme === 'light' ? 'default' : 'outline'}
								size='sm'
								onClick={() => setTheme('light')}
							>
								Light
							</Button>
							<Button
								variant={theme === 'dark' ? 'default' : 'outline'}
								size='sm'
								onClick={() => setTheme('dark')}
							>
								Dark
							</Button>
							<Button
								variant={theme === 'system' ? 'default' : 'outline'}
								size='sm'
								onClick={() => setTheme('system')}
							>
								System
							</Button>
						</div>
					</div>
					<Separator />
					<div className='space-y-3 rounded-none border border-border/70 bg-muted/30 p-4'>
						<div className='flex items-start justify-between gap-4'>
							<div className='space-y-1'>
								<p className='text-xs font-medium'>Application updates</p>
								<p className='text-xs text-muted-foreground'>
									Version {updateStatus?.currentVersion ?? '...'}
								</p>
							</div>
							<Button
								variant='outline'
								size='sm'
								onClick={handleCheckForUpdates}
								disabled={
									updateStatus?.phase === 'checking' ||
									updateStatus?.phase === 'downloading'
								}
							>
								{updateStatus?.phase === 'checking'
									? 'Checking...'
									: 'Check for updates'}
							</Button>
						</div>

						<div className='space-y-2'>
							{updateStatus ? (
								<>
									<p className='text-sm font-medium'>
										{getUpdateHeadline(updateStatus)}
									</p>
									<p className='text-xs leading-5 text-muted-foreground'>
										{updateStatus.message}
									</p>
								</>
							) : (
								<LoadingSkeletonLines
									count={2}
									widths={['w-1/2', 'w-2/3']}
								/>
							)}

							{updateStatus?.phase === 'downloading' &&
							updateStatus.progressPercent !== undefined ? (
								<div className='space-y-1.5'>
									<div className='h-2 overflow-hidden rounded-none bg-border/70'>
										<div
											className='h-full bg-foreground transition-[width] duration-300'
											style={{
												width: `${Math.max(
													0,
													Math.min(updateStatus.progressPercent, 100),
												)}%`,
											}}
										/>
									</div>
									<p className='text-[11px] text-muted-foreground'>
										{Math.round(updateStatus.progressPercent)}% downloaded
										{updateStatus.totalBytes
											? ` • ${formatBytes(updateStatus.transferredBytes ?? 0)} / ${formatBytes(updateStatus.totalBytes)}`
											: ''}
									</p>
								</div>
							) : null}
						</div>

						{updateStatus?.phase === 'downloaded' ? (
							<Button size='sm' onClick={() => void handleApplyUpdate()}>
								Restart to update
							</Button>
						) : null}
					</div>
				</div>

				<DialogFooter>
					<Button variant='outline' onClick={() => onOpenChange(false)}>
						Close
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}

const getUpdateHeadline = (status: UpdateStatus | null): string => {
	if (!status) {
		return 'Ready to check for updates'
	}

	switch (status.phase) {
		case 'unsupported':
			return 'Auto-update unavailable'
		case 'idle':
			return 'Ready to check for updates'
		case 'checking':
			return 'Checking GitHub Releases'
		case 'available':
			return `Update ${status.availableVersion ?? ''} found`.trim()
		case 'downloading':
			return `Downloading ${status.availableVersion ?? 'update'}`
		case 'downloaded':
			return `Update ${status.downloadedVersion ?? ''} ready`.trim()
		case 'no-update':
			return 'You are on the latest version'
		case 'error':
			return 'Update check failed'
		default:
			return 'Update status unavailable'
	}
}

const formatBytes = (value: number): string => {
	if (value < 1024) {
		return `${value} B`
	}

	if (value < 1024 * 1024) {
		return `${(value / 1024).toFixed(1)} KB`
	}

	if (value < 1024 * 1024 * 1024) {
		return `${(value / (1024 * 1024)).toFixed(1)} MB`
	}

	return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`
}
