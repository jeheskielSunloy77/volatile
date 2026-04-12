import { Client as MemjsClient } from 'memjs'
import { createClient, type RedisClientType } from 'redis'

import type {
	ConnectionDraft,
	ConnectionProfile,
	ConnectionSecret,
	KeyCountResult,
	ConnectionTestResult,
	KeyListResult,
	KeyValueRecord,
	ProviderCapabilities,
} from '../../../shared/contracts/cache'
import { isRedisFamilyEngine } from '../../../shared/lib/cache-engines'

import type {
	CacheGateway,
	EngineEventPollResult,
	MemcachedKeyIndexRepository,
} from '../../application/ports'
import { OperationFailure } from '../../domain/operation-failure'

const REDIS_CAPABILITIES: ProviderCapabilities = {
	supportsTTL: true,
	supportsMonitorStream: false,
	supportsSlowLog: true,
	supportsBulkDeletePreview: false,
	supportsSnapshotRestore: false,
	supportsPatternScan: true,
}

const MEMCACHED_CAPABILITIES: ProviderCapabilities = {
	supportsTTL: true,
	supportsMonitorStream: false,
	supportsSlowLog: false,
	supportsBulkDeletePreview: false,
	supportsSnapshotRestore: false,
	supportsPatternScan: true,
}

const MAX_SCAN_LOOP = 25

type EngineConnection = Pick<
	ConnectionProfile,
	'engine' | 'host' | 'port' | 'dbIndex' | 'tlsEnabled' | 'timeoutMs'
>

type RedisKeyType =
	| 'string'
	| 'list'
	| 'set'
	| 'zset'
	| 'hash'
	| 'stream'
	| 'none'
	| 'unknown'

export class DefaultCacheGateway implements CacheGateway {
	public constructor(
		private readonly memcachedIndexRepository: MemcachedKeyIndexRepository,
	) {}

	public getCapabilities(
		profile: Pick<ConnectionProfile, 'engine'>,
	): ProviderCapabilities {
		return isRedisFamilyEngine(profile.engine)
			? REDIS_CAPABILITIES
			: MEMCACHED_CAPABILITIES
	}

	public async testConnection(
		profile: ConnectionDraft,
		secret: ConnectionSecret,
	): Promise<ConnectionTestResult> {
		if (isRedisFamilyEngine(profile.engine)) {
			return this.testRedisConnection(profile, secret)
		}

		return this.testMemcachedConnection(profile, secret)
	}

	public async listKeys(
		profile: ConnectionProfile,
		secret: ConnectionSecret,
		args: { cursor?: string; limit: number },
	): Promise<KeyListResult> {
		if (isRedisFamilyEngine(profile.engine)) {
			return this.redisListKeys(profile, secret, args)
		}

		const keys = await this.memcachedIndexRepository.listKeys(
			profile.id,
			args.limit,
		)

		return {
			keys,
			nextCursor: undefined,
		}
	}

	public async searchKeys(
		profile: ConnectionProfile,
		secret: ConnectionSecret,
		args: { pattern: string; limit: number; cursor?: string },
	): Promise<KeyListResult> {
		if (isRedisFamilyEngine(profile.engine)) {
			return this.redisSearchKeys(profile, secret, args)
		}

		const keys = await this.memcachedIndexRepository.searchKeys(
			profile.id,
			args.pattern,
			args.limit,
			args.cursor,
		)
		const nextCursor =
			keys.length === args.limit && keys.length > 0
				? keys[keys.length - 1]
				: undefined

		return {
			keys,
			nextCursor,
		}
	}

	public async countKeys(
		profile: ConnectionProfile,
		secret: ConnectionSecret,
	): Promise<KeyCountResult> {
		if (isRedisFamilyEngine(profile.engine)) {
			return this.redisCountKeys(profile, secret)
		}

		return {
			totalKeys: await this.memcachedIndexRepository.countKeys(profile.id),
		}
	}

