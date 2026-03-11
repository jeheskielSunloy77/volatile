type WorkspaceStartupReadinessInput = {
	connectionsLoading: boolean
	connectionsCount: number
	selectedConnectionId: string | null
	hasSelectedConnection: boolean
	namespacesLoading: boolean
	capabilitiesLoading: boolean
	keyListLoading: boolean
	keyCountLoading: boolean
}

export const isConnectionsStartupReady = (
	connectionsLoading: boolean,
): boolean => !connectionsLoading

export const isWorkspaceStartupReady = (
	input: WorkspaceStartupReadinessInput,
): boolean => {
	if (input.connectionsLoading) {
		return false
	}

	if (input.connectionsCount === 0) {
		return true
	}

	if (!input.selectedConnectionId || !input.hasSelectedConnection) {
		return false
	}

	return (
		!input.namespacesLoading &&
		!input.capabilitiesLoading &&
		!input.keyListLoading &&
		!input.keyCountLoading
	)
}
