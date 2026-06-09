import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const root = process.cwd()
const agentDir = path.join(root, 'scripts', 'focusmap-agent')
const requiredRuntimePackages = [
  '@supabase/supabase-js',
  'googleapis',
  'playwright',
  'sharp',
  'ws',
]

async function exists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function runNpm(args) {
  const child = execFileAsync('npm', ['--prefix', agentDir, ...args], {
    cwd: root,
    maxBuffer: 1024 * 1024 * 20,
  })
  const { stdout, stderr } = await child
  if (stdout.trim()) process.stdout.write(stdout)
  if (stderr.trim()) process.stderr.write(stderr)
}

async function runtimePackageMissing(packageName) {
  const packageJson = path.join(agentDir, 'node_modules', packageName, 'package.json')
  return !(await exists(packageJson))
}

const missingPackages = []
for (const packageName of requiredRuntimePackages) {
  if (await runtimePackageMissing(packageName)) missingPackages.push(packageName)
}

if (missingPackages.length > 0) {
  console.log(`Installing focusmap-agent dependencies: ${missingPackages.join(', ')}`)
  await runNpm(['ci'])
} else {
  console.log('focusmap-agent dependencies are present')
}

console.log('Building focusmap-agent')
await runNpm(['run', 'build'])

const distCli = path.join(agentDir, 'dist', 'cli.js')
if (!(await exists(distCli))) {
  throw new Error(`focusmap-agent build output is missing: ${distCli}`)
}

console.log('focusmap-agent is ready')
