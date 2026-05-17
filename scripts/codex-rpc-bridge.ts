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

import { createClient } from '@supabase/supabase-js'
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
function makeStep(key: string, label: string, status: CodexStepStatus = 'done'): CodexStep {
  return { key, label, status, at: new Date().toISOString() }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function pushStep(
  supabase: any,
  taskId: string,
  step: CodexStep,
  extra?: { liveLog?: string; threadId?: string; message?: string },
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

  const prompt = fs.readFileSync(promptFile, 'utf-8')
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

  ws.on('open', async () => {
    clearTimeout(connectTimer)
    const rpc = new RpcClient(ws, logFile)

    try {
      // ─── initialize ───
      const initResp = await rpc.call('initialize', {
        clientInfo: { name: 'focusmap', version: '0.1.0' },
      })
      if (initResp.error) {
        throw new Error(`initialize 失敗: ${initResp.error.message}`)
      }
      await pushStep(supabase, taskId, makeStep('connected', 'app-server に接続 (initialize OK)'))

      // ─── newConversation ───
      // codex-rs/app-server の典型的なメソッド名:
      //   newConversation: 新規スレッド作成
      //   sendUserMessage / sendUserTurn: プロンプト送信
      // 環境により異なる可能性があるので両方試す
      let threadId: string | undefined
      let conversationId: string | undefined
      const conv = await rpc.call('newConversation', {
        cwd,
        approvalPolicy: 'never',
        sandboxPolicy: 'danger-full-access',
      }).catch(() => null)

      if (conv && !conv.error && conv.result) {
        const r = conv.result as { conversationId?: string; threadId?: string; thread?: { id?: string } }
        conversationId = r.conversationId
        threadId = r.threadId ?? r.thread?.id
      } else {
        // fallback: thread/start
        const t = await rpc.call('thread/start', { cwd }).catch(() => null)
        if (t?.result) {
          const r = t.result as { thread?: { id?: string }; threadId?: string }
          threadId = r.thread?.id ?? r.threadId
        }
      }

      if (!threadId && !conversationId) {
        throw new Error('thread/conversation 作成失敗（newConversation/thread/start 両方失敗）')
      }
      const visibleId = conversationId ?? threadId!
      await pushStep(supabase, taskId, makeStep('thread_visible',
        `Mobile/Codex.app に表示 (id ${visibleId.slice(0, 8)})`), { threadId: visibleId })
      await supabase.from('ai_tasks').update({ codex_thread_id: visibleId }).eq('id', taskId)

      // ─── 通知購読: live_log を Supabase に逐次反映 ───
      const tailLines: string[] = []
      const flushLog = async () => {
        const text = tailLines.join('\n').slice(-6000)
        await pushStep(supabase, taskId, makeStep('connected', 'app-server に接続 (initialize OK)'),
          { liveLog: text })
      }

      let completed = false
      let completedStatus = 'completed'
      rpc.onNotification((msg) => {
        const method = msg.method ?? ''
        const params = msg.params as Record<string, unknown> | undefined
        if (!params) return

        // item/started, item/completed 等で本文を拾う
        const item = (params.item ?? params.message) as { text?: string; content?: string; role?: string } | undefined
        if (item) {
          const text = item.text ?? item.content ?? ''
          if (text) {
            tailLines.push(`[${method}] ${text}`)
            if (tailLines.length > 200) tailLines.splice(0, tailLines.length - 200)
            flushLog().catch(() => { /* ignore */ })
          }
        }

        // turn/completed (or task_complete) で完了マーク
        if (method.includes('completed') || method.includes('complete')) {
          const turn = (params.turn ?? params.task) as { status?: string } | undefined
          if (turn?.status) completedStatus = turn.status
          if (method === 'turn/completed' || method === 'task_complete') {
            completed = true
          }
        }
        // failed/error notification
        if (method.includes('failed') || method.includes('error')) {
          if (method !== 'item/error') completed = true
          completedStatus = 'failed'
        }
      })

      // ─── turn/start (or sendUserMessage) ───
      const turnPayload: Record<string, unknown> = {
        threadId,
        conversationId,
        input: [{ type: 'text', text: prompt }],
        approvalPolicy: 'never',
        sandboxPolicy: 'danger-full-access',
      }
      const turnResp = await rpc.call('sendUserMessage', turnPayload).catch(() => null)
        ?? await rpc.call('turn/start', turnPayload).catch(() => null)
        ?? await rpc.call('sendUserTurn', turnPayload).catch(() => null)

      if (!turnResp || turnResp.error) {
        throw new Error(`turn 送信失敗: ${turnResp?.error?.message ?? '全メソッドで応答なし'}`)
      }

      // ─── 完了待ち (notification の completed フラグ or timeout) ───
      while (!completed) {
        await new Promise(r => setTimeout(r, 1000))
      }

      const finalLog = tailLines.join('\n').slice(-3000)
      if (completedStatus === 'completed') {
        await pushStep(supabase, taskId, makeStep('completed', '完了 (turn/completed)'),
          { liveLog: finalLog, message: finalLog || '(本文なし)' })
        await supabase.from('ai_tasks').update({
          status: 'completed',
          completed_at: new Date().toISOString(),
        }).eq('id', taskId)
      } else {
        await pushStep(supabase, taskId, makeStep('completed', `失敗 (${completedStatus})`, 'failed'))
        await supabase.from('ai_tasks').update({
          status: 'failed',
          error: `Codex turn ${completedStatus}: ${finalLog.slice(0, 500)}`,
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
