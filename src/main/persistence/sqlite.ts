import fs from 'node:fs'
import path from 'node:path'

import BetterSqlite3 from 'better-sqlite3'

import type {
  AlertEvent,
  AlertListRequest,
  AlertRule,
  ConnectionProfile,
  NamespaceProfile,
  GovernanceAssignment,
  GovernanceAssignmentListRequest,
  GovernancePolicyPack,
  HistoryEvent,
  HistoryQueryRequest,
  IncidentBundle,
  ObservabilitySnapshot,
  RetentionPolicy,
  RetentionPurgeRequest,
  RetentionPurgeResult,
  SnapshotRecord,
  StorageSummary,
  StorageDatasetSummary,
  WorkflowExecutionListRequest,
  WorkflowExecutionRecord,
  WorkflowStepResult,
  WorkflowTemplate,
} from '../../shared/contracts/cache'
import type {
  AlertRepository,
  AlertRuleRepository,
  ConnectionRepository,
  GovernanceAssignmentRepository,
  GovernancePolicyPackRepository,
  HistoryRepository,
  IncidentBundleRepository,
  MemcachedKeyIndexRepository,
  NamespaceRepository,
  ObservabilityRepository,
  RetentionRepository,
  SnapshotRepository,
  WorkflowExecutionRepository,
  WorkflowTemplateRepository,
} from '../application/ports'

const ensureDirectory = (dbPath: string): void => {
  const directory = path.dirname(dbPath)
  fs.mkdirSync(directory, { recursive: true })
}

const addColumnIfMissing = (
  db: BetterSqlite3.Database,
  tableName: string,
  columnName: string,
  definition: string,
): void => {
  const columns = db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all() as Array<{ name: string }>

  if (columns.some((column) => column.name === columnName)) {
    return
  }

  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`)
}

export const createSqliteDatabase = (
  dbPath: string,
): BetterSqlite3.Database => {
  ensureDirectory(dbPath)

  const db = new BetterSqlite3(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  runMigrations(db)

  return db
}

const runMigrations = (db: BetterSqlite3.Database): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS connection_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      engine TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      db_index INTEGER,
      tls_enabled INTEGER NOT NULL,
      environment TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      secret_ref TEXT NOT NULL,
      read_only INTEGER NOT NULL,
      force_read_only INTEGER NOT NULL DEFAULT 0,
      timeout_ms INTEGER NOT NULL,
      retry_max_attempts INTEGER NOT NULL DEFAULT 1,
      retry_backoff_ms INTEGER NOT NULL DEFAULT 250,
      retry_backoff_strategy TEXT NOT NULL DEFAULT 'fixed',
      retry_abort_on_error_rate REAL NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS connection_namespaces (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      name TEXT NOT NULL,
      engine TEXT NOT NULL,
      strategy TEXT NOT NULL,
      db_index INTEGER,
      key_prefix TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (connection_id) REFERENCES connection_profiles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS memcached_key_index (
      connection_id TEXT NOT NULL,
      cache_key TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (connection_id, cache_key),
      FOREIGN KEY (connection_id) REFERENCES connection_profiles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS key_snapshots (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      cache_key TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      redacted_value_hash TEXT NOT NULL,
      value_text TEXT,
      ttl_seconds INTEGER,
      reason TEXT NOT NULL,
      FOREIGN KEY (connection_id) REFERENCES connection_profiles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS workflow_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      parameters_json TEXT NOT NULL,
      requires_approval_on_prod INTEGER NOT NULL,
      supports_dry_run INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workflow_executions (
      id TEXT PRIMARY KEY,
      workflow_template_id TEXT,
      workflow_name TEXT NOT NULL,
      workflow_kind TEXT NOT NULL,
      connection_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL,
      retry_count INTEGER NOT NULL,
      dry_run INTEGER NOT NULL,
      parameters_json TEXT NOT NULL,
      step_results_json TEXT NOT NULL,
      checkpoint_token TEXT,
      policy_pack_id TEXT,
      schedule_window_id TEXT,
      resumed_from_execution_id TEXT,
      error_message TEXT,
      FOREIGN KEY (connection_id) REFERENCES connection_profiles(id) ON DELETE CASCADE,
      FOREIGN KEY (workflow_template_id) REFERENCES workflow_templates(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS history_events (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      source TEXT NOT NULL,
      connection_id TEXT NOT NULL,
      environment TEXT NOT NULL,
      action TEXT NOT NULL,
      key_or_pattern TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      status TEXT NOT NULL,
      redacted_diff TEXT,
      error_code TEXT,
      retryable INTEGER,
      details_json TEXT,
      FOREIGN KEY (connection_id) REFERENCES connection_profiles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS observability_snapshots (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      latency_p50_ms REAL NOT NULL,
      latency_p95_ms REAL NOT NULL,
      error_rate REAL NOT NULL,
      reconnect_count INTEGER NOT NULL,
      ops_per_second REAL NOT NULL,
      slow_op_count INTEGER NOT NULL,
      FOREIGN KEY (connection_id) REFERENCES connection_profiles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS alert_events (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      connection_id TEXT,
      environment TEXT,
      severity TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      source TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS alert_rules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      metric TEXT NOT NULL,
      threshold REAL NOT NULL,
      lookback_minutes INTEGER NOT NULL,
      severity TEXT NOT NULL,
      connection_id TEXT,
      environment TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (connection_id) REFERENCES connection_profiles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS governance_policy_packs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      environments_json TEXT NOT NULL,
      max_workflow_items INTEGER NOT NULL,
      max_retry_attempts INTEGER NOT NULL,
      scheduling_enabled INTEGER NOT NULL,
      execution_windows_json TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS governance_assignments (
      connection_id TEXT PRIMARY KEY,
      policy_pack_id TEXT,
      assigned_at TEXT NOT NULL,
      FOREIGN KEY (connection_id) REFERENCES connection_profiles(id) ON DELETE CASCADE,
      FOREIGN KEY (policy_pack_id) REFERENCES governance_policy_packs(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS incident_bundles (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      from_ts TEXT NOT NULL,
      to_ts TEXT NOT NULL,
      connection_ids_json TEXT NOT NULL,
      includes_json TEXT NOT NULL,
      redaction_profile TEXT NOT NULL,
      checksum TEXT NOT NULL,
      artifact_path TEXT NOT NULL,
      timeline_count INTEGER NOT NULL,
      log_count INTEGER NOT NULL,
      diagnostic_count INTEGER NOT NULL,
      metric_count INTEGER NOT NULL,
      truncated INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS retention_policies (
      dataset TEXT PRIMARY KEY,
      retention_days INTEGER NOT NULL,
      storage_budget_mb INTEGER NOT NULL,
      auto_purge_oldest INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_connection_profiles_engine ON connection_profiles(engine);
    CREATE INDEX IF NOT EXISTS idx_connection_profiles_name ON connection_profiles(name);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_connection_namespaces_connection_name_ci
      ON connection_namespaces(connection_id, lower(name));
    CREATE INDEX IF NOT EXISTS idx_connection_namespaces_connection_id
      ON connection_namespaces(connection_id);
    CREATE INDEX IF NOT EXISTS idx_memcached_key_index_connection_id ON memcached_key_index(connection_id);
    CREATE INDEX IF NOT EXISTS idx_key_snapshots_lookup ON key_snapshots(connection_id, cache_key, captured_at DESC);
    CREATE INDEX IF NOT EXISTS idx_workflow_executions_connection ON workflow_executions(connection_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_history_events_connection ON history_events(connection_id, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_history_events_status ON history_events(status, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_observability_connection ON observability_snapshots(connection_id, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_alert_events_read ON alert_events(is_read, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_alert_rules_enabled ON alert_rules(enabled, metric, severity);
    CREATE INDEX IF NOT EXISTS idx_governance_assignments_policy_pack ON governance_assignments(policy_pack_id);
    CREATE INDEX IF NOT EXISTS idx_incident_bundles_created_at ON incident_bundles(created_at DESC);
  `)

  addColumnIfMissing(
    db,
    'connection_profiles',
    'force_read_only',
    'INTEGER NOT NULL DEFAULT 0',
  )
  addColumnIfMissing(
    db,
    'connection_profiles',
    'retry_max_attempts',
    'INTEGER NOT NULL DEFAULT 1',
  )
  addColumnIfMissing(
    db,
    'connection_profiles',
    'retry_backoff_ms',
    'INTEGER NOT NULL DEFAULT 250',
  )
  addColumnIfMissing(
    db,
    'connection_profiles',
    'retry_backoff_strategy',
    "TEXT NOT NULL DEFAULT 'fixed'",
  )
  addColumnIfMissing(
    db,
    'connection_profiles',
    'retry_abort_on_error_rate',
    'REAL NOT NULL DEFAULT 1',
  )
  addColumnIfMissing(
    db,
    'workflow_executions',
    'checkpoint_token',
    'TEXT',
  )
  addColumnIfMissing(
    db,
    'workflow_executions',
    'policy_pack_id',
    'TEXT',
  )
  addColumnIfMissing(
    db,
    'workflow_executions',
    'schedule_window_id',
    'TEXT',
  )
  addColumnIfMissing(
    db,
    'workflow_executions',
    'resumed_from_execution_id',
    'TEXT',
  )
  addColumnIfMissing(
    db,
    'incident_bundles',
    'truncated',
    'INTEGER NOT NULL DEFAULT 0',
  )

  const upsertRetentionDefaults = db.prepare(`
    INSERT INTO retention_policies (
      dataset,
      retention_days,
      storage_budget_mb,
      auto_purge_oldest
    ) VALUES (?, ?, ?, ?)
    ON CONFLICT(dataset) DO NOTHING
  `)

  for (const dataset of [
    'timelineEvents',
    'observabilitySnapshots',
    'workflowHistory',
    'incidentArtifacts',
  ]) {
    upsertRetentionDefaults.run(dataset, 30, 512, 1)
  }
}

