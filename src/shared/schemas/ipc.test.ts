import { describe, expect, it } from 'vitest'

import { commandEnvelopeSchema, queryEnvelopeSchema } from './ipc'

describe('commandEnvelopeSchema', () => {
  it('accepts a valid connection create payload', () => {
    const parsed = commandEnvelopeSchema.parse({
      command: 'connection.create',
      correlationId: 'abc-123',
      payload: {
        profile: {
          name: 'local redis',
          engine: 'redis',
          host: '127.0.0.1',
          port: 6379,
          dbIndex: 0,
          tlsEnabled: false,
          environment: 'dev',
          tags: ['local'],
          readOnly: false,
          timeoutMs: 5000,
        },
        secret: {
          password: 'secret',
        },
      },
    })

    expect(parsed.command).toBe('connection.create')
    if (parsed.command === 'connection.create') {
      expect(parsed.payload.profile.retryMaxAttempts).toBe(1)
      expect(parsed.payload.profile.forceReadOnly).toBe(false)
    }
  })

  it('accepts Redis-family payloads with dbIndex', () => {
    const parsed = commandEnvelopeSchema.parse({
      command: 'connection.create',
      correlationId: 'abc-124',
      payload: {
        profile: {
          name: 'local valkey',
          engine: 'valkey',
          host: '127.0.0.1',
          port: 6379,
          dbIndex: 2,
          tlsEnabled: false,
          environment: 'dev',
          tags: ['local'],
          readOnly: false,
          timeoutMs: 5000,
        },
        secret: {},
      },
    })

    expect(parsed.command).toBe('connection.create')
  })

  it('rejects memcached payloads with dbIndex', () => {
    expect(() =>
      commandEnvelopeSchema.parse({
        command: 'connection.create',
        correlationId: 'abc-123',
        payload: {
          profile: {
            name: 'local memcached',
            engine: 'memcached',
            host: '127.0.0.1',
            port: 11211,
            dbIndex: 1,
            tlsEnabled: false,
            environment: 'dev',
            tags: ['local'],
            readOnly: false,
            timeoutMs: 5000,
          },
          secret: {},
        },
      }),
    ).toThrowError()
  })

  it('accepts workflow execute payloads', () => {
    const parsed = commandEnvelopeSchema.parse({
      command: 'workflow.execute',
      correlationId: 'wf-1',
      payload: {
        connectionId: 'conn-1',
        template: {
          name: 'Delete sessions',
          kind: 'deleteByPattern',
          parameters: {
            pattern: 'session:*',
          },
          requiresApprovalOnProd: true,
          supportsDryRun: true,
        },
        dryRun: true,
      },
    })

    expect(parsed.command).toBe('workflow.execute')
  })

  it('accepts typed key.set payloads for Redis structures', () => {
    const parsed = commandEnvelopeSchema.parse({
      command: 'key.set',
      correlationId: 'key-set-typed-1',
      payload: {
        connectionId: 'conn-1',
        key: 'leaderboard',
        value: {
          kind: 'zset',
          entries: [
            { member: 'alice', score: 10 },
            { member: 'bob', score: 4.5 },
          ],
        },
        ttlSeconds: 60,
      },
    })

    expect(parsed.command).toBe('key.set')
  })

  it('rejects typed key.set payloads with invalid numeric scores', () => {
    expect(() =>
      commandEnvelopeSchema.parse({
        command: 'key.set',
        correlationId: 'key-set-typed-2',
        payload: {
          connectionId: 'conn-1',
          key: 'leaderboard',
          value: {
            kind: 'zset',
            entries: [{ member: 'alice', score: Number.NaN }],
          },
        },
      }),
    ).toThrowError()
  })

  it('accepts key.update payloads for rename and type changes', () => {
    const parsed = commandEnvelopeSchema.parse({
      command: 'key.update',
      correlationId: 'key-update-1',
      payload: {
        connectionId: 'conn-1',
        currentKey: 'session:1',
        key: 'session:2',
        value: {
          kind: 'hash',
          entries: [{ field: 'status', value: 'active' }],
        },
        ttlSeconds: 300,
      },
    })

    expect(parsed.command).toBe('key.update')
  })

  it('rejects workflow execute payloads with no template source', () => {
    expect(() =>
      commandEnvelopeSchema.parse({
        command: 'workflow.execute',
        correlationId: 'wf-2',
        payload: {
          connectionId: 'conn-1',
        },
      }),
    ).toThrowError()
  })

  it('accepts connection tests with optional connectionId', () => {
    const parsed = commandEnvelopeSchema.parse({
      command: 'connection.test',
      correlationId: 'abc-123',
      payload: {
        connectionId: 'conn-1',
        profile: {
          name: 'local redis',
          engine: 'redis',
          host: '127.0.0.1',
          port: 6379,
          dbIndex: 0,
          tlsEnabled: false,
          environment: 'dev',
          tags: ['local'],
          readOnly: false,
          timeoutMs: 5000,
        },
        secret: {},
      },
    })

    expect(parsed.command).toBe('connection.test')
    expect((parsed.payload as { connectionId?: string }).connectionId).toBe(
      'conn-1',
    )
  })

  it('accepts incident bundle export payloads', () => {
    const parsed = commandEnvelopeSchema.parse({
      command: 'incident.bundle.export',
      correlationId: 'incident-1',
      payload: {
        from: '2026-02-17T00:00:00.000Z',
        to: '2026-02-17T01:00:00.000Z',
        includes: ['timeline', 'diagnostics', 'metrics'],
        redactionProfile: 'strict',
        destinationPath: '/tmp/incident.json',
      },
    })

    expect(parsed.command).toBe('incident.bundle.export')
  })

  it('accepts mark-all-alerts-read commands', () => {
    const parsed = commandEnvelopeSchema.parse({
      command: 'alert.markAllRead',
      correlationId: 'alert-all-read-1',
      payload: {},
    })

    expect(parsed.command).toBe('alert.markAllRead')
  })

  it('accepts delete-all-alerts commands', () => {
    const parsed = commandEnvelopeSchema.parse({
      command: 'alert.deleteAll',
      correlationId: 'alert-delete-all-1',
      payload: {},
    })

    expect(parsed.command).toBe('alert.deleteAll')
  })

  it('accepts cache.flush commands for namespace scope', () => {
    const parsed = commandEnvelopeSchema.parse({
      command: 'cache.flush',
      correlationId: 'cache-flush-1',
      payload: {
        connectionId: 'conn-1',
        namespaceId: 'namespace-1',
        scope: 'namespace',
        guardrailConfirmed: true,
      },
    })

    expect(parsed.command).toBe('cache.flush')
  })

  it('rejects namespace cache.flush commands without namespaceId', () => {
    expect(() =>
      commandEnvelopeSchema.parse({
        command: 'cache.flush',
        correlationId: 'cache-flush-2',
        payload: {
          connectionId: 'conn-1',
          scope: 'namespace',
        },
      }),
    ).toThrowError()
  })

  it('rejects governance policy packs with invalid execution windows', () => {
    expect(() =>
      commandEnvelopeSchema.parse({
        command: 'policy.pack.create',
        correlationId: 'policy-1',
        payload: {
          policyPack: {
            name: 'Night Window',
            environments: ['prod'],
            maxWorkflowItems: 500,
            maxRetryAttempts: 3,
            schedulingEnabled: true,
            executionWindows: [
              {
                id: 'window-1',
                weekdays: ['mon'],
                startTime: '24:00',
                endTime: '01:00',
                timezone: 'UTC',
              },
            ],
            enabled: true,
          },
        },
      }),
    ).toThrowError()
  })
})

