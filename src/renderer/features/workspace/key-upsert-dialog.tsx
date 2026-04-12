import { SaveIcon } from 'lucide-react'

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
import { Input } from '@/renderer/components/ui/input'
import { Label } from '@/renderer/components/ui/label'
import { Textarea } from '@/renderer/components/ui/textarea'

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
					<p className='text-muted-foreground text-xs'>Loading key details...</p>
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
							<Input
								id='workspace-upsert-key'
								value={keyName}
								onChange={(event) => onKeyNameChange(event.target.value)}
								placeholder='session:123'
								disabled={isEditMode || readOnly}
							/>
						</div>

						<div className='space-y-1.5'>
							<Label htmlFor='workspace-upsert-value'>Value</Label>
							<Textarea
								id='workspace-upsert-value'
								value={value}
								onChange={(event) => onValueChange(event.target.value)}
								className='min-h-44'
								placeholder='JSON or string value'
								disabled={readOnly || isNonStringEditBlocked}
							/>
						</div>

						{supportsTTL && (
							<div className='space-y-1.5'>
								<Label htmlFor='workspace-upsert-ttl'>TTL seconds</Label>
								<Input
									id='workspace-upsert-ttl'
									value={ttlSeconds}
									onChange={(event) => onTtlChange(event.target.value)}
									placeholder='Optional'
									disabled={readOnly || isNonStringEditBlocked}
								/>
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
