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
 *   FOCUSMAP_RUNNER_USER_ID    — このPCで実行を許可するFocusmapユーザーID
 *   FOCUSMAP_ALLOW_LEGACY_TASK_RUNNER=true — runner未設定時の旧全体取得を明示許可
 *
 * launchd から毎分起動される（~/Library/LaunchAgents/com.focusmap.task-runner.plist）
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { spawn, spawnSync } from 'child_process'
import { execSync } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
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
const PAUSE_FILE = path.resolve(__dirname, 'task-runner.paused')
const SUPABASE_RESTRICTED_PATTERN = /exceed_cached_egress_quota|Service for this project is restricted/i
const FOCUSMAP_RUNS_DIR = path.join(os.homedir(), '.focusmap', 'ai-runs')
const PACKAGE_CACHE_DIR = path.join(os.homedir(), '.focusmap', 'ai-packages')
const CLAUDE_HOOK_SCRIPT = path.resolve(__dirname, 'focusmap-claude-hook.mjs')
const STAFF_STATUS_SCHEDULE_SKILL_ID = 'staff-status-schedule'
const STAFF_STATUS_DIR = '/Users/kitamuranaohiro/Private/仕事/scripts/staff-status'
const STAFF_STATUS_TIMEOUT_MS = 30 * 60 * 1000
const PACKAGE_TASK_TIMEOUT_MS = 30 * 60 * 1000
const STAFF_STATUS_RETRY_BASE_MS = 5 * 60 * 1000
const STAFF_STATUS_RETRY_MAX_MS = 30 * 60 * 1000
const STAFF_STATUS_STALE_RUNNING_MS = 45 * 60 * 1000
const STAFF_STATUS_INTERACTIVE_LATE_LIMIT_MS = 15 * 60 * 1000
const LOCAL_USER_ID_FILE = path.join(os.homedir(), '.config', 'life-manager', 'focusmap-user-id')

type StaffStatusDueTask = {
  id: string
  user_id: string
  prompt: string
  skill_id: string | null
  approval_type: string | null
  scheduled_at: string | null
  recurrence_cron: string | null
  cwd: string | null
  completed_at: string | null
  source_note_id: string | null
  source_ideal_goal_id: string | null
  executor: 'claude' | 'codex' | 'codex_app' | null
  codex_thread_id?: string | null
  codex_resume_thread_id?: string | null
  space_id?: string | null
  package_id?: string | null
  package_version_id?: string | null
  package_snapshot?: Record<string, unknown> | null
  claimed_runner_id?: string | null
  claim_expires_at?: string | null
  run_visibility?: 'private' | 'space' | null
  result?: Record<string, unknown> | null
}

type AiRunner = {
  id: string
  user_id: string
  hostname: string
  executors: string[]
  available_repo_keys: string[]
  available_secret_names: string[]
  repo_paths: Record<string, string>
}

type SchemaCapabilities = {
  hasAiRunnerTables: boolean
  hasSharedAiTaskColumns: boolean
  hasAiPackageVersioning: boolean
}

let schemaCapabilities: SchemaCapabilities = {
  hasAiRunnerTables: true,
  hasSharedAiTaskColumns: true,
  hasAiPackageVersioning: true,
}

