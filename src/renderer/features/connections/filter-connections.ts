import type { ConnectionProfile } from '@/shared/contracts/cache'
import { isRedisFamilyEngine } from '@/shared/lib/cache-engines'

export type ConnectionEngineFilter = 'all' | 'redisFamily' | 'memcached'

type FilterConnectionsInput = {
	connections: ConnectionProfile[]
	searchText: string
	engineFilter: ConnectionEngineFilter
}

const normalize = (value: string): string => value.trim().toLowerCase()

export const filterConnections = ({
	connections,
	searchText,
	engineFilter,
}: FilterConnectionsInput): ConnectionProfile[] => {
	const normalizedSearch = normalize(searchText)

	return connections.filter((connection) => {
		if (engineFilter === 'redisFamily' && !isRedisFamilyEngine(connection.engine)) {
			return false
		}

		if (engineFilter === 'memcached' && connection.engine !== 'memcached') {
			return false
		}

		if (!normalizedSearch) {
			return true
		}

		const searchable = normalize(
			[
				connection.name,
				connection.host,
				String(connection.port),
				connection.tags.join(' '),
			].join(' '),
		)

		return searchable.includes(normalizedSearch)
	})
}
