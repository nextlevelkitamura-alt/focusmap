import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const root = process.cwd()
const sourceApp = path.join(root, 'dist-desktop', 'mac-arm64', 'Focusmap.app')
const targetApp = '/Applications/Focusmap.app'

async function exists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function expectedResolverVersion() {
  const source = await fs.readFile(path.join(root, 'scripts', 'focusmap-agent', 'src', 'codex-thread-monitor.ts'), 'utf8')
  const match = source.match(/CODEX_THREAD_STATUS_RESOLVER_VERSION\s*=\s*['"]([^'"]+)['"]/)
  if (!match?.[1]) {
    throw new Error('focusmap-agent resolver version が source から読み取れません。')
  }
  return match[1]
}

async function assertBundledAgentResolver(appPath, expectedVersion) {
  const bundledMonitor = path.join(appPath, 'Contents', 'Resources', 'focusmap-agent', 'dist', 'codex-thread-monitor.js')
  if (!(await exists(bundledMonitor))) {
    throw new Error(`同梱focusmap-agentが見つかりません: ${bundledMonitor}`)
  }
  const bundledSource = await fs.readFile(bundledMonitor, 'utf8')
  if (!bundledSource.includes(expectedVersion)) {
    throw new Error([
      `同梱focusmap-agentのresolver versionが古い可能性があります: ${bundledMonitor}`,
      `expected: ${expectedVersion}`,
      '先に npm run mac:build を実行し、dist-desktop の Focusmap.app を作り直してください。',
    ].join('\n'))
  }
}

if (!(await exists(sourceApp))) {
  throw new Error(`ビルド済みアプリが見つかりません: ${sourceApp}\n先に npm run mac:build を実行してください。`)
}

const resolverVersion = await expectedResolverVersion()
await assertBundledAgentResolver(sourceApp, resolverVersion)

await execFileAsync('/usr/bin/osascript', [
  '-e',
  'tell application id "com.focusmap.desktop" to quit',
]).catch(() => {})

await new Promise((resolve) => setTimeout(resolve, 1000))
await fs.rm(targetApp, { recursive: true, force: true })
await execFileAsync('/usr/bin/ditto', [sourceApp, targetApp])
await execFileAsync('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', targetApp]).catch(() => {})
await execFileAsync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', targetApp]).catch((error) => {
  console.warn(`codesign skipped: ${error.message}`)
})
await execFileAsync('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister', [
  '-f',
  targetApp,
]).catch(() => {})
await assertBundledAgentResolver(targetApp, resolverVersion)

console.log(`Installed ${targetApp}`)
console.log(`focusmap-agent resolver version: ${resolverVersion}`)
console.log('Dock の ? アイコンは削除し、/Applications/Focusmap.app をDockへ追加してください。')
