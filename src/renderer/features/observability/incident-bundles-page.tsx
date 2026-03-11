import { useQuery } from '@tanstack/react-query'
import * as React from 'react'

import { Card, CardContent } from '@/renderer/components/ui/card'
import { useStartupGateReady } from '@/renderer/app/startup-gate'
import { unwrapResponse } from '@/renderer/features/common/ipc'
import { ObservabilityPanel } from '@/renderer/features/observability/observability-panel'
import { useUiStore } from '@/renderer/state/ui-store'

export const IncidentBundlesPage = () => {
	const { selectedConnectionId } = useUiStore()

	const connectionsQuery = useQuery({
		queryKey: ['connections'],
		queryFn: async () => unwrapResponse(await window.desktopApi.listConnections()),
	})

	const selectedConnection = React.useMemo(
		() =>
			(connectionsQuery.data ?? []).find(
				(connection) => connection.id === selectedConnectionId,
			) ?? null,
		[connectionsQuery.data, selectedConnectionId],
	)
	useStartupGateReady(
		'incident-bundles-empty-state',
		!connectionsQuery.isLoading && !selectedConnection,
	)

	if (!selectedConnection) {
		return (
			<div className='p-4'>
				<Card>
					<CardContent className='p-4 text-xs text-muted-foreground'>
						Select an active connection from the sidebar to preview and export incident
						bundles.
					</CardContent>
				</Card>
			</div>
		)
	}

	return (
		<div className='h-full min-h-0 overflow-auto p-4'>
			<ObservabilityPanel connection={selectedConnection} mode='incident' />
		</div>
	)
}
