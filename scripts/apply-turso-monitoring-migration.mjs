#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@libsql/client'
import { loadMonitoringEnv, missingMonitoringEnv } from './load-monitoring-env.mjs'

const MIGRATION = 'db/turso/migrations/20260605000000_codex_monitoring.sql'

function splitSqlStatements(sqlText) {
  return sqlText
    .split(';')
    .map(statement => statement.trim())
    .filter(statement => statement && !statement.startsWith('--'))
}

const env = loadMonitoringEnv()
const missing = missingMonitoringEnv(env, ['TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN'])
if (missing.length) {
  console.error(`Missing required env: ${missing.join(', ')}`)
  console.error('Put values in .env.monitoring.local or export them in the shell, then rerun this command.')
  process.exit(1)
}

const client = createClient({
  url: env.TURSO_DATABASE_URL,
  authToken: env.TURSO_AUTH_TOKEN,
})

const sqlText = readFileSync(resolve(MIGRATION), 'utf8')
const statements = splitSqlStatements(sqlText)

console.log(`Applying Turso monitoring migration: ${MIGRATION}`)
for (const sql of statements) {
  await client.execute(sql)
}

const result = await client.execute(`
  SELECT name
  FROM sqlite_master
  WHERE type = 'table'
    AND name IN ('ai_tasks', 'ai_task_progress', 'ai_task_events', 'runner_heartbeats', 'screenshots')
  ORDER BY name
`)

console.log(`Verified tables: ${result.rows.map(row => row.name).join(', ')}`)
