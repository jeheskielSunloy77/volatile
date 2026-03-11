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
	const extension = process.platform === 'win32' ? '.cmd' : ''
	const binaryPath = path.join(rootDir, 'node_modules', '.bin', `${command}${extension}`)
	const result = spawnSync(binaryPath, args, {
		cwd: rootDir,
		stdio: 'inherit',
		env: process.env,
	})

	if (result.status !== 0) {
		throw new Error(`${command} exited with status ${result.status ?? 'unknown'}`)
	}
}
