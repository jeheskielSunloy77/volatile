import { describe, expect, it } from 'vitest'

import { filterConnections } from './filter-connections'
import type { ConnectionProfile } from '../../../shared/contracts/cache'

const createConnection = (
	overrides: Partial<ConnectionProfile>,
): ConnectionProfile => ({
	id: overrides.id ?? 'connection-1',
	name: overrides.name ?? 'Primary Redis',
	engine: overrides.engine ?? 'redis',
	host: overrides.host ?? '127.0.0.1',
	port: overrides.port ?? 6379,
	dbIndex: overrides.dbIndex,
	tlsEnabled: overrides.tlsEnabled ?? false,
	environment: overrides.environment ?? 'dev',
	tags: overrides.tags ?? [],
	secretRef: overrides.secretRef ?? 'secret-ref',
	readOnly: overrides.readOnly ?? false,
	forceReadOnly: overrides.forceReadOnly,
	timeoutMs: overrides.timeoutMs ?? 5000,
	retryMaxAttempts: overrides.retryMaxAttempts,
	retryBackoffMs: overrides.retryBackoffMs,
	retryBackoffStrategy: overrides.retryBackoffStrategy,
	retryAbortOnErrorRate: overrides.retryAbortOnErrorRate,
	createdAt: overrides.createdAt ?? '2026-02-26T00:00:00.000Z',
	updatedAt: overrides.updatedAt ?? '2026-02-26T00:00:00.000Z',
})

describe('filterConnections', () => {
	const connections: ConnectionProfile[] = [
		createConnection({
			id: 'redis-1',
			name: 'Primary Redis',
			engine: 'redis',
			host: 'redis.internal.local',
			port: 6379,
			tags: ['core', 'critical'],
		}),
		createConnection({
			id: 'valkey-1',
			name: 'Valkey Cache',
			engine: 'valkey',
			host: 'valkey.internal.local',
			port: 6379,
			tags: ['replica'],
		}),
		createConnection({
			id: 'memcached-1',
			name: 'Cache Edge',
			engine: 'memcached',
			host: 'cache-edge.local',
			port: 11211,
			tags: ['edge'],
		}),
	]

	it('returns all connections when search text is empty and filter is all', () => {
		const result = filterConnections({
			connections,
			searchText: '',
			engineFilter: 'all',
		})

		expect(result).toHaveLength(3)
	})

	it('filters by Redis family', () => {
		const result = filterConnections({
			connections,
			searchText: '',
			engineFilter: 'redisFamily',
		})

		expect(result).toHaveLength(2)
		expect(result.map((connection) => connection.id)).toEqual([
			'redis-1',
			'valkey-1',
		])
	})

	it('filters by memcached engine', () => {
		const result = filterConnections({
			connections,
			searchText: '',
			engineFilter: 'memcached',
		})

		expect(result).toHaveLength(1)
		expect(result[0].id).toBe('memcached-1')
	})

	it('matches search text against name, host, port, and tags', () => {
		expect(
			filterConnections({
				connections,
				searchText: 'primary',
				engineFilter: 'all',
			}),
		).toHaveLength(1)

		expect(
			filterConnections({
				connections,
				searchText: 'cache-edge',
				engineFilter: 'all',
			}),
		).toHaveLength(1)

		expect(
			filterConnections({
				connections,
				searchText: '11211',
				engineFilter: 'all',
			}),
		).toHaveLength(1)

		expect(
			filterConnections({
				connections,
				searchText: 'critical',
				engineFilter: 'all',
			}),
		).toHaveLength(1)
	})

	it('applies engine filter and search text together', () => {
		const result = filterConnections({
			connections,
			searchText: 'valkey',
			engineFilter: 'redisFamily',
		})

		expect(result).toHaveLength(1)
		expect(result[0].id).toBe('valkey-1')
	})
})
