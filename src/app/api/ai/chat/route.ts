import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  action?: {
    type: string
    params: Record<string, unknown>
    description: string
  }
}

interface UiControlOption {
  label: string
  value: string
}

interface UiControl {
  type: 'select' | 'text'
  key: 'scheduleWindow' | 'duration' | 'calendarId' | 'freeText'
  label: string
  required?: boolean
  options?: UiControlOption[]
  placeholder?: string
  allowCustom?: boolean
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
  | 'fill_required_slots'
  | 'propose_slots'
  | 'resolve_conflict'
  | 'confirm_and_execute'

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
        planner?: {
          mode?: 'task_planner'
          draftPlan?: {
            scheduleWindow?: 'today' | 'within_3_days' | 'this_week' | 'this_month'
            durationMinutes?: number
            durationText?: string
            calendarId?: string
          }
        }
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
    let calendarOptions: UiControlOption[] = []
    if (calendarSettings?.is_sync_enabled) {
      const { data: userCalendars } = await supabase
        .from('user_calendars')
        .select('google_calendar_id, name, is_primary')
        .eq('user_id', user.id)
        .order('is_primary', { ascending: false })

      if (userCalendars && userCalendars.length > 0) {
        calendarsContext = userCalendars.map(c =>
          `- ${c.name} (ID: ${c.google_calendar_id})${c.is_primary ? ' [デフォルト]' : ''}`
        ).join('\n')
        calendarOptions = userCalendars.map(c => ({
          label: c.name,
          value: c.google_calendar_id,
        }))
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

## 対話のルール（重要）
- **必ず1つずつ確認しながら進める**。いきなりアクションを実行しない
- 情報が足りない場合は選択肢付きで質問する
- 例: 「マップに追加して」→ まずプロジェクトを聞く → 次に追加場所を聞く → 最後に実行
- 削除操作は実行不可。「削除はメモ画面から行ってください」と案内する
- 曖昧な指示は質問して明確にする。その際、選択肢ブロックで候補を提示する
- 簡潔に応答する（3文以内）
- 日本語で応答する

## タスク追加プランナー（重要）
- ユーザーが予定追加したい意図の場合、以下の必須情報を埋める:
  1) 追加時期: 今日 / 3日以内 / 今週 / 今月
  2) 所要時間: 5分 / 15分 / 30分 / 1時間 / 2時間（必要なら自由入力）
  3) カレンダー: どのカレンダーに入れるか