describe('queryEnvelopeSchema', () => {
  it('accepts a valid key lookup query', () => {
    const parsed = queryEnvelopeSchema.parse({
      query: 'key.get',
      correlationId: 'xyz-1',
      payload: {
        connectionId: 'conn-1',
        key: 'user:1',
      },
    })

    expect(parsed.query).toBe('key.get')
  })

  it('accepts key search with optional cursor', () => {
    const parsed = queryEnvelopeSchema.parse({
      query: 'key.search',
      correlationId: 'xyz-2',
      payload: {
        connectionId: 'conn-1',
        pattern: 'user:*',
        cursor: '42',
        limit: 100,
      },
    })

    expect(parsed.query).toBe('key.search')
    expect((parsed.payload as { cursor?: string }).cursor).toBe('42')
  })

  it('accepts key count queries with optional pattern', () => {
    const parsed = queryEnvelopeSchema.parse({
      query: 'key.count',
      correlationId: 'xyz-2b',
      payload: {
        connectionId: 'conn-1',
        pattern: 'user:*',
      },
    })

    expect(parsed.query).toBe('key.count')
    expect((parsed.payload as { pattern?: string }).pattern).toBe('user:*')
  })

  it('accepts workflow preview queries', () => {
    const parsed = queryEnvelopeSchema.parse({
      query: 'workflow.preview',
      correlationId: 'xyz-3',
      payload: {
        connectionId: 'conn-1',
        templateId: 'template-1',
      },
    })

    expect(parsed.query).toBe('workflow.preview')
  })

  it('accepts workflow preview pagination fields', () => {
    const parsed = queryEnvelopeSchema.parse({
      query: 'workflow.preview',
      correlationId: 'xyz-3b',
      payload: {
        connectionId: 'conn-1',
        templateId: 'template-1',
        cursor: '20',
        limit: 50,
      },
    })

    expect(parsed.query).toBe('workflow.preview')
    expect((parsed.payload as { cursor?: string }).cursor).toBe('20')
    expect((parsed.payload as { limit?: number }).limit).toBe(50)
  })

  it('accepts alert list queries', () => {
    const parsed = queryEnvelopeSchema.parse({
      query: 'alert.list',
      correlationId: 'xyz-4',
      payload: {
        unreadOnly: true,
        limit: 25,
      },
    })

    expect(parsed.query).toBe('alert.list')
  })

  it('accepts unread alert count queries', () => {
    const parsed = queryEnvelopeSchema.parse({
      query: 'alert.unread.count',
      correlationId: 'xyz-4b',
      payload: {},
    })

    expect(parsed.query).toBe('alert.unread.count')
  })

  it('accepts compare period queries', () => {
    const parsed = queryEnvelopeSchema.parse({
      query: 'observability.comparePeriods',
      correlationId: 'cmp-1',
      payload: {
        baselineFrom: '2026-02-10T00:00:00.000Z',
        baselineTo: '2026-02-10T23:59:59.999Z',
        compareFrom: '2026-02-17T00:00:00.000Z',
        compareTo: '2026-02-17T23:59:59.999Z',
      },
    })

    expect(parsed.query).toBe('observability.comparePeriods')
  })

  it('accepts incident bundle preview queries', () => {
    const parsed = queryEnvelopeSchema.parse({
      query: 'incident.bundle.preview',
      correlationId: 'incident-preview',
      payload: {
        from: '2026-02-17T00:00:00.000Z',
        to: '2026-02-17T01:00:00.000Z',
        includes: ['timeline', 'logs'],
        redactionProfile: 'default',
      },
    })

    expect(parsed.query).toBe('incident.bundle.preview')
  })
})
