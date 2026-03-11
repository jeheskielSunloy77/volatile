import { EventEmitter } from 'node:events'

import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
	app: {
		isPackaged: false,
		getVersion: () => '0.0.0-test',
	},
	BrowserWindow: {
		getAllWindows: (): never[] => [],
	},
	ipcMain: {
		removeHandler: vi.fn(),
		handle: vi.fn(),
	},
}))

vi.mock('electron-updater', () => ({
	autoUpdater: new EventEmitter(),
}))

import { DesktopAppUpdater, createInitialUpdateStatus } from './app-updater'

class FakeUpdater extends EventEmitter {
	public autoDownload = false

	public autoInstallOnAppQuit = true

	public readonly checkForUpdates = vi.fn(async () => null)

	public readonly quitAndInstall = vi.fn()
}

describe('createInitialUpdateStatus', () => {
	it('returns unsupported status for unpackaged apps', () => {
		expect(
			createInitialUpdateStatus({
				currentVersion: '1.2.1',
				isPackaged: false,
				platform: 'linux',
				hasAppImage: false,
			}),
		).toEqual({
			currentVersion: '1.2.1',
			phase: 'unsupported',
			message: 'Auto-update is available only in packaged releases.',
		})
	})

	it('returns idle status for supported packaged builds', () => {
		expect(
			createInitialUpdateStatus({
				currentVersion: '1.2.1',
				isPackaged: true,
				platform: 'win32',
				hasAppImage: false,
			}),
		).toEqual({
			currentVersion: '1.2.1',
			phase: 'idle',
			message: 'Ready to check GitHub Releases for updates.',
		})
	})
})

describe('DesktopAppUpdater', () => {
	it('maps updater events to status snapshots', async () => {
		const fakeUpdater = new FakeUpdater()
		const publishedStatuses: string[] = []
		const updater = new DesktopAppUpdater({
			appUpdater: fakeUpdater,
			isPackaged: true,
			platform: 'win32',
			currentVersion: '1.2.1',
			sendStatus: (status) => {
				publishedStatuses.push(status.phase)
			},
		})

		updater.initialize()
		await updater.checkForUpdates()

		fakeUpdater.emit('checking-for-update')
		fakeUpdater.emit('update-available', {
			version: '1.3.0',
			releaseDate: '2026-03-11T00:00:00.000Z',
		})
		fakeUpdater.emit('download-progress', {
			percent: 42,
			bytesPerSecond: 1024,
			transferred: 2048,
			total: 4096,
		})
		fakeUpdater.emit('update-downloaded', {
			version: '1.3.0',
			releaseDate: '2026-03-11T00:00:00.000Z',
		})

		expect(fakeUpdater.autoDownload).toBe(true)
		expect(fakeUpdater.autoInstallOnAppQuit).toBe(false)
		expect(fakeUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
		expect(publishedStatuses).toEqual([
			'checking',
			'available',
			'downloading',
			'downloaded',
		])
		expect(updater.getStatus()).toMatchObject({
			phase: 'downloaded',
			downloadedVersion: '1.3.0',
			progressPercent: 100,
		})
	})

	it('does not call quitAndInstall unless an update is ready', () => {
		const fakeUpdater = new FakeUpdater()
		const updater = new DesktopAppUpdater({
			appUpdater: fakeUpdater,
			isPackaged: true,
			platform: 'win32',
			currentVersion: '1.2.1',
		})

		updater.applyUpdateAndRestart()
		expect(fakeUpdater.quitAndInstall).not.toHaveBeenCalled()

		updater.initialize()
		fakeUpdater.emit('update-downloaded', {
			version: '1.3.0',
			releaseDate: '2026-03-11T00:00:00.000Z',
		})
		updater.applyUpdateAndRestart()

		expect(fakeUpdater.quitAndInstall).toHaveBeenCalledTimes(1)
	})
})
