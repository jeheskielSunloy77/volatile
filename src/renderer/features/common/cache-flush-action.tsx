import { ChevronDownIcon, DatabaseIcon } from 'lucide-react'
import * as React from 'react'

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
import { Button } from '@/renderer/components/ui/button'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu'
import type { CacheFlushScope } from '@/shared/contracts/cache'

type CacheFlushActionProps = {
	connectionName: string
	namespaceName?: string | null
	namespaceOptionDisabled: boolean
	disabled?: boolean
	isSubmitting?: boolean
	onFlush: (scope: CacheFlushScope) => void
}

const getDialogCopy = (
	scope: CacheFlushScope,
	connectionName: string,
	namespaceName?: string | null,
) => {
	if (scope === 'namespace') {
		return {
			title: 'Flush Namespace?',
			description: `This will permanently remove every key in ${namespaceName ?? 'the selected namespace'} on ${connectionName}.`,
			actionLabel: 'Flush Namespace',
		}
	}

	return {
		title: 'Flush Database?',
		description: `This will permanently remove every key in the active database for ${connectionName}.`,
		actionLabel: 'Flush Database',
	}
}

export const CacheFlushAction = ({
	connectionName,
	namespaceName,
	namespaceOptionDisabled,
	disabled = false,
	isSubmitting = false,
	onFlush,
}: CacheFlushActionProps) => {
	const [pendingScope, setPendingScope] = React.useState<CacheFlushScope | null>(
		null,
	)
	const dialogCopy = pendingScope
		? getDialogCopy(pendingScope, connectionName, namespaceName)
		: null

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger
					disabled={disabled || isSubmitting}
					render={
						<Button variant='outline' size='sm'>
							<DatabaseIcon className='size-3.5' />
							Flush
							<ChevronDownIcon className='size-3.5' />
						</Button>
					}
				/>
				<DropdownMenuContent align='end' className='w-44'>
					<DropdownMenuItem
						variant='destructive'
						onClick={() => setPendingScope('database')}
					>
						Flush Database
					</DropdownMenuItem>
					<DropdownMenuItem
						variant='destructive'
						disabled={namespaceOptionDisabled}
						onClick={() => setPendingScope('namespace')}
					>
						Flush Namespace
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			<AlertDialog
				open={Boolean(pendingScope)}
				onOpenChange={(open) => {
					if (!open && !isSubmitting) {
						setPendingScope(null)
					}
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{dialogCopy?.title}</AlertDialogTitle>
						<AlertDialogDescription>
							{dialogCopy?.description} This action cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={isSubmitting}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant='destructive'
							disabled={!pendingScope || isSubmitting}
							onClick={() => {
								if (!pendingScope) {
									return
								}

								onFlush(pendingScope)
								setPendingScope(null)
							}}
						>
							{dialogCopy?.actionLabel ?? 'Flush'}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	)
}