	public async countKeysByPattern(
		profile: ConnectionProfile,
		secret: ConnectionSecret,
		args: { pattern: string },
	): Promise<KeyCountResult> {
		if (isRedisFamilyEngine(profile.engine)) {
			return this.redisCountKeysByPattern(profile, secret, args)
		}

		const [totalKeys, totalFoundKeys] = await Promise.all([
			this.memcachedIndexRepository.countKeys(profile.id),
			this.memcachedIndexRepository.countKeysByPattern(profile.id, args.pattern),
		])

		return {
			totalKeys,
			totalFoundKeys,
		}
	}

	public async getValue(
		profile: ConnectionProfile,
		secret: ConnectionSecret,
		key: string,
	): Promise<KeyValueRecord> {
		if (isRedisFamilyEngine(profile.engine)) {
			return this.redisGetValue(profile, secret, key)
		}

		const client = this.createMemcachedClient(profile, secret)
		try {
			const result = await client.get(key)
			await this.memcachedIndexRepository.upsertKey(profile.id, key)

			const rawValue = result.value
			const value = rawValue ? rawValue.toString('utf8') : null

			return {
				key,
				value,
				ttlSeconds: null,
				supportsTTL: true,
				keyType: 'string',
				isStringEditable: true,
			}
		} catch (error) {
			throw this.toConnectionFailure(error)
		} finally {
			client.quit()
		}
	}

	public async setValue(
		profile: ConnectionProfile,
		secret: ConnectionSecret,
		args: { key: string; value: string; ttlSeconds?: number },
	): Promise<void> {
		if (isRedisFamilyEngine(profile.engine)) {
			await this.redisSetValue(profile, secret, args)
			return
		}

		const client = this.createMemcachedClient(profile, secret)
		try {
			await client.set(args.key, args.value, {
				expires: args.ttlSeconds ?? 0,
			})
			await this.memcachedIndexRepository.upsertKey(profile.id, args.key)
		} catch (error) {
			throw this.toConnectionFailure(error)
		} finally {
			client.quit()
		}
	}

	public async deleteKey(
		profile: ConnectionProfile,
		secret: ConnectionSecret,
		key: string,
	): Promise<void> {
		if (isRedisFamilyEngine(profile.engine)) {
			await this.redisDeleteKey(profile, secret, key)
			return
		}

		const client = this.createMemcachedClient(profile, secret)
		try {
			await client.delete(key)
			await this.memcachedIndexRepository.removeKey(profile.id, key)
		} catch (error) {
			throw this.toConnectionFailure(error)
		} finally {
			client.quit()
		}
	}

	public async pollEngineEvents(
		profile: ConnectionProfile,
		secret: ConnectionSecret,
		args: { cursor?: string; limit: number },
	): Promise<EngineEventPollResult> {
		if (!isRedisFamilyEngine(profile.engine)) {
			return {
				events: [],
				nextCursor: args.cursor,
			}
		}

		const client = this.createRedisClient(profile, secret)
		const sinceIdRaw = Number(args.cursor)
		const sinceId = Number.isFinite(sinceIdRaw) ? sinceIdRaw : -1
		const limit = Math.min(256, Math.max(1, args.limit))

		try {
			await client.connect()

			const rawEntries = await client.sendCommand([
				'SLOWLOG',
				'GET',
				String(limit),
			])
			if (!Array.isArray(rawEntries)) {
				return {
					events: [],
					nextCursor: args.cursor,
				}
			}

			const parsedEntries = rawEntries
				.map((entry) => parseRedisSlowLogEntry(entry))
				.filter((entry): entry is RedisSlowLogEntry => Boolean(entry))
				.filter((entry) => entry.id > sinceId)
				.sort((left, right) => left.id - right.id)

			const events = parsedEntries.map((entry) => ({
				timestamp: new Date(entry.startedAtSeconds * 1000).toISOString(),
				connectionId: profile.id,
				environment: profile.environment,
				action: `redis.slowlog.${entry.command.toLowerCase()}`,
				keyOrPattern: entry.keyOrPattern,
				durationMs: Math.max(1, Math.round(entry.durationMicroseconds / 1000)),
				status: 'success' as const,
				details: {
					slowlogId: entry.id,
					command: entry.command,
					args: entry.arguments,
					durationMicroseconds: entry.durationMicroseconds,
				},
			}))
			const nextCursor =
				parsedEntries.length > 0
					? String(parsedEntries[parsedEntries.length - 1].id)
					: args.cursor

			return {
				events,
				nextCursor,
			}
		} catch (error) {
			throw this.toConnectionFailure(error)
		} finally {
			await this.disconnectRedisClient(client)
		}
	}

