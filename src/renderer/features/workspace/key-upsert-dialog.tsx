import { Clock3Icon, KeyRoundIcon, SaveIcon, TextCursorInputIcon } from 'lucide-react'

import { Badge } from '@/renderer/components/ui/badge'
import { Button } from '@/renderer/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/renderer/components/ui/dialog'
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
	InputGroupTextarea,
} from '@/renderer/components/ui/input-group'
import { Label } from '@/renderer/components/ui/label'
import { LoadingSkeletonLines } from '@/renderer/components/ui/loading-skeleton'

type KeyUpsertDialogProps = {
	open: boolean
	mode: 'create' | 'edit'
	readOnly: boolean
	supportsTTL: boolean
	keyType?: string
	isStringEditable?: boolean
	isLoading: boolean
	isSaving: boolean
	errorMessage?: string
	isRetryableError?: boolean
	keyName: string
	value: string
	ttlSeconds: string
	onOpenChange: (open: boolean) => void
	onKeyNameChange: (value: string) => void
	onValueChange: (value: string) => void
	onTtlChange: (value: string) => void
	onRetry?: () => void
	onSave: () => void
}

export const KeyUpsertDialog = ({
	open,
	mode,
	readOnly,
	supportsTTL,
	keyType,
	isStringEditable,
	isLoading,
	isSaving,
	errorMessage,
	isRetryableError,
	keyName,
	value,
	ttlSeconds,
	onOpenChange,
	onKeyNameChange,
	onValueChange,
	onTtlChange,
	onRetry,
	onSave,
}: KeyUpsertDialogProps) => {
	const isEditMode = mode === 'edit'
	const isNonStringEditBlocked = isEditMode && isStringEditable === false

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className='max-w-2xl'>
				<DialogHeader>
					<div className='flex items-center justify-between gap-2'>
						<div>
							<DialogTitle>{isEditMode ? 'Edit Key' : 'Create Key'}</DialogTitle>
							<DialogDescription>
								{isEditMode
									? isNonStringEditBlocked
										? 'This key uses a non-string Redis type. String upsert is disabled.'
										: 'Update key value and TTL using upsert.'
									: 'Create a new key and optional TTL.'}
							</DialogDescription>
						</div>
						{readOnly && <Badge variant='outline'>Read-only</Badge>}
						{isEditMode && keyType && <Badge variant='outline'>Type: {keyType}</Badge>}
					</div>
				</DialogHeader>

				{isLoading ? (
					<div className='space-y-3 rounded-none border p-3'>
						<LoadingSkeletonLines
							count={3}
							widths={['w-1/3', 'w-2/3', 'w-1/2']}
						/>
					</div>
				) : errorMessage ? (
					<div className='space-y-2 border p-2 text-xs'>
						<p className='text-destructive'>{errorMessage}</p>
						{isRetryableError && onRetry && (
							<Button size='sm' variant='outline' onClick={onRetry}>
								Retry
							</Button>
						)}
					</div>
				) : (
					<div className='space-y-3'>
						<div className='space-y-1.5'>
							<Label htmlFor='workspace-upsert-key'>Key</Label>
							<InputGroup>
								<InputGroupAddon>
									<KeyRoundIcon className='size-3.5' />
								</InputGroupAddon>
								<InputGroupInput
									id='workspace-upsert-key'
									value={keyName}
									onChange={(event) => onKeyNameChange(event.target.value)}
									placeholder='session:123'
									disabled={isEditMode || readOnly}
								/>
							</InputGroup>
						</div>

						<div className='space-y-1.5'>
							<Label htmlFor='workspace-upsert-value'>Value</Label>
							<InputGroup className='min-h-44 items-start'>
								<InputGroupAddon className='pt-2'>
									<TextCursorInputIcon className='size-3.5' />
								</InputGroupAddon>
								<InputGroupTextarea
									id='workspace-upsert-value'
									value={value}
									onChange={(event) => onValueChange(event.target.value)}
									className='min-h-44'
									placeholder='JSON or string value'
									disabled={readOnly || isNonStringEditBlocked}
								/>
							</InputGroup>
						</div>

						{supportsTTL && (
							<div className='space-y-1.5'>
								<Label htmlFor='workspace-upsert-ttl'>TTL seconds</Label>
								<InputGroup>
									<InputGroupAddon>
										<Clock3Icon className='size-3.5' />
									</InputGroupAddon>
									<InputGroupInput
										id='workspace-upsert-ttl'
										value={ttlSeconds}
										onChange={(event) => onTtlChange(event.target.value)}
										placeholder='Optional'
										disabled={readOnly || isNonStringEditBlocked}
									/>
								</InputGroup>
							</div>
						)}
					</div>
				)}

				<DialogFooter>
					<Button
						onClick={onSave}
						disabled={
							readOnly ||
							isLoading ||
							isSaving ||
							keyName.trim().length === 0 ||
							isNonStringEditBlocked
						}
					>
						<SaveIcon />
						{isSaving ? 'Saving...' : isEditMode ? 'Save Changes' : 'Create Key'}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
