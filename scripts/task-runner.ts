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

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
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
  /** Claude セッション一覧表示用のタイトル。省略時は prompt から生成 */
  displayTitle?: string
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
    const child = spawn(
      '/usr/local/bin/npx',
      ['ts-node', '--esm', bridgePath, opts.taskId, opts.cwd, promptFile],
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

      // 完了判定:
      //   - codex_app (codex:// URL): threads.archived = 1 でのみ完了判定
      //     （codex:// は prefill のみで自動送信されない＝ユーザー操作待ち）
      //   - codex (JSON-RPC bridge): bridge が turn/completed 受信で
      //     自前で status='completed' に更新するため、ここでは何もしない
      const isArchived = row.archived === 1
      const isComplete = isArchived && executor !== 'codex'

      if (isComplete) {
        const completedIdx = steps.findIndex(s => s.key === 'completed')
        const completedStep = makeStep('completed', '完了（アーカイブ済）')
        if (completedIdx >= 0) steps[completedIdx] = completedStep
        else steps.push(completedStep)
        updates.status = 'completed'
        updates.completed_at = new Date().toISOString()
        updates.result = {
          ...baseResult,
          steps,
          message: `Codex.app セッション完了\n\n${liveLog}`,
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
 * tmux セッションがもう存在しない running 状態のRCタスクを completed に更新。
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

    // セッションが消えていたら completed として記録
    // executor に応じてログファイルを切替（Claude: claude-rc-*.log / Codex: codex-exec-*.log）
    const executor = task.executor === 'codex' ? 'codex' : 'claude'
    const logPath = executor === 'codex'
      ? `/tmp/codex-exec-${task.id}.log`
      : `/tmp/claude-rc-${task.id}.log`

    let tail = ''
    try {
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

    // Codex の場合は既存 result (steps/thread_id) を保持しつつ completed step を追加
    let mergedResult: Record<string, unknown>
    if (executor === 'codex') {
      const current = (task.result ?? {}) as { steps?: CodexStep[]; [k: string]: unknown }
      const steps: CodexStep[] = Array.isArray(current.steps) ? [...current.steps] : []
      const completedIdx = steps.findIndex(s => s.key === 'completed')
      const completedStep = makeStep('completed', '完了')
      if (completedIdx >= 0) steps[completedIdx] = completedStep
      else steps.push(completedStep)
      mergedResult = { ...current, executor, steps, live_log: tail, message: tail || defaultMessage }
    } else {
      mergedResult = { message: tail || defaultMessage, executor }
    }

    await supabase
      .from('ai_tasks')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        result: mergedResult,
      })
      .eq('id', task.id)
    console.log(`[task-runner] ${executor} session ended: ${task.id}`)
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
  await cleanupStaleCodexTasks(supabase)

  // ─── 0.1. 実行中の Codex タスクのライブログを DB にダンプ（UI 表示用）─
  await syncCodexLiveLogs(supabase)

  // ─── 0.2. Codex.app スレッド進捗を ~/.codex/state_5.sqlite から同期 ─
  await syncCodexAppThreads(supabase)

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
    .select('id, prompt, skill_id, approval_type, scheduled_at, recurrence_cron, cwd, completed_at, source_note_id, source_ideal_goal_id, executor')
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
          result: { message: 'Remote Control セッションを起動しました。スマホ/Web から接続できます。' },
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
