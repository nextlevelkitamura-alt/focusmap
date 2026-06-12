import {
  convertToModelMessages,
  generateText,
  stepCountIs,
  type UIMessage,
} from 'ai'
import { createClient } from '@/utils/supabase/server'
import { getAgentModel, getAgentVisionModel } from '@/lib/ai/providers'
import { buildAgentTools } from '@/lib/ai/agent-tools'
import { sanitizeUIMessagesForModel } from '@/lib/ai/ui-message-sanitize'
import { summarizeProjectTasks } from '@/lib/ai/context/task-summarizer'
import {
  buildCalendarPreferenceInstructions,
  parseAgentCalendarPreferences,
  type AgentCalendarPreferences,
} from '@/lib/ai/agent-preferences'
import type { OnlineRunner } from '@/lib/ai/remote-tools'
import { withoutAgentProgressMessages } from '@/lib/ai/agent-chat-progress'

export type AgentChatMode = 'general' | 'project'

interface ProjectChatContext {
  projectId: string
  text: string
}

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

function buildSystemPrompt(
  runner: OnlineRunner | null,
  {
    chatMode,
    projectContext,
    calendarPreferences,
  }: {
    chatMode: AgentChatMode
    projectContext?: ProjectChatContext | null
    calendarPreferences: AgentCalendarPreferences
  },
): string {
  const online = runner !== null
  const osLabel = online ? describeOs(runner.os) : null
  const runnerHints = online ? formatRunnerHints(runner) : []
  const calendarPreferenceInstructions = buildCalendarPreferenceInstructions(calendarPreferences)
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
    '- DBやカレンダーの内容を推測で答えない。必要なら listProjects / getProjectContext / listProjectTasks / listNotesForOrganization / listCalendarEvents / findCalendarOpenSlots を使って実データを確認する。',
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
        '- プロジェクト固有の前提が必要な場合は、まず会話中のプロジェクト名・別名・リポジトリ名を手がかりに listProjects({ query }) で探す。',
        '- listProjects の resolved_project が返った場合、または強い一致候補が1件だけの場合は、ユーザーに「どのプロジェクトですか」と聞かず、その projectId で getProjectContext を呼んで読む。',
        '- 「Focusmap」「Focus map」「フォーカスマップ」「フォークスマップ」は同じプロジェクト名の別表記として扱う。該当プロジェクトが1件に絞れるなら必ず読み込んでから返答する。',
        '- 複数候補が同程度に強い場合、または候補が見つからない場合だけ、対象確認をする。',
        '- AGENTS.md が無い素のチャットに近い状態として、現在の会話内容と明示された依頼を優先する。',
      ].join('\n'),
    '',
    '## ツールの種類',
    '- Focusmap DB確認/記録 (常に使える): listProjects / getProjectContext / saveProjectContext / updateProject / listProjectTasks / listNotesForOrganization / getNoteOrganizationDetail',
    '- マインドマップDB操作 (常に使える): getMindmapOverview / getMindmapNodeDetail / updateMindmapNode / moveMindmapNode / updateMindmapMemoLink',
    '- タスク・マップ作成/削除 (常に使える): addTask / addMindmapGroup / addMindmapTask / deleteMindmapNode',
    '- 予定操作 (常に使える): listCalendarEvents / findCalendarOpenSlots / checkCalendarAvailability / addCalendarEvent / updateCalendarEvent',
    '- 予約実行 (常に使える): scheduleTask — 時間指定や繰り返し、またはMacがオフラインのときにサーバー側でタスクを予約実行する。',
    '- Mac経由 (ターミナル/ブラウザ/ファイル): runTerminal / listFiles / readFile / writeFile / runOpenCode / browserNavigate / browserClick / browserFill / browserScreenshot / webResearch',
    '',
    '## Focusmap DB / プロジェクト運用',
    '- 「プロジェクトについて話す」「概要を見て」「今の状況を確認して」「壁打ちして」は、まず listProjects で候補を探し、対象が分かれば getProjectContext で概要・蓄積コンテキスト・最近のタスクを確認する。一意に解決できた対象を再確認するだけの質問は禁止。',
    '- プロジェクトを読んだ後は、読んだ概要・現状・タスク/マップの要点を短く共有し、「この前提で何を整理するか」を聞く。',
    '- 「記録して」「概要を更新して」は saveProjectContext を使う。projects.description は安定した概要、project_contexts.details はAGENTS.md風の読みやすい背景メモ、project_contexts.progress は現在地・次の論点・ブロッカーの状況メモとして使う。プロジェクト名・状態・リポジトリなどプロジェクト本体を変更する時は updateProject を使う。',
    '- project_contexts.details を更新する時は、必要に応じて `## 目的`、`## 判断基準`、`## 重要制約`、`## 最近の決定` のような小見出しで整理する。project_contexts.progress は `## 現在地`、`## 次の論点`、`## ブロッカー` のように、マインドマップ整理に使いやすい現在状況を残す。',
    '- 「マインドマップを見て」は getMindmapOverview を使い、個別ノードの親子・子孫・紐づき詳細は getMindmapNodeDetail を使う。',
    '- 「ノードを変更して」は updateMindmapNode、「このノードをここへ移して」は moveMindmapNode、「このメモの紐づきをこのノードへ変えて」は updateMindmapMemoLink を使う。',
    '- 「マインドマップを整理して」は、getMindmapOverview でノード構造と進捗を見てから listNotesForOrganization で未整理メモの見出しと詳細冒頭30文字を確認する。必要な候補だけ詳細を読み、整理する。',
    '- 「DBを確認して」は、Focusmapの許可されたDBツールで projects / project_contexts / tasks / memo_node_links / memo_items / calendar_events 相当を確認する意味として扱う。任意SQLや秘密情報の取得はしない。',
    '',
    '## 予定操作',
    calendarPreferenceInstructions,
    '- 「どこが空いてる」「予定を入れる候補を出して」は findCalendarOpenSlots で複数日の空き枠を取得する。候補を示し、ユーザーが選んだら checkCalendarAvailability で直前確認してから addCalendarEvent で作成する。',
    '- 「既存の予定の見出し/内容/時間/カレンダーを変更して」は、まず listCalendarEvents で対象候補、現在の google_event_id / calendar_id、available_calendars の移動先IDを確認してから updateCalendarEvent を使う。',
    '- addCalendarEvent が成功した直後は、作成完了に続けて「もしよければ、この予定の詳細も予定詳細に記載できます。内容を入れますか？」と確認する。ユーザーが詳細本文を返したら、直近の予定の googleEventId / calendarId を使って updateCalendarEvent の description へ保存する。直近IDが不明なら listCalendarEvents で対象を特定してから更新する。',
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

