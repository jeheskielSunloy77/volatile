import type { BrowserWindow } from 'electron'
import { app, BrowserWindow as ElectronBrowserWindow, ipcMain } from 'electron'
import type { ProgressInfo, UpdateDownloadedEvent, UpdateInfo } from 'electron-updater'
import { autoUpdater } from 'electron-updater'

import type { UpdateStatus } from '../../shared/contracts/cache'
import {
	APP_UPDATER_APPLY_CHANNEL,
	APP_UPDATER_CHECK_CHANNEL,
	APP_UPDATER_EVENT_CHANNEL,
	APP_UPDATER_STATUS_CHANNEL,
} from '../../shared/ipc/updater'

interface AppUpdaterLike {
	autoDownload: boolean
	autoInstallOnAppQuit: boolean
	on(event: string, listener: (...args: unknown[]) => void): this
	checkForUpdates(): Promise<unknown>
	quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
}

type DesktopAppUpdaterOptions = {
	appUpdater?: AppUpdaterLike
	isPackaged?: boolean
	platform?: NodeJS.Platform
	hasAppImage?: boolean
	currentVersion?: string
	sendStatus?: (status: UpdateStatus) => void
}

export class DesktopAppUpdater {
	private readonly appUpdater: AppUpdaterLike

	private readonly isPackaged: boolean

	private readonly platform: NodeJS.Platform

	private readonly hasAppImage: boolean

	private readonly currentVersion: string

	private readonly sendStatus: (status: UpdateStatus) => void

	private readonly supported: boolean

	private initialized = false

	private status: UpdateStatus

	public constructor(options: DesktopAppUpdaterOptions = {}) {
		this.appUpdater = options.appUpdater ?? autoUpdater
		this.isPackaged = options.isPackaged ?? app.isPackaged
		this.platform = options.platform ?? process.platform
		this.hasAppImage = options.hasAppImage ?? Boolean(process.env.APPIMAGE)
		this.currentVersion = options.currentVersion ?? app.getVersion()
		this.sendStatus = options.sendStatus ?? broadcastUpdateStatus
		this.supported = isUpdaterSupported({
			isPackaged: this.isPackaged,
			platform: this.platform,
			hasAppImage: this.hasAppImage,
		})
		this.status = createInitialUpdateStatus({
			currentVersion: this.currentVersion,
			isPackaged: this.isPackaged,
			platform: this.platform,
			hasAppImage: this.hasAppImage,
		})
	}

	public initialize(): void {
		if (this.initialized) {
			return
		}

		this.initialized = true

		if (!this.supported) {
			this.publishStatus()
			return
		}

		this.appUpdater.autoDownload = true
		this.appUpdater.autoInstallOnAppQuit = false
		this.appUpdater.on('checking-for-update', () => {
			this.setStatus({
				currentVersion: this.currentVersion,
				phase: 'checking',
				message: 'Checking GitHub Releases for a newer version.',
			})
		})
		this.appUpdater.on('update-available', (info: UpdateInfo) => {
			this.setStatus({
				currentVersion: this.currentVersion,
				phase: 'available',
				message: `Update ${info.version} is available and downloading in the background.`,
				availableVersion: info.version,
				releaseDate: info.releaseDate,
				checkedAt: new Date().toISOString(),
			})
		})
		this.appUpdater.on('download-progress', (info: ProgressInfo) => {
			this.setStatus({
				currentVersion: this.currentVersion,
				phase: 'downloading',
				message: `Downloading update ${this.status.availableVersion ?? ''}`.trim(),
				availableVersion: this.status.availableVersion,
				releaseDate: this.status.releaseDate,
				checkedAt: this.status.checkedAt ?? new Date().toISOString(),
				progressPercent: info.percent,
				bytesPerSecond: info.bytesPerSecond,
				transferredBytes: info.transferred,
				totalBytes: info.total,
			})
		})
		this.appUpdater.on('update-not-available', (info: UpdateInfo) => {
			this.setStatus({
				currentVersion: this.currentVersion,
				phase: 'no-update',
				message: `Volatile ${this.currentVersion} is already the latest published version.`,
				availableVersion: info.version,
				releaseDate: info.releaseDate,
				checkedAt: new Date().toISOString(),
			})
		})
		this.appUpdater.on('update-downloaded', (event: UpdateDownloadedEvent) => {
			this.setStatus({
				currentVersion: this.currentVersion,
				phase: 'downloaded',
				message: `Update ${event.version} is ready. Restart Volatile to finish installing it.`,
				availableVersion: event.version,
				downloadedVersion: event.version,
				releaseDate: event.releaseDate,
				checkedAt: new Date().toISOString(),
				progressPercent: 100,
				transferredBytes: this.status.totalBytes,
				totalBytes: this.status.totalBytes,
			})
		})
		this.appUpdater.on('error', (error: Error) => {
			this.setStatus({
				currentVersion: this.currentVersion,
				phase: 'error',
				message: error.message || 'Failed to check for updates.',
				availableVersion: this.status.availableVersion,
				downloadedVersion: this.status.downloadedVersion,
				releaseDate: this.status.releaseDate,
				checkedAt: new Date().toISOString(),
			})
		})
	}

