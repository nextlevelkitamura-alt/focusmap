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

if (!(await exists(sourceApp))) {
  throw new Error(`ビルド済みアプリが見つかりません: ${sourceApp}\n先に npm run mac:build を実行してください。`)
}

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

console.log(`Installed ${targetApp}`)
console.log('Dock の ? アイコンは削除し、/Applications/Focusmap.app をDockへ追加してください。')
