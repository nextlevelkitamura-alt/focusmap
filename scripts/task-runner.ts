#!/usr/bin/env npx ts-node --esm
/**
 * Focusmap Task Runner — claude -p 実行版
 *
 * scheduled_at <= now() かつ status = 'pending' の ai_tasks を取得し、
 * claude -p でローカル実行する。Mac が起動している間だけ動作する。
 *
 * 使い方:
 *   npx ts-node --esm scripts/task-runner.ts
 *
 * 環境変数（.env.local または shell export）:
 *   NEXT_PUBLIC_SUPABASE_URL    — Supabase プロジェクト URL
 *   SUPABASE_SERVICE_ROLE_KEY  — サービスロールキー
 *
 * launchd から毎分起動される（~/Library/LaunchAgents/com.focusmap.task-runner.plist）
 */

import { createClient } from '@supabase/supabase-js'
import { spawn } from 'child_process'
import { execSync } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import { fileURLToPath } from 'url'

// ES モジュール対応の __dirname
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// .env.local を手動で読み込み
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

const envPath = path.resolve(__dirname, '../.env.local')
loadEnvFile(envPath)

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const TASK_TIMEOUT_MS = 10 * 60 * 1000 // 10分

// ─────────────────────────────────────────────────────────────────────────
// macOS 通知
// ─────────────────────────────────────────────────────────────────────────
function notify(message: string, title = 'Focusmap AI') {
  try {
    const escaped = message.replace(/"/g, '\\"')
    const escapedTitle = title.replace(/"/g, '\\"')
    execSync(`osascript -e 'display notification "${escaped}" with title "${escapedTitle}"'`, {
      timeout: 5000,
      stdio: 'ignore',
    })
  } catch {
    // 通知失敗は無視（ヘッドレス環境などでも動作継続）
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Terminal.app を画面右半分に開いて claude を対話実行
// ─────────────────────────────────────────────────────────────────────────
function openTerminalWithClaude(opts: {
  skillId?: string | null
  prompt: string
  cwd?: string | null
}) {
  const command = opts.prompt
  const cwd = opts.cwd || ''

  // AppleScript をファイルに書き出して実行（エスケープ問題を回避）
  const tmpScript = '/tmp/focusmap-open-terminal.scpt'
  const cdLine = cwd ? `cd \\"${cwd}\\" && ` : ''
  const scriptContent = `tell application "Finder"
  set _b to bounds of window of desktop
  set screenW to item 3 of _b
  set screenH to item 4 of _b
end tell
tell application "Terminal"
  activate
  do script "${cdLine}claude --dangerously-skip-permissions \\"${command.replace(/"/g, '')}\\""
  delay 0.5
  set bounds of front window to {screenW div 2, 25, screenW, screenH}
end tell`

  try {
    fs.writeFileSync(tmpScript, scriptContent, 'utf-8')
    execSync(`osascript ${tmpScript}`, { timeout: 15000, stdio: 'ignore' })
  } catch (err) {
    console.error('[task-runner] Terminal.app の起動に失敗:', err instanceof Error ? err.message : err)
  }
}

// ─────────────────────────────────────────────────────────────────────────
// cron 式から次回実行時刻を計算（分・時・曜日 対応、ローカル時刻で比較）
// UIは getHours()/getMinutes()（JST）でcronを生成するため、
// ここもローカル時刻でマッチングする必要がある
// ─────────────────────────────────────────────────────────────────────────
function getNextScheduledAt(cronExpr: string, from: Date): Date {
  const parts = cronExpr.trim().split(/\s+/)
  if (parts.length !== 5) throw new Error(`Invalid cron expression: ${cronExpr}`)

  const [minutePart, hourPart, , , dowPart] = parts
  const now = new Date(from.getTime() + 60 * 1000)
  now.setSeconds(0, 0)

  const limit = new Date(from.getTime() + 8 * 24 * 60 * 60 * 1000)

  while (now < limit) {
    const minute = now.getMinutes()  // ローカル時刻（JST）
    const hour = now.getHours()      // ローカル時刻（JST）
    const dow = now.getDay()         // 曜日（0=日, 1=月, ..., 6=土）

    const minuteMatch = minutePart === '*' || parseInt(minutePart) === minute
    const hourMatch = hourPart === '*' || parseInt(hourPart) === hour
    const dowMatch = dowPart === '*' || dowPart.split(',').map(Number).includes(dow)

    if (minuteMatch && hourMatch && dowMatch) return new Date(now)
    now.setTime(now.getTime() + 60 * 1000)
  }

  throw new Error(`Could not compute next run for cron: ${cronExpr}`)
}

// ─────────────────────────────────────────────────────────────────────────
// claude -p 実行
// ─────────────────────────────────────────────────────────────────────────
function runClaude(opts: {
  prompt: string
  skillId?: string | null
  cwd?: string | null
}): Promise<{ output: string; exitCode: number }> {
  return new Promise((resolve) => {
    // プロンプトをそのまま送信（自然言語でスキルが反応する）
    const fullPrompt = opts.prompt

    const args = [
      '-p', fullPrompt,
      '--dangerously-skip-permissions',
      '--max-budget-usd', '2.00',
      '--max-turns', '10',
      '--output-format', 'text',
    ]

    // CLAUDECODE 環境変数を除外（Claude Code 内からの実行時にネスト防止を回避）
    const env = { ...process.env }
    delete env.CLAUDECODE

    const proc = spawn('claude', args, {
      timeout: TASK_TIMEOUT_MS,
      cwd: opts.cwd || undefined,
      env,
    })

    let output = ''
    let errOutput = ''

    proc.stdout.on('data', (data: Buffer) => {
      output += data.toString()
    })
    proc.stderr.on('data', (data: Buffer) => {
      errOutput += data.toString()
    })

    proc.on('close', (code: number | null) => {
      const exitCode = code ?? 1
      // stderr も結果に含める（claude -p はログを stderr に出すことがある）
      const fullOutput = output.trim() || errOutput.trim()
      resolve({ output: fullOutput, exitCode })
    })

    proc.on('error', (err: Error) => {
      resolve({ output: err.message, exitCode: 1 })
    })
  })
}

// ─────────────────────────────────────────────────────────────────────────
// メイン処理
// ─────────────────────────────────────────────────────────────────────────
async function main() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error(
      '[task-runner] Error: NEXT_PUBLIC_SUPABASE_URL または SUPABASE_SERVICE_ROLE_KEY が未設定です。' +
      '\n.env.local に追加してください。',
    )
    process.exit(1)
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  // ─── 1. due なタスクを取得 ───────────────────────────────────────────
  const { data: rawDueTasks, error } = await supabase
    .from('ai_tasks')
    .select('id, prompt, skill_id, approval_type, scheduled_at, recurrence_cron, cwd, completed_at')
    .eq('status', 'pending')
    .not('scheduled_at', 'is', null)
    .lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(10)

  if (error) {
    console.error('[task-runner] DB error:', error.message)
    process.exit(1)
  }

  // ユーザーが UI で「今日分完了」をチェックした繰り返しタスクはスキップ
  // completed_at が当日（ローカル時刻）以降なら今日分実行済みとみなす
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  const dueTasks = (rawDueTasks || []).filter(t => {
    if (!t.recurrence_cron) return true
    if (!t.completed_at) return true
    return new Date(t.completed_at) < todayStart
  }).slice(0, 5)

  if (!dueTasks || dueTasks.length === 0) {
    console.log('[task-runner] No due tasks at', new Date().toISOString())
    process.exit(0)
  }

  console.log(`[task-runner] ${dueTasks.length} due task(s) found`)

  // ─── 2. タスクを順次実行 ──────────────────────────────────────────────
  for (const task of dueTasks) {
    const shortPrompt = String(task.prompt).slice(0, 40)
    console.log(`[task-runner] Starting: ${task.id} "${shortPrompt}"`)

    // status → running
    const { error: updateErr } = await supabase
      .from('ai_tasks')
      .update({ status: 'running', started_at: new Date().toISOString() })
      .eq('id', task.id)
      .eq('status', 'pending') // 楽観的ロック

    if (updateErr) {
      console.error(`[task-runner] Failed to mark running: ${task.id}`, updateErr.message)
      continue
    }

    // ─── 対話モード: Terminal.app を右半分に開いて claude を起動 ───
    if (task.approval_type === 'confirm' || task.approval_type === 'interactive') {
      notify(`${shortPrompt} — ターミナルを開きます`, 'Focusmap AI')

      openTerminalWithClaude({
        skillId: task.skill_id,
        prompt: task.prompt,
        cwd: task.cwd,
      })

      // ターミナルで対話実行するので、status は running のまま
      // ユーザーが完了したら Focusmap UI から手動で完了にする
      // 繰り返しタスクの場合は次回をスケジュール
      if (task.recurrence_cron) {
        const now = new Date().toISOString()
        let nextAt: string
        try {
          nextAt = getNextScheduledAt(task.recurrence_cron, new Date()).toISOString()
        } catch {
          nextAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        }
        await supabase
          .from('ai_tasks')
          .update({
            status: 'pending',
            result: { message: `ターミナルで対話実行 (${now})` },
            completed_at: now,
            scheduled_at: nextAt,
            started_at: null,
          })
          .eq('id', task.id)
        console.log(`[task-runner] Terminal opened & rescheduled: ${task.id} → next at ${nextAt}`)
      } else {
        await supabase
          .from('ai_tasks')
          .update({ status: 'completed', completed_at: new Date().toISOString(), result: { message: 'ターミナルで対話実行' } })
          .eq('id', task.id)
        console.log(`[task-runner] Terminal opened: ${task.id}`)
      }
      continue
    }

    // ─── 自動モード: claude -p でバックグラウンド実行 ───
    notify(`実行中: ${shortPrompt}`, 'Focusmap AI')

    const { output, exitCode } = await runClaude({
      prompt: task.prompt,
      skillId: task.skill_id,
      cwd: task.cwd,
    })
    const now = new Date().toISOString()

    if (exitCode !== 0) {
      const errMsg = output.slice(0, 500) || 'claude -p が終了コード非0で終了しました'
      await supabase
        .from('ai_tasks')
        .update({ status: 'failed', error: errMsg, completed_at: now })
        .eq('id', task.id)

      notify(`失敗: ${shortPrompt}`, 'Focusmap AI')
      console.error(`[task-runner] Failed: ${task.id} (exit ${exitCode})`)
      continue
    }

    // 成功 → 自動完了 or 繰り返しリセット
    {
      // 自動完了 or 繰り返しリセット
      if (task.recurrence_cron) {
        let nextAt: string
        try {
          nextAt = getNextScheduledAt(task.recurrence_cron, new Date()).toISOString()
        } catch (e) {
          console.error(`[task-runner] cron parse error: ${e}`)
          nextAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        }

        await supabase
          .from('ai_tasks')
          .update({
            status: 'pending',
            result: { message: output, last_run: now },
            completed_at: now,
            scheduled_at: nextAt,
            started_at: null,
          })
          .eq('id', task.id)

        console.log(`[task-runner] Rescheduled: ${task.id} → next at ${nextAt}`)
      } else {
        await supabase
          .from('ai_tasks')
          .update({
            status: 'completed',
            result: { message: output },
            completed_at: now,
          })
          .eq('id', task.id)
      }

      notify(`完了: ${shortPrompt}`, 'Focusmap AI')
    }

    console.log(`[task-runner] Done: ${task.id}`)
  }
}

main().catch(err => {
  console.error('[task-runner] Unexpected error:', err)
  process.exit(1)
})
