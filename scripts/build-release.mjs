import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const rootDir = path.resolve(import.meta.dirname, '..')
const packageJson = JSON.parse(
	readFileSync(path.join(rootDir, 'package.json'), 'utf8'),
)
const platform = process.platform
const arch = process.arch
const publishIndex = process.argv.indexOf('--publish')
const publishMode =
	publishIndex >= 0 && process.argv[publishIndex + 1]
		? process.argv[publishIndex + 1]
		: 'never'
const forgeEnv = {
	...process.env,
	// Electron Forge uses this to detect the active package manager during its
	// system check. Bun does not set a compatible value here, so normalize it.
	npm_config_user_agent: 'npm/10.0.0',
}

runBinary('electron-forge', [
	'package',
	'--platform',
	platform,
	'--arch',
	arch,
])

runBinary('electron-builder', [
	'--config',
	'electron-builder.yml',
	'--publish',
	publishMode,
	'--prepackaged',
	resolvePrepackagedPath({
		productName: packageJson.productName,
		platform,
		arch,
	}),
])

function resolvePrepackagedPath({ productName, platform, arch }) {
	const outputDir = path.join(rootDir, 'out', `${productName}-${platform}-${arch}`)

	if (platform === 'darwin') {
		const appBundlePath = path.join(outputDir, `${productName}.app`)

		if (!existsSync(appBundlePath)) {
			throw new Error(`Prepackaged macOS app not found at ${appBundlePath}`)
		}

		return appBundlePath
	}

	if (!existsSync(outputDir)) {
		throw new Error(`Prepackaged app not found at ${outputDir}`)
	}

	return outputDir
}

function runBinary(command, args) {
	const entrypoint = resolveCliEntrypoint(command)
	const result = spawnSync(process.execPath, [entrypoint, ...args], {
		cwd: rootDir,
		stdio: 'inherit',
		env: forgeEnv,
	})

	if (result.error) {
		throw new Error(`${command} failed to start: ${result.error.message}`)
	}

	if (result.signal) {
		throw new Error(`${command} exited due to signal ${result.signal}`)
	}

	if (result.status !== 0) {
		throw new Error(`${command} exited with status ${result.status ?? 'unknown'}`)
	}
}

function resolveCliEntrypoint(command) {
	if (command === 'electron-forge') {
		return path.join(
			rootDir,
			'node_modules',
			'@electron-forge',
			'cli',
			'dist',
			'electron-forge.js',
		)
	}

	if (command === 'electron-builder') {
		return path.join(rootDir, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js')
	}

	throw new Error(`Unsupported command: ${command}`)
}