	public getStatus(): UpdateStatus {
		return this.status
	}

	public async checkForUpdates(): Promise<UpdateStatus> {
		this.initialize()

		if (!this.supported) {
			return this.status
		}

		try {
			await this.appUpdater.checkForUpdates()
		} catch (error) {
			this.setStatus({
				currentVersion: this.currentVersion,
				phase: 'error',
				message:
					error instanceof Error
						? error.message
						: 'Failed to check for updates.',
				availableVersion: this.status.availableVersion,
				downloadedVersion: this.status.downloadedVersion,
				releaseDate: this.status.releaseDate,
				checkedAt: new Date().toISOString(),
			})
		}

		return this.status
	}

	public applyUpdateAndRestart(): void {
		if (!this.supported || this.status.phase !== 'downloaded') {
			return
		}

		this.appUpdater.quitAndInstall()
	}

	public syncWindow(window: BrowserWindow): void {
		window.webContents.send(APP_UPDATER_EVENT_CHANNEL, this.status)
	}

	private setStatus(status: UpdateStatus): void {
		this.status = status
		this.publishStatus()
	}

	private publishStatus(): void {
		this.sendStatus(this.status)
	}
}

export const registerUpdaterIpcHandlers = (
	updater: DesktopAppUpdater,
): void => {
	ipcMain.removeHandler(APP_UPDATER_STATUS_CHANNEL)
	ipcMain.removeHandler(APP_UPDATER_CHECK_CHANNEL)
	ipcMain.removeHandler(APP_UPDATER_APPLY_CHANNEL)

	ipcMain.handle(APP_UPDATER_STATUS_CHANNEL, () => updater.getStatus())
	ipcMain.handle(APP_UPDATER_CHECK_CHANNEL, () => updater.checkForUpdates())
	ipcMain.handle(APP_UPDATER_APPLY_CHANNEL, () => {
		updater.applyUpdateAndRestart()
	})
}

const broadcastUpdateStatus = (status: UpdateStatus): void => {
	for (const window of ElectronBrowserWindow.getAllWindows()) {
		window.webContents.send(APP_UPDATER_EVENT_CHANNEL, status)
	}
}

const isUpdaterSupported = ({
	isPackaged,
	platform,
	hasAppImage,
}: {
	isPackaged: boolean
	platform: NodeJS.Platform
	hasAppImage: boolean
}): boolean => {
	if (!isPackaged) {
		return false
	}

	if (platform === 'linux' && !hasAppImage) {
		return false
	}

	return platform === 'win32' || platform === 'darwin' || platform === 'linux'
}

export const createInitialUpdateStatus = ({
	currentVersion,
	isPackaged,
	platform,
	hasAppImage,
}: {
	currentVersion: string
	isPackaged: boolean
	platform: NodeJS.Platform
	hasAppImage: boolean
}): UpdateStatus => {
	if (!isPackaged) {
		return {
			currentVersion,
			phase: 'unsupported',
			message: 'Auto-update is available only in packaged releases.',
		}
	}

	if (platform === 'linux' && !hasAppImage) {
		return {
			currentVersion,
			phase: 'unsupported',
			message: 'Auto-update on Linux is available only from the AppImage release.',
		}
	}

	return {
		currentVersion,
		phase: 'idle',
		message: 'Ready to check GitHub Releases for updates.',
	}
}