export function agentMessagesHaveImage(messages: UIMessage[]): boolean {
  return messages.some(message =>
    message.parts.some(part =>
      part.type === 'file' &&
      typeof part.mediaType === 'string' &&
      part.mediaType.toLowerCase().startsWith('image/'),
    ),
  )
}

export function friendlyAgentError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/maximum context length|reduce the length of the messages|context/i.test(message)) {
    return '履歴内の画像・スクリーンショットが大きすぎたため応答を作れませんでした。履歴を軽量化して再送してください。'
  }
  if (/timeout|aborted|network/i.test(message)) {
    return '応答がタイムアウトしました。入力欄は使えます。もう一度送るか、重い作業は予約実行にしてください。'
  }
  return message || 'AI応答の生成に失敗しました。'
}

export async function generateAgentChatReply({
  userId,
  messages,
  spaceId,
  projectId,
  chatMode,
  onToolCallStart,
  onToolCallFinish,
}: {
  userId: string
  messages: UIMessage[]
  spaceId: string | null
  projectId: string | null
  chatMode: AgentChatMode
  onToolCallStart?: NonNullable<Parameters<typeof generateText>[0]['experimental_onToolCallStart']>
  onToolCallFinish?: NonNullable<Parameters<typeof generateText>[0]['experimental_onToolCallFinish']>
}) {
  const supabase = await createClient()
  const modelInputMessages = sanitizeUIMessagesForModel(withoutAgentProgressMessages(messages))
  const usesVision = agentMessagesHaveImage(modelInputMessages)
  const { model } = usesVision ? getAgentVisionModel() : getAgentModel()
  const { tools, runner } = await buildAgentTools(userId, spaceId)
  const { data: userContext } = await supabase
    .from('ai_user_context')
    .select('preferences')
    .eq('user_id', userId)
    .maybeSingle()
  const calendarPreferences = parseAgentCalendarPreferences(userContext?.preferences)
  const projectContext = chatMode === 'project' && projectId
    ? await loadProjectChatContext({
      supabase,
      userId,
      projectId,
      spaceId,
    })
    : null

  if (chatMode === 'project' && projectId && !projectContext) {
    throw new Error('project not found')
  }

  const modelMessages = await convertToModelMessages(modelInputMessages, {
    tools,
    ignoreIncompleteToolCalls: true,
  })

  return generateText({
    model,
    system: buildSystemPrompt(runner, {
      chatMode: projectContext ? 'project' : 'general',
      projectContext,
      calendarPreferences,
    }),
    messages: modelMessages,
    tools,
    stopWhen: stepCountIs(12),
    timeout: { totalMs: 300_000 },
    experimental_onToolCallStart: onToolCallStart,
    experimental_onToolCallFinish: onToolCallFinish,
  })
}
