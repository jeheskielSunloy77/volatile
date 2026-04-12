import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  ConnectionProfile,
  ConnectionSecret,
} from '../../../shared/contracts/cache'
import type { MemcachedKeyIndexRepository } from '../../application/ports'
import { DefaultCacheGateway } from './cache-gateway'

const redisScanMock = vi.fn()
const redisDbSizeMock = vi.fn()
const redisTypeMock = vi.fn()
const redisTtlMock = vi.fn()
const redisGetMock = vi.fn()
const redisHGetAllMock = vi.fn()
const redisLRangeMock = vi.fn()
const redisSMembersMock = vi.fn()
const redisSendCommandMock = vi.fn()
const redisConnectMock = vi.fn(async () => undefined)
const redisDisconnectMock = vi.fn(async () => undefined)

vi.mock('redis', () => ({
  createClient: vi.fn(() => ({
    connect: redisConnectMock,
    scan: redisScanMock,
    dbSize: redisDbSizeMock,
    type: redisTypeMock,
    ttl: redisTtlMock,
    get: redisGetMock,
    hGetAll: redisHGetAllMock,
    lRange: redisLRangeMock,
    sMembers: redisSMembersMock,
    sendCommand: redisSendCommandMock,
    disconnect: redisDisconnectMock,
    isOpen: true,
  })),
}))

vi.mock('memjs', () => ({
  Client: {
    create: vi.fn(() => ({
      quit: vi.fn(),
    })),
  },
}))