function isMissingSchemaError(error: { message?: string; code?: string } | null | undefined): boolean {
  const message = error?.message ?? ''
  return error?.code === '42703' ||
    error?.code === '42P01' ||
    /Could not find (the table|.*column)|column .* does not exist|relation .* does not exist/i.test(message)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function detectSchemaCapabilities(supabase: any): Promise<SchemaCapabilities> {
  const runnerCheck = await supabase
    .from('ai_runners')
    .select('id')
    .limit(1)

  const taskColumnCheck = await supabase
    .from('ai_tasks')
    .select('space_id, claimed_runner_id, claim_expires_at, run_visibility, package_snapshot, package_version_id')
    .limit(1)

  const packageVersionCheck = await supabase
    .from('ai_runner_package_cache')
    .select('runner_id, package_id, version_id')
    .limit(1)

  return {
    hasAiRunnerTables: !isMissingSchemaError(runnerCheck.error),
    hasSharedAiTaskColumns: !isMissingSchemaError(taskColumnCheck.error),
    hasAiPackageVersioning: !isMissingSchemaError(taskColumnCheck.error) && !isMissingSchemaError(packageVersionCheck.error),
  }
}

function releaseClaimFields(): Record<string, null> {
  return schemaCapabilities.hasSharedAiTaskColumns
    ? { claimed_runner_id: null, claim_expires_at: null }
    : {}
}

function asResultRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function nextStaffStatusRetry(task: StaffStatusDueTask): { retryAt: string; retryCount: number; retryDelayMinutes: number } {
  const previous = asResultRecord(task.result)
  const rawCount = previous.retry_count
  const previousCount = typeof rawCount === 'number' && Number.isFinite(rawCount)
    ? rawCount
    : 0
  const retryCount = previousCount + 1
  const delayMs = Math.min(STAFF_STATUS_RETRY_MAX_MS, STAFF_STATUS_RETRY_BASE_MS * retryCount)
  return {
    retryAt: new Date(Date.now() + delayMs).toISOString(),
    retryCount,
    retryDelayMinutes: Math.round(delayMs / 60_000),
  }
}

function isInteractiveStaffStatusTarget(target: string): boolean {
  const normalized = target.toLowerCase()
  return target.includes('morning') ||
    target.includes('朝の状況') ||
    target.includes('朝の作戦') ||
    target.includes('経理') ||
    target.includes('交通費') ||
    normalized.includes('claim')
}

function isAutoRecoverableStaffStatusTarget(target: string): boolean {
  if (isInteractiveStaffStatusTarget(target)) return false
  return target.includes('エントリー処理') ||
    target.includes('確定者') ||
    target.includes('当日案内') ||
    target.includes('対面予定登録') ||
    target.includes('翌日カレンダー') ||
    target.includes('翌日対面') ||
    target.includes('register-next-day') ||
    target.toLowerCase().includes('meet') ||
    target.includes('リンク発行') ||
    target.includes('面談リンク') ||
    target.includes('架電')
}

function isInteractiveStaffStatusTooLate(task: StaffStatusDueTask): boolean {
  if (!isInteractiveStaffStatusTarget(task.prompt) || !task.scheduled_at) return false
  const scheduledMs = new Date(task.scheduled_at).getTime()
  if (!Number.isFinite(scheduledMs)) return false
  return Date.now() - scheduledMs > STAFF_STATUS_INTERACTIVE_LATE_LIMIT_MS
}

function nextScheduleForTask(task: StaffStatusDueTask): string {
  if (task.recurrence_cron) {
    try {
      return getNextScheduledAt(task.recurrence_cron, new Date()).toISOString()
    } catch {
      return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    }
  }
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function escapeAppleScriptString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function ensureRunDir(taskId: string): string {
  const runDir = path.join(FOCUSMAP_RUNS_DIR, taskId)
  fs.mkdirSync(runDir, { recursive: true })
  return runDir
}

function appendRunEvent(taskId: string, event: Record<string, unknown>): void {
  const runDir = ensureRunDir(taskId)
  fs.appendFileSync(
    path.join(runDir, 'events.jsonl'),
    `${JSON.stringify({ task_id: taskId, observed_at: new Date().toISOString(), ...event })}\n`,
    'utf-8',
  )
}

function readRunPath(taskId: string, fileName: string): string {
  return path.join(ensureRunDir(taskId), fileName)
}

function writeClaudeHookSettings(taskId: string, runDir: string): string {
  const settingsPath = path.join(runDir, 'claude-settings.json')
  const commandFor = (eventName: string) =>
    [
      shellQuote(process.execPath),
      shellQuote(CLAUDE_HOOK_SCRIPT),
      shellQuote(taskId),
      shellQuote(runDir),
      shellQuote(eventName),
    ].join(' ')
  const commandHook = (eventName: string) => ({ type: 'command', command: commandFor(eventName) })
  const settings = {
    hooks: {
      SessionStart: [
        { matcher: 'startup|resume', hooks: [commandHook('SessionStart')] },
      ],
      PostToolUse: [
        { matcher: '*', hooks: [commandHook('PostToolUse')] },
      ],
      Stop: [
        { matcher: '', hooks: [commandHook('Stop')] },
      ],
      SessionEnd: [
        { matcher: '', hooks: [commandHook('SessionEnd')] },
      ],
      Notification: [
        { matcher: '', hooks: [commandHook('Notification')] },
      ],
      PermissionDenied: [
        { matcher: '', hooks: [commandHook('PermissionDenied')] },
      ],
    },
  }
  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf-8')
  return settingsPath
}

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
  taskId: string
  skillId?: string | null
  prompt: string
  cwd?: string | null
}) {
  const runDir = ensureRunDir(opts.taskId)
  const settingsPath = writeClaudeHookSettings(opts.taskId, runDir)
  const command = [
    'claude',
    '--settings', shellQuote(settingsPath),
    '--session-id', shellQuote(opts.taskId),
    '--dangerously-skip-permissions',
    ansiCQuote(opts.prompt),
  ].join(' ')
  const cwd = opts.cwd || ''
  fs.writeFileSync(path.join(runDir, 'prompt.txt'), opts.prompt, 'utf-8')
  appendRunEvent(opts.taskId, {
    event_name: 'TerminalLaunch',
    run_dir: runDir,
    hook_settings_path: settingsPath,
    cwd: cwd || null,
  })

  // AppleScript をファイルに書き出して実行（エスケープ問題を回避）
  const tmpScript = '/tmp/focusmap-open-terminal.scpt'
  const commandLine = `${cwd ? `cd ${shellQuote(cwd)} && ` : ''}${command}`
  const scriptContent = `tell application "Finder"
  set _b to bounds of window of desktop
  set screenW to item 3 of _b
  set screenH to item 4 of _b
end tell
tell application "Terminal"
  activate
  do script "${escapeAppleScriptString(commandLine)}"
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

function isBeforeJstCutoff(hour: number, minute: number): boolean {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date())
  const currentHour = Number(parts.find(part => part.type === 'hour')?.value ?? '0')
  const currentMinute = Number(parts.find(part => part.type === 'minute')?.value ?? '0')
  return currentHour * 60 + currentMinute < hour * 60 + minute
}

function runStaffStatusScheduleTarget(taskId: string, target: string): { output: string; exitCode: number } {
  const runDir = ensureRunDir(taskId)
  const stdoutLogPath = path.join(runDir, 'stdout.log')
  fs.writeFileSync(path.join(runDir, 'prompt.txt'), target, 'utf-8')
  fs.writeFileSync(path.join(runDir, 'metadata.json'), `${JSON.stringify({
    task_id: taskId,
    mode: STAFF_STATUS_SCHEDULE_SKILL_ID,
    target,
    cwd: STAFF_STATUS_DIR,
    started_at: new Date().toISOString(),
  }, null, 2)}\n`, 'utf-8')

  appendRunEvent(taskId, {
    event_name: 'ProcessStart',
    mode: STAFF_STATUS_SCHEDULE_SKILL_ID,
    target,
    cwd: STAFF_STATUS_DIR,
    stdout_log_path: stdoutLogPath,
  })

  const result = spawnSync('npx', ['tsx', 'src/entry-schedule.ts', '--target', target], {
    cwd: STAFF_STATUS_DIR,
    encoding: 'utf-8',
    timeout: STAFF_STATUS_TIMEOUT_MS,
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  })
  const output = `${result.stdout || ''}${result.stderr || ''}${result.error ? `\n${result.error.message}` : ''}`
  fs.writeFileSync(stdoutLogPath, output, 'utf-8')
  appendRunEvent(taskId, {
    event_name: 'ProcessExit',
    mode: STAFF_STATUS_SCHEDULE_SKILL_ID,
    target,
    exit_code: result.status ?? 1,
  })

  return { output, exitCode: result.status ?? 1 }
}

async function insertStaffStatusRunHistory(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any, any, any>,
  task: StaffStatusDueTask,
  opts: {
    status: 'completed' | 'failed'
    startedAt: string
    completedAt: string
    output: string
    error?: string | null
    note?: string
  },
): Promise<string | null> {
  const result: Record<string, unknown> = {
    message: opts.output.slice(0, 12000),
    last_run: opts.completedAt,
    scheduled_run_at: task.scheduled_at,
    parent_task_id: task.id,
    imported_from: 'focusmap-task-runner',
    executor: STAFF_STATUS_SCHEDULE_SKILL_ID,
  }
  if (opts.output.length > 12000) result.truncated = true
  if (opts.note) result.note = opts.note

  const { data, error } = await supabase
    .from('ai_tasks')
    .insert({
      user_id: task.user_id,
      prompt: task.prompt,
      skill_id: STAFF_STATUS_SCHEDULE_SKILL_ID,
      approval_type: task.approval_type ?? 'auto',
      status: opts.status,
      result,
      error: opts.error ? opts.error.slice(0, 1000) : null,
      parent_task_id: task.id,
      started_at: opts.startedAt,
      completed_at: opts.completedAt,
      scheduled_at: task.scheduled_at,
      recurrence_cron: null,
      cwd: task.cwd ?? STAFF_STATUS_DIR,
      executor: task.executor ?? 'claude',
      ...(schemaCapabilities.hasSharedAiTaskColumns ? {
        space_id: task.space_id ?? null,
        package_id: task.package_id ?? null,
        ...(schemaCapabilities.hasAiPackageVersioning ? {
          package_version_id: task.package_version_id ?? null,
        } : {}),
        package_snapshot: task.package_snapshot ?? null,
        run_visibility: task.run_visibility ?? (task.space_id ? 'space' : 'private'),
        claimed_runner_id: task.claimed_runner_id ?? null,
      } : {}),
    })
    .select('id')
    .single()

  if (error) {
    console.error(`[task-runner] Staff-status history insert failed: ${task.id}`, error.message)
    return null
  }
  return data?.id ?? null
}

async function recoverStaleStaffStatusTasks(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any, any, any>,
): Promise<void> {
  if (!schemaCapabilities.hasSharedAiTaskColumns) return

  const now = new Date()
  const nowIso = now.toISOString()
  const staleCutoff = new Date(now.getTime() - STAFF_STATUS_STALE_RUNNING_MS).toISOString()

  const { error: clearExpiredClaimError } = await supabase
    .from('ai_tasks')
    .update(releaseClaimFields())
    .eq('status', 'pending')
    .lt('claim_expires_at', nowIso)

  if (clearExpiredClaimError && !isMissingSchemaError(clearExpiredClaimError)) {
    console.error('[task-runner] Failed to clear expired runner reservations:', clearExpiredClaimError.message)
  }

  const { data: staleTasks, error } = await supabase
    .from('ai_tasks')
    .select('id, prompt, scheduled_at, recurrence_cron, result, started_at')
    .eq('skill_id', STAFF_STATUS_SCHEDULE_SKILL_ID)
    .eq('status', 'running')
    .lt('started_at', staleCutoff)
    .limit(20)

  if (error) {
    if (!isMissingSchemaError(error)) {
      console.error('[task-runner] Failed to scan stale staff-status tasks:', error.message)
    }
    return
  }

  for (const staleTask of (staleTasks ?? []) as Array<{
    id: string
    prompt: string
    scheduled_at: string | null
    recurrence_cron: string | null
    result: Record<string, unknown> | null
    started_at: string | null
  }>) {
    const previous = asResultRecord(staleTask.result)
    const recoverCount = typeof previous.recover_count === 'number' ? previous.recover_count + 1 : 1

    if (!isAutoRecoverableStaffStatusTarget(staleTask.prompt)) {
      const nextAt = nextScheduleForTask(staleTask as unknown as StaffStatusDueTask)
      const { error: skipError } = await supabase
        .from('ai_tasks')
        .update({
          status: staleTask.recurrence_cron ? 'pending' : 'completed',
          scheduled_at: staleTask.recurrence_cron ? nextAt : staleTask.scheduled_at,
          completed_at: nowIso,
          started_at: null,
          error: null,
          ...releaseClaimFields(),
          result: {
            ...previous,
            last_run_status: 'skipped_stale_interactive',
            skipped_at: nowIso,
            stale_started_at: staleTask.started_at,
            next_scheduled_at: staleTask.recurrence_cron ? nextAt : null,
            executor: STAFF_STATUS_SCHEDULE_SKILL_ID,
          },
        })
        .eq('id', staleTask.id)
        .eq('status', 'running')

      if (skipError) {
        console.error(`[task-runner] Failed to skip stale interactive staff-status task: ${staleTask.id}`, skipError.message)
      } else {
        console.log(`[task-runner] Skipped stale interactive staff-status task: ${staleTask.id}`)
      }
      continue
    }

    const { error: updateError } = await supabase
      .from('ai_tasks')
      .update({
        status: 'pending',
        scheduled_at: nowIso,
        started_at: null,
        error: `stale staff-status run recovered after ${Math.round(STAFF_STATUS_STALE_RUNNING_MS / 60_000)} minutes`,
        ...releaseClaimFields(),
        result: {
          ...previous,
          last_run_status: 'stale_recovered',
          recovered_at: nowIso,
          stale_started_at: staleTask.started_at,
          recover_count: recoverCount,
          executor: STAFF_STATUS_SCHEDULE_SKILL_ID,
        },
      })
      .eq('id', staleTask.id)
      .eq('status', 'running')

    if (updateError) {
      console.error(`[task-runner] Failed to recover stale staff-status task: ${staleTask.id}`, updateError.message)
    } else {
      console.log(`[task-runner] Recovered stale staff-status task: ${staleTask.id}`)
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// claude -p 実行
// ─────────────────────────────────────────────────────────────────────────
function runClaude(opts: {
  taskId: string
  prompt: string
  skillId?: string | null
  cwd?: string | null
}): Promise<{ output: string; exitCode: number }> {
  return new Promise((resolve) => {
    // プロンプトをそのまま送信（自然言語でスキルが反応する）
    const fullPrompt = opts.prompt
    const runDir = ensureRunDir(opts.taskId)
    const settingsPath = writeClaudeHookSettings(opts.taskId, runDir)
    const stdoutLogPath = path.join(runDir, 'stdout.log')
    fs.writeFileSync(path.join(runDir, 'prompt.txt'), fullPrompt, 'utf-8')
    fs.writeFileSync(stdoutLogPath, '', 'utf-8')
    fs.writeFileSync(path.join(runDir, 'metadata.json'), `${JSON.stringify({
      task_id: opts.taskId,
      mode: 'claude-print',
      cwd: opts.cwd ?? null,
      started_at: new Date().toISOString(),
      hook_settings_path: settingsPath,
    }, null, 2)}\n`, 'utf-8')
    appendRunEvent(opts.taskId, {
      event_name: 'ProcessStart',
      mode: 'claude-print',
      run_dir: runDir,
      stdout_log_path: stdoutLogPath,
      hook_settings_path: settingsPath,
      cwd: opts.cwd ?? null,
    })

    const args = [
      '-p', fullPrompt,
      '--settings', settingsPath,
      '--session-id', opts.taskId,
      '--dangerously-skip-permissions',
      '--max-budget-usd', '2.00',
      '--max-turns', '10',
      '--output-format', 'text',
    ]

    // CLAUDECODE 環境変数を除外（Claude Code 内からの実行時にネスト防止を回避）
    const env = { ...process.env }
    delete env.CLAUDECODE
    delete env.ANTHROPIC_API_KEY

    const proc = spawn('claude', args, {
      timeout: TASK_TIMEOUT_MS,
      cwd: opts.cwd || undefined,
      env,
    })

    let output = ''
    let errOutput = ''

    proc.stdout.on('data', (data: Buffer) => {
      const chunk = data.toString()
      output += chunk
      fs.appendFileSync(stdoutLogPath, chunk, 'utf-8')
    })
    proc.stderr.on('data', (data: Buffer) => {
      const chunk = data.toString()
      errOutput += chunk
      fs.appendFileSync(stdoutLogPath, chunk, 'utf-8')
    })

    proc.on('close', (code: number | null) => {
      const exitCode = code ?? 1
      appendRunEvent(opts.taskId, {
        event_name: 'ProcessClose',
        mode: 'claude-print',
        exit_code: exitCode,
        stdout_log_path: stdoutLogPath,
      })
      // stderr も結果に含める（claude -p はログを stderr に出すことがある）
      const fullOutput = output.trim() || errOutput.trim()
      resolve({ output: fullOutput, exitCode })
    })

    proc.on('error', (err: Error) => {
      appendRunEvent(opts.taskId, {
        event_name: 'ProcessError',
        mode: 'claude-print',
        error: err.message,
        stdout_log_path: stdoutLogPath,
      })
      resolve({ output: err.message, exitCode: 1 })
    })
  })
}

// ─────────────────────────────────────────────────────────────────────────
// Remote Control 起動: tmux + claude --remote-control
//   - メモから起動された ai_task はスマホ/Web からも操作できるよう RC モードで起動
//   - tmux detached session で常駐させ、stdout からセッションURLをキャプチャ
// ─────────────────────────────────────────────────────────────────────────
const REMOTE_URL_PATTERN = /https:\/\/claude\.ai\/code\/[A-Za-z0-9_\-?=&./%]+/

/**
 * bash の ANSI-C quoting ($'...') 形式で文字列を引用符化する。
 * 改行・タブ等を実際の制御文字として bash に渡せる。
 * 例: "hello\nworld" → $'hello\nworld' （bash上で改行を含む文字列として展開される）
 */
function ansiCQuote(s: string): string {
  return "$'" + s
    .replace(/\\/g, '\\\\')   // backslash 最初
    .replace(/'/g, "\\'")     // single quote
    .replace(/\n/g, '\\n')    // newline
    .replace(/\r/g, '\\r')    // CR
    .replace(/\t/g, '\\t')    // tab
    + "'"
}

async function waitForRemoteUrl(logPath: string, timeoutMs: number): Promise<string | null> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(logPath)) {
      try {
        const content = fs.readFileSync(logPath, 'utf-8')
        const m = content.match(REMOTE_URL_PATTERN)
        if (m) return m[0]
      } catch {
        // 読み込みエラーは無視して再試行
      }
    }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  return null
}

function tmuxSessionExists(sessionName: string): boolean {
  try {
    execSync(`tmux has-session -t "${sessionName}"`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * Remote Control モードで起動する。
 * - 同期的に tmux 起動 → URL キャプチャ → プロンプト注入まで行い、URL を返す
 * - tmux セッションは detached で残り、スマホ/Web から接続可能
 */
async function launchRemoteControl(opts: {
  taskId: string
  prompt: string
  cwd: string
  /** Claude セッション一覧表示用のタイトル。省略時は prompt から生成 */
  displayTitle?: string
}): Promise<{
  success: true
  url: string
  sessionName: string
  runDir: string
  stdoutLogPath: string
  hookSettingsPath: string
} | { success: false; error: string }> {
  const sessionName = `memo-${opts.taskId.slice(0, 8)}`
  const logPath = `/tmp/claude-rc-${opts.taskId}.log`
  const runDir = ensureRunDir(opts.taskId)
  const promptPath = path.join(runDir, 'prompt.txt')
  const stdoutLogPath = path.join(runDir, 'stdout.log')
  const hookSettingsPath = writeClaudeHookSettings(opts.taskId, runDir)

  // cwd 存在確認
  if (!fs.existsSync(opts.cwd)) {
    return { success: false, error: `cwd not found: ${opts.cwd}` }
  }

  // 既存セッション残骸があれば掃除
  if (tmuxSessionExists(sessionName)) {
    try { execSync(`tmux kill-session -t "${sessionName}"`, { stdio: 'ignore' }) } catch { /* ignore */ }
  }

  // プロンプトをファイルに保存（改行・特殊文字を安全に扱う）
  fs.writeFileSync(promptPath, opts.prompt, 'utf-8')

  // タイトル: 改行・引用符・バックスラッシュを除去（tmux/claude のパース対策）
  // 60字に収める（Claude モバイルアプリのセッション一覧で省略されない長さ）
  const rawTitle = opts.displayTitle ?? opts.prompt
  const title = rawTitle
    .slice(0, 60)
    .replace(/[\n\r\t]+/g, ' ')
    .replace(/\\/g, '')
    .replace(/"/g, '')
    .replace(/'/g, '')
    .trim() || 'メモ'

  // 既存ログ削除して空ファイル作成（pipe-pane は append しか出来ないため）
  try { fs.unlinkSync(logPath) } catch { /* ignore */ }
  fs.writeFileSync(logPath, '', 'utf-8')
  fs.writeFileSync(stdoutLogPath, '', 'utf-8')
  fs.writeFileSync(path.join(runDir, 'metadata.json'), `${JSON.stringify({
    task_id: opts.taskId,
    mode: 'claude-remote-control',
    cwd: opts.cwd,
    title,
    tmux_session_name: sessionName,
    tmp_log_path: logPath,
    stdout_log_path: stdoutLogPath,
    prompt_path: promptPath,
    hook_settings_path: hookSettingsPath,
    claude_session_id: opts.taskId,
    started_at: new Date().toISOString(),
  }, null, 2)}\n`, 'utf-8')
  appendRunEvent(opts.taskId, {
    event_name: 'RemoteControlStart',
    run_dir: runDir,
    stdout_log_path: stdoutLogPath,
    tmp_log_path: logPath,
    hook_settings_path: hookSettingsPath,
    session_id: opts.taskId,
    tmux_session_name: sessionName,
    cwd: opts.cwd,
  })

  // claude を tmux 内で「TTYを保ったまま」起動する。
  // パイプ（| tee）すると非対話と判定されて --print モードになるため、
  // pipe-pane で別途出力を捕捉する。
  // ANTHROPIC_API_KEY と CLAUDECODE は Remote Control が動かないので除外。
  // --dangerously-skip-permissions: 許可ダイアログを全部スキップ（無人実行のため必須）
  // プロンプトは ANSI-C quoting ($'...') で渡す → 改行が実際の改行として claude に届く
  // （JSON.stringify だと \n がリテラル2文字として渡されてしまうため）
  const promptQuoted = ansiCQuote(opts.prompt)
  const inner = [
    'unset ANTHROPIC_API_KEY',
    'unset CLAUDECODE',
    [
      'exec claude',
      '--remote-control', shellQuote(title),
      '--settings', shellQuote(hookSettingsPath),
      '--session-id', shellQuote(opts.taskId),
      '--dangerously-skip-permissions',
      promptQuoted,
    ].join(' '),
  ].join('; ')
  const bashWrapped = `bash -c ${JSON.stringify(inner)}`

  try {
    execSync(
      `tmux new-session -d -s ${JSON.stringify(sessionName)} -c ${JSON.stringify(opts.cwd)} ${bashWrapped}`,
      { stdio: 'ignore' },
    )
  } catch (err) {
    return { success: false, error: `tmux 起動失敗: ${err instanceof Error ? err.message : String(err)}` }
  }

  // tmux pipe-pane で stdout/stderr を取り出してログファイルに追記
  try {
    execSync(
      `tmux pipe-pane -o -t ${JSON.stringify(sessionName)} ${JSON.stringify(`tee -a ${shellQuote(stdoutLogPath)} >> ${shellQuote(logPath)}`)}`,
      { stdio: 'ignore' },
    )
  } catch {
    // pipe-pane 失敗してもセッション自体は動くので警告だけ
    console.error('[launchRemoteControl] pipe-pane failed (出力捕捉できないが続行)')
  }

  // セッションURLをキャプチャ（最大60秒）
  const url = await waitForRemoteUrl(logPath, 60_000)
  if (!url) {
    if (tmuxSessionExists(sessionName)) {
      try { execSync(`tmux kill-session -t "${sessionName}"`, { stdio: 'ignore' }) } catch { /* ignore */ }
    }
    appendRunEvent(opts.taskId, {
      event_name: 'RemoteControlUrlTimeout',
      run_dir: runDir,
      stdout_log_path: stdoutLogPath,
      tmp_log_path: logPath,
    })
    // ログ末尾をエラーとして返す
    let tail = ''
    try {
      const content = fs.readFileSync(logPath, 'utf-8')
      tail = content.slice(-500)
    } catch { /* ignore */ }
    return {
      success: false,
      error: `Remote Control セッションURLを60秒以内に取得できませんでした。\n${tail || '（ログ読み取り失敗）'}`,
    }
  }

  appendRunEvent(opts.taskId, {
    event_name: 'RemoteControlUrlReady',
    run_dir: runDir,
    stdout_log_path: stdoutLogPath,
    tmp_log_path: logPath,
    remote_session_url: url,
  })

  return { success: true, url, sessionName, runDir, stdoutLogPath, hookSettingsPath }
}

// ─────────────────────────────────────────────────────────────────────────
// メモ情報を Codex プロンプトに整形（タイトル → 空行 → 詳細 → 空行 → 本体）
//   - シャープや --- 等のマークアップは入れない（ユーザー要望: 地の文として）
//   - 完全一致する内容は重複させない
// ─────────────────────────────────────────────────────────────────────────
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

function splitPromptBlocks(text: string): string[] {
  return normalizePromptBlock(text)
    .split(/\n{2,}/)
    .map(block => normalizePromptBlock(block))
    .filter(Boolean)
}

function removeRepeatedPromptBlocks(blocks: string[]): string[] {
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

  return result
}

function buildPromptWithMemo(opts: {
  memoTitle?: string
  memoDescription?: string
  prompt: string
}): string {
  const title = normalizePromptBlock(opts.memoTitle ?? '')
  const desc = normalizePromptBlock(opts.memoDescription ?? '')
  const body = normalizePromptBlock(opts.prompt)
  const bodyBlocks = splitPromptBlocks(body)
  const bodyKeys = new Set(bodyBlocks.map(promptCompareKey))

  const parts: string[] = []
  if (title && !bodyKeys.has(promptCompareKey(title))) parts.push(title)
  if (
    desc &&
    promptCompareKey(desc) !== promptCompareKey(title) &&
    !bodyKeys.has(promptCompareKey(desc))
  ) {
    parts.push(desc)
  }
  parts.push(...bodyBlocks)

  return removeRepeatedPromptBlocks(parts).join('\n\n')
}

// ─────────────────────────────────────────────────────────────────────────
// Codex app-server 健全性チェック（launchd 常駐の codex app-server に接続）
//   - http://127.0.0.1:7878/readyz が HTTP 200 を返せば OK
//   - 起動前に確認することで「daemon 停止」を即座に検知して step に記録
// ─────────────────────────────────────────────────────────────────────────
const CODEX_APP_SERVER_HTTP = 'http://127.0.0.1:7878'

function checkCodexAppServerReady(): { ready: boolean; error?: string } {
  try {
    const out = execSync(
      `curl -sf -o /dev/null -w '%{http_code}' --max-time 3 ${CODEX_APP_SERVER_HTTP}/readyz`,
      { encoding: 'utf-8', timeout: 5000 },
    ).trim()
    if (out === '200') return { ready: true }
    return { ready: false, error: `readyz returned HTTP ${out}` }
  } catch (e) {
    return { ready: false, error: `daemon unreachable: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Codex ステップトラッキング
//   - ai_tasks.result.steps[] に進捗イベントを蓄積し UI でタイムライン表示
//   - 既存 key があれば上書き、なければ末尾追加
//   - live_log も同時に渡せば一回の UPDATE で両方更新（書き込み競合を回避）
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

async function pushCodexStep(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any, any, any>,
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
// Codex CLI 起動（codex --remote 経由で app-server に接続）
//   - codex app-server (launchd 常駐) に WebSocket 接続して thread を作成
//   - 結果として ~/.codex/state_5.sqlite に thread が追加され、
//     ペアリング済 Codex.app / ChatGPT mobile app の laptop アイコンで見える
//   - tmux detached で常駐させ、stdout を pipe-pane で捕捉
//   - 旧 launchCodexExec はモバイル可視性が無かったため置き換え
// ─────────────────────────────────────────────────────────────────────────
async function launchCodexRemote(opts: {
  taskId: string
  prompt: string  // GLM 整理済プロンプト
  cwd: string
  displayTitle?: string  // 「メモ見出し · 詳細」形式
  memoTitle?: string  // チャット名生成用のタイトルだけ
  memoDescription?: string  // 同じく詳細だけ
  resumeThreadId?: string | null  // 指定時は thread/resume で会話継続（往復）
}): Promise<{ success: true; sessionName: string } | { success: false; error: string }> {
  const sessionName = `codex-${opts.taskId.slice(0, 8)}`
  const logPath = `/tmp/codex-exec-${opts.taskId}.log`

  if (!fs.existsSync(opts.cwd)) {
    return { success: false, error: `cwd not found: ${opts.cwd}` }
  }

  // 既存セッション残骸クリーンアップ
  if (tmuxSessionExists(sessionName)) {
    try { execSync(`tmux kill-session -t "${sessionName}"`, { stdio: 'ignore' }) } catch { /* ignore */ }
  }

  // ログファイル初期化
  try { fs.unlinkSync(logPath) } catch { /* ignore */ }
  fs.writeFileSync(logPath, '', 'utf-8')

  // プロンプト組み立て: 「タイトル\n\n詳細\n\nプロンプト本体」
  //   - シャープやセパレータ等のマークアップは入れない（Codex が地の文として読む）
  //   - 重複は省く（title === desc / title === prompt の場合）
  const fullPrompt = buildPromptWithMemo({
    memoTitle: opts.memoTitle,
    memoDescription: opts.memoDescription,
    prompt: opts.prompt,
  })

  // JSON-RPC ブリッジを detached child process として起動
  //   旧 `codex --remote` (TUI) では positional prompt が auto-submit されず
  //   tmux detached で誰も Enter を押せず thread だけ作って止まる問題があったため、
  //   ws://127.0.0.1:7878 に直接接続して newConversation + sendUserMessage を打つ
  //   Node.js クライアント (scripts/codex-rpc-bridge.ts) に切替。
  //   完了検知も turn/completed notification を購読するので確実。
  const promptFile = `/tmp/codex-prompt-${opts.taskId}.txt`
  fs.writeFileSync(promptFile, fullPrompt, 'utf-8')

  const bridgePath = path.resolve(__dirname, 'codex-rpc-bridge.ts')
  if (!fs.existsSync(bridgePath)) {
    return { success: false, error: `bridge script not found: ${bridgePath}` }
  }

  try {
    // detached + unref で task-runner 終了後も bridge プロセスは生き残る
    // stdout/stderr はファイルにリダイレクト
    const bridgeLog = `/tmp/codex-bridge-stdout-${opts.taskId}.log`
    const outFd = fs.openSync(bridgeLog, 'a')
    // bridge は tsx で起動する（このプロジェクトは ts-node 未導入。run-task-runner.sh と同じ tsx を使う）
    const bridgeArgs = [opts.taskId, opts.cwd, promptFile, opts.resumeThreadId ?? '']
    const tsxBin = path.resolve(__dirname, '..', 'node_modules', '.bin', 'tsx')
    const useLocalTsx = fs.existsSync(tsxBin)
    const child = spawn(
      useLocalTsx ? tsxBin : '/usr/local/bin/npx',
      useLocalTsx ? [bridgePath, ...bridgeArgs] : ['--yes', 'tsx', bridgePath, ...bridgeArgs],
      {
        detached: true,
        stdio: ['ignore', outFd, outFd],
        env: { ...process.env },
        cwd: path.resolve(__dirname, '..'),
      },
    )
    child.unref()
    // sessionName は互換性のため bridge プロセスを表す論理名として返す
  } catch (err) {
    return { success: false, error: `bridge 起動失敗: ${err instanceof Error ? err.message : String(err)}` }
  }

  // displayTitle は将来 thread title 上書きに使用
  void opts.displayTitle

  return { success: true, sessionName }
}

// ─────────────────────────────────────────────────────────────────────────
// Codex.app 起動（codex:// URL スキーム経由、Mac proxy パターン）
//   - スマホから API → DB → task-runner → open codex://... → Codex.app
//   - Codex.app の threads DB (~/.codex/state_5.sqlite) で進捗追跡
//   - ペアリング済の ChatGPT mobile からも見える可能性あり
// ─────────────────────────────────────────────────────────────────────────
function launchCodexApp(opts: {
  taskId: string
  prompt: string
  cwd: string | null
  memoTitle?: string
  memoDescription?: string
}): { success: true; openedAt: string } | { success: false; error: string } {
  // プロンプト組み立て: タイトル / 詳細 / 本体 をシンプルに改行で繋ぐ（マークアップなし）
  const fullPrompt = buildPromptWithMemo({
    memoTitle: opts.memoTitle,
    memoDescription: opts.memoDescription,
    prompt: opts.prompt,
  })

  // codex://new?prompt=...&path=...
  const params = new URLSearchParams()
  params.set('prompt', fullPrompt)
  if (opts.cwd) params.set('path', opts.cwd)
  const url = `codex://new?${params.toString()}`

  try {
    // macOS `open` でアプリ起動 + URL 引き渡し
    execSync(`open ${JSON.stringify(url)}`, { stdio: 'ignore', timeout: 5000 })
    return { success: true, openedAt: new Date().toISOString() }
  } catch (err) {
    return { success: false, error: `open 失敗: ${err instanceof Error ? err.message : String(err)}` }
  }
}

/**
 * ~/.codex/state_5.sqlite を読み、codex_app タスクに対応するスレッドを探して
 * Supabase の result に進捗を同期する。
 * 1分おき（task-runner サイクル）に実行。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function syncCodexAppThreads(supabase: any): Promise<void> {
  const dbPath = path.join(os.homedir(), '.codex', 'state_5.sqlite')
  if (!fs.existsSync(dbPath)) return

  // codex_app / codex 両 executor の running タスク取得（どちらも threads DB を共有）
  const { data: tasks } = await supabase
    .from('ai_tasks')
    .select('id, prompt, codex_thread_id, started_at, executor, result, tmux_session_name')
    .in('executor', ['codex_app', 'codex'])
    .eq('status', 'running')
    .limit(50)

  if (!tasks || tasks.length === 0) return

  for (const task of tasks as Array<{
    id: string
    prompt: string
    codex_thread_id: string | null
    started_at: string | null
    executor: string | null
    result: Record<string, unknown> | null
    tmux_session_name: string | null
  }>) {
    // thread_id 未確定なら、プロンプト先頭でマッチング
    let threadId = task.codex_thread_id
    if (!threadId) {
      // プロンプト先頭40文字（# タイトル...）でマッチ
      const promptPrefix = task.prompt.slice(0, 40).replace(/'/g, "''")
      const sinceMs = task.started_at ? new Date(task.started_at).getTime() - 60_000 : 0
      try {
        const out = execSync(
          `sqlite3 ${JSON.stringify(dbPath)} "SELECT id FROM threads WHERE first_user_message LIKE '${promptPrefix}%' AND updated_at_ms >= ${sinceMs} ORDER BY created_at_ms DESC LIMIT 1"`,
          { encoding: 'utf-8', timeout: 5000 },
        ).trim()
        if (out) {
          threadId = out
          await supabase
            .from('ai_tasks')
            .update({ codex_thread_id: threadId })
            .eq('id', task.id)
          console.log(`[codex-app] thread matched: ${task.id} → ${threadId}`)
        }
      } catch {
        // thread 未生成 or DB ロック中、次サイクルで再試行
      }
    }

    if (!threadId) continue

    // thread 状態取得
    try {
      const stateOut = execSync(
        `sqlite3 -json ${JSON.stringify(dbPath)} "SELECT title, tokens_used, has_user_event, archived, updated_at_ms, preview FROM threads WHERE id = '${threadId}'"`,
        { encoding: 'utf-8', timeout: 5000 },
      ).trim()
      if (!stateOut) continue

      const rows = JSON.parse(stateOut) as Array<{
        title?: string
        tokens_used?: number
        has_user_event?: number
        archived?: number
        updated_at_ms?: number
        preview?: string
      }>
      if (rows.length === 0) continue
      const row = rows[0]

      const liveLog = [
        `📱 ${task.executor === 'codex' ? 'Codex CLI' : 'Codex.app'} セッション ${threadId.slice(0, 8)}`,
        `タイトル: ${row.title ?? '(未設定)'}`,
        `トークン使用: ${row.tokens_used ?? 0}`,
        `最終更新: ${row.updated_at_ms ? new Date(row.updated_at_ms).toLocaleString('ja-JP') : '(未更新)'}`,
        `ユーザー操作: ${row.has_user_event ? 'あり' : 'なし'}`,
        '',
        '── プレビュー ──',
        row.preview ?? '(空)',
      ].join('\n')

      const executor = task.executor === 'codex' ? 'codex' : 'codex_app'

      // 既存 steps を保持しつつ thread 検出を step として記録
      const current = (task.result ?? {}) as { steps?: CodexStep[]; [k: string]: unknown }
      const steps: CodexStep[] = Array.isArray(current.steps) ? [...current.steps] : []
      const hasThreadStep = steps.some(s => s.key === 'thread_visible')
      if (!hasThreadStep) {
        steps.push(makeStep('thread_visible', `Mobile/Codex.app に表示 (thread ${threadId.slice(0, 8)})`))
      }

      const baseResult: Record<string, unknown> = {
        ...current,
        live_log: executor === 'codex' ? (current.live_log ?? liveLog) : liveLog,
        executor,
        codex_thread_id: threadId,
        steps,
      }

      const updates: Record<string, unknown> = { result: baseResult }

      // 完了候補判定:
      //   - codex_app (codex:// URL): threads.archived = 1 で完了候補
      //     （codex:// は prefill のみで自動送信されない＝ユーザー操作待ち）
      //   - codex (JSON-RPC bridge): bridge が turn/completed 受信後に
      //     awaiting_approval に更新するため、ここでは何もしない
      const isArchived = row.archived === 1
      const isComplete = isArchived && executor !== 'codex'

      if (isComplete) {
        const completedIdx = steps.findIndex(s => s.key === 'completed')
        const completedStep = makeStep('completed', '完了候補（アーカイブ済・確認待ち）')
        if (completedIdx >= 0) steps[completedIdx] = completedStep
        else steps.push(completedStep)
        updates.status = 'awaiting_approval'
        updates.result = {
          ...baseResult,
          steps,
          message: `Codex.app セッションは完了候補です。内容を確認して完了にしてください。\n\n${liveLog}`,
          session_health: 'stopped',
          awaiting_approval_at: new Date().toISOString(),
        }
      }
      await supabase
        .from('ai_tasks')
        .update(updates)
        .eq('id', task.id)
    } catch (e) {
      console.error(`[codex-app] state read failed for ${task.id}:`, e instanceof Error ? e.message : e)
    }
  }
}

/**
 * tmux セッションがもう存在しない running 状態のRCタスクを確認待ちに更新。
 * 毎回 main() の冒頭で呼ぶことで、ユーザーが Claude を /exit したり Mac 再起動した場合の
 * 取り残しを掃除する。
 */
/**
 * 実行中のCodexタスクのライブログを ai_tasks.result.live_log に書き込む。
 * 毎サイクル冒頭で呼ぶことで、UI から進行状況をリアルタイムに見られる。
 * Codex 専用（Claude は Remote Control 経由で見られるので不要）
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function syncCodexLiveLogs(supabase: any): Promise<void> {
  const { data: codexRunning } = await supabase
    .from('ai_tasks')
    .select('id, tmux_session_name, result')
    .eq('executor', 'codex')
    .eq('status', 'running')
    .not('tmux_session_name', 'is', null)
    .limit(20)

  for (const task of (codexRunning ?? []) as Array<{
    id: string
    tmux_session_name: string
    result: Record<string, unknown> | null
  }>) {
    if (!tmuxSessionExists(task.tmux_session_name)) continue  // reconcile が処理する
    const logPath = `/tmp/codex-exec-${task.id}.log`
    if (!fs.existsSync(logPath)) continue
    try {
      const content = fs.readFileSync(logPath, 'utf-8')
      // ANSI エスケープシーケンス除去
      const cleaned = content.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
      // 末尾 6000 字（UI で読みやすい範囲）
      const tail = cleaned.slice(-6000)
      // 既存 result (steps/codex_thread_id) を保持したまま live_log のみ差し替え
      const merged = { ...(task.result ?? {}), executor: 'codex', live_log: tail }
      await supabase
        .from('ai_tasks')
        .update({ result: merged })
        .eq('id', task.id)
    } catch {
      // ログ読めなくても続行
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 古い Codex タスクの掃除
//   - PR #9 以前の tmux 経由 codex タスクが ハングして残っている (codex-* セッション)
//   - bridge 異常終了で running のまま放置されたタスクもここで failed マーク
//   - 基準: executor='codex' で started_at が 30 分以上前
// ─────────────────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function cleanupStaleCodexTasks(supabase: any): Promise<void> {
  const cutoff = new Date(Date.now() - 30 * 60_000).toISOString()
  const { data } = await supabase
    .from('ai_tasks')
    .select('id, tmux_session_name')
    .eq('executor', 'codex')
    .eq('status', 'running')
    .lt('started_at', cutoff)
    .limit(50)

  for (const t of (data ?? []) as Array<{ id: string; tmux_session_name: string | null }>) {
    // 旧 tmux セッションが残っていれば kill（codex_app の codex:// は tmux 使わないので影響なし）
    if (t.tmux_session_name && t.tmux_session_name.startsWith('codex-')) {
      try {
        execSync(`tmux kill-session -t ${JSON.stringify(t.tmux_session_name)}`, { stdio: 'ignore' })
        console.log(`[cleanup] tmux killed: ${t.tmux_session_name}`)
      } catch { /* セッション既に消滅 */ }
    }
    await supabase
      .from('ai_tasks')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        error: 'Codex タスクが 30 分以上停滞したため自動失敗マーク（PR #9 以前の遺物 / bridge 異常死）',
      })
      .eq('id', t.id)
    console.log(`[cleanup] stale codex task failed: ${t.id}`)
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function reconcileRemoteControlSessions(supabase: any): Promise<void> {
  const { data: runningTasks } = await supabase
    .from('ai_tasks')
    .select('id, executor, tmux_session_name, started_at, result')
    .eq('status', 'running')
    .not('tmux_session_name', 'is', null)
    .limit(50)

  const rows = (runningTasks ?? []) as Array<{
    id: string
    executor: string | null
    tmux_session_name: string | null
    started_at: string | null
    result: Record<string, unknown> | null
  }>
  for (const task of rows) {
    if (!task.tmux_session_name) continue
    if (tmuxSessionExists(task.tmux_session_name)) continue

    // セッションが消えていたら「完了候補」として記録する。
    // executor に応じてログファイルを切替（Claude: persistent stdout.log 優先 / Codex: codex-exec-*.log）
    const executor = task.executor === 'codex' ? 'codex' : 'claude'
    const current = (task.result ?? {}) as { steps?: CodexStep[]; run_dir?: unknown; [k: string]: unknown }
    const runDir = typeof current.run_dir === 'string' ? current.run_dir : ensureRunDir(task.id)
    const persistentLogPath = path.join(runDir, 'stdout.log')
    const tmpLogPath = executor === 'codex'
      ? `/tmp/codex-exec-${task.id}.log`
      : `/tmp/claude-rc-${task.id}.log`

    let tail = ''
    try {
      const logPath = fs.existsSync(persistentLogPath) ? persistentLogPath : tmpLogPath
      if (fs.existsSync(logPath)) {
        const content = fs.readFileSync(logPath, 'utf-8')
        // ANSI エスケープシーケンスを除去して読みやすく
        const cleaned = content.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
        tail = cleaned.slice(-3000)
      }
    } catch { /* ignore */ }

    const defaultMessage = executor === 'codex'
      ? 'Codex セッションは終了しました'
      : 'Remote Control セッションは終了しました'
    appendRunEvent(task.id, {
      event_name: 'TmuxSessionMissing',
      executor,
      tmux_session_name: task.tmux_session_name,
      run_dir: runDir,
      stdout_log_path: fs.existsSync(persistentLogPath) ? persistentLogPath : null,
      tmp_log_path: fs.existsSync(tmpLogPath) ? tmpLogPath : null,
    })

    // Codex の場合は既存 result (steps/thread_id) を保持しつつ停止 step を追加
    let mergedResult: Record<string, unknown>
    if (executor === 'codex') {
      const steps: CodexStep[] = Array.isArray(current.steps) ? [...current.steps] : []
      const stoppedIdx = steps.findIndex(s => s.key === 'stopped')
      const stoppedStep = makeStep('stopped', 'セッション終了（確認待ち）')
      if (stoppedIdx >= 0) steps[stoppedIdx] = stoppedStep
      else steps.push(stoppedStep)
      mergedResult = {
        ...current,
        executor,
        steps,
        live_log: tail,
        message: tail || defaultMessage,
        session_health: 'stopped',
        awaiting_approval_at: new Date().toISOString(),
      }
    } else {
      mergedResult = {
        ...current,
        message: tail || defaultMessage,
        executor,
        run_dir: runDir,
        stdout_log_path: fs.existsSync(persistentLogPath) ? persistentLogPath : undefined,
        tmp_log_path: fs.existsSync(tmpLogPath) ? tmpLogPath : undefined,
        session_health: 'stopped',
        awaiting_approval_at: new Date().toISOString(),
      }
    }

    await supabase
      .from('ai_tasks')
      .update({
        status: 'awaiting_approval',
        result: mergedResult,
      })
      .eq('id', task.id)
    console.log(`[task-runner] ${executor} session ended, awaiting approval: ${task.id}`)
  }
}