- 足りない情報があるときは、説明だけで終わらせずに \`ui_controls\` を返す
- 情報が揃ったら、具体的な候補時間を2〜3件提案し \`proposal_cards\` を返す
- 候補が作れない場合は、\`resolve_conflict\` にして代替案（ずらす/別日/分割/見送り）を案内する

## planner_state の指定方法
応答末尾に以下を含める:
\`\`\`planner_state
"capture_intent" | "fill_required_slots" | "propose_slots" | "resolve_conflict" | "confirm_and_execute"
\`\`\`

## UIコントロールの指定方法
追加情報が必要なとき:
\`\`\`ui_controls
[
  {"type":"select","key":"scheduleWindow","label":"いつ入れますか？","required":true,"options":[{"label":"今日","value":"today"},{"label":"3日以内","value":"within_3_days"},{"label":"今週","value":"this_week"},{"label":"今月","value":"this_month"}]},
  {"type":"select","key":"duration","label":"所要時間","required":true,"allowCustom":true,"options":[{"label":"5分","value":"5"},{"label":"15分","value":"15"},{"label":"30分","value":"30"},{"label":"1時間","value":"60"},{"label":"2時間","value":"120"}]},
  {"type":"select","key":"calendarId","label":"カレンダー","required":true,"options":[{"label":"Work","value":"work_calendar_id"}]}
]
\`\`\`

## 候補カードの指定方法
候補時間を提示する際:
\`\`\`proposal_cards
[
  {"id":"p1","title":"請求書処理","startAt":"2026-02-26T19:00:00+09:00","endAt":"2026-02-26T19:30:00+09:00","calendarId":"xxx","reason":"締切が近く30分で実施可能","value":"木曜19:00で追加して"},
  {"id":"p2","title":"請求書処理","startAt":"2026-02-27T08:00:00+09:00","endAt":"2026-02-27T08:30:00+09:00","calendarId":"xxx","reason":"朝の空き時間を活用","value":"金曜8:00で追加して"}
]
\`\`\`

## 選択肢の指定方法
ユーザーに選択を求める場合、応答の最後に以下のJSONブロックを含める:
\`\`\`options
[{"label": "表示テキスト", "value": "選択時に送信される値"}, ...]
\`\`\`
- 最大4つまで
- プロジェクトやタスクを選ぶ場合は、コンテキストの一覧から候補を出す
- 日時を選ぶ場合は、具体的な候補日時を出す

例:
ユーザー: 「マップに追加して」
AI: どのプロジェクトに追加しますか？
\`\`\`options
[{"label": "プロジェクトA", "value": "プロジェクトAに追加して"}, {"label": "プロジェクトB", "value": "プロジェクトBに追加して"}]
\`\`\`

## アクション指定方法
すべての確認が完了して実行する段階で、応答の最後に以下のJSONブロックを含める:
\`\`\`action
{"type": "アクション名", "params": {パラメータ}, "description": "確認用の説明"}
\`\`\`
注意: actionブロックとoptionsブロックは同時に使わない。どちらか一方のみ。

アクション名と必要なパラメータ:
- add_task: {"title": "タスク名", "project_id": "プロジェクトID(任意)", "parent_task_id": "親タスクID(任意)"}
- add_calendar_event: {"title": "予定名", "scheduled_at": "ISO8601日時(JST)", "estimated_time": 分数, "calendar_id": "カレンダーID(任意)", "project_id": "プロジェクトID(任意)"}
- edit_memo: {"note_id": "メモID", "content": "新しい内容"}
- link_project: {"note_id": "メモID", "project_id": "プロジェクトID"}
- archive_memo: {"note_id": "メモID"}
- update_priority: {"task_id": "タスクID", "priority": 1-4}
- set_deadline: {"task_id": "タスクID", "scheduled_at": "ISO8601日時", "estimated_time": 分数}

## カレンダー予定追加の対話フロー（重要）
ユーザーが予定を追加したい場合、**足りない情報だけを聞く**。すでに分かっている情報は確認不要。

必要な情報:
1. 予定名（何をするか）
2. 日時（いつ）
3. 所要時間（どのくらい）

### パターン別の対応:

**A. 情報が十分な場合**（例:「明日10時に会議を1時間」）
→ 即座に最終確認。actionブロックを出力してOK。
「📅 2/22(土) 10:00〜11:00 会議 をカレンダーに登録します」

**B. 一部不足の場合**（例:「明日会議」→ 時間が不明）
→ 不足分だけoptionsで聞く。
「何時からですか？」+ options: 9:00, 10:00, 13:00, 14:00

**C. 曖昧な場合**（例:「予定を入れて」→ 全部不明）
→ まず「どんな予定ですか？」から聞く

### 所要時間のデフォルト:
- 会議・ミーティング: 1時間
- ランチ・食事: 1時間
- 旅行・外出: 終日(480分)
- その他: 1時間
- ユーザーが時間を言わなかった場合、デフォルトを適用して最終確認に進んでOK

### 最終確認時のルール:
- 要約を表示: 「📅 M/D(曜) HH:MM〜HH:MM タイトル をカレンダーに登録します」
- scheduled_atはISO8601 JST形式（例: 2026-02-22T10:00:00+09:00）
- 「明日」「来週」等は具体的な日付に変換して表示する
${calendarsContext ? `- カレンダーが複数ある場合、optionsでどのカレンダーか聞く` : ''}

## コンテキスト
今日の日付: ${new Date().toISOString().split('T')[0]}
現在時刻: ${new Date().toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' })}
タイムゾーン: Asia/Tokyo
${calendarSettings?.is_sync_enabled ? `Googleカレンダー連携: 有効\nデフォルトカレンダーID: ${calendarSettings.default_calendar_id || 'primary'}${calendarsContext ? '\n利用可能なカレンダー:\n' + calendarsContext : ''}` : 'Googleカレンダー連携: 未設定'}

ユーザーのプロジェクト一覧:
${projectsContext || '(プロジェクトなし)'}
${activeNoteContent}`

    const plannerContext = context.planner
    const prompt = `${historyContext ? `## 会話履歴\n${historyContext}\n\n` : ''}${plannerContext ? `## プランナーコンテキスト\n${JSON.stringify(plannerContext)}\n\n` : ''}ユーザー: ${message.trim()}`

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
            maxOutputTokens: 800,
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

    // planner_state ブロックを抽出
    const plannerStateBlock = extractJsonBlock(replyText, 'planner_state')
    let plannerState: PlannerState | undefined
    if (typeof plannerStateBlock.value === 'string') {
      const allowedStates: PlannerState[] = [
        'capture_intent',
        'fill_required_slots',
        'propose_slots',
        'resolve_conflict',
        'confirm_and_execute',
      ]
      if (allowedStates.includes(plannerStateBlock.value as PlannerState)) {
        plannerState = plannerStateBlock.value as PlannerState
      }
    }
    replyText = plannerStateBlock.text

    // UIコントロールブロックを抽出
    const uiControlsBlock = extractJsonBlock(replyText, 'ui_controls')
    let uiControls: UiControl[] | undefined
    if (Array.isArray(uiControlsBlock.value)) {
      uiControls = uiControlsBlock.value.filter(Boolean).slice(0, 4) as UiControl[]
    }
    replyText = uiControlsBlock.text

    // 候補カードブロックを抽出
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

    // プランナーモード時のフォールバック（選択UIが欠落した場合）
    const shouldAddFallbackControls =
      context.planner?.mode === 'task_planner' &&
      rallyCount >= 1 &&
      !action &&
      (!options || options.length === 0) &&
      (!uiControls || uiControls.length === 0) &&
      (!proposalCards || proposalCards.length === 0)

    if (shouldAddFallbackControls) {
      plannerState = plannerState || 'fill_required_slots'
      uiControls = [
        {
          type: 'select',
          key: 'scheduleWindow',
          label: 'いつ入れますか？',
          required: true,
          options: [
            { label: '今日', value: 'today' },
            { label: '3日以内', value: 'within_3_days' },
            { label: '今週', value: 'this_week' },
            { label: '今月', value: 'this_month' },
          ],
        },
        {
          type: 'select',
          key: 'duration',
          label: '所要時間',
          required: true,
          allowCustom: true,
          options: [
            { label: '5分', value: '5' },
            { label: '15分', value: '15' },
            { label: '30分', value: '30' },
            { label: '1時間', value: '60' },
            { label: '2時間', value: '120' },
          ],
        },
        {
          type: 'select',
          key: 'calendarId',
          label: 'カレンダー',
          required: true,
          options: calendarOptions.length > 0
            ? calendarOptions
            : [{ label: 'デフォルトカレンダー', value: 'primary' }],
        },
        {
          type: 'text',
          key: 'freeText',
          label: '補足（任意）',
          placeholder: '例: 17時ごろ、先方都合で前後可',
        },
      ]
      if (!replyText.trim()) {
        replyText = '不足情報を選択してください。必要なら自由入力で補足できます。'
      }
    }

    return NextResponse.json({
      reply: replyText,
      action,
      options,
      plannerState,
      uiControls,
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
