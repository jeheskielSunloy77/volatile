import type { CacheEngine } from '../contracts/cache'

export const REDIS_FAMILY_ENGINES = [
  'redis',
  'keydb',
  'dragonfly',
  'valkey',
] as const satisfies readonly CacheEngine[]

export const CACHE_ENGINES = [...REDIS_FAMILY_ENGINES, 'memcached'] as const satisfies readonly CacheEngine[]

export const isRedisFamilyEngine = (engine: CacheEngine): boolean =>
  REDIS_FAMILY_ENGINES.includes(engine as (typeof REDIS_FAMILY_ENGINES)[number])

export const getCacheEngineLabel = (engine: CacheEngine): string => {
  switch (engine) {
    case 'redis':
      return 'Redis'
    case 'keydb':
      return 'KeyDB'
    case 'dragonfly':
      return 'Dragonfly'
    case 'valkey':
      return 'Valkey'
    case 'memcached':
      return 'Memcached'
  }
}

export const getDefaultPortForEngine = (engine: CacheEngine): number =>
  engine === 'memcached' ? 11211 : 6379
