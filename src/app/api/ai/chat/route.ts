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

## カレンダー予定追加（推論優先モード・最重要ルール）
ユーザーが予定やタスクを追加したい場合、**必ず best_proposal ブロックで1案を提案する**。
proposal_cards は絶対に使わない。best_proposal のみ使うこと。

### 推論のルール:
1. **予定名**: 会話やメモから推論。不明なら聞く（これだけは必須質問）
2. **日時**: 空き時間データがあればそこから最適な1枠を自動選択。なければ直近の一般的な時間を推定
3. **所要時間**: 必ず以下のデフォルトを適用する。ユーザーに聞かない
   - 会議・ミーティング・打ち合わせ: 60分
   - ランチ・食事: 60分
   - 電話・通話: 15分
   - 短い作業（メール返信等）: 15分
   - 一般的な作業・タスク: 60分
   - 外出・旅行: 480分
   - 不明な場合: 60分
4. **カレンダー**: ${calendarCount <= 1 ? 'カレンダーは1つなので自動選択する（ID: ' + defaultCalendarId + '）' : '複数カレンダーがある場合のみoptionsで聞く'}

### 応答パターン:
- 予定名がわかる場合 → **即座にbest_proposalを返す**（他に何も聞かない）
- 予定名が不明 → 「どんな予定ですか？」とだけ聞く（1質問のみ）

### best_proposal ブロック（必須形式）
予定を提案するときは**必ずこの形式のみ**を使う:
\`\`\`best_proposal
{"title":"予定名","startAt":"2026-02-26T14:00:00+09:00","endAt":"2026-02-26T15:00:00+09:00","calendarId":"${defaultCalendarId}","duration":60,"reason":"明日14時〜15時は空いており、作業に最適な時間帯です"}
\`\`\`
**絶対ルール**:
- startAt/endAt は必ず ISO8601 JST (+09:00) 形式
- duration は分数（整数）
- calendarId は必ず実際のカレンダーIDを入れる
- reason は「なぜこの時間を選んだか」を具体的に書く（例: 「午前中の空き時間で集中しやすい」「電話なので15分の隙間に収まる」）
- best_proposalを返すとき、actionブロックやoptionsブロックやproposal_cardsブロックは絶対に返さない
- 空き時間データがない場合でも、常識的な時間帯（9:00-20:00）で推定して提案する

### ユーザーが提案を承認した場合
「登録して」「OK」「それで」等の承認メッセージが来たら、actionブロックを返す:
\`\`\`action
{"type":"add_calendar_event","params":{"title":"予定名","scheduled_at":"ISO8601+09:00","estimated_time":60,"calendar_id":"${defaultCalendarId}"},"description":"📅 M/D(曜) HH:MM〜HH:MM 予定名 をカレンダーに登録します"}
\`\`\`
- estimated_time は分数（必ず含める）
- calendar_id は必ず含める

### ユーザーが「他の候補」「変えたい」等を要求した場合
別の時間帯で新しい best_proposal を返す（proposal_cardsは使わない）

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

    // 候補カードブロックを抽出（AIが旧形式で返した場合のフォールバック）
    const proposalCardsBlock = extractJsonBlock(replyText, 'proposal_cards')
    if (Array.isArray(proposalCardsBlock.value) && proposalCardsBlock.value.length > 0 && !bestProposal) {
      // proposal_cards が返ってきたが best_proposal がない → 最初の1件を bestProposal に変換
      const first = proposalCardsBlock.value[0] as ProposalCard
      if (first.title && first.startAt && first.endAt) {
        const startDate = new Date(first.startAt)
        const endDate = new Date(first.endAt)
        const durationMin = Math.round((endDate.getTime() - startDate.getTime()) / 60000)
        bestProposal = {
          title: first.title,
          startAt: first.startAt,
          endAt: first.endAt,
          calendarId: first.calendarId || defaultCalendarId,
          duration: durationMin > 0 ? durationMin : 60,
          reason: first.reason || '提案された時間帯です',
        }
      }
    }
    replyText = proposalCardsBlock.text

    // 選択肢ブロックを抽出（失敗時も本文から除去）
    const optionsBlock = extractJsonBlock(replyText, 'options')
    let options: { label: string; value: string }[] | undefined

    if (Array.isArray(optionsBlock.value) && optionsBlock.value.length > 0) {
      options = optionsBlock.value.slice(0, 4)
    }
    replyText = optionsBlock.text

    // 残存するJSONコードブロックをクリーンアップ（AIが中途半端なJSONを返した場合）
    replyText = replyText.replace(/```\w*\s*\n[\s\S]*?(\n```|$)/g, '').trim()

    return NextResponse.json({
      reply: replyText,
      action,
      options,
      plannerState,
      bestProposal,
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
