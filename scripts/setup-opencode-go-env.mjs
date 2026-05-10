#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

const envPath = '.env.local'
const args = new Map()

for (const arg of process.argv.slice(2)) {
  const [key, ...valueParts] = arg.replace(/^--/, '').split('=')
  if (key && valueParts.length > 0) args.set(key, valueParts.join('='))
}

async function resolveApiKey() {
  const fromArg = args.get('key') || args.get('opencode-go-api-key')
  const fromEnv = process.env.OPENCODE_GO_API_KEY || process.env.EXTERNAL_AI_API_KEY
  if (fromArg) return fromArg.trim()
  if (fromEnv) return fromEnv.trim()

  const rl = createInterface({ input, output })
  const answer = await rl.question('OpenCode Go API key: ')
  rl.close()
  return answer.trim()
}

function upsertEnv(content, entries) {
  const lines = content ? content.split(/\r?\n/) : []
  const used = new Set()
  const nextLines = lines.map(line => {
    const match = line.match(/^([A-Z0-9_]+)=/)
    if (!match) return line
    const key = match[1]
    if (!(key in entries)) return line
    used.add(key)
    return `${key}=${entries[key]}`
  })

  const missing = Object.entries(entries)
    .filter(([key]) => !used.has(key))
    .map(([key, value]) => `${key}=${value}`)

  const needsHeader = missing.length > 0 && !nextLines.some(line => line.includes('OpenCode Go / Kimi K2.6'))
  if (needsHeader) {
    nextLines.push('', '# OpenCode Go / Kimi K2.6')
  } else if (missing.length > 0 && nextLines.at(-1) !== '') {
    nextLines.push('')
  }
  nextLines.push(...missing)

  return `${nextLines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`
}

const apiKey = await resolveApiKey()
if (!apiKey) {
  console.error('OpenCode Go API key が空です')
  process.exit(1)
}

const entries = {
  OPENCODE_GO_API_KEY: apiKey,
  EXTERNAL_AI_API_KEY: apiKey,
  EXTERNAL_AI_API_BASE_URL: 'https://opencode.ai/zen/go/v1/chat/completions',
  EXTERNAL_AI_MODEL: 'kimi-k2.6',
  EXTERNAL_AI_DISABLE_THINKING: 'false',
}

const current = existsSync(envPath) ? readFileSync(envPath, 'utf8') : ''
writeFileSync(envPath, upsertEnv(current, entries), { mode: 0o600 })

console.log('.env.local に OpenCode Go / Kimi K2.6 設定を保存しました')
console.log('開発サーバーを再起動すると反映されます')
