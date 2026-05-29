/**
 * 統合エージェントエンドポイント (DeepSeek V4 Pro + Vercel AI SDK)
 *
 * 1チャット・1モデル・1エンドポイント。モデルがメッセージごとに
 * 「ただ答える / ツールを呼ぶ」を自律判断する。intent分類・モード切替は無い。
 *
 * 脳はここ (streamText ループ)。Mac は agent_command 経由のリモート実行器。
 */
import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'
import { streamText, convertToModelMessages, stepCountIs, type UIMessage } from 'ai'
import { getAgentModel } from '@/lib/ai/providers'
import { buildAgentTools } from '@/lib/ai/agent-tools'
import type { OnlineRunner } from '@/lib/ai/remote-tools'

// マルチステップのツール実行で時間がかかるため上限を引き上げる (Cloud Run の上限内)
export const maxDuration = 600

// heartbeat metadata の os/platform を人間向けの表記に整える。
function describeOs(os: string | null): string {
  if (!os) return 'OS不明'
  const lower = os.toLowerCase()
  if (lower.includes('darwin') || lower.includes('mac')) return 'macOS'
  if (lower.includes('win')) return 'Windows'
  if (lower.includes('linux')) return 'Linux'
  return os
}

function formatRunnerHints(runner: OnlineRunner): string[] {
  const lines: string[] = []
  if (runner.googleDriveRoots.length > 0) {
    lines.push(`- Google Drive候補: ${runner.googleDriveRoots.join(' / ')}`)
  }
  if (runner.inaccessibleGoogleDriveRoots.length > 0) {
    lines.push(`- アクセス不可のGoogle Drive候補: ${runner.inaccessibleGoogleDriveRoots.join(' / ')}`)
  }
  if (runner.cloudStorageRoots.length > 0) {
    lines.push(`- CloudStorage候補: ${runner.cloudStorageRoots.join(' / ')}`)
  }
  if (runner.codingHarnesses.length > 0) {
    lines.push(`- 利用可能なコード実行ハーネス: ${runner.codingHarnesses.join(' / ')}`)
  }
  if (runner.folderAccess) {
    const access = Object.entries(runner.folderAccess)
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(', ')
    if (access) lines.push(`- フォルダ権限: ${access}`)
  }
  return lines
}

function buildSystemPrompt(runner: OnlineRunner | null): string {
  const online = runner !== null
  const osLabel = online ? describeOs(runner.os) : null
  const runnerHints = online ? formatRunnerHints(runner) : []
  return [
    'あなたは Focusmap の統合AIアシスタントです。日本語で応答します。',
    '',
    '## 基本方針',
    '- 雑談・相談・質問にはそのまま自然に答える。ツールは不要なら呼ばない。',
    '- ユーザーが「実行」「やって」「巡回して」「記録して」など作業を求めたら、適切なツールを使って実際に実行する。',
    '- マルチステップの作業は、1ステップずつツールを呼びながら進める。各ステップの結果を見て次を判断する。',
    '- ツールが失敗した場合は、理由をユーザーに分かりやすく伝え、代替案を提案する。',
    '',
    '## ツールの種類',
    '- サーバー直実行 (常に使える): addTask / addCalendarEvent / addMindmapGroup / addMindmapTask / deleteMindmapNode',
    '- 予約実行 (常に使える): scheduleTask — 時間指定や繰り返し、またはMacがオフラインのときにサーバー側でタスクを予約実行する。',
    '- Mac経由 (ターミナル/ブラウザ/ファイル): runTerminal / listFiles / readFile / writeFile / runOpenCode / browserNavigate / browserClick / browserFill / browserScreenshot / webResearch',
    '',
    '## Mac実行ルール',
    '- フォルダの中身確認は、まず listFiles を使う。シェルの ls/find は listFiles/readFile で足りない場合だけ使う。',
    '- runTerminal は通常コマンドを自動実行する。削除・sudo・git push などの危険操作はMac側でブロックされる。',
    '- cwd を指定できる作業では、対象リポジトリまたはフォルダの絶対パスを必ず cwd に入れる。',
    '- OpenCodeが利用可能な場合、コードベース調査や実装案の下請けには runOpenCode を使える。失敗したら listFiles/readFile/runTerminal で自力継続する。',
    '- 存在しない一般パスを前提にしない。Google Drive は runner が検出した候補パスを優先する。',
    '',
    online
      ? [
        `## 接続状態\n現在このユーザーの常駐エージェントは**オンライン**です (OS: ${osLabel})。Mac経由ツールは即時実行できます。`,
        `- runTerminal でシェルコマンドを生成するときは、必ずこのOS (${osLabel}) に合った構文・コマンドを使ってください。例: Windows なら PowerShell/cmd、macOS・Linux なら sh/bash。パス区切りや改行コードもOSに合わせること。`,
        ...runnerHints,
      ].join('\n')
      : '## 接続状態\n現在このユーザーの常駐エージェントは**オフライン（または未接続）**です。Mac経由ツール (ターミナル/ブラウザ/ファイル) は実行できません。これらが必要な作業を頼まれたら、エージェントを起動して接続するよう案内するか、scheduleTask で予約実行を提案してください。サーバー直実行ツールと scheduleTask は通常どおり使えます。',
  ].join('\n')
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const { messages, spaceId } = body as { messages?: UIMessage[]; spaceId?: string | null }

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'messages is required' }, { status: 400 })
    }

    const { model } = getAgentModel()
    const { tools, runner } = await buildAgentTools(user.id, spaceId ?? null)
    const modelMessages = await convertToModelMessages(messages)

    const result = streamText({
      model,
      system: buildSystemPrompt(runner),
      messages: modelMessages,
      tools,
      stopWhen: stepCountIs(12),
    })

    return result.toUIMessageStreamResponse()
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'agent request failed' },
      { status: 500 },
    )
  }
}
