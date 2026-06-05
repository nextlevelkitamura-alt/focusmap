/**
 * リモートツール・ブリッジ — Mac 常駐エージェント (Focusmap Lite) への実行委譲
 *
 * サーバー側の脳 (Vercel AI SDK streamText ループ) が「Macでしか出来ない操作」
 * (ターミナル/ブラウザ/ファイル) を呼ぶときの橋渡し。
 *
 * 仕組み:
 *  1. resolveOnlineRunner() で heartbeat 5分以内の runner を1台選ぶ
 *  2. runRemoteCommand() で agent_commands に1行 INSERT (status=pending)
 *  3. Mac 側が claim → 実行 → status を completed/failed に更新し result/error を書く
 *  4. サーバーは agent_commands 行をポーリングして結果を待つ
 *     (agent_commands は supabase_realtime publication 未登録のため Realtime 不可 → ポーリング)
 *
 * Mac 側 (command-executor.ts) は cwd・timeout・安全ブロック・ファイル一覧を処理する。
 */
import { tool, type ToolSet } from 'ai'
import { z } from 'zod/v3'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/utils/supabase/server'

const HEARTBEAT_ONLINE_WINDOW_MS = 5 * 60 * 1000 // 5分以内の heartbeat をオンラインとみなす
const DEFAULT_TIMEOUT_MS = 120_000 // 1ツール最大2分
const DEFAULT_POLL_MS = 1_500
const DEFAULT_SHELL_TIMEOUT_MS = 180_000
const DEFAULT_OPENCODE_TIMEOUT_MS = 300_000
const MAX_SHELL_TIMEOUT_MS = 570_000

export interface OnlineRunner {
  id: string
  hostname: string
  displayName: string | null
  /** ランナーのOS (heartbeat metadata の os/platform から。例: 'darwin' | 'win32' | 'linux')。不明なら null。 */
  os: string | null
  googleDriveRoots: string[]
  inaccessibleGoogleDriveRoots: string[]
  cloudStorageRoots: string[]
  codingHarnesses: string[]
  folderAccess: Record<string, unknown> | null
}

/** metadata から OS を取り出す。agent が os/platform を送っていれば使う。 */
function extractOs(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null
  const meta = metadata as Record<string, unknown>
  if (typeof meta.os === 'string' && meta.os.trim()) return meta.os.trim()
  if (typeof meta.platform === 'string' && meta.platform.trim()) return meta.platform.trim()
  return null
}

function extractStringArray(metadata: unknown, key: string): string[] {
  if (!metadata || typeof metadata !== 'object') return []
  const value = (metadata as Record<string, unknown>)[key]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function extractObject(metadata: unknown, key: string): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== 'object') return null
  const value = (metadata as Record<string, unknown>)[key]
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

/**
 * その runner が agent_commands (ターミナル/ブラウザ/ファイル) を claim・実行できるか。
 * focusmap-agent (focusmap-lite) だけが agent_commands を処理する。
 * ai_tasks 実行用の task-runner も同じ ai_runners に heartbeat を出すが、
 * agent_commands は一切 claim しないため、これを除外しないとコマンドが pending のまま放置される。
 *
 * 判別: focusmap-agent の heartbeat は metadata.app='focusmap-lite' (サーバー側付与) /
 * metadata.agent='focusmap-agent' (エージェント側付与) を持つ。task-runner はどちらも持たない。
 */
function canExecuteRemoteCommands(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object') return false
  const meta = metadata as Record<string, unknown>
  return meta.app === 'focusmap-lite' || meta.agent === 'focusmap-agent'
}

/**
 * heartbeat が直近 5 分以内で、かつ agent_commands を実行できる focusmap-agent を1台返す。
 * 無ければ null (= Macオフライン)。最新 heartbeat のものを優先する。
 */
