import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives'
import { FusesPlugin } from '@electron-forge/plugin-fuses'
import { VitePlugin } from '@electron-forge/plugin-vite'
import type { ForgeConfig } from '@electron-forge/shared-types'
import { FuseV1Options, FuseVersion } from '@electron/fuses'

const config: ForgeConfig = {
	packagerConfig: {
		asar: true,
		ignore: (file: string): boolean => {
			if (!file) {
				return false
			}

			const bundledNodeModules = [
				'/node_modules/better-sqlite3/',
				'/node_modules/bindings/',
				'/node_modules/file-uri-to-path/',
			]

			const shouldKeep =
				file.startsWith('/.vite') ||
				file === '/node_modules' ||
				bundledNodeModules.some((modulePath) => file.startsWith(modulePath))

			return !shouldKeep
		},
		icon: 'assets/icon',
		executableName: 'volatile',
		appBundleId: 'com.volatile.app',
		appCategoryType: 'public.app-category.developer-tools',
		win32metadata: {
			CompanyName: 'Volatile',
			FileDescription: 'Volatile desktop application',
			OriginalFilename: 'Volatile.exe',
			ProductName: 'Volatile',
		},
	},
	rebuildConfig: {},
	plugins: [
		new AutoUnpackNativesPlugin({}),
		new VitePlugin({
			// `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
			// If you are familiar with Vite configuration, it will look really familiar.
			build: [
				{
					// `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
					entry: 'src/main/main.ts',
					config: 'vite.main.config.ts',
					target: 'main',
				},
				{
					entry: 'src/preload/preload.ts',
					config: 'vite.preload.config.ts',
					target: 'preload',
				},
			],
			renderer: [
				{
					name: 'main_window',
					config: 'vite.renderer.config.ts',
				},
			],
		}),
		// Fuses are used to enable/disable various Electron functionality
		// at package time, before code signing the application
		new FusesPlugin({
			version: FuseVersion.V1,
			[FuseV1Options.RunAsNode]: false,
			[FuseV1Options.EnableCookieEncryption]: true,
			[FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
			[FuseV1Options.EnableNodeCliInspectArguments]: false,
			[FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
			[FuseV1Options.OnlyLoadAppFromAsar]: true,
		}),
	],
}

export default config
