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
import { getAgentModel, getAgentVisionModel } from '@/lib/ai/providers'
import { buildAgentTools } from '@/lib/ai/agent-tools'
import { sanitizeUIMessagesForModel } from '@/lib/ai/ui-message-sanitize'
import { summarizeProjectTasks } from '@/lib/ai/context/task-summarizer'
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

function formatTokyoNow(): string {
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date())
}

type AgentChatMode = 'general' | 'project'

interface ProjectChatContext {
  projectId: string
  text: string
}

function buildSystemPrompt(
  runner: OnlineRunner | null,
  {
    chatMode,
    projectContext,
  }: {
    chatMode: AgentChatMode
    projectContext?: ProjectChatContext | null
  },
): string {
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
    '- 画像が添付されている場合は、画像の内容を実際に確認してから答える。',
    `- 現在日時は ${formatTokyoNow()}（Asia/Tokyo）として扱う。今日/明日/来週などの相対日時は必ずこの日時を基準にISO 8601へ変換してからツールへ渡す。`,
    '',
    '## Codex風の実行モデル',
    '- あなたは「会話だけのAI」ではなく、必要な道具を選んで実行するエージェントです。できる作業は、回答だけで済ませずツールで確認・記録・実行する。',
    '- 低リスクな確認・作成・更新は自律的に進める。取り返しがつきにくい削除、大量変更、外部公開、送信、課金、権限変更、秘密情報の表示や保存は、実行前にユーザーへ確認する。',
    '- DBやカレンダーの内容を推測で答えない。必要なら listProjects / getProjectContext / listProjectTasks / listCalendarEvents を使って実データを確認する。',
    '- ツール結果にない事実は「未確認」として扱う。実行できなかった時は、どの接続や権限が不足しているかを短く伝える。',
    '- Mac経由のターミナル・ブラウザ・ファイル操作は広い権限を持つが、常駐エージェント側の安全ブロックと許可ルートに従う。ブロックされたら迂回せず、より安全な方法を提案する。',
    '',
    '## チャットスコープ',
    chatMode === 'project' && projectContext
      ? [
        '- これはプロジェクトチャットです。下のプロジェクト文脈を最初から読み込んだ前提で会話する。',
        '- ユーザーが明示的に別対象を指定しない限り、このプロジェクトについて話していると解釈する。',
        '- タスク・マップ・予定を作る場合は、原則としてこのプロジェクトIDを使う。',
        projectContext.text,
      ].join('\n')
      : [
        '- これは通常チャットです。全スペース/全プロジェクトの情報へアクセスできますが、最初から特定プロジェクトの文脈を読み込まない。',
        '- プロジェクト固有の前提が必要な場合だけ、ユーザーに対象を確認するか、必要な情報をツールで取得する。',
        '- AGENTS.md が無い素のチャットに近い状態として、現在の会話内容と明示された依頼を優先する。',
      ].join('\n'),
    '',
    '## ツールの種類',
    '- Focusmap DB確認/記録 (常に使える): listProjects / getProjectContext / saveProjectContext / listProjectTasks',
    '- タスク・マップ操作 (常に使える): addTask / addMindmapGroup / addMindmapTask / deleteMindmapNode',
    '- 予定操作 (常に使える): listCalendarEvents / checkCalendarAvailability / addCalendarEvent / updateCalendarEvent',
    '- 予約実行 (常に使える): scheduleTask — 時間指定や繰り返し、またはMacがオフラインのときにサーバー側でタスクを予約実行する。',
    '- Mac経由 (ターミナル/ブラウザ/ファイル): runTerminal / listFiles / readFile / writeFile / runOpenCode / browserNavigate / browserClick / browserFill / browserScreenshot / webResearch',
    '',
    '## Focusmap DB / プロジェクト運用',
    '- 「プロジェクトについて話す」「概要を見て」「今の状況を確認して」は、対象が曖昧なら listProjects で候補を探し、対象が分かれば getProjectContext で概要・蓄積コンテキスト・最近のタスクを確認する。',
    '- 「記録して」「概要を更新して」「この進捗を残して」は saveProjectContext を使う。通常チャットで対象プロジェクトが曖昧なら、勝手に別プロジェクトへ記録せず確認する。',
    '- 「DBを確認して」は、Focusmapの許可されたDBツールで projects / project_contexts / tasks / calendar_events 相当を確認する意味として扱う。任意SQLや秘密情報の取得はしない。',
    '',
    '## 予定操作',
    '- 「予定をこの時間に入れるのはどうかな」は checkCalendarAvailability で衝突確認してから、必要なら addCalendarEvent で作成する。',
    '- 「既存の予定の見出し/内容/時間を変更して」は、まず listCalendarEvents で対象候補を確認し、google_event_id と calendar_id を特定してから updateCalendarEvent を使う。',
    '- 対象候補が複数ある予定変更は、誤更新を避けるためユーザーへどれを変更するか確認する。',
    '',
    '## 仕事リポ・求人運用',
    '- ユーザーが「仕事リポ」「求人更新」「求人立案」「求人採用」「求人を作って/直して/巡回して」と依頼したら、対象指定がない限り `/Users/kitamuranaohiro/Private/仕事` を仕事リポ候補として扱う。',
    '- まず listFiles で `/Users/kitamuranaohiro/Private/仕事`、必要に応じて `/Users/kitamuranaohiro/Private/仕事/scripts/job-update` と `/Users/kitamuranaohiro/Private/仕事/scripts/job-create` を確認する。',
    '- すぐ実行する依頼なら runTerminal または runOpenCode を cwd `/Users/kitamuranaohiro/Private/仕事` で使う。定期実行の依頼なら scheduleTask に cwd と skillId を渡して予約する。',
    '- 求人更新は skillId `job-update` を優先する。求人立案は cwd `/Users/kitamuranaohiro/Private/仕事` と、リポ内の job-create/job-update 関連資料を確認したうえで進める。',
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

async function loadProjectChatContext({
  supabase,
  userId,
  projectId,
  spaceId,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>
  userId: string
  projectId: string
  spaceId: string | null
}): Promise<ProjectChatContext | null> {
  let projectQuery = supabase
    .from('projects')
    .select('id, title, description, status, repo_path, space_id')
    .eq('id', projectId)
    .eq('user_id', userId)

  if (spaceId) projectQuery = projectQuery.eq('space_id', spaceId)

  const { data: project, error: projectError } = await projectQuery.maybeSingle()
  if (projectError) throw projectError
  if (!project) return null

  const { data: context } = await supabase
    .from('project_contexts')
    .select('heading, details, progress')
    .eq('user_id', userId)
    .eq('project_id', projectId)
    .maybeSingle()

  const taskSummary = await summarizeProjectTasks(supabase, userId, projectId)
  const contextLines = [
    `## 現在のプロジェクト`,
    `- project_id: ${project.id}`,
    `- 名前: ${project.title ?? '無題'}`,
    `- 状態: ${project.status ?? '不明'}`,
    project.repo_path ? `- リポジトリ: ${project.repo_path}` : '',
    project.description ? `\n### プロジェクト説明\n${project.description}` : '',
    context?.heading || context?.details || context?.progress
      ? [
        '\n### 蓄積コンテキスト',
        context.heading ? `見出し: ${context.heading}` : '',
        context.details ? `詳細: ${context.details}` : '',
        context.progress ? `進捗: ${context.progress}` : '',
      ].filter(Boolean).join('\n')
      : '',
    taskSummary ? `\n${taskSummary}` : '',
  ].filter(Boolean)

  return {
    projectId: project.id,
    text: contextLines.join('\n'),
  }
}

function hasImagePart(messages: UIMessage[]): boolean {
  return messages.some(message =>
    message.parts.some(part =>
      part.type === 'file' &&
      typeof part.mediaType === 'string' &&
      part.mediaType.toLowerCase().startsWith('image/'),
    ),
  )
}

function friendlyAgentError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/maximum context length|reduce the length of the messages|context/i.test(message)) {
    return '履歴内の画像・スクリーンショットが大きすぎたため応答を作れませんでした。履歴を軽量化して再送してください。'
  }
  if (/timeout|aborted|network/i.test(message)) {
    return '応答がタイムアウトしました。入力欄は使えます。もう一度送るか、重い作業は予約実行にしてください。'
  }
  return message || 'AI応答の生成に失敗しました。'
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const { messages, spaceId, projectId, chatMode } = body as {
      messages?: UIMessage[]
      spaceId?: string | null
      projectId?: string | null
      chatMode?: AgentChatMode
    }

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'messages is required' }, { status: 400 })
    }
    if (chatMode === 'project' && !projectId) {
      return NextResponse.json({ error: 'projectId is required for project chat' }, { status: 400 })
    }

    const modelInputMessages = sanitizeUIMessagesForModel(messages)
    const usesVision = hasImagePart(modelInputMessages)
    const { model } = usesVision ? getAgentVisionModel() : getAgentModel()
    const { tools, runner } = await buildAgentTools(user.id, spaceId ?? null)
    const projectContext = chatMode === 'project' && projectId
      ? await loadProjectChatContext({
        supabase,
        userId: user.id,
        projectId,
        spaceId: spaceId ?? null,
      })
      : null

    if (chatMode === 'project' && projectId && !projectContext) {
      return NextResponse.json({ error: 'project not found' }, { status: 404 })
    }

    const modelMessages = await convertToModelMessages(modelInputMessages, {
      tools,
      ignoreIncompleteToolCalls: true,
    })

    const result = streamText({
      model,
      system: buildSystemPrompt(runner, {
        chatMode: projectContext ? 'project' : 'general',
        projectContext,
      }),
      messages: modelMessages,
      tools,
      stopWhen: stepCountIs(12),
      timeout: { totalMs: 300_000 },
      onError: ({ error }) => {
        console.error('[ai/agent] stream error:', error)
      },
    })

    return result.toUIMessageStreamResponse({
      onError: friendlyAgentError,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'agent request failed' },
      { status: 500 },
    )
  }
}
