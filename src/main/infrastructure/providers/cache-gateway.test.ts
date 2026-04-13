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
const redisHSetMock = vi.fn()
const redisLRangeMock = vi.fn()
const redisSMembersMock = vi.fn()
const redisSendCommandMock = vi.fn()
const redisSetMock = vi.fn()
const redisDelMock = vi.fn()
const memcachedDeleteMock = vi.fn()
const memcachedFlushMock = vi.fn()
const memcachedQuitMock = vi.fn()
const redisExpireMock = vi.fn()
const redisRPushMock = vi.fn()
const redisSAddMock = vi.fn()
const redisZAddMock = vi.fn()
const redisXAddMock = vi.fn()
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
    hSet: redisHSetMock,
    lRange: redisLRangeMock,
    rPush: redisRPushMock,
    sMembers: redisSMembersMock,
    sAdd: redisSAddMock,
    zAdd: redisZAddMock,
    xAdd: redisXAddMock,
    set: redisSetMock,
    del: redisDelMock,
    expire: redisExpireMock,
    sendCommand: redisSendCommandMock,
    disconnect: redisDisconnectMock,
    isOpen: true,
  })),
}))

vi.mock('memjs', () => ({
  Client: {
    create: vi.fn(() => ({
      delete: memcachedDeleteMock,
      flush: memcachedFlushMock,
      quit: memcachedQuitMock,
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
    redisHSetMock.mockReset()
    redisLRangeMock.mockReset()
    redisSMembersMock.mockReset()
    redisSendCommandMock.mockReset()
    redisSetMock.mockReset()
    redisDelMock.mockReset()
    memcachedDeleteMock.mockReset()
    memcachedFlushMock.mockReset()
    memcachedQuitMock.mockReset()
    redisExpireMock.mockReset()
    redisRPushMock.mockReset()
    redisSAddMock.mockReset()
    redisZAddMock.mockReset()
    redisXAddMock.mockReset()
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

    expect(result.keys).toEqual([
      { key: 'a', keyType: 'unknown', ttlSeconds: null },
      { key: 'b', keyType: 'unknown', ttlSeconds: null },
    ])
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

    expect(result.keys).toEqual([
      { key: 'a', keyType: 'unknown', ttlSeconds: null },
    ])
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

    expect(result.keys).toEqual([{ key: 'k1' }, { key: 'k2' }])
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

    expect(result.keys).toEqual([{ key: 'k1' }])
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

    expect(result.keys).toEqual([
      { key: 'tenant:1', keyType: 'unknown', ttlSeconds: null },
    ])
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

  it('writes hash keys through type-aware Redis commands', async () => {
    const gateway = new DefaultCacheGateway(createMemcachedRepository([]))

    await gateway.setValue(redisProfile, secret, {
      key: 'user:123',
      value: {
        kind: 'hash',
        entries: [
          { field: 'id', value: '123' },
          { field: 'status', value: 'active' },
        ],
      },
      ttlSeconds: 90,
    })

    expect(redisDelMock).toHaveBeenCalledWith('user:123')
    expect(redisHSetMock).toHaveBeenCalledWith('user:123', {
      id: '123',
      status: 'active',
    })
    expect(redisExpireMock).toHaveBeenCalledWith('user:123', 90)
    expect(redisSetMock).not.toHaveBeenCalled()
  })

  it('flushes Redis databases with FLUSHDB', async () => {
    const gateway = new DefaultCacheGateway(createMemcachedRepository([]))

    await gateway.flush(redisProfile, secret, { scope: 'database' })

    expect(redisSendCommandMock).toHaveBeenCalledWith(['FLUSHDB'])
  })

  it('flushes Redis prefix namespaces by scanning and deleting matching keys', async () => {
    redisScanMock
      .mockResolvedValueOnce({
        keys: ['tenant:user:1', 'tenant:user:2'],
        cursor: '5',
      })
      .mockResolvedValueOnce({
        keys: [],
        cursor: '0',
      })

    const gateway = new DefaultCacheGateway(createMemcachedRepository([]))

    await gateway.flush(redisProfile, secret, {
      scope: 'namespace',
      keyPrefix: 'tenant:',
    })

    expect(redisScanMock).toHaveBeenNthCalledWith(1, '0', {
      MATCH: 'tenant:*',
      COUNT: 1000,
    })
    expect(redisSendCommandMock).toHaveBeenCalledWith([
      'DEL',
      'tenant:user:1',
      'tenant:user:2',
    ])
  })

  it('flushes memcached databases and clears the local index', async () => {
    const repository = createMemcachedRepository(['k1', 'k2'])
    const gateway = new DefaultCacheGateway(repository)

    await gateway.flush(memcachedProfile, secret, { scope: 'database' })

    expect(memcachedFlushMock).toHaveBeenCalledTimes(1)
    expect(repository.deleteByConnectionId).toHaveBeenCalledWith('mem-1')
  })

  it('flushes memcached prefix namespaces by deleting indexed keys', async () => {
    const repository = createMemcachedRepository(['tenant:1', 'tenant:2'])
    const gateway = new DefaultCacheGateway(repository)

    await gateway.flush(memcachedProfile, secret, {
      scope: 'namespace',
      keyPrefix: 'tenant:',
    })

    expect(repository.searchKeys).toHaveBeenCalledWith(
      'mem-1',
      'tenant:*',
      1000,
      undefined,
    )
    expect(memcachedDeleteMock).toHaveBeenCalledWith('tenant:1')
    expect(memcachedDeleteMock).toHaveBeenCalledWith('tenant:2')
    expect(repository.removeKey).toHaveBeenCalledWith('mem-1', 'tenant:1')
    expect(repository.removeKey).toHaveBeenCalledWith('mem-1', 'tenant:2')
  })
})
