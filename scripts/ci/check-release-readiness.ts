import fs from 'node:fs'
import path from 'node:path'

type PackageAuthor = {
  name?: string
  email?: string
}

type PackageJson = {
  name?: string
  productName?: string
  version?: string
  description?: string
  private?: boolean
  license?: string
  author?: string | PackageAuthor
  repository?: string | { type?: string; url?: string }
  homepage?: string
  bugs?: string | { url?: string }
  keywords?: string[]
}

const root = process.cwd()
const packageJsonPath = path.join(root, 'package.json')
const requiredIconPaths = [
  path.join(root, 'assets', 'icon.png'),
  path.join(root, 'assets', 'icon.ico'),
  path.join(root, 'assets', 'icon.icns'),
]

const errors: string[] = []

const assert = (condition: unknown, message: string): void => {
  if (!condition) {
    errors.push(message)
  }
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

const readPackageJson = (): PackageJson => {
  const raw = fs.readFileSync(packageJsonPath, 'utf8')
  return JSON.parse(raw) as PackageJson
}

const extractRepositoryUrl = (repository: PackageJson['repository']): string => {
  if (typeof repository === 'string') {
    return repository
  }

  return repository?.url ?? ''
}

const extractBugsUrl = (bugs: PackageJson['bugs']): string => {
  if (typeof bugs === 'string') {
    return bugs
  }

  return bugs?.url ?? ''
}

const checkTagVersion = (version: string): void => {
  const refName = process.env.GITHUB_REF_NAME
  if (!isNonEmptyString(refName) || !refName.startsWith('v')) {
    return
  }

  const tagVersion = refName.slice(1)
  assert(
    tagVersion === version,
    `Tag version mismatch: ${refName} does not match package version ${version}.`,
  )
}

const checkRequiredFile = (filePath: string, label: string): void => {
  assert(fs.existsSync(filePath), `${label} is missing (${path.relative(root, filePath)}).`)
}

const pkg = readPackageJson()
const description = pkg.description?.trim() ?? ''
const repositoryUrl = extractRepositoryUrl(pkg.repository).trim()
const bugsUrl = extractBugsUrl(pkg.bugs).trim()

assert(isNonEmptyString(pkg.name), 'package.json must define "name".')
assert(isNonEmptyString(pkg.productName), 'package.json must define "productName".')
assert(isNonEmptyString(pkg.version), 'package.json must define "version".')
assert(isNonEmptyString(description), 'package.json must define a non-empty "description".')
assert(
  description !== 'My Electron application description',
  'package.json contains a placeholder description.',
)
assert(
  Array.isArray(pkg.keywords) && pkg.keywords.length > 0,
  'package.json must define non-empty "keywords".',
)
assert(isNonEmptyString(repositoryUrl), 'package.json must define "repository".')
assert(isNonEmptyString(pkg.homepage), 'package.json must define "homepage".')
assert(isNonEmptyString(bugsUrl), 'package.json must define "bugs.url".')
assert(isNonEmptyString(pkg.license), 'package.json must define "license".')

if (isNonEmptyString(pkg.version)) {
  checkTagVersion(pkg.version)
}

checkRequiredFile(path.join(root, 'README.md'), 'README')
checkRequiredFile(path.join(root, 'LICENSE'), 'LICENSE')
checkRequiredFile(path.join(root, 'SECURITY.md'), 'SECURITY policy')
checkRequiredFile(path.join(root, 'CONTRIBUTING.md'), 'CONTRIBUTING guide')
checkRequiredFile(path.join(root, '.github', 'CODEOWNERS'), 'CODEOWNERS')

for (const iconPath of requiredIconPaths) {
  checkRequiredFile(iconPath, 'Release icon')
  if (fs.existsSync(iconPath)) {
    const size = fs.statSync(iconPath).size
    assert(size > 0, `Icon file is empty (${path.relative(root, iconPath)}).`)
  }
}

if (errors.length > 0) {
  console.error('Release readiness checks failed:')
  for (const error of errors) {
    console.error(`- ${error}`)
  }
  process.exit(1)
}

console.log('Release readiness checks passed.')
