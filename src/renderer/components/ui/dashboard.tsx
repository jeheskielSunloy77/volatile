import * as React from 'react'

import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from '@/renderer/components/ui/card'
import { LoadingSkeletonLines } from '@/renderer/components/ui/loading-skeleton'
import { cn } from '@/renderer/lib/utils'

type DashboardStatItem = {
	label: string
	value: React.ReactNode
	description?: React.ReactNode
	tone?: 'default' | 'positive' | 'warning' | 'danger'
}

type DashboardSectionProps = React.ComponentProps<'section'>

type DashboardChartCardProps = {
	title: string
	description?: React.ReactNode
	loading?: boolean
	error?: React.ReactNode
	empty?: React.ReactNode
	children: React.ReactNode
	className?: string
	contentClassName?: string
}

const toneClassName: Record<
	NonNullable<DashboardStatItem['tone']>,
	string
> = {
	default: 'border-border/70',
	positive: 'border-chart-2/30 bg-chart-2/5',
	warning: 'border-chart-4/30 bg-chart-4/5',
	danger: 'border-destructive/25 bg-destructive/5',
}

export const DashboardSection = ({
	className,
	...props
}: DashboardSectionProps) => (
	<section className={cn('grid gap-3', className)} {...props} />
)

export const DashboardStats = ({
	items,
	className,
}: {
	items: DashboardStatItem[]
	className?: string
}) => (
	<div className={cn('grid gap-3 md:grid-cols-2 xl:grid-cols-4', className)}>
		{items.map((item) => (
			<Card
				key={item.label}
				className={cn('rounded-none border shadow-none', toneClassName[item.tone ?? 'default'])}
			>
				<CardContent className='space-y-1 p-4'>
					<p className='text-muted-foreground text-[11px] uppercase tracking-[0.22em]'>
						{item.label}
					</p>
					<p className='text-2xl font-semibold tracking-tight'>{item.value}</p>
					{item.description ? (
						<p className='text-muted-foreground text-xs'>{item.description}</p>
					) : null}
				</CardContent>
			</Card>
		))}
	</div>
)

export const DashboardChartCard = ({
	title,
	description,
	loading = false,
	error,
	empty,
	children,
	className,
	contentClassName,
}: DashboardChartCardProps) => (
	<Card className={cn('min-h-0 rounded-none border shadow-none', className)}>
		<CardHeader className='pb-2'>
			<CardTitle>{title}</CardTitle>
			{description ? <CardDescription>{description}</CardDescription> : null}
		</CardHeader>
		<CardContent className={cn('min-h-[18rem]', contentClassName)}>
			{loading ? (
				<div className='space-y-3'>
					<LoadingSkeletonLines count={4} widths={['w-5/6', 'w-2/3', 'w-3/4', 'w-1/2']} />
				</div>
			) : error ? (
				<p className='text-destructive text-xs'>{error}</p>
			) : empty ? (
				<p className='text-muted-foreground text-xs'>{empty}</p>
			) : (
				children
			)}
		</CardContent>
	</Card>
)