const redisProfile: ConnectionProfile = {
  id: 'redis-1',
  name: 'redis',
  engine: 'redis',
  host: '127.0.0.1',
  port: 6379,
  dbIndex: 0,
  tlsEnabled: false,
  environment: 'dev',
  tags: [],
  secretRef: 'redis-1',
  readOnly: false,
  timeoutMs: 5000,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

const memcachedProfile: ConnectionProfile = {
  ...redisProfile,
  id: 'mem-1',
  name: 'memcached',
  engine: 'memcached',
  port: 11211,
}

const keydbProfile: ConnectionProfile = {
  ...redisProfile,
  id: 'keydb-1',
  name: 'keydb',
  engine: 'keydb',
}

const secret: ConnectionSecret = {}

const createMemcachedRepository = (
  keys: string[],
): MemcachedKeyIndexRepository => ({
  listKeys: vi.fn(async () => []),
  countKeys: vi.fn(async () => keys.length),
  searchKeys: vi.fn(async () => keys),
  countKeysByPattern: vi.fn(async () => keys.length),
  upsertKey: vi.fn(async () => undefined),
  removeKey: vi.fn(async () => undefined),
  deleteByConnectionId: vi.fn(async () => undefined),
})

describe('DefaultCacheGateway search pagination', () => {
  beforeEach(() => {
    redisScanMock.mockReset()
    redisDbSizeMock.mockReset()
    redisTypeMock.mockReset()
    redisTtlMock.mockReset()
    redisGetMock.mockReset()
    redisHGetAllMock.mockReset()
    redisLRangeMock.mockReset()
    redisSMembersMock.mockReset()
    redisSendCommandMock.mockReset()
    redisConnectMock.mockClear()
    redisDisconnectMock.mockClear()
  })

  it('returns redis nextCursor when the scan has more pages', async () => {
    redisScanMock.mockResolvedValueOnce({
      keys: ['a', 'b'],
      cursor: '23',
    })

    const gateway = new DefaultCacheGateway(createMemcachedRepository([]))

    const result = await gateway.searchKeys(redisProfile, secret, {
      pattern: 'user:*',
      limit: 2,
      cursor: '0',
    })

    expect(result.keys).toEqual(['a', 'b'])
    expect(result.nextCursor).toBe('23')
    expect(redisScanMock).toHaveBeenCalledWith('0', {
      MATCH: 'user:*',
      COUNT: 50,
    })
  })

  it('clears redis nextCursor when scan reaches terminal cursor', async () => {
    redisScanMock.mockResolvedValueOnce({
      keys: ['a'],
      cursor: '0',
    })

    const gateway = new DefaultCacheGateway(createMemcachedRepository([]))

    const result = await gateway.searchKeys(redisProfile, secret, {
      pattern: 'user:*',
      limit: 10,
      cursor: '11',
    })

    expect(result.keys).toEqual(['a'])
    expect(result.nextCursor).toBeUndefined()
    expect(redisScanMock).toHaveBeenCalledWith('11', {
      MATCH: 'user:*',
      COUNT: 50,
    })
  })

  it('returns memcached nextCursor from the last key on full pages', async () => {
    const repository = createMemcachedRepository(['k1', 'k2'])
    const gateway = new DefaultCacheGateway(repository)

    const result = await gateway.searchKeys(memcachedProfile, secret, {
      pattern: 'k*',
      limit: 2,
      cursor: 'k0',
    })

    expect(result.keys).toEqual(['k1', 'k2'])
    expect(result.nextCursor).toBe('k2')
    expect(repository.searchKeys).toHaveBeenCalledWith('mem-1', 'k*', 2, 'k0')
  })

  it('does not return memcached nextCursor when the page is incomplete', async () => {
    const repository = createMemcachedRepository(['k1'])
    const gateway = new DefaultCacheGateway(repository)

    const result = await gateway.searchKeys(memcachedProfile, secret, {
      pattern: 'k*',
      limit: 2,
      cursor: 'k0',
    })

    expect(result.keys).toEqual(['k1'])
    expect(result.nextCursor).toBeUndefined()
  })

  it('returns exact redis pattern counts by scanning to terminal cursor', async () => {
    redisDbSizeMock.mockResolvedValueOnce(30)
    redisScanMock
      .mockResolvedValueOnce({
        keys: ['user:1', 'user:2'],
        cursor: '5',
      })
      .mockResolvedValueOnce({
        keys: ['user:2', 'user:3'],
        cursor: '0',
      })

    const gateway = new DefaultCacheGateway(createMemcachedRepository([]))

    const result = await gateway.countKeysByPattern(redisProfile, secret, {
      pattern: 'user:*',
    })

    expect(result).toEqual({
      totalKeys: 30,
      totalFoundKeys: 3,
    })
  })

  it('returns memcached total and filtered counts from index repository', async () => {
    const repository = createMemcachedRepository(['k1', 'k2', 'k3'])
    const gateway = new DefaultCacheGateway(repository)

    const result = await gateway.countKeysByPattern(memcachedProfile, secret, {
      pattern: 'k*',
    })

    expect(result).toEqual({
      totalKeys: 3,
      totalFoundKeys: 3,
    })
    expect(repository.countKeys).toHaveBeenCalledWith('mem-1')
    expect(repository.countKeysByPattern).toHaveBeenCalledWith('mem-1', 'k*')
  })

  it('routes non-redis Redis-family engines through the Redis code path', async () => {
    redisScanMock.mockResolvedValueOnce({
      keys: ['tenant:1'],
      cursor: '0',
    })

    const gateway = new DefaultCacheGateway(createMemcachedRepository([]))

    const result = await gateway.searchKeys(keydbProfile, secret, {
      pattern: 'tenant:*',
      limit: 5,
    })

    expect(result.keys).toEqual(['tenant:1'])
    expect(redisConnectMock).toHaveBeenCalledTimes(1)
    expect(redisScanMock).toHaveBeenCalledWith('0', {
      MATCH: 'tenant:*',
      COUNT: 50,
    })
  })

  it('reads hash keys without issuing GET', async () => {
    redisTypeMock.mockResolvedValueOnce('hash')
    redisTtlMock.mockResolvedValueOnce(90)
    redisHGetAllMock.mockResolvedValueOnce({
      id: '123',
      status: 'active',
    })

    const gateway = new DefaultCacheGateway(createMemcachedRepository([]))

    const result = await gateway.getValue(redisProfile, secret, 'user:123')

    expect(result).toEqual({
      key: 'user:123',
      value: JSON.stringify(
        {
          id: '123',
          status: 'active',
        },
        null,
        2,
      ),
      ttlSeconds: 90,
      supportsTTL: true,
      keyType: 'hash',
      isStringEditable: false,
    })
    expect(redisGetMock).not.toHaveBeenCalled()
    expect(redisHGetAllMock).toHaveBeenCalledWith('user:123')
  })
})