	private async testRedisConnection(
		profile: EngineConnection,
		secret: ConnectionSecret,
	): Promise<ConnectionTestResult> {
		const client = this.createRedisClient(profile, secret)
		const startedAt = Date.now()

		try {
			await client.connect()
			await client.ping()

			return {
				latencyMs: Date.now() - startedAt,
				capabilities: REDIS_CAPABILITIES,
			}
		} catch (error) {
			throw this.toConnectionFailure(error)
		} finally {
			await this.disconnectRedisClient(client)
		}
	}

	private async testMemcachedConnection(
		profile: EngineConnection,
		secret: ConnectionSecret,
	): Promise<ConnectionTestResult> {
		const client = this.createMemcachedClient(profile, secret)
		const startedAt = Date.now()

		try {
			await client.get('__volatile_healthcheck__')

			return {
				latencyMs: Date.now() - startedAt,
				capabilities: MEMCACHED_CAPABILITIES,
			}
		} catch (error) {
			throw this.toConnectionFailure(error)
		} finally {
			client.quit()
		}
	}

	private async redisListKeys(
		profile: ConnectionProfile,
		secret: ConnectionSecret,
		args: { cursor?: string; limit: number },
	): Promise<KeyListResult> {
		const client = this.createRedisClient(profile, secret)

		try {
			await client.connect()

			const scanResult = await client.scan(args.cursor ?? '0', {
				MATCH: '*',
				COUNT: args.limit,
			})
			const nextCursor = toRedisText(scanResult.cursor)

			return {
				keys: scanResult.keys.map(toRedisText),
				nextCursor: nextCursor === '0' ? undefined : nextCursor,
			}
		} catch (error) {
			throw this.toConnectionFailure(error)
		} finally {
			await this.disconnectRedisClient(client)
		}
	}

	private async redisSearchKeys(
		profile: ConnectionProfile,
		secret: ConnectionSecret,
		args: { pattern: string; limit: number; cursor?: string },
	): Promise<KeyListResult> {
		const client = this.createRedisClient(profile, secret)
		const keySet = new Set<string>()

		try {
			await client.connect()

			let cursor = args.cursor ?? '0'
			let loopCount = 0

			do {
				const scanResult = await client.scan(cursor, {
					MATCH: args.pattern,
					COUNT: Math.min(500, Math.max(args.limit, 50)),
				})

				scanResult.keys.forEach((key) => keySet.add(toRedisText(key)))

				cursor = toRedisText(scanResult.cursor)
				loopCount += 1
			} while (
				cursor !== '0' &&
				keySet.size < args.limit &&
				loopCount < MAX_SCAN_LOOP
			)

			return {
				keys: Array.from(keySet).slice(0, args.limit),
				nextCursor: cursor === '0' ? undefined : cursor,
			}
		} catch (error) {
			throw this.toConnectionFailure(error)
		} finally {
			await this.disconnectRedisClient(client)
		}
	}

	private async redisCountKeys(
		profile: ConnectionProfile,
		secret: ConnectionSecret,
	): Promise<KeyCountResult> {
		const client = this.createRedisClient(profile, secret)

		try {
			await client.connect()
			const totalKeys = await client.dbSize()
			return {
				totalKeys,
			}
		} catch (error) {
			throw this.toConnectionFailure(error)
		} finally {
			await this.disconnectRedisClient(client)
		}
	}

	private async redisCountKeysByPattern(
		profile: ConnectionProfile,
		secret: ConnectionSecret,
		args: { pattern: string },
	): Promise<KeyCountResult> {
		const client = this.createRedisClient(profile, secret)
		const matches = new Set<string>()

		try {
			await client.connect()

			let cursor = '0'
			do {
				const scanResult = await client.scan(cursor, {
					MATCH: args.pattern,
					COUNT: 1000,
				})
				scanResult.keys.forEach((key) => {
					matches.add(toRedisText(key))
				})
				cursor = toRedisText(scanResult.cursor)
			} while (cursor !== '0')

			return {
				totalKeys: await client.dbSize(),
				totalFoundKeys: matches.size,
			}
		} catch (error) {
			throw this.toConnectionFailure(error)
		} finally {
			await this.disconnectRedisClient(client)
		}
	}

