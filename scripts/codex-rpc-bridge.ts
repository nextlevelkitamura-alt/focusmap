#!/usr/bin/env npx ts-node --esm
/**
 * Codex App-Server JSON-RPC ブリッジ
 * ===================================
 * 1 タスクを ws://127.0.0.1:7878 の codex app-server に直接送信し、
 * `turn/completed` を待って Supabase の ai_tasks を更新する。
 *
 * 旧 task-runner の `codex --remote` (TUI) 方式は positional prompt が
 * auto-submit されず（Enter 待ち）、tmux detached では誰も Enter を押せず
 * thread だけ作られて止まる問題があったため、JSON-RPC 直接通信に切替。
 *
 * 起動:
 *   npx ts-node --esm scripts/codex-rpc-bridge.ts <taskId> <cwd> <promptFile>
 *
 * task-runner.ts から detached child process として spawn される。
 * 1 タスクで 1 プロセス。完了/失敗で exit する。
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import WebSocket from 'ws'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// .env.local 読み込み
function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return
  const content = fs.readFileSync(filePath, 'utf-8')
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx < 1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '')
    if (!(key in process.env)) process.env[key] = value
  }
}
loadEnvFile(path.resolve(__dirname, '../.env.local'))

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const WS_URL = 'ws://127.0.0.1:7878'
const OVERALL_TIMEOUT_MS = 15 * 60 * 1000 // 15分
const CONNECT_TIMEOUT_MS = 10_000
const LOG_FILE_TEMPLATE = (taskId: string) => `/tmp/codex-bridge-${taskId}.log`

// ─────────────────────────────────────────────────────────────────────────
// ステップ型（task-runner と同期、ai_tasks.result.steps[] に蓄積）
// ─────────────────────────────────────────────────────────────────────────
type CodexStepStatus = 'done' | 'active' | 'failed'
interface CodexStep {
  key: string
  label: string
  status: CodexStepStatus
  at: string
}
type AiTaskTerminalStatus = 'completed' | 'failed'

function makeStep(key: string, label: string, status: CodexStepStatus = 'done'): CodexStep {
  return { key, label, status, at: new Date().toISOString() }
}

function stringifyError(value: unknown): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object' && 'message' in value && typeof value.message === 'string') {
    return value.message
  }
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function extractText(value: unknown): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(extractText).join('')
  if (typeof value !== 'object') return ''

  const record = value as Record<string, unknown>
  if (typeof record.text === 'string') return record.text
  if (typeof record.delta === 'string') return record.delta
  if (typeof record.content === 'string') return record.content
  if (Array.isArray(record.content)) return record.content.map(extractText).join('')
  if (Array.isArray(record.parts)) return record.parts.map(extractText).join('')
  return ''
}

function normalizePromptBlock(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function promptCompareKey(text: string): string {
  return normalizePromptBlock(text).replace(/\s+/g, ' ')
}

function dedupeRepeatedPromptBlocks(text: string): string {
  const blocks = normalizePromptBlock(text)
    .split(/\n{2,}/)
    .map(block => normalizePromptBlock(block))
    .filter(Boolean)
  const result: string[] = []
  let i = 0

  while (i < blocks.length) {
    let repeatedBlockLength = 0
    const remaining = blocks.length - i
    for (let length = Math.floor(remaining / 2); length >= 1; length--) {
      const first = blocks.slice(i, i + length).map(promptCompareKey)
      const second = blocks.slice(i + length, i + length * 2).map(promptCompareKey)
      if (first.every((key, index) => key === second[index])) {
        repeatedBlockLength = length
        break
      }
    }
    if (repeatedBlockLength > 0) {
      result.push(...blocks.slice(i, i + repeatedBlockLength))
      i += repeatedBlockLength * 2
    } else {
      result.push(blocks[i])
      i += 1
    }
  }

  return result.join('\n\n')
}

function resolveTurnOutcome(opts: {
  status: string
  error: unknown
  hasAssistantOutput: boolean
}): { status: AiTaskTerminalStatus; label: string; error?: string; note?: string } {
  const normalized = opts.status.trim().toLowerCase()
  const errorText = stringifyError(opts.error)

  if (errorText) {
    return {
      status: 'failed',
      label: `失敗 (${opts.status || 'error'})`,
      error: `Codex turn ${opts.status || 'error'}: ${errorText}`,
    }
  }

  const successful = new Set(['completed', 'complete', 'success', 'succeeded', 'done', 'finished'])
  if (successful.has(normalized)) {
    return { status: 'completed', label: '完了' }
  }

  const failed =
    normalized.includes('fail') ||
    normalized.includes('error') ||
    normalized.includes('abort') ||
    normalized.includes('cancel') ||
    normalized.includes('timeout')
  if (failed) {
    return {
      status: 'failed',
      label: `失敗 (${opts.status})`,
      error: `Codex turn ${opts.status}`,
    }
  }

  if (normalized === 'interrupted' && opts.hasAssistantOutput) {
    return {
      status: 'completed',
      label: '完了（Codex status: interrupted / errorなし）',
      note: 'Codex app-server は interrupted を返しましたが、error はなく回答ログを取得できたため完了扱いにしました。',
    }
  }

  if (opts.hasAssistantOutput) {
    return {
      status: 'completed',
      label: `完了（Codex status: ${opts.status || 'unknown'}）`,
      note: 'Codex app-server の終了 status は未分類ですが、error はなく回答ログを取得できたため完了扱いにしました。',
    }
  }

  return {
    status: 'failed',
    label: `失敗 (${opts.status || 'unknown'})`,
    error: `Codex turn ${opts.status || 'unknown'}: 回答ログを取得できないまま終了しました`,
  }
}

async function pushStep(
  supabase: SupabaseClient,
  taskId: string,
  step: CodexStep,
  extra?: { liveLog?: string; threadId?: string; message?: string; metadata?: Record<string, unknown> },
): Promise<void> {
  const { data } = await supabase.from('ai_tasks').select('result').eq('id', taskId).maybeSingle()
  const current = (data?.result ?? {}) as { steps?: CodexStep[]; [k: string]: unknown }
  const steps: CodexStep[] = Array.isArray(current.steps) ? [...current.steps] : []
  const idx = steps.findIndex(s => s.key === step.key)
  if (idx >= 0) steps[idx] = step
  else steps.push(step)

  const merged: Record<string, unknown> = { ...current, executor: 'codex', steps }
  if (extra?.liveLog !== undefined) merged.live_log = extra.liveLog
  if (extra?.threadId) merged.codex_thread_id = extra.threadId
  if (extra?.message) merged.message = extra.message
  if (extra?.metadata) Object.assign(merged, extra.metadata)
  await supabase.from('ai_tasks').update({ result: merged }).eq('id', taskId)
}

// ─────────────────────────────────────────────────────────────────────────
// JSON-RPC ヘルパー
// ─────────────────────────────────────────────────────────────────────────
interface RpcEnvelope {
  jsonrpc?: string
  id?: number
  method?: string
  params?: unknown
  result?: unknown
  error?: { code?: number; message?: string }
}

class RpcClient {
  private ws: WebSocket
  private nextId = 0
  private pending = new Map<number, (msg: RpcEnvelope) => void>()
  private notificationHandlers = new Set<(msg: RpcEnvelope) => void>()
  private logFile: string

  constructor(ws: WebSocket, logFile: string) {
    this.ws = ws
    this.logFile = logFile
    ws.on('message', (data: WebSocket.Data) => {
      const raw = data.toString()
      this.appendLog(`← ${raw}\n`)
      let msg: RpcEnvelope
      try {
        msg = JSON.parse(raw)
      } catch {
        return
      }
      if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
        const resolve = this.pending.get(msg.id)!
        this.pending.delete(msg.id)
        resolve(msg)
      } else if (msg.method) {
        for (const h of this.notificationHandlers) h(msg)
      }
    })
  }

  private appendLog(line: string) {
    try { fs.appendFileSync(this.logFile, line) } catch { /* ignore */ }
  }

  call(method: string, params?: unknown, timeoutMs = 30_000): Promise<RpcEnvelope> {
    const id = ++this.nextId
    const payload = { jsonrpc: '2.0', id, method, params }
    this.appendLog(`→ ${JSON.stringify(payload)}\n`)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`RPC timeout: ${method}`))
      }, timeoutMs)
      this.pending.set(id, (msg) => {
        clearTimeout(timer)
        resolve(msg)
      })
      this.ws.send(JSON.stringify(payload))
    })
  }

  onNotification(handler: (msg: RpcEnvelope) => void): () => void {
    this.notificationHandlers.add(handler)
    return () => { this.notificationHandlers.delete(handler) }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// メイン: 引数から taskId / cwd / promptFile を受け取り 1 タスク実行
// ─────────────────────────────────────────────────────────────────────────
async function main() {
  const [, , taskId, cwd, promptFile] = process.argv
  if (!taskId || !cwd || !promptFile) {
    console.error('Usage: codex-rpc-bridge.ts <taskId> <cwd> <promptFile>')
    process.exit(2)
  }
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 未設定')
    process.exit(2)
  }
  if (!fs.existsSync(promptFile)) {
    console.error(`prompt file not found: ${promptFile}`)
    process.exit(2)
  }
  if (!fs.existsSync(cwd)) {
    console.error(`cwd not found: ${cwd}`)
    process.exit(2)
  }

  const rawPrompt = fs.readFileSync(promptFile, 'utf-8')
  const prompt = dedupeRepeatedPromptBlocks(rawPrompt)
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  const logFile = LOG_FILE_TEMPLATE(taskId)
  try { fs.unlinkSync(logFile) } catch { /* ignore */ }
  fs.writeFileSync(logFile, '', 'utf-8')

  const overallTimer = setTimeout(async () => {
    await pushStep(supabase, taskId, makeStep('completed', `タイムアウト (${OVERALL_TIMEOUT_MS / 60_000}分)`, 'failed'))
    await supabase.from('ai_tasks').update({
      status: 'failed',
      error: `Codex 実行が ${OVERALL_TIMEOUT_MS / 60_000}分以内に完了しませんでした`,
      completed_at: new Date().toISOString(),
    }).eq('id', taskId)
    process.exit(1)
  }, OVERALL_TIMEOUT_MS)

  // ─── WebSocket 接続 ───
  const ws = new WebSocket(WS_URL)
  const connectTimer = setTimeout(() => {
    console.error(`connect timeout ${CONNECT_TIMEOUT_MS}ms`)
    ws.terminate()
  }, CONNECT_TIMEOUT_MS)

  ws.on('error', async (err) => {
    clearTimeout(connectTimer)
    clearTimeout(overallTimer)
    await pushStep(supabase, taskId, makeStep('connected', `WS 接続失敗: ${err.message}`, 'failed'))
    await supabase.from('ai_tasks').update({
      status: 'failed',
      error: `codex app-server WebSocket 接続失敗: ${err.message}`,
      completed_at: new Date().toISOString(),
    }).eq('id', taskId)
    process.exit(1)
  })

  // ─── response.error チェックでフォールバックを正しく動かすヘルパー ───
  // rpc.call は error response を resolve で返すので「.catch + ??」のフォールバックは効かない
  async function callOk(rpc: RpcClient, method: string, params: unknown): Promise<RpcEnvelope | null> {
    const resp = await rpc.call(method, params).catch((e): RpcEnvelope =>
      ({ error: { message: String(e?.message ?? e) } }))
    if (resp?.error) {
      console.error(`[bridge] ${method} ERROR: ${JSON.stringify(resp.error)}`)
      return null
    }
    return resp
  }

  ws.on('open', async () => {
    clearTimeout(connectTimer)
    const rpc = new RpcClient(ws, logFile)

    try {
      // ─── initialize ───
      // Codex 0.130 app-server は initialize → thread/start → turn/start が正解の流れ
      // method 一覧は /tmp/codex-bridge-28cd0e3e-*.log の error response で確証済
      const initResp = await callOk(rpc, 'initialize', {
        clientInfo: { name: 'focusmap', version: '0.1.0' },
      })
      if (!initResp) throw new Error('initialize 失敗')
      await pushStep(supabase, taskId, makeStep('connected', 'app-server に接続 (initialize OK)'))

      // ─── thread/start で新規 thread 作成 ───
      // response: { result: { thread: { id, ... }, model, ... } }
      const threadResp = await callOk(rpc, 'thread/start', { cwd })
      if (!threadResp) throw new Error('thread/start 失敗')
      const threadResult = threadResp.result as { thread?: { id?: string }; threadId?: string }
      const threadId = threadResult.thread?.id ?? threadResult.threadId
      if (!threadId) throw new Error('thread/start レスポンスから id を取得できない')

      await pushStep(supabase, taskId, makeStep('thread_visible',
        `Thread 作成 (mobile/Codex.app に表示, id ${threadId.slice(0, 8)})`),
        { threadId })
      await supabase.from('ai_tasks').update({ codex_thread_id: threadId }).eq('id', taskId)

      await pushStep(supabase, taskId, makeStep('prompt_ready', `プロンプト準備完了 (${prompt.length}文字)`), {
        metadata: {
          prompt_chars: prompt.length,
          prompt_preview: prompt.slice(0, 1000),
          prompt_deduped: rawPrompt !== prompt,
        },
      })

      // ─── 通知購読 ───
      // app-server の notification は item.content[] / delta / commandExecution に分かれる。
      // UI に出すログは人が読める粒度に整形し、DB 更新は debounce して書き込み過多を避ける。
      const logEntries: string[] = []
      const activeAgentMessages = new Map<string, string>()
      const seenNotifMethods = new Set<string>()
      let flushTimer: NodeJS.Timeout | null = null

      const trimEntries = () => {
        if (logEntries.length > 200) logEntries.splice(0, logEntries.length - 200)
      }
      const buildLiveLog = (maxChars = 6000) => {
        const active = [...activeAgentMessages.values()]
          .filter(Boolean)
          .map(text => `[assistant:streaming] ${text}`)
        return [...logEntries, ...active].join('\n\n').slice(-maxChars)
      }
      const flushLog = async (extraStep?: CodexStep) => {
        const text = buildLiveLog()
        await pushStep(supabase, taskId,
          extraStep ?? makeStep('connected', 'app-server に接続 (initialize OK)'),
          { liveLog: text })
      }
      const scheduleFlushLog = () => {
        if (flushTimer) return
        flushTimer = setTimeout(() => {
          flushTimer = null
          flushLog().catch(() => { /* ignore */ })
        }, 1200)
      }
      const appendLogEntry = (entry: string) => {
        if (!entry.trim()) return
        logEntries.push(entry.trim())
        trimEntries()
        scheduleFlushLog()
      }

      let completed = false
      let completedStatus = 'completed'
      let completedError: unknown = null
      rpc.onNotification((msg) => {
        const method = msg.method ?? ''
        seenNotifMethods.add(method)
        console.error(`[bridge] notif method=${method} params=${JSON.stringify(msg.params).slice(0, 300)}`)
        const params = msg.params as Record<string, unknown> | undefined
        if (!params) return

        if (method === 'item/agentMessage/delta') {
          const itemId = typeof params.itemId === 'string' ? params.itemId : null
          const delta = extractText(params.delta)
          if (itemId && delta) {
            activeAgentMessages.set(itemId, (activeAgentMessages.get(itemId) ?? '') + delta)
            scheduleFlushLog()
          }
          return
        }

        const item = (params.item ?? params.message) as Record<string, unknown> | undefined
        if (item) {
          const itemType = typeof item.type === 'string' ? item.type : 'item'
          if (itemType === 'agentMessage') {
            const itemId = typeof item.id === 'string' ? item.id : null
            const text = extractText(item) || (itemId ? activeAgentMessages.get(itemId) ?? '' : '')
            if (itemId) activeAgentMessages.delete(itemId)
            if (text) appendLogEntry(`[assistant] ${text}`)
          } else if (itemType === 'userMessage' && method === 'item/completed') {
            const text = extractText(item)
            appendLogEntry(`[user] プロンプト送信済み (${text.length}文字)`)
          } else if (itemType === 'commandExecution') {
            const command = typeof item.command === 'string' ? item.command : '(command)'
            const status = typeof item.status === 'string' ? item.status : ''
            if (method === 'item/completed') {
              const exitCode = typeof item.exitCode === 'number' ? `exit=${item.exitCode}` : ''
              const duration = typeof item.durationMs === 'number' ? `duration=${item.durationMs}ms` : ''
              appendLogEntry(
                [
                  `[command:${status || 'completed'}] ${command}`,
                  [exitCode, duration].filter(Boolean).join(' '),
                ].filter(Boolean).join('\n'),
              )
            } else if (method === 'item/started') {
              appendLogEntry(`[command:started] ${command}`)
            }
          }
        }

        if (method === 'item/commandExecution/requestApproval') {
          const command = typeof params.command === 'string' ? params.command : '(command)'
          appendLogEntry(`[approval-requested] ${command}`)
        } else if (method === 'serverRequest/resolved') {
          appendLogEntry('[approval-resolved] Codex app-server request resolved')
        }

        // 完了系: turn/* で complet|finish|end|done をマッチ
        if (/^(turn|thread).*(complet|finish|end|done)/i.test(method)) {
          const turn = (params.turn ?? params.task) as { status?: string; error?: unknown } | undefined
          if (turn?.status) completedStatus = turn.status
          completedError = turn?.error ?? null
          completed = true
        }
        // 失敗系: turn/* で fail|error|interrupt
        if (/^(turn|thread).*(fail|error|interrupt)/i.test(method) && method !== 'item/error') {
          completed = true
          completedStatus = 'failed'
        }
      })

      // ─── turn/start ───
      // Phase A で確定: input-no-policy が正解
      //   { threadId, input: [{ type: 'text', text }] }
      //   sandboxPolicy/approvalPolicy は thread/start の defaults を継承（"never" 文字列は型エラー）
      // 念のためフォールバック shape も残す（codex バージョン違い対策）
      const TURN_SHAPES: Array<{ name: string; payload: Record<string, unknown> }> = [
        { name: 'input-no-policy', payload: { threadId, input: [{ type: 'text', text: prompt }] } },
        { name: 'input-approval-only', payload: { threadId, input: [{ type: 'text', text: prompt }], approvalPolicy: 'never' } },
        { name: 'items-array', payload: { threadId, items: [{ type: 'text', text: prompt }] } },
        { name: 'text-flat', payload: { threadId, text: prompt } },
      ]
      let turnOk: RpcEnvelope | null = null
      for (const s of TURN_SHAPES) {
        turnOk = await callOk(rpc, 'turn/start', s.payload)
        if (turnOk) {
          console.error(`[bridge] turn/start OK shape=${s.name}`)
          break
        }
      }
      if (!turnOk) throw new Error('turn/start 全 shape で失敗')

      await pushStep(supabase, taskId, makeStep('turn_started', 'プロンプト送信完了 (turn/start)'))

      // ─── 完了待ち ───
      while (!completed) {
        await new Promise(r => setTimeout(r, 1000))
      }
      console.error(`[bridge] completed=true status=${completedStatus} seen notifs=[${[...seenNotifMethods].join(', ')}]`)
      if (flushTimer) {
        clearTimeout(flushTimer)
        flushTimer = null
      }

      const finalLog = buildLiveLog(6000)
      const hasAssistantOutput = finalLog.includes('[assistant')
      const outcome = resolveTurnOutcome({
        status: completedStatus,
        error: completedError,
        hasAssistantOutput,
      })
      const resultMetadata = {
        codex_turn_status: completedStatus,
        codex_turn_error: completedError ?? null,
        codex_seen_notifications: [...seenNotifMethods],
        ...(outcome.note ? { codex_completion_note: outcome.note } : {}),
      }

      if (outcome.status === 'completed') {
        await pushStep(supabase, taskId, makeStep('completed', outcome.label),
          { liveLog: finalLog, message: finalLog || '(本文なし)', metadata: resultMetadata })
        await supabase.from('ai_tasks').update({
          status: outcome.status,
          error: null,
          completed_at: new Date().toISOString(),
        }).eq('id', taskId)
      } else {
        const errorText = `${outcome.error ?? `Codex turn ${completedStatus}`}: ${finalLog.slice(0, 500)}`
        await pushStep(supabase, taskId, makeStep('completed', outcome.label, 'failed'),
          { liveLog: finalLog, message: finalLog || '(本文なし)', metadata: resultMetadata })
        await supabase.from('ai_tasks').update({
          status: outcome.status,
          error: errorText.slice(0, 1000),
          completed_at: new Date().toISOString(),
        }).eq('id', taskId)
      }

      ws.close()
      clearTimeout(overallTimer)
      process.exit(0)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[bridge] error:', msg)
      await pushStep(supabase, taskId, makeStep('completed', `エラー: ${msg}`, 'failed'))
      await supabase.from('ai_tasks').update({
        status: 'failed',
        error: msg.slice(0, 1000),
        completed_at: new Date().toISOString(),
      }).eq('id', taskId)
      ws.close()
      clearTimeout(overallTimer)
      process.exit(1)
    }
  })
}

main().catch(err => {
  console.error('[bridge] unexpected:', err)
  process.exit(1)
})