type ConnectionRow = {
  id: string
  name: string
  engine: ConnectionProfile['engine']
  host: string
  port: number
  db_index: number | null
  tls_enabled: 0 | 1
  environment: 'dev' | 'staging' | 'prod'
  tags_json: string
  secret_ref: string
  read_only: 0 | 1
  force_read_only: 0 | 1
  timeout_ms: number
  retry_max_attempts: number
  retry_backoff_ms: number
  retry_backoff_strategy: 'fixed' | 'exponential'
  retry_abort_on_error_rate: number
  created_at: string
  updated_at: string
}

const parseJson = <T>(raw: string, fallback: T): T => {
  try {
    return JSON.parse(raw) as T
  } catch (error) {
    void error
    return fallback
  }
}

const rowToConnectionProfile = (row: ConnectionRow): ConnectionProfile => ({
  id: row.id,
  name: row.name,
  engine: row.engine,
  host: row.host,
  port: row.port,
  dbIndex: row.db_index ?? undefined,
  tlsEnabled: row.tls_enabled === 1,
  environment: row.environment,
  tags: parseJson<string[]>(row.tags_json, []),
  secretRef: row.secret_ref,
  readOnly: row.read_only === 1,
  forceReadOnly: row.force_read_only === 1,
  timeoutMs: row.timeout_ms,
  retryMaxAttempts: row.retry_max_attempts,
  retryBackoffMs: row.retry_backoff_ms,
  retryBackoffStrategy: row.retry_backoff_strategy,
  retryAbortOnErrorRate: row.retry_abort_on_error_rate,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

export class SqliteConnectionRepository implements ConnectionRepository {
  private readonly listStatement: BetterSqlite3.Statement<[], ConnectionRow>

  private readonly findByIdStatement: BetterSqlite3.Statement<
    [string],
    ConnectionRow
  >

  private readonly saveStatement: BetterSqlite3.Statement<[
    string,
    string,
    ConnectionProfile['engine'],
    string,
    number,
    number | null,
    number,
    'dev' | 'staging' | 'prod',
    string,
    string,
    number,
    number,
    number,
    number,
    number,
    string,
    number,
    string,
    string,
  ]>

  private readonly deleteStatement: BetterSqlite3.Statement<[string]>

  public constructor(private readonly db: BetterSqlite3.Database) {
    this.listStatement = this.db.prepare<[], ConnectionRow>(`
      SELECT
        id,
        name,
        engine,
        host,
        port,
        db_index,
        tls_enabled,
        environment,
        tags_json,
        secret_ref,
        read_only,
        force_read_only,
        timeout_ms,
        retry_max_attempts,
        retry_backoff_ms,
        retry_backoff_strategy,
        retry_abort_on_error_rate,
        created_at,
        updated_at
      FROM connection_profiles
      ORDER BY name COLLATE NOCASE ASC
    `)

    this.findByIdStatement = this.db.prepare<[string], ConnectionRow>(`
      SELECT
        id,
        name,
        engine,
        host,
        port,
        db_index,
        tls_enabled,
        environment,
        tags_json,
        secret_ref,
        read_only,
        force_read_only,
        timeout_ms,
        retry_max_attempts,
        retry_backoff_ms,
        retry_backoff_strategy,
        retry_abort_on_error_rate,
        created_at,
        updated_at
      FROM connection_profiles
      WHERE id = ?
      LIMIT 1
    `)

    this.saveStatement = this.db.prepare(`
      INSERT INTO connection_profiles (
        id,
        name,
        engine,
        host,
        port,
        db_index,
        tls_enabled,
        environment,
        tags_json,
        secret_ref,
        read_only,
        force_read_only,
        timeout_ms,
        retry_max_attempts,
        retry_backoff_ms,
        retry_backoff_strategy,
        retry_abort_on_error_rate,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        engine = excluded.engine,
        host = excluded.host,
        port = excluded.port,
        db_index = excluded.db_index,
        tls_enabled = excluded.tls_enabled,
        environment = excluded.environment,
        tags_json = excluded.tags_json,
        secret_ref = excluded.secret_ref,
        read_only = excluded.read_only,
        force_read_only = excluded.force_read_only,
        timeout_ms = excluded.timeout_ms,
        retry_max_attempts = excluded.retry_max_attempts,
        retry_backoff_ms = excluded.retry_backoff_ms,
        retry_backoff_strategy = excluded.retry_backoff_strategy,
        retry_abort_on_error_rate = excluded.retry_abort_on_error_rate,
        updated_at = excluded.updated_at
    `)

    this.deleteStatement = this.db.prepare('DELETE FROM connection_profiles WHERE id = ?')
  }

  public async list(): Promise<ConnectionProfile[]> {
    const rows = this.listStatement.all()
    return rows.map(rowToConnectionProfile)
  }

  public async findById(id: string): Promise<ConnectionProfile | null> {
    const row = this.findByIdStatement.get(id)
    if (!row) {
      return null
    }

    return rowToConnectionProfile(row)
  }

  public async save(profile: ConnectionProfile): Promise<void> {
    this.saveStatement.run(
      profile.id,
      profile.name,
      profile.engine,
      profile.host,
      profile.port,
      profile.dbIndex ?? null,
      profile.tlsEnabled ? 1 : 0,
      profile.environment,
      JSON.stringify(profile.tags),
      profile.secretRef,
      profile.readOnly ? 1 : 0,
      profile.forceReadOnly ? 1 : 0,
      profile.timeoutMs,
      profile.retryMaxAttempts ?? 1,
      profile.retryBackoffMs ?? 250,
      profile.retryBackoffStrategy ?? 'fixed',
      profile.retryAbortOnErrorRate ?? 1,
      profile.createdAt,
      profile.updatedAt,
    )
  }

  public async delete(id: string): Promise<void> {
    this.deleteStatement.run(id)
  }
}

type NamespaceRow = {
  id: string
  connection_id: string
  name: string
  engine: ConnectionProfile['engine']
  strategy: 'redisLogicalDb' | 'keyPrefix'
  db_index: number | null
  key_prefix: string | null
  created_at: string
  updated_at: string
}

const rowToNamespace = (row: NamespaceRow): NamespaceProfile => ({
  id: row.id,
  connectionId: row.connection_id,
  name: row.name,
  engine: row.engine,
  strategy: row.strategy,
  dbIndex: row.db_index ?? undefined,
  keyPrefix: row.key_prefix ?? undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

export class SqliteNamespaceRepository implements NamespaceRepository {
  private readonly listByConnectionStatement: BetterSqlite3.Statement<
    [string],
    NamespaceRow
  >

  private readonly findByIdStatement: BetterSqlite3.Statement<[string], NamespaceRow>

  private readonly saveStatement: BetterSqlite3.Statement<
    [
      string,
      string,
      string,
      ConnectionProfile['engine'],
      'redisLogicalDb' | 'keyPrefix',
      number | null,
      string | null,
      string,
      string,
    ]
  >

  private readonly deleteStatement: BetterSqlite3.Statement<[string]>

  public constructor(private readonly db: BetterSqlite3.Database) {
    this.listByConnectionStatement = this.db.prepare<[string], NamespaceRow>(`
      SELECT
        id,
        connection_id,
        name,
        engine,
        strategy,
        db_index,
        key_prefix,
        created_at,
        updated_at
      FROM connection_namespaces
      WHERE connection_id = ?
      ORDER BY name COLLATE NOCASE ASC
    `)

    this.findByIdStatement = this.db.prepare<[string], NamespaceRow>(`
      SELECT
        id,
        connection_id,
        name,
        engine,
        strategy,
        db_index,
        key_prefix,
        created_at,
        updated_at
      FROM connection_namespaces
      WHERE id = ?
      LIMIT 1
    `)

    this.saveStatement = this.db.prepare(`
      INSERT INTO connection_namespaces (
        id,
        connection_id,
        name,
        engine,
        strategy,
        db_index,
        key_prefix,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        connection_id = excluded.connection_id,
        name = excluded.name,
        engine = excluded.engine,
        strategy = excluded.strategy,
        db_index = excluded.db_index,
        key_prefix = excluded.key_prefix,
        updated_at = excluded.updated_at
    `)

    this.deleteStatement = this.db.prepare(
      'DELETE FROM connection_namespaces WHERE id = ?',
    )
  }

  public async listByConnectionId(connectionId: string): Promise<NamespaceProfile[]> {
    const rows = this.listByConnectionStatement.all(connectionId)
    return rows.map(rowToNamespace)
  }

  public async findById(id: string): Promise<NamespaceProfile | null> {
    const row = this.findByIdStatement.get(id)
    if (!row) {
      return null
    }

    return rowToNamespace(row)
  }

  public async save(namespace: NamespaceProfile): Promise<void> {
    this.saveStatement.run(
      namespace.id,
      namespace.connectionId,
      namespace.name,
      namespace.engine,
      namespace.strategy,
      namespace.dbIndex ?? null,
      namespace.keyPrefix ?? null,
      namespace.createdAt,
      namespace.updatedAt,
    )
  }

  public async delete(id: string): Promise<void> {
    this.deleteStatement.run(id)
  }
}

export class SqliteMemcachedKeyIndexRepository
  implements MemcachedKeyIndexRepository
{
  private readonly listStatement: BetterSqlite3.Statement<
    [string, number],
    { cache_key: string }
  >

  private readonly countStatement: BetterSqlite3.Statement<
    [string],
    { total: number }
  >

  private readonly searchStatement: BetterSqlite3.Statement<
    [string, string, string | null, string | null, number],
    { cache_key: string }
  >

  private readonly countByPatternStatement: BetterSqlite3.Statement<
    [string, string],
    { total: number }
  >

  private readonly upsertStatement: BetterSqlite3.Statement<
    [string, string, string]
  >

  private readonly removeStatement: BetterSqlite3.Statement<[string, string]>

  private readonly removeByConnectionStatement: BetterSqlite3.Statement<
    [string]
  >

  public constructor(private readonly db: BetterSqlite3.Database) {
    this.listStatement = this.db.prepare<[string, number], { cache_key: string }>(`
      SELECT cache_key
      FROM memcached_key_index
      WHERE connection_id = ?
      ORDER BY cache_key COLLATE NOCASE ASC
      LIMIT ?
    `)

    this.countStatement = this.db.prepare<[string], { total: number }>(`
      SELECT COUNT(*) AS total
      FROM memcached_key_index
      WHERE connection_id = ?
    `)

    this.searchStatement = this.db.prepare<
      [string, string, string | null, string | null, number],
      { cache_key: string }
    >(`
      SELECT cache_key
      FROM memcached_key_index
      WHERE connection_id = ?
        AND cache_key LIKE ? ESCAPE '\\'
        AND (? IS NULL OR cache_key > ?)
      ORDER BY cache_key COLLATE NOCASE ASC
      LIMIT ?
    `)

    this.countByPatternStatement = this.db.prepare<[string, string], { total: number }>(`
      SELECT COUNT(*) AS total
      FROM memcached_key_index
      WHERE connection_id = ?
        AND cache_key LIKE ? ESCAPE '\\'
    `)

    this.upsertStatement = this.db.prepare(`
      INSERT INTO memcached_key_index (connection_id, cache_key, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(connection_id, cache_key) DO UPDATE SET
        updated_at = excluded.updated_at
    `)

    this.removeStatement = this.db.prepare(
      'DELETE FROM memcached_key_index WHERE connection_id = ? AND cache_key = ?',
    )

    this.removeByConnectionStatement = this.db.prepare(
      'DELETE FROM memcached_key_index WHERE connection_id = ?',
    )
  }

  public async listKeys(connectionId: string, limit: number): Promise<string[]> {
    const rows = this.listStatement.all(connectionId, limit)
    return rows.map((row) => row.cache_key)
  }

  public async countKeys(connectionId: string): Promise<number> {
    const row = this.countStatement.get(connectionId)
    return row?.total ?? 0
  }

  public async searchKeys(
    connectionId: string,
    pattern: string,
    limit: number,
    cursor?: string,
  ): Promise<string[]> {
    const sqlPattern = toSqlLikePattern(pattern)
    const cursorValue = cursor ?? null
    const rows = this.searchStatement.all(
      connectionId,
      sqlPattern,
      cursorValue,
      cursorValue,
      limit,
    )
    return rows.map((row) => row.cache_key)
  }

  public async countKeysByPattern(
    connectionId: string,
    pattern: string,
  ): Promise<number> {
    const row = this.countByPatternStatement.get(
      connectionId,
      toSqlLikePattern(pattern),
    )
    return row?.total ?? 0
  }

  public async upsertKey(connectionId: string, key: string): Promise<void> {
    this.upsertStatement.run(connectionId, key, new Date().toISOString())
  }

  public async removeKey(connectionId: string, key: string): Promise<void> {
    this.removeStatement.run(connectionId, key)
  }

  public async deleteByConnectionId(connectionId: string): Promise<void> {
    this.removeByConnectionStatement.run(connectionId)
  }
}

type SnapshotRow = {
  id: string
  connection_id: string
  cache_key: string
  captured_at: string
  redacted_value_hash: string
  value_text: string | null
  ttl_seconds: number | null
  reason: 'set' | 'delete' | 'workflow'
}

const rowToSnapshot = (row: SnapshotRow): SnapshotRecord => ({
  id: row.id,
  connectionId: row.connection_id,
  key: row.cache_key,
  capturedAt: row.captured_at,
  redactedValueHash: row.redacted_value_hash,
  value: row.value_text,
  ttlSeconds: row.ttl_seconds ?? undefined,
  reason: row.reason,
})

export class SqliteSnapshotRepository implements SnapshotRepository {
  private readonly saveStatement: BetterSqlite3.Statement<[
    string,
    string,
    string,
    string,
    string,
    string | null,
    number | null,
    string,
  ]>

  private readonly listByConnectionStatement: BetterSqlite3.Statement<
    [string, number],
    SnapshotRow
  >

  private readonly listByKeyStatement: BetterSqlite3.Statement<
    [string, string, number],
    SnapshotRow
  >

  private readonly findLatestStatement: BetterSqlite3.Statement<
    [string, string],
    SnapshotRow
  >

  private readonly findByIdStatement: BetterSqlite3.Statement<[string], SnapshotRow>

  public constructor(private readonly db: BetterSqlite3.Database) {
    this.saveStatement = this.db.prepare(`
      INSERT INTO key_snapshots (
        id,
        connection_id,
        cache_key,
        captured_at,
        redacted_value_hash,
        value_text,
        ttl_seconds,
        reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    this.listByConnectionStatement = this.db.prepare(`
      SELECT
        id,
        connection_id,
        cache_key,
        captured_at,
        redacted_value_hash,
        value_text,
        ttl_seconds,
        reason
      FROM key_snapshots
      WHERE connection_id = ?
      ORDER BY captured_at DESC
      LIMIT ?
    `)

    this.listByKeyStatement = this.db.prepare(`
      SELECT
        id,
        connection_id,
        cache_key,
        captured_at,
        redacted_value_hash,
        value_text,
        ttl_seconds,
        reason
      FROM key_snapshots
      WHERE connection_id = ?
        AND cache_key = ?
      ORDER BY captured_at DESC
      LIMIT ?
    `)

    this.findLatestStatement = this.db.prepare(`
      SELECT
        id,
        connection_id,
        cache_key,
        captured_at,
        redacted_value_hash,
        value_text,
        ttl_seconds,
        reason
      FROM key_snapshots
      WHERE connection_id = ?
        AND cache_key = ?
      ORDER BY captured_at DESC
      LIMIT 1
    `)

    this.findByIdStatement = this.db.prepare(`
      SELECT
        id,
        connection_id,
        cache_key,
        captured_at,
        redacted_value_hash,
        value_text,
        ttl_seconds,
        reason
      FROM key_snapshots
      WHERE id = ?
      LIMIT 1
    `)
  }

  public async save(record: SnapshotRecord): Promise<void> {
    this.saveStatement.run(
      record.id,
      record.connectionId,
      record.key,
      record.capturedAt,
      record.redactedValueHash,
      record.value,
      record.ttlSeconds ?? null,
      record.reason,
    )
  }

  public async list(args: {
    connectionId: string
    key?: string
    limit: number
  }): Promise<SnapshotRecord[]> {
    const rows = args.key
      ? this.listByKeyStatement.all(args.connectionId, args.key, args.limit)
      : this.listByConnectionStatement.all(args.connectionId, args.limit)

    return rows.map(rowToSnapshot)
  }

  public async findLatest(args: {
    connectionId: string
    key: string
  }): Promise<SnapshotRecord | null> {
    const row = this.findLatestStatement.get(args.connectionId, args.key)
    if (!row) {
      return null
    }

    return rowToSnapshot(row)
  }

  public async findById(id: string): Promise<SnapshotRecord | null> {
    const row = this.findByIdStatement.get(id)
    if (!row) {
      return null
    }

    return rowToSnapshot(row)
  }
}

type WorkflowTemplateRow = {
  id: string
  name: string
  kind: 'deleteByPattern' | 'ttlNormalize' | 'warmupSet'
  parameters_json: string
  requires_approval_on_prod: 0 | 1
  supports_dry_run: 0 | 1
  created_at: string
  updated_at: string
}

const rowToWorkflowTemplate = (row: WorkflowTemplateRow): WorkflowTemplate => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  parameters: parseJson(row.parameters_json, {}),
  requiresApprovalOnProd: row.requires_approval_on_prod === 1,
  supportsDryRun: row.supports_dry_run === 1,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

export class SqliteWorkflowTemplateRepository
  implements WorkflowTemplateRepository
{
  private readonly saveStatement: BetterSqlite3.Statement<[
    string,
    string,
    string,
    string,
    number,
    number,
    string,
    string,
  ]>

  private readonly listStatement: BetterSqlite3.Statement<[], WorkflowTemplateRow>

  private readonly findByIdStatement: BetterSqlite3.Statement<
    [string],
    WorkflowTemplateRow
  >

  private readonly deleteStatement: BetterSqlite3.Statement<[string]>

  public constructor(private readonly db: BetterSqlite3.Database) {
    this.saveStatement = this.db.prepare(`
      INSERT INTO workflow_templates (
        id,
        name,
        kind,
        parameters_json,
        requires_approval_on_prod,
        supports_dry_run,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        kind = excluded.kind,
        parameters_json = excluded.parameters_json,
        requires_approval_on_prod = excluded.requires_approval_on_prod,
        supports_dry_run = excluded.supports_dry_run,
        updated_at = excluded.updated_at
    `)

    this.listStatement = this.db.prepare(`
      SELECT
        id,
        name,
        kind,
        parameters_json,
        requires_approval_on_prod,
        supports_dry_run,
        created_at,
        updated_at
      FROM workflow_templates
      ORDER BY updated_at DESC
    `)

    this.findByIdStatement = this.db.prepare(`
      SELECT
        id,
        name,
        kind,
        parameters_json,
        requires_approval_on_prod,
        supports_dry_run,
        created_at,
        updated_at
      FROM workflow_templates
      WHERE id = ?
      LIMIT 1
    `)

    this.deleteStatement = this.db.prepare(
      'DELETE FROM workflow_templates WHERE id = ?',
    )
  }

  public async save(template: WorkflowTemplate): Promise<void> {
    this.saveStatement.run(
      template.id,
      template.name,
      template.kind,
      JSON.stringify(template.parameters),
      template.requiresApprovalOnProd ? 1 : 0,
      template.supportsDryRun ? 1 : 0,
      template.createdAt,
      template.updatedAt,
    )
  }

  public async list(): Promise<WorkflowTemplate[]> {
    const rows = this.listStatement.all()
    return rows.map(rowToWorkflowTemplate)
  }

  public async findById(id: string): Promise<WorkflowTemplate | null> {
    const row = this.findByIdStatement.get(id)
    if (!row) {
      return null
    }

    return rowToWorkflowTemplate(row)
  }

  public async delete(id: string): Promise<void> {
    this.deleteStatement.run(id)
  }
}

type WorkflowExecutionRow = {
  id: string
  workflow_template_id: string | null
  workflow_name: string
  workflow_kind: 'deleteByPattern' | 'ttlNormalize' | 'warmupSet'
  connection_id: string
  started_at: string
  finished_at: string | null
  status: 'pending' | 'running' | 'success' | 'error' | 'aborted'
  retry_count: number
  dry_run: 0 | 1
  parameters_json: string
  step_results_json: string
  checkpoint_token: string | null
  policy_pack_id: string | null
  schedule_window_id: string | null
  resumed_from_execution_id: string | null
  error_message: string | null
}

const rowToWorkflowExecution = (
  row: WorkflowExecutionRow,
): WorkflowExecutionRecord => ({
  id: row.id,
  workflowTemplateId: row.workflow_template_id ?? undefined,
  workflowName: row.workflow_name,
  workflowKind: row.workflow_kind,
  connectionId: row.connection_id,
  startedAt: row.started_at,
  finishedAt: row.finished_at ?? undefined,
  status: row.status,
  retryCount: row.retry_count,
  dryRun: row.dry_run === 1,
  parameters: parseJson(row.parameters_json, {}),
  stepResults: parseJson<WorkflowStepResult[]>(row.step_results_json, []),
  checkpointToken: row.checkpoint_token ?? undefined,
  policyPackId: row.policy_pack_id ?? undefined,
  scheduleWindowId: row.schedule_window_id ?? undefined,
  resumedFromExecutionId: row.resumed_from_execution_id ?? undefined,
  errorMessage: row.error_message ?? undefined,
})

export class SqliteWorkflowExecutionRepository
  implements WorkflowExecutionRepository
{
  private readonly saveStatement: BetterSqlite3.Statement<[
    string,
    string | null,
    string,
    string,
    string,
    string,
    string | null,
    string,
    number,
    number,
    string,
    string,
    string | null,
    string | null,
    string | null,
    string | null,
    string | null,
  ]>

  private readonly listByAnyStatement: BetterSqlite3.Statement<
    [number],
    WorkflowExecutionRow
  >

  private readonly listByConnectionStatement: BetterSqlite3.Statement<
    [string, number],
    WorkflowExecutionRow
  >

  private readonly listByTemplateStatement: BetterSqlite3.Statement<
    [string, number],
    WorkflowExecutionRow
  >

  private readonly listByConnectionAndTemplateStatement: BetterSqlite3.Statement<
    [string, string, number],
    WorkflowExecutionRow
  >

  private readonly findByIdStatement: BetterSqlite3.Statement<
    [string],
    WorkflowExecutionRow
  >

  public constructor(private readonly db: BetterSqlite3.Database) {
    this.saveStatement = this.db.prepare(`
      INSERT INTO workflow_executions (
        id,
        workflow_template_id,
        workflow_name,
        workflow_kind,
        connection_id,
        started_at,
        finished_at,
        status,
        retry_count,
        dry_run,
        parameters_json,
        step_results_json,
        checkpoint_token,
        policy_pack_id,
        schedule_window_id,
        resumed_from_execution_id,
        error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        workflow_template_id = excluded.workflow_template_id,
        workflow_name = excluded.workflow_name,
        workflow_kind = excluded.workflow_kind,
        connection_id = excluded.connection_id,
        started_at = excluded.started_at,
        finished_at = excluded.finished_at,
        status = excluded.status,
        retry_count = excluded.retry_count,
        dry_run = excluded.dry_run,
        parameters_json = excluded.parameters_json,
        step_results_json = excluded.step_results_json,
        checkpoint_token = excluded.checkpoint_token,
        policy_pack_id = excluded.policy_pack_id,
        schedule_window_id = excluded.schedule_window_id,
        resumed_from_execution_id = excluded.resumed_from_execution_id,
        error_message = excluded.error_message
    `)

    const baseSelect = `
      SELECT
        id,
        workflow_template_id,
        workflow_name,
        workflow_kind,
        connection_id,
        started_at,
        finished_at,
        status,
        retry_count,
        dry_run,
        parameters_json,
        step_results_json,
        checkpoint_token,
        policy_pack_id,
        schedule_window_id,
        resumed_from_execution_id,
        error_message
      FROM workflow_executions
    `

    this.listByAnyStatement = this.db.prepare(`
      ${baseSelect}
      ORDER BY started_at DESC
      LIMIT ?
    `)

    this.listByConnectionStatement = this.db.prepare(`
      ${baseSelect}
      WHERE connection_id = ?
      ORDER BY started_at DESC
      LIMIT ?
    `)

    this.listByTemplateStatement = this.db.prepare(`
      ${baseSelect}
      WHERE workflow_template_id = ?
      ORDER BY started_at DESC
      LIMIT ?
    `)

    this.listByConnectionAndTemplateStatement = this.db.prepare(`
      ${baseSelect}
      WHERE connection_id = ?
        AND workflow_template_id = ?
      ORDER BY started_at DESC
      LIMIT ?
    `)

    this.findByIdStatement = this.db.prepare(`
      ${baseSelect}
      WHERE id = ?
      LIMIT 1
    `)
  }

  public async save(record: WorkflowExecutionRecord): Promise<void> {
    this.saveStatement.run(
      record.id,
      record.workflowTemplateId ?? null,
      record.workflowName,
      record.workflowKind,
      record.connectionId,
      record.startedAt,
      record.finishedAt ?? null,
      record.status,
      record.retryCount,
      record.dryRun ? 1 : 0,
      JSON.stringify(record.parameters),
      JSON.stringify(record.stepResults),
      record.checkpointToken ?? null,
      record.policyPackId ?? null,
      record.scheduleWindowId ?? null,
      record.resumedFromExecutionId ?? null,
      record.errorMessage ?? null,
    )
  }

  public async list(
    args: WorkflowExecutionListRequest,
  ): Promise<WorkflowExecutionRecord[]> {
    const rows = args.connectionId
      ? args.templateId
        ? this.listByConnectionAndTemplateStatement.all(
            args.connectionId,
            args.templateId,
            args.limit,
          )
        : this.listByConnectionStatement.all(args.connectionId, args.limit)
      : args.templateId
        ? this.listByTemplateStatement.all(args.templateId, args.limit)
        : this.listByAnyStatement.all(args.limit)

    return rows.map(rowToWorkflowExecution)
  }

  public async findById(id: string): Promise<WorkflowExecutionRecord | null> {
    const row = this.findByIdStatement.get(id)
    if (!row) {
      return null
    }

    return rowToWorkflowExecution(row)
  }
}

type HistoryRow = {
  id: string
  timestamp: string
  source: 'app' | 'engine'
  connection_id: string
  environment: 'dev' | 'staging' | 'prod'
  action: string
  key_or_pattern: string
  duration_ms: number
  status: 'success' | 'error' | 'blocked'
  redacted_diff: string | null
  error_code: string | null
  retryable: number | null
  details_json: string | null
}

const rowToHistoryEvent = (row: HistoryRow): HistoryEvent => ({
  id: row.id,
  timestamp: row.timestamp,
  source: row.source,
  connectionId: row.connection_id,
  environment: row.environment,
  action: row.action,
  keyOrPattern: row.key_or_pattern,
  durationMs: row.duration_ms,
  status: row.status,
  redactedDiff: row.redacted_diff ?? undefined,
  errorCode: row.error_code as HistoryEvent['errorCode'],
  retryable:
    row.retryable === null ? undefined : row.retryable === 1,
  details: row.details_json ? parseJson(row.details_json, {}) : undefined,
})

export class SqliteHistoryRepository implements HistoryRepository {
  private readonly insertStatement: BetterSqlite3.Statement<[
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    number,
    string,
    string | null,
    string | null,
    number | null,
    string | null,
  ]>

  private readonly queryStatement: BetterSqlite3.Statement<
    [
      string | null,
      string | null,
      string | null,
      string | null,
      string | null,
      string | null,
      number,
    ],
    HistoryRow
  >

  public constructor(private readonly db: BetterSqlite3.Database) {
    this.insertStatement = this.db.prepare(`
      INSERT INTO history_events (
        id,
        timestamp,
        source,
        connection_id,
        environment,
        action,
        key_or_pattern,
        duration_ms,
        status,
        redacted_diff,
        error_code,
        retryable,
        details_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    this.queryStatement = this.db.prepare(`
      SELECT
        id,
        timestamp,
        source,
        connection_id,
        environment,
        action,
        key_or_pattern,
        duration_ms,
        status,
        redacted_diff,
        error_code,
        retryable,
        details_json
      FROM history_events
      WHERE (? IS NULL OR connection_id = ?)
        AND (? IS NULL OR timestamp >= ?)
        AND (? IS NULL OR timestamp <= ?)
      ORDER BY timestamp DESC
      LIMIT ?
    `)
  }

  public async append(event: HistoryEvent): Promise<void> {
    this.insertStatement.run(
      event.id,
      event.timestamp,
      event.source,
      event.connectionId,
      event.environment,
      event.action,
      event.keyOrPattern,
      event.durationMs,
      event.status,
      event.redactedDiff ?? null,
      event.errorCode ?? null,
      event.retryable === undefined ? null : event.retryable ? 1 : 0,
      event.details ? JSON.stringify(event.details) : null,
    )
  }

  public async query(args: HistoryQueryRequest): Promise<HistoryEvent[]> {
    const rows = this.queryStatement.all(
      args.connectionId ?? null,
      args.connectionId ?? null,
      args.from ?? null,
      args.from ?? null,
      args.to ?? null,
      args.to ?? null,
      args.limit,
    )

    return rows.map(rowToHistoryEvent)
  }
}

type ObservabilityRow = {
  id: string
  connection_id: string
  timestamp: string
  latency_p50_ms: number
  latency_p95_ms: number
  error_rate: number
  reconnect_count: number
  ops_per_second: number
  slow_op_count: number
}

const rowToObservability = (row: ObservabilityRow): ObservabilitySnapshot => ({
  id: row.id,
  connectionId: row.connection_id,
  timestamp: row.timestamp,
  latencyP50Ms: row.latency_p50_ms,
  latencyP95Ms: row.latency_p95_ms,
  errorRate: row.error_rate,
  reconnectCount: row.reconnect_count,
  opsPerSecond: row.ops_per_second,
  slowOpCount: row.slow_op_count,
})

export class SqliteObservabilityRepository implements ObservabilityRepository {
  private readonly insertStatement: BetterSqlite3.Statement<[
    string,
    string,
    string,
    number,
    number,
    number,
    number,
    number,
    number,
  ]>

  private readonly queryStatement: BetterSqlite3.Statement<
    [
      string | null,
      string | null,
      string | null,
      string | null,
      string | null,
      string | null,
      number,
    ],
    ObservabilityRow
  >

  public constructor(private readonly db: BetterSqlite3.Database) {
    this.insertStatement = this.db.prepare(`
      INSERT INTO observability_snapshots (
        id,
        connection_id,
        timestamp,
        latency_p50_ms,
        latency_p95_ms,
        error_rate,
        reconnect_count,
        ops_per_second,
        slow_op_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    this.queryStatement = this.db.prepare(`
      SELECT
        id,
        connection_id,
        timestamp,
        latency_p50_ms,
        latency_p95_ms,
        error_rate,
        reconnect_count,
        ops_per_second,
        slow_op_count
      FROM observability_snapshots
      WHERE (? IS NULL OR connection_id = ?)
        AND (? IS NULL OR timestamp >= ?)
        AND (? IS NULL OR timestamp <= ?)
      ORDER BY timestamp DESC
      LIMIT ?
    `)
  }

  public async append(snapshot: ObservabilitySnapshot): Promise<void> {
    this.insertStatement.run(
      snapshot.id,
      snapshot.connectionId,
      snapshot.timestamp,
      snapshot.latencyP50Ms,
      snapshot.latencyP95Ms,
      snapshot.errorRate,
      snapshot.reconnectCount,
      snapshot.opsPerSecond,
      snapshot.slowOpCount,
    )
  }

  public async query(args: {
    connectionId?: string
    from?: string
    to?: string
    limit: number
  }): Promise<ObservabilitySnapshot[]> {
    const rows = this.queryStatement.all(
      args.connectionId ?? null,
      args.connectionId ?? null,
      args.from ?? null,
      args.from ?? null,
      args.to ?? null,
      args.to ?? null,
      args.limit,
    )

    return rows.map(rowToObservability)
  }
}

type AlertRow = {
  id: string
  created_at: string
  connection_id: string | null
  environment: 'dev' | 'staging' | 'prod' | null
  severity: 'info' | 'warning' | 'critical'
  title: string
  message: string
  source: 'app' | 'policy' | 'workflow' | 'observability'
  is_read: 0 | 1
}

const rowToAlert = (row: AlertRow): AlertEvent => ({
  id: row.id,
  createdAt: row.created_at,
  connectionId: row.connection_id ?? undefined,
  environment: row.environment ?? undefined,
  severity: row.severity,
  title: row.title,
  message: row.message,
  source: row.source,
  read: row.is_read === 1,
})

export class SqliteAlertRepository implements AlertRepository {
  private readonly insertStatement: BetterSqlite3.Statement<[
    string,
    string,
    string | null,
    string | null,
    string,
    string,
    string,
    string,
    number,
  ]>

  private readonly listStatement: BetterSqlite3.Statement<
    [number | null, number | null, number],
    AlertRow
  >

  private readonly countUnreadStatement: BetterSqlite3.Statement<
    [],
    { unread_count: number }
  >

  private readonly markReadStatement: BetterSqlite3.Statement<[string]>

  private readonly markAllReadStatement: BetterSqlite3.Statement<[]>

  private readonly deleteAllStatement: BetterSqlite3.Statement<[]>

  public constructor(private readonly db: BetterSqlite3.Database) {
    this.insertStatement = this.db.prepare(`
      INSERT INTO alert_events (
        id,
        created_at,
        connection_id,
        environment,
        severity,
        title,
        message,
        source,
        is_read
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    this.listStatement = this.db.prepare(`
      SELECT
        id,
        created_at,
        connection_id,
        environment,
        severity,
        title,
        message,
        source,
        is_read
      FROM alert_events
      WHERE (? IS NULL OR is_read = ?)
      ORDER BY created_at DESC
      LIMIT ?
    `)

    this.countUnreadStatement = this.db.prepare(`
      SELECT COUNT(*) AS unread_count
      FROM alert_events
      WHERE is_read = 0
    `)

    this.markReadStatement = this.db.prepare(
      'UPDATE alert_events SET is_read = 1 WHERE id = ?',
    )

    this.markAllReadStatement = this.db.prepare(
      'UPDATE alert_events SET is_read = 1 WHERE is_read = 0',
    )

    this.deleteAllStatement = this.db.prepare('DELETE FROM alert_events')
  }

  public async append(event: AlertEvent): Promise<void> {
    this.insertStatement.run(
      event.id,
      event.createdAt,
      event.connectionId ?? null,
      event.environment ?? null,
      event.severity,
      event.title,
      event.message,
      event.source,
      event.read ? 1 : 0,
    )
  }

  public async list(request: AlertListRequest): Promise<AlertEvent[]> {
    const readFilter = request.unreadOnly ? 0 : null
    const rows = this.listStatement.all(readFilter, readFilter, request.limit)

    return rows.map(rowToAlert)
  }

  public async countUnread(): Promise<number> {
    return this.countUnreadStatement.get()?.unread_count ?? 0
  }

  public async markRead(id: string): Promise<void> {
    this.markReadStatement.run(id)
  }

  public async markAllRead(): Promise<void> {
    this.markAllReadStatement.run()
  }

  public async deleteAll(): Promise<void> {
    this.deleteAllStatement.run()
  }
}

type AlertRuleRow = {
  id: string
  name: string
  metric: AlertRule['metric']
  threshold: number
  lookback_minutes: number
  severity: AlertRule['severity']
  connection_id: string | null
  environment: AlertRule['environment']
  enabled: 0 | 1
  created_at: string
  updated_at: string
}

const rowToAlertRule = (row: AlertRuleRow): AlertRule => ({
  id: row.id,
  name: row.name,
  metric: row.metric,
  threshold: row.threshold,
  lookbackMinutes: row.lookback_minutes,
  severity: row.severity,
  connectionId: row.connection_id ?? undefined,
  environment: row.environment ?? undefined,
  enabled: row.enabled === 1,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

export class SqliteAlertRuleRepository implements AlertRuleRepository {
  private readonly listStatement: BetterSqlite3.Statement<[], AlertRuleRow>

  private readonly findByIdStatement: BetterSqlite3.Statement<[string], AlertRuleRow>

  private readonly saveStatement: BetterSqlite3.Statement<[
    string,
    string,
    string,
    number,
    number,
    string,
    string | null,
    string | null,
    number,
    string,
    string,
  ]>

  private readonly deleteStatement: BetterSqlite3.Statement<[string]>

  public constructor(private readonly db: BetterSqlite3.Database) {
    this.listStatement = this.db.prepare(`
      SELECT
        id,
        name,
        metric,
        threshold,
        lookback_minutes,
        severity,
        connection_id,
        environment,
        enabled,
        created_at,
        updated_at
      FROM alert_rules
      ORDER BY updated_at DESC
    `)

    this.findByIdStatement = this.db.prepare(`
      SELECT
        id,
        name,
        metric,
        threshold,
        lookback_minutes,
        severity,
        connection_id,
        environment,
        enabled,
        created_at,
        updated_at
      FROM alert_rules
      WHERE id = ?
      LIMIT 1
    `)

    this.saveStatement = this.db.prepare(`
      INSERT INTO alert_rules (
        id,
        name,
        metric,
        threshold,
        lookback_minutes,
        severity,
        connection_id,
        environment,
        enabled,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        metric = excluded.metric,
        threshold = excluded.threshold,
        lookback_minutes = excluded.lookback_minutes,
        severity = excluded.severity,
        connection_id = excluded.connection_id,
        environment = excluded.environment,
        enabled = excluded.enabled,
        updated_at = excluded.updated_at
    `)

    this.deleteStatement = this.db.prepare('DELETE FROM alert_rules WHERE id = ?')
  }

  public async list(): Promise<AlertRule[]> {
    return this.listStatement.all().map(rowToAlertRule)
  }

  public async findById(id: string): Promise<AlertRule | null> {
    const row = this.findByIdStatement.get(id)
    return row ? rowToAlertRule(row) : null
  }

  public async save(rule: AlertRule): Promise<void> {
    this.saveStatement.run(
      rule.id,
      rule.name,
      rule.metric,
      rule.threshold,
      rule.lookbackMinutes,
      rule.severity,
      rule.connectionId ?? null,
      rule.environment ?? null,
      rule.enabled ? 1 : 0,
      rule.createdAt,
      rule.updatedAt,
    )
  }

  public async delete(id: string): Promise<void> {
    this.deleteStatement.run(id)
  }
}

type GovernancePolicyPackRow = {
  id: string
  name: string
  description: string | null
  environments_json: string
  max_workflow_items: number
  max_retry_attempts: number
  scheduling_enabled: 0 | 1
  execution_windows_json: string
  enabled: 0 | 1
  created_at: string
  updated_at: string
}

const rowToGovernancePolicyPack = (
  row: GovernancePolicyPackRow,
): GovernancePolicyPack => ({
  id: row.id,
  name: row.name,
  description: row.description ?? undefined,
  environments: parseJson(row.environments_json, ['dev']),
  maxWorkflowItems: row.max_workflow_items,
  maxRetryAttempts: row.max_retry_attempts,
  schedulingEnabled: row.scheduling_enabled === 1,
  executionWindows: parseJson(row.execution_windows_json, []),
  enabled: row.enabled === 1,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

export class SqliteGovernancePolicyPackRepository
  implements GovernancePolicyPackRepository
{
  private readonly listStatement: BetterSqlite3.Statement<
    [],
    GovernancePolicyPackRow
  >

  private readonly findByIdStatement: BetterSqlite3.Statement<
    [string],
    GovernancePolicyPackRow
  >

  private readonly saveStatement: BetterSqlite3.Statement<[
    string,
    string,
    string | null,
    string,
    number,
    number,
    number,
    string,
    number,
    string,
    string,
  ]>

  private readonly deleteStatement: BetterSqlite3.Statement<[string]>

  public constructor(private readonly db: BetterSqlite3.Database) {
    this.listStatement = this.db.prepare(`
      SELECT
        id,
        name,
        description,
        environments_json,
        max_workflow_items,
        max_retry_attempts,
        scheduling_enabled,
        execution_windows_json,
        enabled,
        created_at,
        updated_at
      FROM governance_policy_packs
      ORDER BY updated_at DESC
    `)

    this.findByIdStatement = this.db.prepare(`
      SELECT
        id,
        name,
        description,
        environments_json,
        max_workflow_items,
        max_retry_attempts,
        scheduling_enabled,
        execution_windows_json,
        enabled,
        created_at,
        updated_at
      FROM governance_policy_packs
      WHERE id = ?
      LIMIT 1
    `)

    this.saveStatement = this.db.prepare(`
      INSERT INTO governance_policy_packs (
        id,
        name,
        description,
        environments_json,
        max_workflow_items,
        max_retry_attempts,
        scheduling_enabled,
        execution_windows_json,
        enabled,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        environments_json = excluded.environments_json,
        max_workflow_items = excluded.max_workflow_items,
        max_retry_attempts = excluded.max_retry_attempts,
        scheduling_enabled = excluded.scheduling_enabled,
        execution_windows_json = excluded.execution_windows_json,
        enabled = excluded.enabled,
        updated_at = excluded.updated_at
    `)

    this.deleteStatement = this.db.prepare(
      'DELETE FROM governance_policy_packs WHERE id = ?',
    )
  }

  public async list(): Promise<GovernancePolicyPack[]> {
    return this.listStatement.all().map(rowToGovernancePolicyPack)
  }

  public async findById(id: string): Promise<GovernancePolicyPack | null> {
    const row = this.findByIdStatement.get(id)
    return row ? rowToGovernancePolicyPack(row) : null
  }

  public async save(policyPack: GovernancePolicyPack): Promise<void> {
    this.saveStatement.run(
      policyPack.id,
      policyPack.name,
      policyPack.description ?? null,
      JSON.stringify(policyPack.environments),
      policyPack.maxWorkflowItems,
      policyPack.maxRetryAttempts,
      policyPack.schedulingEnabled ? 1 : 0,
      JSON.stringify(policyPack.executionWindows),
      policyPack.enabled ? 1 : 0,
      policyPack.createdAt,
      policyPack.updatedAt,
    )
  }

  public async delete(id: string): Promise<void> {
    this.deleteStatement.run(id)
  }
}

type GovernanceAssignmentRow = {
  connection_id: string
  policy_pack_id: string | null
}

export class SqliteGovernanceAssignmentRepository
  implements GovernanceAssignmentRepository
{
  private readonly listStatement: BetterSqlite3.Statement<[], GovernanceAssignmentRow>

  private readonly listByConnectionStatement: BetterSqlite3.Statement<
    [string],
    GovernanceAssignmentRow
  >

  private readonly upsertStatement: BetterSqlite3.Statement<
    [string, string, string]
  >

  private readonly clearStatement: BetterSqlite3.Statement<[string]>

  public constructor(private readonly db: BetterSqlite3.Database) {
    this.listStatement = this.db.prepare(`
      SELECT
        connection_id,
        policy_pack_id
      FROM governance_assignments
      ORDER BY assigned_at DESC
    `)

    this.listByConnectionStatement = this.db.prepare(`
      SELECT
        connection_id,
        policy_pack_id
      FROM governance_assignments
      WHERE connection_id = ?
      LIMIT 1
    `)

    this.upsertStatement = this.db.prepare(`
      INSERT INTO governance_assignments (
        connection_id,
        policy_pack_id,
        assigned_at
      ) VALUES (?, ?, ?)
      ON CONFLICT(connection_id) DO UPDATE SET
        policy_pack_id = excluded.policy_pack_id,
        assigned_at = excluded.assigned_at
    `)

    this.clearStatement = this.db.prepare(
      'DELETE FROM governance_assignments WHERE connection_id = ?',
    )
  }

  public async list(
    args: GovernanceAssignmentListRequest,
  ): Promise<GovernanceAssignment[]> {
    const rows = args.connectionId
      ? this.listByConnectionStatement.all(args.connectionId)
      : this.listStatement.all()

    return rows.map((row) => ({
      connectionId: row.connection_id,
      policyPackId: row.policy_pack_id ?? undefined,
    }))
  }

  public async assign(args: {
    connectionId: string
    policyPackId?: string
  }): Promise<void> {
    if (!args.policyPackId) {
      this.clearStatement.run(args.connectionId)
      return
    }

    this.upsertStatement.run(
      args.connectionId,
      args.policyPackId,
      new Date().toISOString(),
    )
  }
}

type IncidentBundleRow = {
  id: string
  created_at: string
  from_ts: string
  to_ts: string
  connection_ids_json: string
  includes_json: string
  redaction_profile: IncidentBundle['redactionProfile']
  checksum: string
  artifact_path: string
  timeline_count: number
  log_count: number
  diagnostic_count: number
  metric_count: number
  truncated: number
}

const rowToIncidentBundle = (row: IncidentBundleRow): IncidentBundle => ({
  id: row.id,
  createdAt: row.created_at,
  from: row.from_ts,
  to: row.to_ts,
  connectionIds: parseJson(row.connection_ids_json, []),
  includes: parseJson(row.includes_json, []),
  redactionProfile: row.redaction_profile,
  checksum: row.checksum,
  artifactPath: row.artifact_path,
  timelineCount: row.timeline_count,
  logCount: row.log_count,
  diagnosticCount: row.diagnostic_count,
  metricCount: row.metric_count,
  truncated: row.truncated === 1,
})

export class SqliteIncidentBundleRepository implements IncidentBundleRepository {
  private readonly saveStatement: BetterSqlite3.Statement<[
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    number,
    number,
    number,
    number,
    number,
  ]>

  private readonly listStatement: BetterSqlite3.Statement<
    [number],
    IncidentBundleRow
  >

  public constructor(private readonly db: BetterSqlite3.Database) {
    this.saveStatement = this.db.prepare(`
      INSERT INTO incident_bundles (
        id,
        created_at,
        from_ts,
        to_ts,
        connection_ids_json,
        includes_json,
        redaction_profile,
        checksum,
        artifact_path,
        timeline_count,
        log_count,
        diagnostic_count,
        metric_count,
        truncated
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        created_at = excluded.created_at,
        from_ts = excluded.from_ts,
        to_ts = excluded.to_ts,
        connection_ids_json = excluded.connection_ids_json,
        includes_json = excluded.includes_json,
        redaction_profile = excluded.redaction_profile,
        checksum = excluded.checksum,
        artifact_path = excluded.artifact_path,
        timeline_count = excluded.timeline_count,
        log_count = excluded.log_count,
        diagnostic_count = excluded.diagnostic_count,
        metric_count = excluded.metric_count,
        truncated = excluded.truncated
    `)

    this.listStatement = this.db.prepare(`
      SELECT
        id,
        created_at,
        from_ts,
        to_ts,
        connection_ids_json,
        includes_json,
        redaction_profile,
        checksum,
        artifact_path,
        timeline_count,
        log_count,
        diagnostic_count,
        metric_count,
        truncated
      FROM incident_bundles
      ORDER BY created_at DESC
      LIMIT ?
    `)
  }

  public async save(bundle: IncidentBundle): Promise<void> {
    this.saveStatement.run(
      bundle.id,
      bundle.createdAt,
      bundle.from,
      bundle.to,
      JSON.stringify(bundle.connectionIds),
      JSON.stringify(bundle.includes),
      bundle.redactionProfile,
      bundle.checksum,
      bundle.artifactPath,
      bundle.timelineCount,
      bundle.logCount,
      bundle.diagnosticCount,
      bundle.metricCount,
      bundle.truncated ? 1 : 0,
    )
  }

  public async list(limit: number): Promise<IncidentBundle[]> {
    return this.listStatement.all(limit).map(rowToIncidentBundle)
  }
}

type RetentionPolicyRow = {
  dataset: RetentionPolicy['dataset']
  retention_days: number
  storage_budget_mb: number
  auto_purge_oldest: 0 | 1
}

const rowToRetentionPolicy = (row: RetentionPolicyRow): RetentionPolicy => ({
  dataset: row.dataset,
  retentionDays: row.retention_days,
  storageBudgetMb: row.storage_budget_mb,
  autoPurgeOldest: row.auto_purge_oldest === 1,
})

const bytesPerRowEstimateByDataset: Record<RetentionPolicy['dataset'], number> = {
  timelineEvents: 640,
  observabilitySnapshots: 420,
  workflowHistory: 860,
  incidentArtifacts: 1280,
}

const retentionDatasetTableMap: Record<
  RetentionPolicy['dataset'],
  { table: string; timestampColumn: string }
> = {
  timelineEvents: {
    table: 'history_events',
    timestampColumn: 'timestamp',
  },
  observabilitySnapshots: {
    table: 'observability_snapshots',
    timestampColumn: 'timestamp',
  },
  workflowHistory: {
    table: 'workflow_executions',
    timestampColumn: 'started_at',
  },
  incidentArtifacts: {
    table: 'incident_bundles',
    timestampColumn: 'created_at',
  },
}

export class SqliteRetentionRepository implements RetentionRepository {
  private readonly listPoliciesStatement: BetterSqlite3.Statement<
    [],
    RetentionPolicyRow
  >

  private readonly savePolicyStatement: BetterSqlite3.Statement<
    [string, number, number, number]
  >

  private readonly findPolicyByDatasetStatement: BetterSqlite3.Statement<
    [string],
    RetentionPolicyRow
  >

  public constructor(private readonly db: BetterSqlite3.Database) {
    this.listPoliciesStatement = this.db.prepare(`
      SELECT
        dataset,
        retention_days,
        storage_budget_mb,
        auto_purge_oldest
      FROM retention_policies
      ORDER BY dataset ASC
    `)

    this.findPolicyByDatasetStatement = this.db.prepare(`
      SELECT
        dataset,
        retention_days,
        storage_budget_mb,
        auto_purge_oldest
      FROM retention_policies
      WHERE dataset = ?
      LIMIT 1
    `)

    this.savePolicyStatement = this.db.prepare(`
      INSERT INTO retention_policies (
        dataset,
        retention_days,
        storage_budget_mb,
        auto_purge_oldest
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(dataset) DO UPDATE SET
        retention_days = excluded.retention_days,
        storage_budget_mb = excluded.storage_budget_mb,
        auto_purge_oldest = excluded.auto_purge_oldest
    `)
  }

  public async listPolicies(): Promise<RetentionPolicy[]> {
    return this.listPoliciesStatement.all().map(rowToRetentionPolicy)
  }

  public async savePolicy(policy: RetentionPolicy): Promise<void> {
    this.savePolicyStatement.run(
      policy.dataset,
      policy.retentionDays,
      policy.storageBudgetMb,
      policy.autoPurgeOldest ? 1 : 0,
    )
  }

  public async purge(
    request: RetentionPurgeRequest,
  ): Promise<RetentionPurgeResult> {
    const datasetConfig = retentionDatasetTableMap[request.dataset]
    const policyRow = this.findPolicyByDatasetStatement.get(request.dataset)
    const policy = policyRow
      ? rowToRetentionPolicy(policyRow)
      : {
          dataset: request.dataset,
          retentionDays: 30,
          storageBudgetMb: 512,
          autoPurgeOldest: true,
        }

    const cutoff =
      request.olderThan ??
      new Date(
        Date.now() - policy.retentionDays * 24 * 60 * 60 * 1000,
      ).toISOString()

    const eligibleRow = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM ${datasetConfig.table} WHERE ${datasetConfig.timestampColumn} < ?`,
      )
      .get(cutoff) as { count: number }

    const eligibleRows = eligibleRow.count
    const estimatedBytes =
      eligibleRows * bytesPerRowEstimateByDataset[request.dataset]

    if (request.dryRun) {
      return {
        dataset: request.dataset,
        cutoff,
        dryRun: true,
        deletedRows: eligibleRows,
        freedBytes: estimatedBytes,
      }
    }

    const result = this.db
      .prepare(
        `DELETE FROM ${datasetConfig.table} WHERE ${datasetConfig.timestampColumn} < ?`,
      )
      .run(cutoff)

    const deletedRows = Number(result.changes ?? 0)

    return {
      dataset: request.dataset,
      cutoff,
      dryRun: false,
      deletedRows,
      freedBytes: deletedRows * bytesPerRowEstimateByDataset[request.dataset],
    }
  }

  public async getStorageSummary(): Promise<StorageSummary> {
    const policies = await this.listPolicies()
    const policyByDataset = new Map(
      policies.map((policy) => [policy.dataset, policy]),
    )

    const datasets: StorageDatasetSummary[] = []
    let totalBytes = 0

    for (const [dataset, config] of Object.entries(retentionDatasetTableMap) as Array<
      [RetentionPolicy['dataset'], { table: string; timestampColumn: string }]
    >) {
      const row = this.db
        .prepare(
          `SELECT COUNT(*) AS count, MIN(${config.timestampColumn}) AS oldest, MAX(${config.timestampColumn}) AS newest FROM ${config.table}`,
        )
        .get() as { count: number; oldest: string | null; newest: string | null }

      const rowCount = Number(row.count ?? 0)
      const totalDatasetBytes = rowCount * bytesPerRowEstimateByDataset[dataset]
      const policy = policyByDataset.get(dataset) ?? {
        dataset,
        retentionDays: 30,
        storageBudgetMb: 512,
        autoPurgeOldest: true,
      }
      const budgetBytes = policy.storageBudgetMb * 1024 * 1024
      const usageRatio = budgetBytes === 0 ? 0 : totalDatasetBytes / budgetBytes

      datasets.push({
        dataset,
        rowCount,
        totalBytes: totalDatasetBytes,
        budgetBytes,
        usageRatio: Number(usageRatio.toFixed(3)),
        overBudget: totalDatasetBytes > budgetBytes,
        oldestTimestamp: row.oldest ?? undefined,
        newestTimestamp: row.newest ?? undefined,
      })

      totalBytes += totalDatasetBytes
    }

    return {
      generatedAt: new Date().toISOString(),
      datasets,
      totalBytes,
    }
  }
}

const toSqlLikePattern = (inputPattern: string): string => {
  const escaped = inputPattern
    .replaceAll('\\', '\\\\')
    .replaceAll('%', '\\%')
    .replaceAll('_', '\\_')

  return escaped.replaceAll('*', '%')
}
