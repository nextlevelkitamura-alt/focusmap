#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { loadMonitoringEnv, missingMonitoringEnv, REQUIRED_MONITORING_ENV } from './load-monitoring-env.mjs'

const repoArgIndex = process.argv.indexOf('--repo')
const repo = repoArgIndex >= 0 && process.argv[repoArgIndex + 1]
  ? process.argv[repoArgIndex + 1]
  : 'nextlevelkitamura-alt/focusmap'

const env = loadMonitoringEnv()
const missing = missingMonitoringEnv(env)
if (missing.length) {
  console.error(`Missing required env: ${missing.join(', ')}`)
  console.error('Put values in .env.monitoring.local or export them in the shell, then rerun this command.')
  process.exit(1)
}

function setSecret(name, value) {
  const result = spawnSync('gh', ['secret', 'set', name, '--repo', repo], {
    input: value,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  if (result.status !== 0) {
    process.stderr.write(result.stderr)
    process.exit(result.status ?? 1)
  }
  console.log(`Set GitHub secret: ${name}`)
}

for (const name of REQUIRED_MONITORING_ENV) {
  setSecret(name, env[name])
}

console.log(`Done. Repo: ${repo}`)