	private async redisGetValue(
		profile: ConnectionProfile,
		secret: ConnectionSecret,
		key: string,
	): Promise<KeyValueRecord> {
		const client = this.createRedisClient(profile, secret)

		try {
			await client.connect()

			const [keyTypeRaw, ttl] = await Promise.all([client.type(key), client.ttl(key)])
			const keyType = normalizeRedisKeyType(keyTypeRaw)
			const ttlNumber = Number(ttl)
			const value = await this.readRedisValueByType(client, key, keyType)

			return {
				key,
				value,
				ttlSeconds: Number.isFinite(ttlNumber) && ttlNumber >= 0 ? ttlNumber : null,
				supportsTTL: true,
				keyType,
				isStringEditable: keyType === 'string' || keyType === 'none',
			}
		} catch (error) {
			throw this.toConnectionFailure(error)
		} finally {
			await this.disconnectRedisClient(client)
		}
	}

	private async redisSetValue(
		profile: ConnectionProfile,
		secret: ConnectionSecret,
		args: { key: string; value: string; ttlSeconds?: number },
	): Promise<void> {
		const client = this.createRedisClient(profile, secret)

		try {
			await client.connect()
			if (typeof args.ttlSeconds === 'number') {
				await client.set(args.key, args.value, {
					EX: args.ttlSeconds,
				})
			} else {
				await client.set(args.key, args.value)
			}
		} catch (error) {
			throw this.toConnectionFailure(error)
		} finally {
			await this.disconnectRedisClient(client)
		}
	}

	private async redisDeleteKey(
		profile: ConnectionProfile,
		secret: ConnectionSecret,
		key: string,
	): Promise<void> {
		const client = this.createRedisClient(profile, secret)

		try {
			await client.connect()
			await client.del(key)
		} catch (error) {
			throw this.toConnectionFailure(error)
		} finally {
			await this.disconnectRedisClient(client)
		}
	}

	private createRedisClient(
		profile: EngineConnection,
		secret: ConnectionSecret,
	): RedisClientType {
		const socketBase = {
			host: profile.host,
			port: profile.port,
			connectTimeout: profile.timeoutMs,
		}

		const socket = profile.tlsEnabled
			? {
					...socketBase,
					tls: true as const,
				}
			: socketBase

		return createClient({
			socket,
			database: profile.dbIndex,
			username: secret.username,
			password: secret.password,
		})
	}

	private createMemcachedClient(
		profile: EngineConnection,
		secret: ConnectionSecret,
	) {
		return MemjsClient.create(`${profile.host}:${profile.port}`, {
			username: secret.username,
			password: secret.password,
			timeout: Math.max(0.1, profile.timeoutMs / 1000),
			conntimeout: Math.max(0.2, (profile.timeoutMs * 2) / 1000),
		})
	}

	private toConnectionFailure(cause: unknown): OperationFailure {
		const message =
			cause instanceof Error
				? cause.message
				: 'Connection operation failed unexpectedly.'

		return new OperationFailure('CONNECTION_FAILED', message, true)
	}

	private async disconnectRedisClient(client: RedisClientType): Promise<void> {
		if (!client.isOpen) {
			return
		}

		await client.disconnect().catch((error: unknown): void => {
			void error
		})
	}