export async function resolveOnlineRunner(
  supabase: SupabaseClient,
  userId: string,
): Promise<OnlineRunner | null> {
  const since = new Date(Date.now() - HEARTBEAT_ONLINE_WINDOW_MS).toISOString()
  const { data, error } = await supabase
    .from('ai_runners')
    .select('id, hostname, display_name, metadata, last_heartbeat_at')
    .eq('user_id', userId)
    .gte('last_heartbeat_at', since)
    .order('last_heartbeat_at', { ascending: false })
    .limit(10)
  if (error || !data) return null

  const capable = data.find(row => canExecuteRemoteCommands(row.metadata))
  if (!capable) return null
  return {
    id: capable.id,
    hostname: capable.hostname,
    displayName: capable.display_name ?? null,
    os: extractOs(capable.metadata),
    googleDriveRoots: extractStringArray(capable.metadata, 'google_drive_roots'),
    inaccessibleGoogleDriveRoots: extractStringArray(capable.metadata, 'inaccessible_google_drive_roots'),
    cloudStorageRoots: extractStringArray(capable.metadata, 'cloud_storage_roots'),
    codingHarnesses: extractStringArray(capable.metadata, 'coding_harnesses'),
    folderAccess: extractObject(capable.metadata, 'folder_access'),
  }
}

export interface RemoteCommandResult {
  ok: boolean
  status: 'completed' | 'failed' | 'cancelled' | 'timeout'
  result?: unknown
  error?: string
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/**
 * agent_commands に1コマンドを投入し、Mac側が結果を書くまでポーリングで待つ。
 * timeoutMs を超えたら status='timeout' を返す (行はそのまま残す = Mac が後で完了させる可能性)。
 */
export async function runRemoteCommand(params: {
  supabase: SupabaseClient
  runnerId: string
  userId: string
  spaceId: string | null
  type: string
  payload: Record<string, unknown>
  timeoutMs?: number
  pollMs?: number
}): Promise<RemoteCommandResult> {
  const { supabase, runnerId, userId, spaceId, type, payload } = params
  const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const pollMs = params.pollMs ?? DEFAULT_POLL_MS

  const { data: inserted, error: insertError } = await supabase
    .from('agent_commands')
    .insert({
      runner_id: runnerId,
      user_id: userId,
      space_id: spaceId,
      type,
      payload,
      status: 'pending',
    })
    .select('id')
    .single()

  if (insertError || !inserted) {
    return { ok: false, status: 'failed', error: insertError?.message ?? 'コマンド投入に失敗しました' }
  }

  const commandId = inserted.id as string
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    await sleep(pollMs)
    const { data: row, error: pollError } = await supabase
      .from('agent_commands')
      .select('status, result, error')
      .eq('id', commandId)
      .maybeSingle()
    if (pollError || !row) continue

    if (row.status === 'completed') {
      return { ok: true, status: 'completed', result: row.result }
    }
    if (row.status === 'failed') {
      return { ok: false, status: 'failed', error: row.error ?? '実行に失敗しました' }
    }
    if (row.status === 'cancelled') {
      return { ok: false, status: 'cancelled', error: 'コマンドがキャンセルされました' }
    }
  }

  return {
    ok: false,
    status: 'timeout',
    error: `Mac側の応答がタイムアウトしました (${Math.round(timeoutMs / 1000)}秒)。Macがスリープした可能性があります。`,
  }
}

/**
 * リモートツール群のコンテキスト。
 * runnerId が null の場合 = Macオフライン → 各ツールは graceful にオフライン理由を返す
 * (モデルがユーザーに「Macがオフラインなので予約します」等と伝えられるようにする)。
 */
export interface RemoteToolContext {
  userId: string
  spaceId: string | null
  runner: OnlineRunner | null
}

const OFFLINE_RETURN = {
  success: false as const,
  offline: true as const,
  message:
    'このMacはオフライン（または未接続）です。ターミナル・ブラウザ・ファイル操作は実行できません。ユーザーに、Macを起動して接続するか、予約実行に切り替えるか確認してください。',
}

/**
 * リモートツール群を組み立てて返す。ctx.runner が null ならオフライン応答のみ返すツール群になる。
 */
