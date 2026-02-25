import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { getFreeTimeContext } from '@/lib/free-time-context'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  action?: {
    type: string
    params: Record<string, unknown>
    description: string
  }
}

interface BestProposal {
  title: string
  startAt: string
  endAt: string
  calendarId: string
  duration: number
  reason: string
}

interface ProposalCard {
  id: string
  title: string
  startAt: string
  endAt: string
  calendarId: string
  reason: string
  impact?: string
  value?: string
}

type PlannerState =
  | 'capture_intent'
  | 'propose'
  | 'resolve_conflict'
  | 'confirm_and_execute'

// スケジューリング意図を検出するキーワード
const SCHEDULING_KEYWORDS = ['予定', 'カレンダー', '入れて', 'スケジュール', '会議', 'ミーティング', 'ランチ', '追加して', '登録', '予約']

// POST /api/ai/chat - AIチャット対話
export async function POST(request: Request) {
  try {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'AI service not configured' }, { status: 503 })
    }

    const body = await request.json()
    const { message, history = [], context = {} } = body as {
      message: string
      history: ChatMessage[]
      context: {
        activeNoteId?: string
        activeProjectId?: string
      }
    }

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 })
    }

    // 7ラリー制限チェック
    const rallyCount = history.filter(m => m.role === 'user').length
    if (rallyCount >= 7) {
      return NextResponse.json({
        reply: '会話が長くなりました。リセットして新しい会話を始めましょう。',
        shouldReset: true,
      })
    }

    // ユーザーのプロジェクトとタスクを取得（コンテキスト用）
    const { data: projects } = await supabase
      .from('projects')
      .select('id, title')
      .eq('user_id', user.id)

    const { data: tasks } = await supabase
      .from('tasks')
      .select('id, title, project_id, priority, scheduled_at')
      .eq('user_id', user.id)
      .is('parent_task_id', null)
      .is('deleted_at', null)
      .limit(30)

    // ユーザーのカレンダー設定を取得
    const { data: calendarSettings } = await supabase
      .from('user_calendar_settings')
      .select('is_sync_enabled, default_calendar_id')
      .eq('user_id', user.id)
      .maybeSingle()

    let calendarsContext = ''
    let defaultCalendarId = 'primary'
    let calendarCount = 0
    if (calendarSettings?.is_sync_enabled) {
      const { data: userCalendars } = await supabase
        .from('user_calendars')
        .select('google_calendar_id, name, is_primary')
        .eq('user_id', user.id)
        .order('is_primary', { ascending: false })

      if (userCalendars && userCalendars.length > 0) {
        calendarCount = userCalendars.length
        calendarsContext = userCalendars.map(c =>
          `- ${c.name} (ID: ${c.google_calendar_id})${c.is_primary ? ' [デフォルト]' : ''}`
        ).join('\n')
        defaultCalendarId = calendarSettings.default_calendar_id || userCalendars[0].google_calendar_id || 'primary'
      }
    }

    // スケジューリング意図を検出
    const allMessages = [...history.map(m => m.content), message]
    const isSchedulingIntent = SCHEDULING_KEYWORDS.some(kw =>
      allMessages.some(text => text.includes(kw))
    )

    // スケジューリング意図があり、カレンダー連携済みの場合、空き時間を取得
    let freeTimeContext = ''
    if (isSchedulingIntent && calendarSettings?.is_sync_enabled) {
      const calendarIds = calendarsContext
        .split('\n')
        .map(line => {
          const match = line.match(/ID: ([^)]+)/)
          return match?.[1]
        })
        .filter(Boolean) as string[]

      if (calendarIds.length > 0) {
        try {
          const result = await getFreeTimeContext(user.id, calendarIds, supabase)
          freeTimeContext = result.contextText
        } catch (err) {
          console.error('[chat] Free time fetch failed:', err)
        }
      }
    }

    // アクティブなメモのコンテキスト
    let activeNoteContent = ''
    if (context.activeNoteId) {
      const { data: note } = await supabase
        .from('notes')
        .select('content, project_id')
        .eq('id', context.activeNoteId)
        .eq('user_id', user.id)
        .single()
      if (note) {
        activeNoteContent = `\n現在選択中のメモ: "${note.content}"`
      }
    }

    // プロジェクト一覧を文字列化
    const projectsContext = (projects || []).map(p => {
      const projectTasks = (tasks || []).filter(t => t.project_id === p.id)
      const taskList = projectTasks.map(t => `  - ${t.title}`).join('\n')
      return `- ${p.title} (ID: ${p.id})${taskList ? '\n' + taskList : ''}`
    }).join('\n')

    // 会話履歴を文字列化
    const historyContext = history.map(m =>
      `${m.role === 'user' ? 'ユーザー' : 'AI'}: ${m.content}`
    ).join('\n')

    const systemPrompt = `あなたは「しかみか」のAIアシスタントです。
ユーザーのメモを整理し、タスクや予定の管理を手伝います。

## できること
1. マインドマップにタスクを追加 → action: add_task
2. カレンダーに予定を追加 → action: add_calendar_event
3. メモの編集 → action: edit_memo
4. メモにプロジェクトを紐付け → action: link_project
5. メモを処理済みにする → action: archive_memo
6. タスクの優先度変更 → action: update_priority
7. タスクの締切設定 → action: set_deadline

## 対話の基本ルール
- **推論優先**: 会話の文脈、メモの内容、空き時間データから可能な限り推論する。ユーザーに聞くのは本当に分からない情報だけ
- 削除操作は実行不可。「削除はメモ画面から行ってください」と案内する
- 簡潔に応答する（3文以内）
- 日本語で応答する

## カレンダー予定追加（推論優先モード）
ユーザーが予定を追加したい場合:

### 推論のルール:
1. **予定名**: 会話やメモから推論。不明なら聞く（これだけは必須質問）
2. **日時**: 空き時間データから最適な1枠を自動選択。「明日」「来週」等のヒントがあれば優先
3. **所要時間**: タスク種別から自動推定（会議=60分, ランチ=60分, 作業=60分, 外出=480分）
4. **カレンダー**: ${calendarCount <= 1 ? 'カレンダーは1つなので自動選択する' : '複数カレンダーがある場合のみoptionsで聞く'}

### 応答パターン:

**A. 予定名+日時ヒントがある場合**（例:「明日企画書作成を入れて」）
→ 空き時間データから最適枠を選び、best_proposalブロックを即座に返す

**B. 予定名はあるが日時が曖昧**（例:「企画書作成を入れて」）
→ 空き時間データから最適枠を推論し、best_proposalブロックを返す

**C. 予定名が不明**（例:「予定を入れて」）
→ 「どんな予定ですか？」とだけ聞く（1質問のみ）

### best_proposal ブロック（最適1案の提案）
空き時間データを参照し、最も適切な1枠を選んで以下を返す:
\`\`\`best_proposal
{"title":"予定名","startAt":"2026-02-26T14:00:00+09:00","endAt":"2026-02-26T15:00:00+09:00","calendarId":"${defaultCalendarId}","duration":60,"reason":"明日午後に1時間の空きがあります"}
\`\`\`
- startAt/endAt は必ず ISO8601 JST (+09:00) 形式
- reason に「なぜこの時間を選んだか」を1文で書く
- 空き時間データにある時間のみ提案すること
- best_proposalを返すとき、actionブロックやoptionsブロックは返さない

### ユーザーが提案を承認した場合
「登録して」「OK」「それで」等の承認メッセージが来たら、actionブロックを返す:
\`\`\`action
{"type":"add_calendar_event","params":{"title":"予定名","scheduled_at":"ISO8601+09:00","estimated_time":60,"calendar_id":"${defaultCalendarId}"},"description":"📅 M/D(曜) HH:MM〜HH:MM 予定名 をカレンダーに登録します"}
\`\`\`

### ユーザーが「他の候補」を要求した場合
proposal_cardsブロックで2〜3件の代替案を返す:
\`\`\`proposal_cards
[{"id":"p1","title":"予定名","startAt":"ISO8601","endAt":"ISO8601","calendarId":"xxx","reason":"理由","value":"この時間で登録して"}]
\`\`\`

## マップ追加・その他の操作
- 情報が足りない場合は選択肢付きで質問する
- 例: 「マップに追加して」→ プロジェクトが複数あるならoptionsで聞く

## 選択肢の指定方法
\`\`\`options
[{"label": "表示テキスト", "value": "選択時に送信される値"}, ...]
\`\`\`
- 最大4つまで

## アクション指定方法
\`\`\`action
{"type": "アクション名", "params": {パラメータ}, "description": "確認用の説明"}
\`\`\`
注意: actionブロックとoptionsブロックとbest_proposalブロックは同時に使わない。どれか1つのみ。

アクション名と必要なパラメータ:
- add_task: {"title": "タスク名", "project_id": "プロジェクトID(任意)", "parent_task_id": "親タスクID(任意)"}
- add_calendar_event: {"title": "予定名", "scheduled_at": "ISO8601日時(JST)", "estimated_time": 分数, "calendar_id": "カレンダーID(任意)", "project_id": "プロジェクトID(任意)"}
- edit_memo: {"note_id": "メモID", "content": "新しい内容"}
- link_project: {"note_id": "メモID", "project_id": "プロジェクトID"}
- archive_memo: {"note_id": "メモID"}
- update_priority: {"task_id": "タスクID", "priority": 1-4}
- set_deadline: {"task_id": "タスクID", "scheduled_at": "ISO8601日時", "estimated_time": 分数}

## コンテキスト
今日の日付: ${new Date().toISOString().split('T')[0]}
現在時刻: ${new Date().toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' })}
タイムゾーン: Asia/Tokyo
${calendarSettings?.is_sync_enabled ? `Googleカレンダー連携: 有効\nデフォルトカレンダーID: ${defaultCalendarId}${calendarsContext ? '\n利用可能なカレンダー:\n' + calendarsContext : ''}` : 'Googleカレンダー連携: 未設定'}

ユーザーのプロジェクト一覧:
${projectsContext || '(プロジェクトなし)'}
${activeNoteContent}
${freeTimeContext}`

    const prompt = `${historyContext ? `## 会話履歴\n${historyContext}\n\n` : ''}ユーザー: ${message.trim()}`

    // Gemini API 呼び出し（3.0優先、未対応時は2.5へフォールバック）
    const genAI = new GoogleGenerativeAI(apiKey)
    const preferredModel = (process.env.GEMINI_MODEL || 'gemini-3.0-flash').trim()
    const modelCandidates = Array.from(new Set([preferredModel, 'gemini-2.5-flash'].filter(Boolean)))

    let result: Awaited<ReturnType<ReturnType<typeof genAI.getGenerativeModel>['generateContent']>> | null = null
    let lastModelError: unknown = null

    for (const modelName of modelCandidates) {
      try {
        const model = genAI.getGenerativeModel({ model: modelName })
        result = await model.generateContent({
          contents: [
            { role: 'user', parts: [{ text: systemPrompt + '\n\n' + prompt }] }
          ],
          generationConfig: {
            maxOutputTokens: 1000,
            temperature: 0.7,
          },
        })
        break
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error)
        lastModelError = error
        const isModelUnavailable =
          errMsg.includes('404') ||
          errMsg.toLowerCase().includes('not found') ||
          errMsg.toLowerCase().includes('model')
        if (!isModelUnavailable) {
          throw error
        }
      }
    }

    if (!result) {
      throw lastModelError || new Error('No available Gemini model')
    }

    const responseText = result.response.text()

    const extractJsonBlock = (source: string, blockName: string) => {
      const regex = new RegExp(`\`\`\`${blockName}\\s*\\n([\\s\\S]*?)\\n\`\`\``)
      const match = source.match(regex)
      if (!match) return { value: undefined as unknown, text: source }

      try {
        const value = JSON.parse(match[1])
        return {
          value,
          text: source.replace(regex, '').trim(),
        }
      } catch {
        return { value: undefined as unknown, text: source.replace(regex, '').trim() }
      }
    }

    // アクションブロックを抽出（失敗時も本文から除去）
    const actionBlock = extractJsonBlock(responseText, 'action')
    let action: ChatMessage['action'] | undefined
    let replyText = actionBlock.text
    if (actionBlock.value && typeof actionBlock.value === 'object') {
      action = actionBlock.value as ChatMessage['action']
    }

    // best_proposal ブロックを抽出
    const bestProposalBlock = extractJsonBlock(replyText, 'best_proposal')
    let bestProposal: BestProposal | undefined
    if (bestProposalBlock.value && typeof bestProposalBlock.value === 'object') {
      bestProposal = bestProposalBlock.value as BestProposal
    }
    replyText = bestProposalBlock.text

    // planner_state ブロックを抽出
    const plannerStateBlock = extractJsonBlock(replyText, 'planner_state')
    let plannerState: PlannerState | undefined
    if (typeof plannerStateBlock.value === 'string') {
      const allowedStates: PlannerState[] = [
        'capture_intent',
        'propose',
        'resolve_conflict',
        'confirm_and_execute',
      ]
      if (allowedStates.includes(plannerStateBlock.value as PlannerState)) {
        plannerState = plannerStateBlock.value as PlannerState
      }
    }
    replyText = plannerStateBlock.text

    // 候補カードブロックを抽出（「他の候補」要求時に使用）
    const proposalCardsBlock = extractJsonBlock(replyText, 'proposal_cards')
    let proposalCards: ProposalCard[] | undefined
    if (Array.isArray(proposalCardsBlock.value)) {
      proposalCards = proposalCardsBlock.value.filter(Boolean).slice(0, 3) as ProposalCard[]
    }
    replyText = proposalCardsBlock.text

    // 選択肢ブロックを抽出（失敗時も本文から除去）
    const optionsBlock = extractJsonBlock(replyText, 'options')
    let options: { label: string; value: string }[] | undefined

    if (Array.isArray(optionsBlock.value) && optionsBlock.value.length > 0) {
      options = optionsBlock.value.slice(0, 4)
    }
    replyText = optionsBlock.text

    return NextResponse.json({
      reply: replyText,
      action,
      options,
      plannerState,
      bestProposal,
      proposalCards,
    })
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error'
    console.error('Chat error:', errMsg, error)

    // Google API固有のエラーをユーザーフレンドリーなメッセージに変換
    if (errMsg.includes('API key not valid') || errMsg.includes('API_KEY_INVALID')) {
      return NextResponse.json({ error: 'AI機能が一時的に利用できません' }, { status: 503 })
    }
    if (errMsg.includes('quota') || errMsg.includes('429') || errMsg.includes('RATE_LIMIT')) {
      return NextResponse.json({ error: 'リクエスト上限に達しました。しばらくお待ちください' }, { status: 429 })
    }

    return NextResponse.json({ error: 'AIチャット中にエラーが発生しました' }, { status: 500 })
  }
}
