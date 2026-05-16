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
}): Promise<{ success: true; url: string; sessionName: string } | { success: false; error: string }> {
  const sessionName = `memo-${opts.taskId.slice(0, 8)}`
  const logPath = `/tmp/claude-rc-${opts.taskId}.log`
  const promptPath = `/tmp/claude-prompt-${opts.taskId}.txt`

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
  const title = `memo: ${opts.prompt
    .slice(0, 40)
    .replace(/[\n\r\t]+/g, ' ')
    .replace(/\\/g, '')
    .replace(/"/g, '')
    .replace(/'/g, '')
    .trim()}`

  // 既存ログ削除して空ファイル作成（pipe-pane は append しか出来ないため）
  try { fs.unlinkSync(logPath) } catch { /* ignore */ }
  fs.writeFileSync(logPath, '', 'utf-8')

  // claude を tmux 内で「TTYを保ったまま」起動する。
  // パイプ（| tee）すると非対話と判定されて --print モードになるため、
  // pipe-pane で別途出力を捕捉する。
  // ANTHROPIC_API_KEY と CLAUDECODE は Remote Control が動かないので除外。
  // --dangerously-skip-permissions: 許可ダイアログを全部スキップ（無人実行のため必須）
  // プロンプトは ANSI-C quoting ($'...') で渡す → 改行が実際の改行として claude に届く
  // （JSON.stringify だと \n がリテラル2文字として渡されてしまうため）
  const promptQuoted = ansiCQuote(opts.prompt)
  const inner = `unset ANTHROPIC_API_KEY; unset CLAUDECODE; exec claude --remote-control ${JSON.stringify(title)} --dangerously-skip-permissions ${promptQuoted}`
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
      `tmux pipe-pane -o -t ${JSON.stringify(sessionName)} ${JSON.stringify(`cat >> ${logPath}`)}`,
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

  // プロンプトファイル削除（positional arg で渡しているので使わないが念のため）
  try { fs.unlinkSync(promptPath) } catch { /* ignore */ }

  return { success: true, url, sessionName }
}

/**
 * tmux セッションがもう存在しない running 状態のRCタスクを completed に更新。
 * 毎回 main() の冒頭で呼ぶことで、ユーザーが Claude を /exit したり Mac 再起動した場合の
 * 取り残しを掃除する。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function reconcileRemoteControlSessions(supabase: any): Promise<void> {
  const { data: runningTasks } = await supabase
    .from('ai_tasks')
    .select('id, tmux_session_name, started_at')
    .eq('status', 'running')
    .not('tmux_session_name', 'is', null)
    .limit(50)

  const rows = (runningTasks ?? []) as Array<{ id: string; tmux_session_name: string | null; started_at: string | null }>
  for (const task of rows) {
    if (!task.tmux_session_name) continue
    if (tmuxSessionExists(task.tmux_session_name)) continue
    // セッションが消えていたら completed として記録
    const logPath = `/tmp/claude-rc-${task.id}.log`
    let tail = ''
    try {
      if (fs.existsSync(logPath)) {
        const content = fs.readFileSync(logPath, 'utf-8')
        tail = content.slice(-2000)
      }
    } catch { /* ignore */ }
    await supabase
      .from('ai_tasks')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        result: { message: tail || 'Remote Control セッションは終了しました' },
      })
      .eq('id', task.id)
    console.log(`[task-runner] RC session ended: ${task.id}`)
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

  // ─── 0. tmux セッションが消えた RC タスクを completed/failed に遷移 ─
  await reconcileRemoteControlSessions(supabase)

  // ─── 0.5. リポ自動発見スキャン（5分に1回 or scan_now 要求時）─
  const hostname = os.hostname()
  try {
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

  // ─── 1. due なタスクを取得 ───────────────────────────────────────────
  const { data: rawDueTasks, error } = await supabase
    .from('ai_tasks')
    .select('id, prompt, skill_id, approval_type, scheduled_at, recurrence_cron, cwd, completed_at, source_note_id, source_ideal_goal_id')
    .eq('status', 'pending')
    .not('scheduled_at', 'is', null)
    .lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(10)

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

    // ─── メモから起動: claude --remote-control（tmux detached）───
    if ((task.source_note_id || task.source_ideal_goal_id) && task.cwd) {
      notify(`スマホで操作可能に起動中: ${shortPrompt}`, 'Focusmap AI')
      const result = await launchRemoteControl({
        taskId: task.id,
        prompt: task.prompt,
        cwd: task.cwd,
      })
      const now = new Date().toISOString()

      if (!result.success) {
        await supabase
          .from('ai_tasks')
          .update({ status: 'failed', error: result.error.slice(0, 1000), completed_at: now })
          .eq('id', task.id)
        notify(`起動失敗: ${shortPrompt}`, 'Focusmap AI')
        console.error(`[task-runner] RC launch failed: ${task.id}: ${result.error}`)
        continue
      }

      // 起動成功 → URL を保存。status は running のまま（tmux 内で claude が動き続ける）
      await supabase
        .from('ai_tasks')
        .update({
          remote_session_url: result.url,
          tmux_session_name: result.sessionName,
          result: { message: 'Remote Control セッションを起動しました。スマホ/Web から接続できます。' },
        })
        .eq('id', task.id)

      notify(`スマホから接続可能: ${shortPrompt}`, 'Focusmap AI')
      console.log(`[task-runner] RC session started: ${task.id} → ${result.url}`)
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
