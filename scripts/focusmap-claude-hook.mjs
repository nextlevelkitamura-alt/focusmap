#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

function readStdin() {
  return new Promise(resolve => {
    let input = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', chunk => { input += chunk })
    process.stdin.on('end', () => resolve(input))
  })
}

function safeJsonParse(raw) {
  if (!raw.trim()) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return { raw }
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

const [, , taskId = 'unknown', runDir = '', explicitEventName = 'hook'] = process.argv
const resolvedRunDir = runDir || path.join(process.env.HOME || '.', '.focusmap', 'ai-runs', taskId)
ensureDir(resolvedRunDir)

const rawInput = await readStdin()
const payload = safeJsonParse(rawInput)
const eventName =
  typeof payload.hook_event_name === 'string' ? payload.hook_event_name :
  typeof payload.hookEventName === 'string' ? payload.hookEventName :
  explicitEventName

const event = {
  task_id: taskId,
  event_name: eventName,
  observed_at: new Date().toISOString(),
  session_id: payload.session_id ?? payload.sessionId ?? null,
  transcript_path: payload.transcript_path ?? payload.transcriptPath ?? null,
  cwd: payload.cwd ?? null,
  tool_name: payload.tool_name ?? payload.toolName ?? null,
  notification_type: payload.notification_type ?? payload.notificationType ?? null,
  raw: payload,
}

fs.appendFileSync(
  path.join(resolvedRunDir, 'events.jsonl'),
  `${JSON.stringify(event)}\n`,
  'utf8',
)

// Keep hook invisible to Claude unless a future hook needs decision control.
process.exit(0)