// ─────────────────────────────────────────────────────────────────────────
// リポジトリ自動発見スキャナー
//   ~/dev, ~/Documents 等を再帰探索し .git 持ちフォルダを発見
//   available_repos テーブルに upsert する
// ─────────────────────────────────────────────────────────────────────────

const DEFAULT_SCAN_PATHS = [
  '~/dev', '~/Documents', '~/Projects', '~/Workspace', '~/Private', '~/Code',
]
const SCANNER_SKIP_DIRS = new Set([
  'node_modules', '.next', 'dist', 'build', '.cache', '.turbo',
  'venv', '.venv', '__pycache__', '.git', 'target', '.vscode',
  '.idea', 'Pods', '.gradle',
])
const SCANNER_MAX_DEPTH = 4
const SCANNER_INTERVAL_MS = 5 * 60 * 1000

function expandHome(p: string): string {
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2))
  if (p === '~') return os.homedir()
  return p
}

interface FoundRepo {
  absolute_path: string
  display_name: string
  last_git_commit_at: string | null
}

function getLastCommitISO(repoDir: string): string | null {
  try {
    const out = execSync('git log -1 --format=%cI', {
      cwd: repoDir,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).toString().trim()
    return out || null
  } catch {
    return null
  }
}

function findReposRec(rootDir: string, depth: number, out: FoundRepo[]): void {
  if (depth > SCANNER_MAX_DEPTH) return
  if (!fs.existsSync(rootDir)) return
  let stats: fs.Stats
  try { stats = fs.statSync(rootDir) } catch { return }
  if (!stats.isDirectory()) return

  if (fs.existsSync(path.join(rootDir, '.git'))) {
    out.push({
      absolute_path: rootDir,
      display_name: path.basename(rootDir),
      last_git_commit_at: getLastCommitISO(rootDir),
    })
    return
  }

  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(rootDir, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name.startsWith('.')) continue
    if (SCANNER_SKIP_DIRS.has(entry.name)) continue
    findReposRec(path.join(rootDir, entry.name), depth + 1, out)
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ensureDefaultScanSettings(supabase: any, userId: string, hostname: string): Promise<void> {
  const { data: existing } = await supabase
    .from('user_scan_settings')
    .select('user_id')
    .eq('user_id', userId)
    .eq('hostname', hostname)
    .maybeSingle()
  if (existing) return
  await supabase
    .from('user_scan_settings')
    .insert({ user_id: userId, hostname, scan_paths: DEFAULT_SCAN_PATHS })
  console.log(`[repo-scanner] Created default scan settings for user ${userId.slice(0, 8)} on ${hostname}`)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function scanAndSync(supabase: any, hostname: string): Promise<void> {
  const { data: settingsList } = await supabase
    .from('user_scan_settings')
    .select('user_id, scan_paths, scan_now_requested_at, last_scanned_at')
    .eq('hostname', hostname)

  if (!settingsList || settingsList.length === 0) return

  const now = Date.now()
  for (const setting of settingsList as Array<{
    user_id: string
    scan_paths: string[]
    scan_now_requested_at: string | null
    last_scanned_at: string | null
  }>) {
    const lastScannedMs = setting.last_scanned_at ? new Date(setting.last_scanned_at).getTime() : 0
    const requestedMs = setting.scan_now_requested_at ? new Date(setting.scan_now_requested_at).getTime() : 0
    const needsScan = (now - lastScannedMs) > SCANNER_INTERVAL_MS || requestedMs > lastScannedMs
    if (!needsScan) continue

    const paths = (setting.scan_paths && setting.scan_paths.length > 0) ? setting.scan_paths : DEFAULT_SCAN_PATHS
    console.log(`[repo-scanner] Scanning for ${setting.user_id.slice(0, 8)} (${paths.length} paths)...`)

    const found: FoundRepo[] = []
    for (const rawPath of paths) {
      try { findReposRec(expandHome(rawPath), 0, found) } catch (e) {
        console.error(`[repo-scanner] error scanning ${rawPath}:`, e instanceof Error ? e.message : e)
      }
    }
    console.log(`[repo-scanner]   Found ${found.length} repos`)

    const uniq = new Map<string, FoundRepo>()
    for (const r of found) uniq.set(r.absolute_path, r)

    const nowIso = new Date().toISOString()

    const { data: existing } = await supabase
      .from('available_repos')
      .select('id, absolute_path')
      .eq('user_id', setting.user_id)
      .eq('hostname', hostname)

    const existingPaths = new Set((existing ?? []).map((r: { absolute_path: string }) => r.absolute_path))
    const foundPaths = new Set(uniq.keys())

    if (uniq.size > 0) {
      const rows = Array.from(uniq.values()).map(r => ({
        user_id: setting.user_id,
        hostname,
        absolute_path: r.absolute_path,
        display_name: r.display_name,
        last_git_commit_at: r.last_git_commit_at,
        last_seen_at: nowIso,
      }))
      const { error: upsertErr } = await supabase
        .from('available_repos')
        .upsert(rows, { onConflict: 'user_id,hostname,absolute_path' })
      if (upsertErr) console.error('[repo-scanner] upsert error:', upsertErr.message)
    }

    const toDelete = Array.from(existingPaths).filter(p => !foundPaths.has(p as string))
    if (toDelete.length > 0) {
      await supabase
        .from('available_repos')
        .delete()
        .eq('user_id', setting.user_id)
        .eq('hostname', hostname)
        .in('absolute_path', toDelete)
    }

    await supabase
      .from('user_scan_settings')
      .update({ last_scanned_at: nowIso })
      .eq('user_id', setting.user_id)
      .eq('hostname', hostname)
  }
}

function readLocalRunnerUserId(): string | null {
  if (process.env.FOCUSMAP_RUNNER_USER_ID) return process.env.FOCUSMAP_RUNNER_USER_ID.trim()
  try {
    if (fs.existsSync(LOCAL_USER_ID_FILE)) {
      const value = fs.readFileSync(LOCAL_USER_ID_FILE, 'utf-8').trim()
      return value || null
    }
  } catch {
    return null
  }
  return null
}

function commandExists(command: string): boolean {
  try {
    const result = spawnSync('which', [command], { stdio: 'ignore' })
    return result.status === 0
  } catch {
    return false
  }
}

function detectExecutors(): string[] {
  const executors: string[] = []
  if (commandExists('claude')) executors.push('claude')
  if (commandExists('codex')) executors.push('codex', 'codex_app')
  return executors.length > 0 ? executors : ['claude']
}

function detectSecretNames(): string[] {
  const suffixes = ['_API_KEY', '_TOKEN', '_SECRET', '_CREDENTIALS']
  return Object.keys(process.env)
    .filter(key => suffixes.some(suffix => key.endsWith(suffix)))
    .sort()
}

function normalizeRepoKey(value: string): string {
  return value.trim()
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildRepoAvailability(supabase: any, userId: string, hostname: string): Promise<{
  keys: string[]
  paths: Record<string, string>
}> {
  const { data } = await supabase
    .from('available_repos')
    .select('absolute_path, display_name')
    .eq('user_id', userId)
    .eq('hostname', hostname)

  const keys = new Set<string>()
  const paths: Record<string, string> = {}
  for (const repo of (data ?? []) as Array<{ absolute_path: string; display_name: string }>) {
    const absolutePath = normalizeRepoKey(repo.absolute_path)
    const displayName = normalizeRepoKey(repo.display_name)
    if (absolutePath) {
      keys.add(absolutePath)
      paths[absolutePath] = repo.absolute_path
    }
    if (displayName) {
      keys.add(displayName)
      paths[displayName] = repo.absolute_path
    }
  }
  return { keys: [...keys], paths }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ensureRunnerSpaceOptIns(supabase: any, runnerId: string, userId: string): Promise<void> {
  const editableSpaceIds = new Set<string>()

  const { data: ownedSpaces } = await supabase
    .from('spaces')
    .select('id')
    .eq('user_id', userId)
  for (const space of (ownedSpaces ?? []) as Array<{ id: string }>) editableSpaceIds.add(space.id)

  const { data: memberSpaces } = await supabase
    .from('space_members')
    .select('space_id, role')
    .eq('user_id', userId)
    .in('role', ['owner', 'editor'])
  for (const member of (memberSpaces ?? []) as Array<{ space_id: string }>) editableSpaceIds.add(member.space_id)

  if (editableSpaceIds.size === 0) return
  const rows = [...editableSpaceIds].map(spaceId => ({
    runner_id: runnerId,
    space_id: spaceId,
    enabled: true,
  }))
  const { error } = await supabase
    .from('ai_runner_spaces')
    .upsert(rows, { onConflict: 'runner_id,space_id' })
  if (error) console.error('[runner] space opt-in upsert failed:', error.message)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function heartbeatRunner(supabase: any, hostname: string): Promise<AiRunner | null> {
  const userId = readLocalRunnerUserId()
  if (!userId) {
    console.warn(`[runner] No local runner user id. Set FOCUSMAP_RUNNER_USER_ID or ${LOCAL_USER_ID_FILE}`)
    return null
  }

  const repoAvailability = await buildRepoAvailability(supabase, userId, hostname)
  const executors = detectExecutors()
  const nowIso = new Date().toISOString()
  const { data, error } = await supabase
    .from('ai_runners')
    .upsert({
      user_id: userId,
      hostname,
      display_name: hostname,
      executors,
      available_repo_keys: repoAvailability.keys,
      available_secret_names: detectSecretNames(),
      repo_paths: repoAvailability.paths,
      metadata: {
        platform: process.platform,
        pid: process.pid,
        focusmap_path: path.resolve(__dirname, '..'),
      },
      last_heartbeat_at: nowIso,
      updated_at: nowIso,
    }, { onConflict: 'user_id,hostname' })
    .select('id, user_id, hostname, executors, available_repo_keys, available_secret_names, repo_paths')
    .single()

  if (error) {
    console.error('[runner] heartbeat failed:', error.message)
    return null
  }

  await ensureRunnerSpaceOptIns(supabase, data.id, userId)
  return {
    id: data.id,
    user_id: data.user_id,
    hostname: data.hostname,
    executors: data.executors ?? [],
    available_repo_keys: data.available_repo_keys ?? [],
    available_secret_names: data.available_secret_names ?? [],
    repo_paths: (data.repo_paths ?? {}) as Record<string, string>,
  }
}

function requiredRepoKeyFromTask(task: StaffStatusDueTask): string | null {
  const snapshot = task.package_snapshot
  const value = snapshot && typeof snapshot === 'object'
    ? snapshot.required_repo_key
    : null
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function withRunnerResolvedCwd(task: StaffStatusDueTask, runner: AiRunner): StaffStatusDueTask {
  if (task.cwd) return task
  const repoKey = requiredRepoKeyFromTask(task)
  if (!repoKey) return task
  const cwd = runner.repo_paths[repoKey]
  return cwd ? { ...task, cwd } : task
}

type AiPackageRow = {
  id: string
  title: string
  space_id: string | null
  required_repo_key: string | null
  current_version_id: string | null
}

type AiPackageVersionRow = {
  id: string
  package_id: string
  version: string
  manifest: Record<string, unknown> | null
  source_kind: 'git' | 'local_repo_key' | 'inline'
  repo_url: string | null
  git_ref: string | null
  git_commit_sha: string | null
  package_path: string | null
  content_sha256: string | null
}

type AiRunnerPackageCacheRow = {
  runner_id: string
  package_id: string
  version_id: string
  local_path: string | null
  sync_status: 'missing' | 'sync_requested' | 'syncing' | 'ready' | 'failed'
}

type PackageExecutionPlan = {
  cwd: string
  command: string | null
  runtime: 'command' | 'claude'
  versionLabel: string | null
}

function safePathSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) || 'package'
}

function stringFrom(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function packageManifest(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function resolvePackageSubdir(baseDir: string, packagePath: string | null | undefined): string {
  const safePackagePath = packagePath && packagePath.trim() ? packagePath.trim() : '.'
  if (path.isAbsolute(safePackagePath)) {
    throw new Error(`package_path must be relative: ${safePackagePath}`)
  }
  const base = path.resolve(baseDir)
  const resolved = path.resolve(base, safePackagePath)
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) {
    throw new Error(`package_path escapes package root: ${safePackagePath}`)
  }
  return resolved
}

function runProcess(command: string, args: string[], cwd?: string, timeoutMs = 10 * 60 * 1000): { output: string; exitCode: number } {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf-8',
    timeout: timeoutMs,
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  })
  const output = `${result.stdout || ''}${result.stderr || ''}${result.error ? `\n${result.error.message}` : ''}`
  return { output, exitCode: result.status ?? (result.error ? 1 : 0) }
}

function runShellCommand(command: string, cwd: string, timeoutMs = 10 * 60 * 1000): { output: string; exitCode: number } {
  return runProcess('/bin/bash', ['-lc', command], cwd, timeoutMs)
}

function gitHead(cwd: string): string | null {
  const result = runProcess('git', ['rev-parse', 'HEAD'], cwd, 30_000)
  return result.exitCode === 0 ? result.output.trim() : null
}

function syncGitPackage(version: AiPackageVersionRow): { localPath: string; gitCommitSha: string | null; sourceRef: string | null } {
  if (!version.repo_url) throw new Error('repo_url is required for git packages')
  const checkoutDir = path.join(
    PACKAGE_CACHE_DIR,
    safePathSegment(version.package_id),
    safePathSegment(version.id),
  )
  fs.mkdirSync(path.dirname(checkoutDir), { recursive: true })

  if (!fs.existsSync(path.join(checkoutDir, '.git'))) {
    if (fs.existsSync(checkoutDir)) fs.rmSync(checkoutDir, { recursive: true, force: true })
    const clone = runProcess('git', ['clone', '--filter=blob:none', '--depth=1', version.repo_url, checkoutDir], undefined, 15 * 60 * 1000)
    if (clone.exitCode !== 0) throw new Error(clone.output.slice(0, 2000) || 'git clone failed')
  } else {
    const fetchOrigin = runProcess('git', ['fetch', '--depth=1', 'origin'], checkoutDir, 10 * 60 * 1000)
    if (fetchOrigin.exitCode !== 0) throw new Error(fetchOrigin.output.slice(0, 2000) || 'git fetch failed')
  }

  if (version.git_ref) {
    const fetchRef = runProcess('git', ['fetch', '--depth=1', 'origin', version.git_ref], checkoutDir, 10 * 60 * 1000)
    if (fetchRef.exitCode !== 0) throw new Error(fetchRef.output.slice(0, 2000) || `git fetch ${version.git_ref} failed`)
    const checkout = runProcess('git', ['checkout', '--force', 'FETCH_HEAD'], checkoutDir, 60_000)
    if (checkout.exitCode !== 0) throw new Error(checkout.output.slice(0, 2000) || `git checkout ${version.git_ref} failed`)
  } else {
    const pull = runProcess('git', ['pull', '--ff-only', '--depth=1'], checkoutDir, 10 * 60 * 1000)
    if (pull.exitCode !== 0) throw new Error(pull.output.slice(0, 2000) || 'git pull failed')
  }

  const localPath = resolvePackageSubdir(checkoutDir, version.package_path)
  if (!fs.existsSync(localPath)) throw new Error(`package_path not found after sync: ${localPath}`)
  return { localPath, gitCommitSha: gitHead(checkoutDir), sourceRef: version.git_ref ?? version.repo_url }
}

function syncLocalRepoPackage(pkg: AiPackageRow, version: AiPackageVersionRow, runner: AiRunner): { localPath: string; gitCommitSha: string | null; sourceRef: string | null } {
  const manifest = packageManifest(version.manifest)
  const repoKey = stringFrom(manifest.repo_key) ?? pkg.required_repo_key
  if (!repoKey) throw new Error('repo_key or required_repo_key is required for local_repo_key packages')
  const repoPath = runner.repo_paths[repoKey]
  if (!repoPath) throw new Error(`repo not available on this runner: ${repoKey}`)
  const localPath = resolvePackageSubdir(repoPath, version.package_path)
  if (!fs.existsSync(localPath)) throw new Error(`package_path not found in local repo: ${localPath}`)
  return { localPath, gitCommitSha: gitHead(repoPath), sourceRef: repoKey }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function upsertPackageCache(supabase: any, row: Record<string, unknown>): Promise<void> {
  const { error } = await supabase
    .from('ai_runner_package_cache')
    .upsert({
      ...row,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'runner_id,package_id' })
  if (error && !isMissingSchemaError(error)) {
    console.error('[package-sync] cache upsert failed:', error.message)
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function syncRunnerPackageVersions(supabase: any, runner: AiRunner): Promise<void> {
  if (!schemaCapabilities.hasAiPackageVersioning) return

  const { data: runnerSpaces, error: spacesError } = await supabase
    .from('ai_runner_spaces')
    .select('space_id')
    .eq('runner_id', runner.id)
    .eq('enabled', true)

  if (spacesError) {
    if (!isMissingSchemaError(spacesError)) console.error('[package-sync] runner spaces query failed:', spacesError.message)
    return
  }

  const spaceIds = (runnerSpaces ?? []).map((row: { space_id: string }) => row.space_id).filter(Boolean)
  const packageMap = new Map<string, AiPackageRow>()

  const ownPackages = await supabase
    .from('ai_task_packages')
    .select('id, title, space_id, required_repo_key, current_version_id')
    .eq('user_id', runner.user_id)
    .eq('is_active', true)
    .not('current_version_id', 'is', null)

  if (ownPackages.error) {
    if (!isMissingSchemaError(ownPackages.error)) console.error('[package-sync] own packages query failed:', ownPackages.error.message)
    return
  }
  for (const pkg of (ownPackages.data ?? []) as AiPackageRow[]) packageMap.set(pkg.id, pkg)

  if (spaceIds.length > 0) {
    const spacePackages = await supabase
      .from('ai_task_packages')
      .select('id, title, space_id, required_repo_key, current_version_id')
      .in('space_id', spaceIds)
      .eq('is_active', true)
      .not('current_version_id', 'is', null)

    if (spacePackages.error) {
      if (!isMissingSchemaError(spacePackages.error)) console.error('[package-sync] space packages query failed:', spacePackages.error.message)
      return
    }
    for (const pkg of (spacePackages.data ?? []) as AiPackageRow[]) packageMap.set(pkg.id, pkg)
  }

  const packages = [...packageMap.values()].filter(pkg => pkg.current_version_id)
  if (packages.length === 0) return

  const versionIds = packages.map(pkg => pkg.current_version_id).filter((id): id is string => !!id)
  const { data: versions, error: versionsError } = await supabase
    .from('ai_task_package_versions')
    .select('id, package_id, version, manifest, source_kind, repo_url, git_ref, git_commit_sha, package_path, content_sha256')
    .in('id', versionIds)

  if (versionsError) {
    if (!isMissingSchemaError(versionsError)) console.error('[package-sync] versions query failed:', versionsError.message)
    return
  }
  const versionRows = (versions ?? []) as AiPackageVersionRow[]
  const versionById = new Map<string, AiPackageVersionRow>(versionRows.map(version => [version.id, version]))

  const { data: caches, error: cachesError } = await supabase
    .from('ai_runner_package_cache')
    .select('runner_id, package_id, version_id, local_path, sync_status')
    .eq('runner_id', runner.id)
    .in('package_id', packages.map(pkg => pkg.id))

  if (cachesError) {
    if (!isMissingSchemaError(cachesError)) console.error('[package-sync] caches query failed:', cachesError.message)
    return
  }
  const cacheRows = (caches ?? []) as AiRunnerPackageCacheRow[]
  const cacheByPackageId = new Map<string, AiRunnerPackageCacheRow>(cacheRows.map(cache => [cache.package_id, cache]))

  for (const pkg of packages) {
    const version = pkg.current_version_id ? versionById.get(pkg.current_version_id) : null
    if (!version) continue
    const cache = cacheByPackageId.get(pkg.id)
    const isReady = cache?.version_id === version.id &&
      cache.sync_status === 'ready' &&
      !!cache.local_path &&
      fs.existsSync(cache.local_path)
    if (isReady) continue

    await upsertPackageCache(supabase, {
      runner_id: runner.id,
      package_id: pkg.id,
      version_id: version.id,
      sync_status: 'syncing',
      sync_requested_at: cache?.sync_status === 'sync_requested' ? new Date().toISOString() : cache?.sync_status ? null : new Date().toISOString(),
      last_error: null,
    })

    try {
      const synced = version.source_kind === 'git'
        ? syncGitPackage(version)
        : syncLocalRepoPackage(pkg, version, runner)
      const manifest = packageManifest(version.manifest)
      const installCommand = stringFrom(manifest.install_command)
      if (installCommand) {
        const install = runShellCommand(installCommand, synced.localPath, PACKAGE_TASK_TIMEOUT_MS)
        if (install.exitCode !== 0) throw new Error(install.output.slice(0, 2000) || 'install_command failed')
      }
      await upsertPackageCache(supabase, {
        runner_id: runner.id,
        package_id: pkg.id,
        version_id: version.id,
        local_path: synced.localPath,
        source_ref: synced.sourceRef,
        git_commit_sha: synced.gitCommitSha,
        content_sha256: version.content_sha256,
        sync_status: 'ready',
        synced_at: new Date().toISOString(),
        last_error: null,
        metadata: {
          package_title: pkg.title,
          package_version: version.version,
          source_kind: version.source_kind,
        },
      })
      console.log(`[package-sync] ready: ${pkg.title} ${version.version} → ${synced.localPath}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await upsertPackageCache(supabase, {
        runner_id: runner.id,
        package_id: pkg.id,
        version_id: version.id,
        sync_status: 'failed',
        last_error: message.slice(0, 2000),
      })
      console.error(`[package-sync] failed: ${pkg.title} ${version.version}:`, message)
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolvePackageExecution(supabase: any, task: StaffStatusDueTask, runner: AiRunner): Promise<PackageExecutionPlan> {
  if (!task.package_id || !task.package_version_id) {
    throw new Error('package_id and package_version_id are required')
  }
  const { data: cache, error: cacheError } = await supabase
    .from('ai_runner_package_cache')
    .select('local_path, sync_status, version_id')
    .eq('runner_id', runner.id)
    .eq('package_id', task.package_id)
    .eq('version_id', task.package_version_id)
    .maybeSingle()

  if (cacheError) throw new Error(cacheError.message)
  if (!cache || cache.sync_status !== 'ready' || !cache.local_path) {
    throw new Error('package is not synced on this runner yet')
  }
  if (!fs.existsSync(cache.local_path)) {
    throw new Error(`synced package path not found: ${cache.local_path}`)
  }

  const snapshot = packageManifest(task.package_snapshot)
  const snapshotVersion = packageManifest(snapshot.version)
  let manifest = packageManifest(snapshotVersion.manifest)
  let versionLabel = stringFrom(snapshotVersion.version) ?? stringFrom(snapshot.package_version)

  if (Object.keys(manifest).length === 0 || !versionLabel) {
    const { data: version } = await supabase
      .from('ai_task_package_versions')
      .select('version, manifest')
      .eq('id', task.package_version_id)
      .maybeSingle()
    manifest = packageManifest(version?.manifest)
    versionLabel = versionLabel ?? stringFrom(version?.version)
  }

  const command = stringFrom(manifest.run_command) ?? stringFrom(manifest.command)
  const runtimeValue = stringFrom(manifest.runtime)
  const runtime: 'command' | 'claude' = command
    ? 'command'
    : runtimeValue === 'claude' || task.executor === 'claude'
      ? 'claude'
      : 'command'

  if (runtime === 'command' && !command) {
    throw new Error('package manifest requires command or run_command')
  }

  return {
    cwd: cache.local_path,
    command,
    runtime,
    versionLabel,
  }
}

function runPackageCommand(opts: {
  taskId: string
  prompt: string
  cwd: string
  command: string
  packageId: string
  packageVersionId: string
}): Promise<{ output: string; exitCode: number }> {
  return new Promise((resolve) => {
    const runDir = ensureRunDir(opts.taskId)
    const stdoutLogPath = path.join(runDir, 'stdout.log')
    fs.writeFileSync(path.join(runDir, 'prompt.txt'), opts.prompt, 'utf-8')
    fs.writeFileSync(stdoutLogPath, '', 'utf-8')
    fs.writeFileSync(path.join(runDir, 'metadata.json'), `${JSON.stringify({
      task_id: opts.taskId,
      mode: 'ai-package-command',
      cwd: opts.cwd,
      command: opts.command,
      package_id: opts.packageId,
      package_version_id: opts.packageVersionId,
      started_at: new Date().toISOString(),
    }, null, 2)}\n`, 'utf-8')
    appendRunEvent(opts.taskId, {
      event_name: 'ProcessStart',
      mode: 'ai-package-command',
      run_dir: runDir,
      stdout_log_path: stdoutLogPath,
      cwd: opts.cwd,
      package_id: opts.packageId,
      package_version_id: opts.packageVersionId,
    })

    const env = {
      ...process.env,
      FOCUSMAP_TASK_ID: opts.taskId,
      FOCUSMAP_TASK_PROMPT: opts.prompt,
      FOCUSMAP_PACKAGE_ID: opts.packageId,
      FOCUSMAP_PACKAGE_VERSION_ID: opts.packageVersionId,
    }

    const proc = spawn('/bin/bash', ['-lc', opts.command], {
      cwd: opts.cwd,
      env,
      timeout: PACKAGE_TASK_TIMEOUT_MS,
    })

    let output = ''
    let errOutput = ''
    proc.stdout.on('data', (data: Buffer) => {
      const chunk = data.toString()
      output += chunk
      fs.appendFileSync(stdoutLogPath, chunk, 'utf-8')
    })
    proc.stderr.on('data', (data: Buffer) => {
      const chunk = data.toString()
      errOutput += chunk
      fs.appendFileSync(stdoutLogPath, chunk, 'utf-8')
    })
    proc.on('close', (code: number | null) => {
      const exitCode = code ?? 1
      appendRunEvent(opts.taskId, {
        event_name: 'ProcessClose',
        mode: 'ai-package-command',
        exit_code: exitCode,
        stdout_log_path: stdoutLogPath,
      })
      resolve({ output: `${output}${errOutput}`.trim(), exitCode })
    })
    proc.on('error', (error: Error) => {
      appendRunEvent(opts.taskId, {
        event_name: 'ProcessError',
        mode: 'ai-package-command',
        error: error.message,
        stdout_log_path: stdoutLogPath,
      })
      resolve({ output: error.message, exitCode: 1 })
    })
  })
}

function nextPackageRetry(task: StaffStatusDueTask): { retryAt: string; retryCount: number; retryDelayMinutes: number } {
  const previous = asResultRecord(task.result)
  const rawCount = previous.retry_count
  const previousCount = typeof rawCount === 'number' && Number.isFinite(rawCount) ? rawCount : 0
  const retryCount = previousCount + 1
  const delayMs = Math.min(30 * 60 * 1000, 5 * 60 * 1000 * retryCount)
  return {
    retryAt: new Date(Date.now() + delayMs).toISOString(),
    retryCount,
    retryDelayMinutes: Math.round(delayMs / 60_000),
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function claimDueTasksWithRunner(supabase: any, runner: AiRunner, limit = 5): Promise<StaffStatusDueTask[]> {
  const tasks: StaffStatusDueTask[] = []
  for (let i = 0; i < limit; i++) {
    const { data, error } = await supabase.rpc('claim_ai_task_for_runner', {
      p_runner_id: runner.id,
      p_claim_ttl_seconds: 300,
    })
    if (error) {
      console.error('[runner] claim failed:', error.message)
      break
    }
    const task = Array.isArray(data) ? data[0] : data
    if (!task) break
    tasks.push(withRunnerResolvedCwd(task as StaffStatusDueTask, runner))
  }
  return tasks
}

// ─────────────────────────────────────────────────────────────────────────
// メイン処理
// ─────────────────────────────────────────────────────────────────────────
async function main() {
  if (fs.existsSync(PAUSE_FILE)) {
    console.log(`[task-runner] Paused by ${PAUSE_FILE}`)
    process.exit(0)
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error(
      '[task-runner] Error: NEXT_PUBLIC_SUPABASE_URL または SUPABASE_SERVICE_ROLE_KEY が未設定です。' +
      '\n.env.local に追加してください。',
    )
    process.exit(1)
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  schemaCapabilities = await detectSchemaCapabilities(supabase)

  // ─── 0. tmux セッションが消えた RC タスクを確認待ちに遷移 ─
  await reconcileRemoteControlSessions(supabase)
  await cleanupStaleCodexTasks(supabase)

  // ─── 0.1. 実行中の Codex タスクのライブログを DB にダンプ（UI 表示用）─
  await syncCodexLiveLogs(supabase)

  // ─── 0.2. Codex.app スレッド進捗を ~/.codex/state_5.sqlite から同期 ─
  await syncCodexAppThreads(supabase)

  // ─── 0.3. staff-status が途中停止した場合は次回実行へ戻す ─
  await recoverStaleStaffStatusTasks(supabase)

  // ─── 0.5. リポ自動発見スキャン（5分に1回 or scan_now 要求時）─
  const hostname = os.hostname()
  try {
    const localRunnerUserId = readLocalRunnerUserId()
    if (localRunnerUserId) {
      await ensureDefaultScanSettings(supabase, localRunnerUserId, hostname)
    }
    // ai_tasks を持つユーザーで scan_settings 未作成の人にデフォルトを入れる
    const { data: activeUsers } = await supabase
      .from('ai_tasks')
      .select('user_id')
      .limit(50)
    const seen = new Set<string>()
    for (const row of (activeUsers ?? []) as Array<{ user_id: string }>) {
      if (seen.has(row.user_id)) continue
      seen.add(row.user_id)
      await ensureDefaultScanSettings(supabase, row.user_id, hostname)
    }
    await scanAndSync(supabase, hostname)
  } catch (e) {
    console.error('[task-runner] repo scan error:', e instanceof Error ? e.message : e)
  }

  // ─── 1. runner heartbeat → due task を atomic claim ─────────────────
  let dueTasks: StaffStatusDueTask[] = []
  const runner = schemaCapabilities.hasAiRunnerTables && schemaCapabilities.hasSharedAiTaskColumns
    ? await heartbeatRunner(supabase, hostname)
    : null
  if (runner) {
    await syncRunnerPackageVersions(supabase, runner)
    dueTasks = await claimDueTasksWithRunner(supabase, runner, 5)
  } else if (
    schemaCapabilities.hasAiRunnerTables &&
    schemaCapabilities.hasSharedAiTaskColumns &&
    process.env.FOCUSMAP_ALLOW_LEGACY_TASK_RUNNER !== 'true'
  ) {
    console.log('[task-runner] Runner is not configured; skipping AI execution claims')
  } else {
    // Legacy fallback while the shared runner migration has not been applied, or when explicitly allowed.
    const selectColumns = [
      'id, user_id, prompt, skill_id, approval_type, scheduled_at, recurrence_cron, cwd, completed_at, result',
      'source_note_id, source_ideal_goal_id, executor',
      schemaCapabilities.hasSharedAiTaskColumns
        ? `space_id, package_id, package_snapshot, claimed_runner_id, claim_expires_at, run_visibility${schemaCapabilities.hasAiPackageVersioning ? ', package_version_id' : ''}`
        : '',
    ].filter(Boolean).join(', ')
    const { data: rawDueTasks, error } = await supabase
      .from('ai_tasks')
      .select(selectColumns)
      .eq('status', 'pending')
      .not('scheduled_at', 'is', null)
      .lte('scheduled_at', new Date().toISOString())
      .order('scheduled_at', { ascending: true })
      .limit(5)

    if (error) {
      console.error('[task-runner] DB error:', error.message)
      if (SUPABASE_RESTRICTED_PATTERN.test(error.message)) {
        fs.writeFileSync(
          PAUSE_FILE,
          [
            `Paused at ${new Date().toISOString()}`,
            `Reason: ${error.message}`,
            'Remove this file after the Supabase project restriction is lifted.',
            '',
          ].join('\n'),
          'utf-8',
        )
        console.error(`[task-runner] Supabase project is restricted. Created ${PAUSE_FILE} and paused future runs.`)
      }
      process.exit(1)
    }

    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
    dueTasks = ((rawDueTasks || []) as unknown as StaffStatusDueTask[]).filter(t => {
      if (!t.recurrence_cron) return true
      if (!t.completed_at) return true
      return new Date(t.completed_at) < todayStart
    })
  }

  if (!dueTasks || dueTasks.length === 0) {
    console.log('[task-runner] No due tasks at', new Date().toISOString())
    process.exit(0)
  }

  console.log(`[task-runner] ${dueTasks.length} due task(s) found${runner ? ` for runner ${runner.hostname}` : ''}`)

  // ─── 2. タスクを順次実行 ──────────────────────────────────────────────
  for (const task of dueTasks) {
    const shortPrompt = String(task.prompt).slice(0, 40)
    const startedAt = new Date().toISOString()
    console.log(`[task-runner] Starting: ${task.id} "${shortPrompt}"`)

    if (task.skill_id === STAFF_STATUS_SCHEDULE_SKILL_ID && isInteractiveStaffStatusTooLate(task)) {
      const skippedAt = new Date().toISOString()
      const nextAt = nextScheduleForTask(task)
      await supabase
        .from('ai_tasks')
        .update({
          status: task.recurrence_cron ? 'pending' : 'completed',
          scheduled_at: task.recurrence_cron ? nextAt : task.scheduled_at,
          completed_at: skippedAt,
          started_at: null,
          error: null,
          ...releaseClaimFields(),
          result: {
            ...asResultRecord(task.result),
            last_run_status: 'skipped_stale_interactive',
            skipped_at: skippedAt,
            scheduled_run_at: task.scheduled_at,
            next_scheduled_at: task.recurrence_cron ? nextAt : null,
            skip_reason: 'interactive staff-status target was too old to auto-open',
            executor: STAFF_STATUS_SCHEDULE_SKILL_ID,
          },
        })
        .eq('id', task.id)
      console.log(`[task-runner] Skipped stale interactive staff-status task: ${task.id} → ${task.recurrence_cron ? nextAt : 'completed'}`)
      continue
    }

    if (runner && task.claimed_runner_id && task.claimed_runner_id !== runner.id) {
      console.log(`[task-runner] Skipping task reserved by another runner: ${task.id}`)
      continue
    }

    // status → running. The runner selection is already decided before this point;
    // keep this update simple so the script body is not blocked by REST filter quirks.
    const markRunningQuery = supabase
      .from('ai_tasks')
      .update({ status: 'running', started_at: startedAt })
      .eq('id', task.id)
      .eq('status', 'pending') // 楽観的ロック

    const { data: claimedTask, error: updateErr } = await markRunningQuery
      .select('id')
      .maybeSingle()

    if (updateErr) {
      console.error(`[task-runner] Failed to mark running: ${task.id}`, updateErr.message)
      continue
    }
    if (!claimedTask) {
      console.log(`[task-runner] Skipping already-claimed task: ${task.id}`)
      continue
    }

    if (task.package_id && task.package_version_id) {
      if (!runner) {
        await supabase
          .from('ai_tasks')
          .update({
            status: 'pending',
            scheduled_at: new Date(Date.now() + 60_000).toISOString(),
            started_at: null,
            error: 'No configured runner is available for this package task',
            ...releaseClaimFields(),
          })
          .eq('id', task.id)
        console.error(`[task-runner] Package task has no runner: ${task.id}`)
        continue
      }

      let plan: PackageExecutionPlan
      try {
        plan = await resolvePackageExecution(supabase, task, runner)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await supabase
          .from('ai_tasks')
          .update({
            status: 'pending',
            scheduled_at: new Date(Date.now() + 60_000).toISOString(),
            started_at: null,
            error: message.slice(0, 1000),
            ...releaseClaimFields(),
            result: {
              ...asResultRecord(task.result),
              last_run_status: 'waiting_for_package_sync',
              package_id: task.package_id,
              package_version_id: task.package_version_id,
              retry_reason: message,
            },
          })
          .eq('id', task.id)
        console.error(`[task-runner] Package not ready; retry queued: ${task.id}: ${message}`)
        continue
      }

      notify(`パッケージ実行中: ${shortPrompt}`, 'Focusmap AI')
      const result = plan.runtime === 'command' && plan.command
        ? await runPackageCommand({
          taskId: task.id,
          prompt: task.prompt,
          cwd: plan.cwd,
          command: plan.command,
          packageId: task.package_id,
          packageVersionId: task.package_version_id,
        })
        : await runClaude({
          taskId: task.id,
          prompt: task.prompt,
          skillId: task.skill_id,
          cwd: plan.cwd,
        })

      const completedAt = new Date().toISOString()
      if (result.exitCode !== 0) {
        const { retryAt, retryCount, retryDelayMinutes } = nextPackageRetry(task)
        const errMsg = result.output.slice(0, 1000) || 'AI package command failed'
        await supabase
          .from('ai_tasks')
          .update({
            status: 'pending',
            scheduled_at: retryAt,
            started_at: null,
            completed_at: null,
            error: errMsg,
            ...releaseClaimFields(),
            result: {
              ...asResultRecord(task.result),
              message: result.output.slice(0, 4000),
              last_run: completedAt,
              last_run_status: 'failed_retrying',
              retry_count: retryCount,
              retry_delay_minutes: retryDelayMinutes,
              next_retry_at: retryAt,
              package_id: task.package_id,
              package_version_id: task.package_version_id,
              package_version: plan.versionLabel,
              local_path: plan.cwd,
              executor: 'ai_package',
            },
          })
          .eq('id', task.id)
        notify(`再試行予定: ${shortPrompt}`, 'Focusmap AI')
        console.error(`[task-runner] Package failed; retrying: ${task.id} (exit ${result.exitCode}) → ${retryAt}`)
        continue
      }

      if (task.recurrence_cron) {
        let nextAt: string
        try {
          nextAt = getNextScheduledAt(task.recurrence_cron, new Date()).toISOString()
        } catch (error) {
          console.error(`[task-runner] package cron parse error: ${error}`)
          nextAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        }
        await supabase
          .from('ai_tasks')
          .update({
            status: 'pending',
            result: {
              message: result.output.slice(0, 12000),
              last_run: completedAt,
              last_run_status: 'completed',
              package_id: task.package_id,
              package_version_id: task.package_version_id,
              package_version: plan.versionLabel,
              local_path: plan.cwd,
              stdout_log_path: readRunPath(task.id, 'stdout.log'),
              executor: 'ai_package',
            },
            error: null,
            completed_at: completedAt,
            scheduled_at: nextAt,
            started_at: null,
            ...releaseClaimFields(),
          })
          .eq('id', task.id)
        notify(`完了: ${shortPrompt}`, 'Focusmap AI')
        console.log(`[task-runner] Package rescheduled: ${task.id} → ${nextAt}`)
      } else {
        await supabase
          .from('ai_tasks')
          .update({
            status: 'completed',
            result: {
              message: result.output.slice(0, 12000),
              last_run: completedAt,
              last_run_status: 'completed',
              package_id: task.package_id,
              package_version_id: task.package_version_id,
              package_version: plan.versionLabel,
              local_path: plan.cwd,
              stdout_log_path: readRunPath(task.id, 'stdout.log'),
              executor: 'ai_package',
            },
            error: null,
            completed_at: completedAt,
            ...releaseClaimFields(),
          })
          .eq('id', task.id)
        notify(`完了: ${shortPrompt}`, 'Focusmap AI')
        console.log(`[task-runner] Package done: ${task.id}`)
      }
      continue
    }

    if (task.skill_id === STAFF_STATUS_SCHEDULE_SKILL_ID) {
      const staffTask = task as StaffStatusDueTask
      const { output, exitCode } = runStaffStatusScheduleTarget(task.id, task.prompt)
      const completedAt = new Date().toISOString()
      const isCallGateRetry = exitCode === 2 && task.prompt.includes('架電') && isBeforeJstCutoff(11, 30)

      if (isCallGateRetry) {
        const retryAt = new Date(Date.now() + 5 * 60 * 1000).toISOString()
        await supabase
          .from('ai_tasks')
          .update({
            status: 'pending',
            error: null,
            scheduled_at: retryAt,
            started_at: null,
            ...releaseClaimFields(),
            result: {
              message: output.slice(0, 4000),
              last_run: completedAt,
              retry_reason: '架電ゲート未成立のため5分後に再判定',
              executor: STAFF_STATUS_SCHEDULE_SKILL_ID,
            },
          })
          .eq('id', task.id)
        console.log(`[task-runner] Staff-status gate retry: ${task.id} → ${retryAt}`)
        continue
      }

      if (exitCode !== 0) {
        const isCallGateSkipped = exitCode === 2 && task.prompt.includes('架電')
        const historyStatus = isCallGateSkipped ? 'completed' : 'failed'
        const note = isCallGateSkipped ? '架電ゲート未成立のため当日分を終了' : undefined
        const errorMessage = isCallGateSkipped ? null : (output.slice(0, 1000) || `staff-status target failed: ${task.prompt}`)

        if (!isCallGateSkipped) {
          const { retryAt, retryCount, retryDelayMinutes } = nextStaffStatusRetry(staffTask)
          const previousResult = asResultRecord(staffTask.result)
          await supabase
            .from('ai_tasks')
            .update({
              status: 'pending',
              error: errorMessage,
              scheduled_at: retryAt,
              started_at: null,
              completed_at: null,
              ...releaseClaimFields(),
              result: {
                ...previousResult,
                message: output.slice(0, 4000),
                last_run: completedAt,
                last_run_status: 'failed_retrying',
                retry_count: retryCount,
                retry_reason: 'staff-status target failed; retrying until success',
                retry_delay_minutes: retryDelayMinutes,
                next_retry_at: retryAt,
                executor: STAFF_STATUS_SCHEDULE_SKILL_ID,
              },
            })
            .eq('id', task.id)
          notify(`再試行予定: ${shortPrompt}`, 'Focusmap AI')
          console.error(`[task-runner] Staff-status failed; retrying: ${task.id} (exit ${exitCode}) → ${retryAt}`)
          continue
        }

        if (task.recurrence_cron) {
          let nextAt: string
          try {
            nextAt = getNextScheduledAt(task.recurrence_cron, new Date()).toISOString()
          } catch {
            nextAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
          }
          const historyTaskId = await insertStaffStatusRunHistory(supabase, staffTask, {
            status: historyStatus,
            startedAt,
            completedAt,
            output,
            error: errorMessage,
            note,
          })
          await supabase
            .from('ai_tasks')
            .update({
              status: 'pending',
              error: null,
              completed_at: completedAt,
              scheduled_at: nextAt,
              started_at: null,
              ...releaseClaimFields(),
              result: {
                message: output.slice(0, 4000),
                last_run: completedAt,
                last_history_task_id: historyTaskId,
                last_run_status: historyStatus,
                note,
                executor: STAFF_STATUS_SCHEDULE_SKILL_ID,
              },
            })
            .eq('id', task.id)
          notify(`${historyStatus === 'completed' ? '完了' : '失敗'}: ${shortPrompt}`, 'Focusmap AI')
          console.error(`[task-runner] Staff-status ${historyStatus}: ${task.id} (exit ${exitCode}) → ${nextAt}`)
          continue
        }

        await supabase
          .from('ai_tasks')
          .update({
            status: historyStatus,
            error: errorMessage,
            completed_at: completedAt,
            ...releaseClaimFields(),
            result: {
              message: output.slice(0, 4000),
              last_run: completedAt,
              note,
              executor: STAFF_STATUS_SCHEDULE_SKILL_ID,
            },
          })
          .eq('id', task.id)
        notify(`${historyStatus === 'completed' ? '完了' : '失敗'}: ${shortPrompt}`, 'Focusmap AI')
        console.error(`[task-runner] Staff-status ${historyStatus}: ${task.id} (exit ${exitCode})`)
        continue
      }

      if (task.recurrence_cron) {
        let nextAt: string
        try {
          nextAt = getNextScheduledAt(task.recurrence_cron, new Date()).toISOString()
        } catch {
          nextAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        }
        const historyTaskId = await insertStaffStatusRunHistory(supabase, staffTask, {
          status: 'completed',
          startedAt,
          completedAt,
          output,
        })
        await supabase
          .from('ai_tasks')
          .update({
            status: 'pending',
            error: null,
            result: {
              message: output.slice(0, 4000),
              last_run: completedAt,
              last_history_task_id: historyTaskId,
              last_run_status: 'completed',
              executor: STAFF_STATUS_SCHEDULE_SKILL_ID,
            },
            completed_at: completedAt,
            scheduled_at: nextAt,
            started_at: null,
            ...releaseClaimFields(),
          })
          .eq('id', task.id)
        notify(`完了: ${shortPrompt}`, 'Focusmap AI')
        console.log(`[task-runner] Staff-status rescheduled: ${task.id} → ${nextAt}`)
      } else {
        await supabase
          .from('ai_tasks')
          .update({
            status: 'completed',
            error: null,
            result: {
              message: output.slice(0, 4000),
              last_run: completedAt,
              executor: STAFF_STATUS_SCHEDULE_SKILL_ID,
            },
            completed_at: completedAt,
            ...releaseClaimFields(),
          })
          .eq('id', task.id)
        notify(`完了: ${shortPrompt}`, 'Focusmap AI')
        console.log(`[task-runner] Staff-status done: ${task.id}`)
      }
      continue
    }

    // ─── メモから起動: executor 別に分岐 ───
    if ((task.source_note_id || task.source_ideal_goal_id) && task.cwd) {
      // 元メモを取得（タイトル付与・チャット名生成用）
      let memoTitle: string | undefined
      let memoDescription: string | undefined
      let displayTitle: string | undefined
      if (task.source_ideal_goal_id) {
        const { data: memo } = await supabase
          .from('ideal_goals')
          .select('title, description')
          .eq('id', task.source_ideal_goal_id)
          .maybeSingle()
        if (memo?.title) {
          memoTitle = String(memo.title).trim()
          memoDescription = memo.description ? String(memo.description).trim() : undefined
          const titlePart = memoTitle.slice(0, 30)
          const descPart = memoDescription ? memoDescription.replace(/\s+/g, ' ').slice(0, 30) : ''
          displayTitle = descPart ? `${titlePart} · ${descPart}` : titlePart
        }
      } else if (task.source_note_id) {
        const { data: note } = await supabase
          .from('notes')
          .select('content')
          .eq('id', task.source_note_id)
          .maybeSingle()
        if (note?.content) {
          memoTitle = String(note.content).replace(/\s+/g, ' ').trim().slice(0, 60)
          displayTitle = memoTitle
        }
      }

      const executor: 'claude' | 'codex' | 'codex_app' =
        task.executor === 'codex_app' ? 'codex_app' :
        task.executor === 'codex' ? 'codex' :
        'claude'
      const now = new Date().toISOString()
      const memoPrompt = buildPromptWithMemo({
        memoTitle,
        memoDescription,
        prompt: task.prompt,
      })

      // ─── Codex.app executor (Mac proxy: open codex://...) ───
      if (executor === 'codex_app') {
        notify(`Codex.app 起動: ${shortPrompt}`, 'Focusmap AI')
        const result = launchCodexApp({
          taskId: task.id,
          prompt: memoPrompt,
          cwd: task.cwd,
          memoTitle,
          memoDescription,
        })
        if (!result.success) {
          await supabase
            .from('ai_tasks')
            .update({ status: 'failed', error: result.error.slice(0, 1000), completed_at: now })
            .eq('id', task.id)
          console.error(`[task-runner] Codex.app launch failed: ${task.id}: ${result.error}`)
          continue
        }

        await supabase
          .from('ai_tasks')
          .update({
            result: {
              message: 'Codex.app を起動しました。Mac の Codex アプリで内容を確認、ペアリング済ならスマホ ChatGPT app でも見られます',
              executor: 'codex_app',
              opened_at: result.openedAt,
            },
          })
          .eq('id', task.id)

        notify(`Codex.app 起動完了: ${shortPrompt}`, 'Focusmap AI')
        console.log(`[task-runner] Codex.app launched: ${task.id} at ${result.openedAt}`)
        continue
      }

      // ─── Codex executor (app-server 経由 / mobile・Codex.app に出現) ───
      if (executor === 'codex') {
        notify(`Codex 起動中: ${shortPrompt}`, 'Focusmap AI')

        // ① Mac で受信（status=running 設定済 → step 化）
        await pushCodexStep(supabase, task.id,
          makeStep('received', 'Mac の task-runner が受信'))

        // ② daemon 健全性チェック（codex app-server が起動していないと thread 作成できない）
        const health = checkCodexAppServerReady()
        if (!health.ready) {
          await pushCodexStep(supabase, task.id,
            makeStep('daemon_ready', `Codex daemon 未起動: ${health.error}`, 'failed'))
          await supabase
            .from('ai_tasks')
            .update({
              status: 'failed',
              error: `codex app-server (ws://127.0.0.1:7878) に接続できません: ${health.error}\nlaunchctl で com.focusmap.codex-app-server が動作中か確認してください。`,
              completed_at: now,
            })
            .eq('id', task.id)
          notify(`Codex daemon 停止: ${shortPrompt}`, 'Focusmap AI')
          console.error(`[task-runner] codex daemon unreachable: ${health.error}`)
          continue
        }
        await pushCodexStep(supabase, task.id,
          makeStep('daemon_ready', 'Codex daemon (ws://127.0.0.1:7878) 接続OK'))

        // ③ tmux で codex --remote 起動
        const result = await launchCodexRemote({
          taskId: task.id,
          prompt: memoPrompt,
          cwd: task.cwd,
          displayTitle,
          memoTitle,
          memoDescription,
          resumeThreadId: task.codex_resume_thread_id ?? null,
        })

        if (!result.success) {
          await pushCodexStep(supabase, task.id,
            makeStep('spawn', `tmux 起動失敗: ${result.error}`, 'failed'))
          await supabase
            .from('ai_tasks')
            .update({ status: 'failed', error: result.error.slice(0, 1000), completed_at: now })
            .eq('id', task.id)
          notify(`Codex 起動失敗: ${shortPrompt}`, 'Focusmap AI')
          console.error(`[task-runner] Codex launch failed: ${task.id}: ${result.error}`)
          continue
        }
        await pushCodexStep(supabase, task.id,
          makeStep('spawn', 'JSON-RPC bridge プロセス起動'))

        notify(`Codex 実行開始: ${shortPrompt}`, 'Focusmap AI')
        console.log(`[task-runner] Codex bridge spawned: ${task.id}`)

        // bridge プロセスが独立して WebSocket 接続 → newConversation → turn/completed まで
        // 担当するので、task-runner はここで早期 return。
        // 進捗 step (connected / thread_visible / completed) は bridge が更新する。
        continue
      }

      // ─── Claude executor （既存）───
      notify(`Claude スマホで操作可能に起動中: ${shortPrompt}`, 'Focusmap AI')
      const result = await launchRemoteControl({
        taskId: task.id,
        prompt: memoPrompt,
        cwd: task.cwd,
        displayTitle,
      })

      if (!result.success) {
        await supabase
          .from('ai_tasks')
          .update({ status: 'failed', error: result.error.slice(0, 1000), completed_at: now })
          .eq('id', task.id)
        notify(`Claude 起動失敗: ${shortPrompt}`, 'Focusmap AI')
        console.error(`[task-runner] Claude RC launch failed: ${task.id}: ${result.error}`)
        continue
      }

      await supabase
        .from('ai_tasks')
        .update({
          remote_session_url: result.url,
          tmux_session_name: result.sessionName,
          result: {
            message: 'Remote Control セッションを起動しました。スマホ/Web から接続できます。',
            executor: 'claude',
            run_dir: result.runDir,
            stdout_log_path: result.stdoutLogPath,
            hook_settings_path: result.hookSettingsPath,
            claude_session_id: task.id,
            session_health: 'active',
          },
        })
        .eq('id', task.id)

      notify(`Claude スマホから接続可能: ${shortPrompt}`, 'Focusmap AI')
      console.log(`[task-runner] Claude RC session started: ${task.id} → ${result.url}`)
      continue
    }

    // ─── 対話モード: Terminal.app を右半分に開いて claude を起動 ───
    if (task.approval_type === 'confirm' || task.approval_type === 'interactive') {
      notify(`${shortPrompt} — ターミナルを開きます`, 'Focusmap AI')

      openTerminalWithClaude({
        taskId: task.id,
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
            ...releaseClaimFields(),
          })
          .eq('id', task.id)
        console.log(`[task-runner] Terminal opened & rescheduled: ${task.id} → next at ${nextAt}`)
      } else {
        await supabase
          .from('ai_tasks')
          .update({
            status: 'awaiting_approval',
            result: {
              message: 'ターミナルで対話実行を開始しました。結果を確認して完了にしてください。',
              executor: 'claude',
              run_dir: ensureRunDir(task.id),
              claude_session_id: task.id,
              session_health: 'active',
            },
          })
          .eq('id', task.id)
        console.log(`[task-runner] Terminal opened: ${task.id}`)
      }
      continue
    }

    // ─── 自動モード: claude -p でバックグラウンド実行 ───
    notify(`実行中: ${shortPrompt}`, 'Focusmap AI')

    const { output, exitCode } = await runClaude({
      taskId: task.id,
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
            ...releaseClaimFields(),
          })
          .eq('id', task.id)

        console.log(`[task-runner] Rescheduled: ${task.id} → next at ${nextAt}`)
      } else {
        await supabase
          .from('ai_tasks')
          .update({
            status: 'awaiting_approval',
            result: {
              message: output,
              executor: 'claude',
              run_dir: ensureRunDir(task.id),
              stdout_log_path: readRunPath(task.id, 'stdout.log'),
              claude_session_id: task.id,
              session_health: 'stopped',
              awaiting_approval_at: now,
            },
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
