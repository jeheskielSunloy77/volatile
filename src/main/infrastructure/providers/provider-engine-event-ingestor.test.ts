import { describe, expect, it, vi } from 'vitest'

import type { ConnectionProfile } from '../../../shared/contracts/cache'
import { isRedisFamilyEngine } from '../../../shared/lib/cache-engines'
import type {
  CacheGateway,
  ConnectionRepository,
  SecretStore,
} from '../../application/ports'
import { ProviderEngineEventIngestor } from './provider-engine-event-ingestor'

const createProfile = (
  id: string,
  engine: ConnectionProfile['engine'],
): ConnectionProfile => ({
  id,
  name: id,
  engine,
  host: '127.0.0.1',
  port: engine === 'memcached' ? 11211 : 6379,
  dbIndex: isRedisFamilyEngine(engine) ? 0 : undefined,
  tlsEnabled: false,
  environment: 'dev',
  tags: [],
  secretRef: id,
  readOnly: false,
  timeoutMs: 5000,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
})

describe('ProviderEngineEventIngestor', () => {
  it('polls engine events for supported profiles on start', async () => {
    const connectionRepository: ConnectionRepository = {
      list: vi.fn(async () => [
        createProfile('keydb-1', 'keydb'),
        createProfile('mem-1', 'memcached'),
      ]),
      findById: vi.fn(async () => null),
      save: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    }

    const secretStore: SecretStore = {
      saveSecret: vi.fn(async () => undefined),
      getSecret: vi.fn(async () => ({
        password: 'secret',
      })),
      deleteSecret: vi.fn(async () => undefined),
    }

    const pollEngineEvents = vi
      .fn()
      .mockResolvedValueOnce({
        events: [
          {
            connectionId: 'keydb-1',
            action: 'redis.slowlog.get',
            keyOrPattern: 'user:1',
            durationMs: 10,
            status: 'success',
          },
        ],
        nextCursor: '5',
      })
      .mockResolvedValue({
        events: [],
        nextCursor: '5',
      })

    const cacheGateway: CacheGateway = {
      testConnection: vi.fn(async () => {
        throw new Error('not needed')
      }),
      getCapabilities: vi.fn((profile) => ({
        supportsTTL: true,
        supportsMonitorStream: false,
        supportsSlowLog: isRedisFamilyEngine(profile.engine),
        supportsBulkDeletePreview: false,
        supportsSnapshotRestore: false,
        supportsPatternScan: true,
      })),
      listKeys: vi.fn(async () => ({ keys: [], nextCursor: undefined })),
      searchKeys: vi.fn(async () => ({ keys: [], nextCursor: undefined })),
      countKeys: vi.fn(async () => ({ totalKeys: 0 })),
      countKeysByPattern: vi.fn(async () => ({ totalKeys: 0, totalFoundKeys: 0 })),
      getValue: vi.fn(async (profile, _secret, key) => ({
        key,
        value: null,
        ttlSeconds: null,
        supportsTTL: isRedisFamilyEngine(profile.engine),
      })),
      setValue: vi.fn(async () => undefined),
      deleteKey: vi.fn(async () => undefined),
      flush: vi.fn(async () => undefined),
      pollEngineEvents,
    }

    const onEvent = vi.fn(async () => undefined)
    const ingestor = new ProviderEngineEventIngestor(
      connectionRepository,
      secretStore,
      cacheGateway,
      {
        pollIntervalMs: 1,
        pollLimit: 10,
      },
    )

    await ingestor.start({ onEvent })

    await vi.waitFor(() => {
      expect(connectionRepository.list).toHaveBeenCalledTimes(1)
      expect(cacheGateway.getCapabilities).toHaveBeenCalledTimes(2)
      expect(pollEngineEvents).toHaveBeenCalled()
      expect(onEvent).toHaveBeenCalledTimes(1)
    })

    await ingestor.stop()

    expect(secretStore.getSecret).toHaveBeenCalledWith('keydb-1')
    expect(secretStore.getSecret).not.toHaveBeenCalledWith('mem-1')
  })
})
