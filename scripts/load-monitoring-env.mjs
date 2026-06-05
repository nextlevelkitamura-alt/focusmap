import { existsSync, readFileSync } from 'node:fs'

const DEFAULT_ENV_FILES = ['.env.monitoring.local', '.env.local']

function parseEnvText(text) {
  const result = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!match) continue
    const key = match[1]
    let value = match[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    result[key] = value
  }
  return result
}

export function loadMonitoringEnv(files = DEFAULT_ENV_FILES) {
  const loaded = {}
  for (const file of files) {
    if (!existsSync(file)) continue
    Object.assign(loaded, parseEnvText(readFileSync(file, 'utf8')))
  }
  return { ...loaded, ...process.env }
}

export const REQUIRED_MONITORING_ENV = [
  'TURSO_DATABASE_URL',
  'TURSO_AUTH_TOKEN',
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_SCREENSHOT_BUCKET',
]

export function missingMonitoringEnv(env, keys = REQUIRED_MONITORING_ENV) {
  return keys.filter(key => !env[key])
}
