import path from 'node:path'

import type BetterSqlite3 from 'better-sqlite3'
import { app, BrowserWindow } from 'electron'
import started from 'electron-squirrel-startup'

import { OperationsService } from './application/operations-service'
import { DefaultCacheGateway } from './infrastructure/providers/cache-gateway'
import { ProviderEngineEventIngestor } from './infrastructure/providers/provider-engine-event-ingestor'
import { InMemorySecretStore } from './infrastructure/secrets/in-memory-secret-store'
import { KeytarSecretStore } from './infrastructure/secrets/keytar-secret-store'
import { registerIpcHandlers } from './interface-adapters/ipc'
import {
	createSqliteDatabase,
	SqliteAlertRepository,
	SqliteAlertRuleRepository,
	SqliteConnectionRepository,
	SqliteGovernanceAssignmentRepository,
	SqliteGovernancePolicyPackRepository,
	SqliteHistoryRepository,
	SqliteIncidentBundleRepository,
	SqliteMemcachedKeyIndexRepository,
	SqliteNamespaceRepository,
	SqliteObservabilityRepository,
	SqliteRetentionRepository,
	SqliteSnapshotRepository,
	SqliteWorkflowExecutionRepository,
	SqliteWorkflowTemplateRepository,
} from './persistence/sqlite'
import {
	DesktopAppUpdater,
	registerUpdaterIpcHandlers,
} from './updater/app-updater'

if (started) {
	app.quit()
}

type RuntimeContext = {
	db: BetterSqlite3.Database
	service: OperationsService
}

let runtime: RuntimeContext | null = null
const desktopUpdater = new DesktopAppUpdater()

const initializeRuntime = (): RuntimeContext => {
	if (runtime) {
		return runtime
	}

	const userDataPath = app.getPath('userData')

	const databasePath = path.join(userDataPath, 'volatile.db')
	const db = createSqliteDatabase(databasePath)

	const connectionRepository = new SqliteConnectionRepository(db)
	const memcachedKeyIndexRepository = new SqliteMemcachedKeyIndexRepository(db)
	const namespaceRepository = new SqliteNamespaceRepository(db)
	const snapshotRepository = new SqliteSnapshotRepository(db)
	const workflowTemplateRepository = new SqliteWorkflowTemplateRepository(db)
	const workflowExecutionRepository = new SqliteWorkflowExecutionRepository(db)
	const historyRepository = new SqliteHistoryRepository(db)
	const observabilityRepository = new SqliteObservabilityRepository(db)
	const alertRepository = new SqliteAlertRepository(db)
	const alertRuleRepository = new SqliteAlertRuleRepository(db)
	const governancePolicyPackRepository =
		new SqliteGovernancePolicyPackRepository(db)
	const governanceAssignmentRepository =
		new SqliteGovernanceAssignmentRepository(db)
	const incidentBundleRepository = new SqliteIncidentBundleRepository(db)
	const retentionRepository = new SqliteRetentionRepository(db)

	const secretStore = (() => {
		if (process.env.SECRET_STORE === 'memory') {
			return new InMemorySecretStore()
		}

		try {
			return new KeytarSecretStore()
		} catch (_error) {
			return new InMemorySecretStore()
		}
	})()

	const cacheGateway = new DefaultCacheGateway(memcachedKeyIndexRepository)
	const engineEventIngestor = new ProviderEngineEventIngestor(
		connectionRepository,
		secretStore,
		cacheGateway,
	)

	const service = new OperationsService(
		connectionRepository,
		secretStore,
		memcachedKeyIndexRepository,
		cacheGateway,
		{
			snapshotRepository,
			workflowTemplateRepository,
			workflowExecutionRepository,
			historyRepository,
			observabilityRepository,
			alertRepository,
			alertRuleRepository,
			governancePolicyPackRepository,
			governanceAssignmentRepository,
			incidentBundleRepository,
			retentionRepository,
			engineEventIngestor,
			namespaceRepository,
		},
	)

	registerIpcHandlers(service)
	registerUpdaterIpcHandlers(desktopUpdater)

	runtime = {
		db,
		service,
	}

	return runtime
}

const createMainWindow = (): BrowserWindow => {
	const mainWindow = new BrowserWindow({
		width: 1360,
		height: 860,
		minWidth: 1120,
		minHeight: 700,
		title: 'Volatile',
		webPreferences: {
			preload: path.join(__dirname, 'preload.js'),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	})

	if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
		void mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL)
	} else {
		void mainWindow.loadFile(
			path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
		)
	}

	desktopUpdater.syncWindow(mainWindow)

	return mainWindow
}

app.whenReady().then(async () => {
	const context = initializeRuntime()
	await context.service
		.startEngineEventIngestion()
		.catch((error: unknown): void => {
			void error
		})
	createMainWindow()
	desktopUpdater.initialize()
	void desktopUpdater.checkForUpdates()

	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			createMainWindow()
		}
	})
})

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') {
		app.quit()
	}
})

app.on('before-quit', () => {
	void runtime?.service
		.stopEngineEventIngestion()
		.catch((error: unknown): void => {
			void error
		})
	runtime?.db.close()
	runtime = null
})