export function createRemoteTools(ctx: RemoteToolContext): ToolSet {
  const { userId, spaceId, runner } = ctx

  // 共通: runnerが居なければオフライン応答。居ればコマンド投入してポーリング待ち。
  const run = async (
    type: string,
    payload: Record<string, unknown>,
    timeoutMs?: number,
  ) => {
    if (!runner) return OFFLINE_RETURN
    const supabase = await createClient()
    const res = await runRemoteCommand({ supabase, runnerId: runner.id, userId, spaceId, type, payload, timeoutMs })
    if (res.ok) return { success: true, result: res.result }
    return { success: false, status: res.status, error: res.error }
  }

  const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`
  const normalizeShellTimeoutMs = (value: number | undefined, fallback: number) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
    return Math.max(1_000, Math.min(Math.round(value), MAX_SHELL_TIMEOUT_MS))
  }
  const waitForAgentTimeoutMs = (agentTimeoutMs: number) =>
    Math.min(agentTimeoutMs + 30_000, 600_000)
  const openCodeCommand = (input: {
    prompt: string
    cwd?: string
    agent?: string
    model?: string
    title?: string
  }) => {
    const parts = ['opencode', 'run', '--format', 'json']
    if (input.cwd) parts.push('--dir', shellQuote(input.cwd))
    if (input.agent) parts.push('--agent', shellQuote(input.agent))
    if (input.model) parts.push('--model', shellQuote(input.model))
    if (input.title) parts.push('--title', shellQuote(input.title))
    parts.push(shellQuote(input.prompt))
    return parts.join(' ')
  }

  return {
    runTerminal: tool({
      description:
        'Macのターミナルでシェルコマンドを自動実行する。フォルダ探索・git・npm・スクリプト実行など。破壊的コマンド(rm -rf, sudo, git push等)はMac側でブロックされる。',
      inputSchema: z.object({
        command: z.string().describe('実行するシェルコマンド'),
        cwd: z.string().optional().describe('作業ディレクトリ(省略時はホーム)'),
        timeoutMs: z.number().optional().describe('タイムアウト(ms)。省略時180000、最大570000'),
      }),
      execute: async ({ command, cwd, timeoutMs }) => {
        const shellTimeoutMs = normalizeShellTimeoutMs(timeoutMs, DEFAULT_SHELL_TIMEOUT_MS)
        return run(
          'run_shell',
          { command, cwd, timeout_ms: shellTimeoutMs },
          waitForAgentTimeoutMs(shellTimeoutMs),
        )
      },
    }),

    listFiles: tool({
      description:
        'Mac上のフォルダ直下を一覧する。Google Drive、Documents、Downloads、リポジトリなどの探索では、まずこのツールを使う。',
      inputSchema: z.object({
        path: z.string().describe('一覧するフォルダの絶対パス'),
        maxEntries: z.number().optional().describe('最大件数。省略時200、最大1000'),
      }),
      execute: async ({ path, maxEntries }) => run('file_list', { path, max_entries: maxEntries }),
    }),

    browserNavigate: tool({
      description: 'Macのブラウザ(Playwright)で指定URLを開く。ログイン済みセッションを使った巡回に使う。',
      inputSchema: z.object({
        url: z.string().describe('開くURL'),
        sessionId: z.string().optional().describe('ブラウザセッションID(継続操作で同一セッションを使う場合)'),
        waitFor: z.string().optional().describe('表示を待つCSSセレクタ'),
      }),
      execute: async ({ url, sessionId, waitFor }) =>
        run('browser_navigate', { url, session_id: sessionId, wait_for: waitFor }),
    }),

    browserClick: tool({
      description: 'Macのブラウザで指定セレクタの要素をクリックする。',
      inputSchema: z.object({
        selector: z.string().describe('クリックする要素のCSSセレクタ'),
        sessionId: z.string().optional().describe('ブラウザセッションID'),
      }),
      execute: async ({ selector, sessionId }) =>
        run('browser_click', { selector, session_id: sessionId }),
    }),

    browserFill: tool({
      description: 'Macのブラウザで入力欄に値を入力する。ログインフォームや検索欄に使う。',
      inputSchema: z.object({
        selector: z.string().describe('入力欄のCSSセレクタ'),
        value: z.string().describe('入力する値'),
        pressEnter: z.boolean().optional().describe('入力後にEnterを押すか'),
        sessionId: z.string().optional().describe('ブラウザセッションID'),
      }),
      execute: async ({ selector, value, pressEnter, sessionId }) =>
        run('browser_fill', { selector, value, press_enter: pressEnter, session_id: sessionId }),
    }),

    browserScreenshot: tool({
      description: 'Macのブラウザでスクリーンショットを撮る。現在の画面状態の確認に使う。',
      inputSchema: z.object({
        url: z.string().optional().describe('撮影前に開くURL(省略時は現在のページ)'),
        selector: z.string().optional().describe('特定要素だけ撮る場合のCSSセレクタ'),
        fullPage: z.boolean().optional().describe('ページ全体を撮るか'),
        sessionId: z.string().optional().describe('ブラウザセッションID'),
      }),
      execute: async ({ url, selector, fullPage, sessionId }) =>
        run('browser_screenshot', { url, selector, full_page: fullPage ?? false, session_id: sessionId, type: 'jpeg', quality: 75 }),
    }),

    readFile: tool({
      description: 'Mac上のファイルを読む。設定ファイルやログの確認に使う。',
      inputSchema: z.object({
        path: z.string().describe('読むファイルの絶対パス'),
      }),
      execute: async ({ path }) => run('file_read', { path }),
    }),

    writeFile: tool({
      description: 'Mac上にファイルを書き込む。スクリプト生成や成果物の保存に使う。',
      inputSchema: z.object({
        path: z.string().describe('書き込み先の絶対パス'),
        content: z.string().describe('書き込む内容'),
        mkdirs: z.boolean().optional().describe('親ディレクトリが無ければ作成するか'),
      }),
      needsApproval: true,
      execute: async ({ path, content, mkdirs }) =>
        run('file_write', { path, content, mkdirs }),
    }),

    runOpenCode: tool({
      description:
        'OpenCode CLIを非対話モードで実行する。コード調査、実装案、リポジトリ内の読み取り中心作業に使う。OpenCodeがMacに未導入なら失敗するため、その場合はrunTerminal/listFiles/readFileで続行する。',
      inputSchema: z.object({
        prompt: z.string().describe('OpenCodeへ渡す依頼文'),
        cwd: z.string().optional().describe('対象リポジトリ/フォルダの絶対パス'),
        agent: z.string().optional().describe('OpenCode agent名。例: plan / build など。未指定可'),
        model: z.string().optional().describe('provider/model形式のモデル指定。未指定可'),
        title: z.string().optional().describe('OpenCodeセッション名。未指定可'),
        timeoutMs: z.number().optional().describe('タイムアウト(ms)。省略時300000、最大570000'),
      }),
      execute: async (input) => {
        const shellTimeoutMs = normalizeShellTimeoutMs(input.timeoutMs, DEFAULT_OPENCODE_TIMEOUT_MS)
        return run(
          'run_shell',
          { command: openCodeCommand(input), cwd: input.cwd, timeout_ms: shellTimeoutMs },
          waitForAgentTimeoutMs(shellTimeoutMs),
        )
      },
    }),

    webResearch: tool({
      description:
        'MacのブラウザでURLを開き、本文テキストを抽出して返す。Web上の情報を読み取って要約・記録する調査に使う。',
      inputSchema: z.object({
        url: z.string().describe('調査するページのURL'),
        selector: z.string().optional().describe('抽出対象のCSSセレクタ(省略時はページ全体)'),
        maxChars: z.number().optional().describe('抽出する最大文字数'),
      }),
      execute: async ({ url, selector, maxChars }) =>
        run('browser_text', { url, selector, max_chars: maxChars }),
    }),
  }
}