	private async readRedisValueByType(
		client: RedisClientType,
		key: string,
		keyType: RedisKeyType,
	): Promise<string | null> {
		switch (keyType) {
			case 'none':
				return null
			case 'string': {
				const value = await client.get(key)
				return value === null ? null : toRedisText(value)
			}
			case 'hash': {
				const value = await client.hGetAll(key)
				return serializeRedisStructuredValue(value)
			}
			case 'list': {
				const values = await client.lRange(key, 0, -1)
				return serializeRedisStructuredValue(values.map(toRedisText))
			}
			case 'set': {
				const values = await client.sMembers(key)
				return serializeRedisStructuredValue(values.map(toRedisText))
			}
			case 'zset': {
				const values = await client.sendCommand(['ZRANGE', key, '0', '-1', 'WITHSCORES'])
				return serializeRedisStructuredValue(parseRedisZsetEntries(values))
			}
			case 'stream': {
				const entries = await client.sendCommand(['XRANGE', key, '-', '+'])
				return serializeRedisStructuredValue(parseRedisStreamEntries(entries))
			}
			case 'unknown':
			default: {
				const value = await client.sendCommand(['DUMP', key])
				return serializeRedisStructuredValue({
					type: keyType,
					dump: value === null ? null : toRedisText(value),
				})
			}
		}
	}
}

const toRedisText = (value: unknown): string => {
	if (typeof value === 'string') {
		return value
	}

	if (Buffer.isBuffer(value)) {
		return value.toString('utf8')
	}

	return String(value)
}

const normalizeRedisKeyType = (value: unknown): RedisKeyType => {
	const normalized = toRedisText(value).toLowerCase()

	switch (normalized) {
		case 'string':
		case 'list':
		case 'set':
		case 'zset':
		case 'hash':
		case 'stream':
		case 'none':
			return normalized
		default:
			return 'unknown'
	}
}

const serializeRedisStructuredValue = (value: unknown): string =>
	JSON.stringify(value, null, 2)

const parseRedisZsetEntries = (value: unknown): Array<{ member: string; score: number }> => {
	if (!Array.isArray(value)) {
		return []
	}

	const entries: Array<{ member: string; score: number }> = []
	for (let index = 0; index < value.length; index += 2) {
		const member = value[index]
		const score = value[index + 1]
		if (member === undefined || score === undefined) {
			continue
		}

		entries.push({
			member: toRedisText(member),
			score: Number(score),
		})
	}

	return entries
}

const parseRedisStreamEntries = (
	value: unknown,
): Array<{ id: string; fields: Record<string, string> }> => {
	if (!Array.isArray(value)) {
		return []
	}

	const entries: Array<{ id: string; fields: Record<string, string> }> = []
	for (const entry of value) {
		if (!Array.isArray(entry) || entry.length < 2) {
			continue
		}

		const [id, fieldsRaw] = entry
		const fields: Record<string, string> = {}
		if (Array.isArray(fieldsRaw)) {
			for (let index = 0; index < fieldsRaw.length; index += 2) {
				const field = fieldsRaw[index]
				const fieldValue = fieldsRaw[index + 1]
				if (field === undefined || fieldValue === undefined) {
					continue
				}

				fields[toRedisText(field)] = toRedisText(fieldValue)
			}
		}

		entries.push({
			id: toRedisText(id),
			fields,
		})
	}

	return entries
}

type RedisSlowLogEntry = {
	id: number
	startedAtSeconds: number
	durationMicroseconds: number
	command: string
	keyOrPattern: string
	arguments: string[]
}

const parseRedisSlowLogEntry = (entry: unknown): RedisSlowLogEntry | null => {
	if (!Array.isArray(entry) || entry.length < 4) {
		return null
	}

	const id = Number(entry[0])
	const startedAtSeconds = Number(entry[1])
	const durationMicroseconds = Number(entry[2])
	if (
		!Number.isFinite(id) ||
		!Number.isFinite(startedAtSeconds) ||
		!Number.isFinite(durationMicroseconds)
	) {
		return null
	}

	const rawCommand = entry[3]
	const commandTokens = Array.isArray(rawCommand)
		? rawCommand.map((token) => toRedisText(token))
		: [toRedisText(rawCommand)]

	if (commandTokens.length === 0) {
		return null
	}

	const command = commandTokens[0].trim().toUpperCase() || 'UNKNOWN'
	const commandArguments = commandTokens.slice(1)
	const keyOrPattern = commandArguments[0] ?? command

	return {
		id: Math.trunc(id),
		startedAtSeconds: Math.trunc(startedAtSeconds),
		durationMicroseconds: Math.max(0, Math.trunc(durationMicroseconds)),
		command,
		keyOrPattern,
		arguments: commandArguments,
	}
}
