import { describe, expect, it } from 'vitest'

import {
	isConnectionsStartupReady,
	isWorkspaceStartupReady,
} from './startup-readiness'

describe('startup readiness helpers', () => {
	it('treats connections startup as ready once the first query settles', () => {
		expect(isConnectionsStartupReady(true)).toBe(false)
		expect(isConnectionsStartupReady(false)).toBe(true)
	})

	it('keeps workspace startup pending while connections are still loading', () => {
		expect(
			isWorkspaceStartupReady({
				connectionsLoading: true,
				connectionsCount: 0,
				selectedConnectionId: null,
				hasSelectedConnection: false,
				namespacesLoading: false,
				capabilitiesLoading: false,
				keyListLoading: false,
				keyCountLoading: false,
			}),
		).toBe(false)
	})

	it('treats empty workspace state as ready once connections settle', () => {
		expect(
			isWorkspaceStartupReady({
				connectionsLoading: false,
				connectionsCount: 0,
				selectedConnectionId: null,
				hasSelectedConnection: false,
				namespacesLoading: false,
				capabilitiesLoading: false,
				keyListLoading: false,
				keyCountLoading: false,
			}),
		).toBe(true)
	})

	it('waits for connection selection before completing workspace startup', () => {
		expect(
			isWorkspaceStartupReady({
				connectionsLoading: false,
				connectionsCount: 2,
				selectedConnectionId: null,
				hasSelectedConnection: false,
				namespacesLoading: false,
				capabilitiesLoading: false,
				keyListLoading: false,
				keyCountLoading: false,
			}),
		).toBe(false)
	})

	it('waits for dependent workspace queries after the connection is selected', () => {
		expect(
			isWorkspaceStartupReady({
				connectionsLoading: false,
				connectionsCount: 1,
				selectedConnectionId: 'conn-1',
				hasSelectedConnection: true,
				namespacesLoading: false,
				capabilitiesLoading: true,
				keyListLoading: false,
				keyCountLoading: false,
			}),
		).toBe(false)
	})

	it('completes workspace startup once all critical queries have settled', () => {
		expect(
			isWorkspaceStartupReady({
				connectionsLoading: false,
				connectionsCount: 1,
				selectedConnectionId: 'conn-1',
				hasSelectedConnection: true,
				namespacesLoading: false,
				capabilitiesLoading: false,
				keyListLoading: false,
				keyCountLoading: false,
			}),
		).toBe(true)
	})
})
