import { Skeleton } from '@/renderer/components/ui/skeleton'
import { cn } from '@/renderer/lib/utils'

type LoadingSkeletonLinesProps = {
	className?: string
	count?: number
	lineClassName?: string
	widths?: string[]
}

export const LoadingSkeletonLines = ({
	className,
	count = 2,
	lineClassName,
	widths,
}: LoadingSkeletonLinesProps) => {
	return (
		<div className={cn('space-y-2', className)}>
			{Array.from({ length: count }).map((_, index) => (
				<Skeleton
					key={index}
					className={cn(
						'h-3 rounded-none',
						widths?.[index] ??
							(count === 1 ? 'w-full' : index === count - 1 ? 'w-2/3' : 'w-full'),
						lineClassName,
					)}
				/>
			))}
		</div>
	)
}
