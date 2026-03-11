import { NextRequest } from 'next/server'
import { authenticateApiKey, isAuthError } from '../../_lib/auth'
import { apiSuccess, apiError, handleCors } from '../../_lib/response'
import { createServiceClient } from '@/utils/supabase/service'
import { generateText } from 'ai'
import { getModelForSkill, getConfigForSkill } from '@/lib/ai/providers'
import { getFreeTimeContext } from '@/lib/free-time-context'
import { format } from 'date-fns'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

const MAX_RALLIES = 15
const JST_OFFSET_MS = 9 * 60 * 60 * 1000

function toJstDate(date: Date): Date {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000)
}

function toJstIsoString(date: Date): string {
  const jst = new Date(date.getTime() + JST_OFFSET_MS)
  const year = jst.getUTCFullYear()
  const month = String(jst.getUTCMonth() + 1).padStart(2, '0')
  const day = String(jst.getUTCDate()).padStart(2, '0')
  const hour = String(jst.getUTCHours()).padStart(2, '0')
  const minute = String(jst.getUTCMinutes()).padStart(2, '0')
  return `${year}-${month}-${day}T${hour}:${minute}:00+09:00`
}

function snapToFiveMinutes(date: Date): Date {
  const d = new Date(date)
  d.setSeconds(0, 0)
  d.setMinutes(Math.round(d.getMinutes() / 5) * 5)
  return d
}

function clampDuration(minutes: number): number {
  if (!Number.isFinite(minutes)) return 60
  return Math.max(5, Math.min(720, Math.round(minutes)))
}

function formatOptionDateLabel(startIso: string, durationMin: number): string {
  const start = new Date(startIso)
  const end = new Date(start.getTime() + durationMin * 60 * 1000)
  const dayNames = ['日', '月', '火', '水', '木', '金', '土']
  const day = dayNames[start.getDay()]
  const startHHMM = start.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' })
  const endHHMM = end.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' })
  return `${start.getMonth() + 1}/${start.getDate()}(${day}) ${startHHMM}〜${endHHMM}`
}

// OPTIONS /api/v1/ai/scheduling
export async function OPTIONS() {
  return handleCors()
}

// POST /api/v1/ai/scheduling
export async function POST(request: NextRequest) {
  const auth = await authenticateApiKey(request, 'ai:scheduling')
  if (isAuthError(auth)) return auth

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return apiError('SERVICE_UNAVAILABLE', 'AI service not configured', 503)
  }

  let body: { message?: unknown; history?: unknown }
  try {
    body = await request.json()
  } catch {
    return apiError('BAD_REQUEST', 'Invalid JSON body', 400)
  }

  const { message, history = [] } = body as {
    message: string
    history: ChatMessage[]
  }

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return apiError('BAD_REQUEST', 'message is required', 400)
  }

  const rallyCount = (history as ChatMessage[]).filter((m) => m.role === 'user').length
  if (rallyCount >= MAX_RALLIES) {
    return apiSuccess({
      reply: '会話が長くなりました。リセットして新しい会話を始めましょう。',
      shouldReset: true,
    })
  }

  const serviceClient = createServiceClient()

  // カレンダー設定を取得
  const { data: calendarSettings } = await serviceClient
    .from('user_calendar_settings')
    .select('is_sync_enabled, default_calendar_id')
    .eq('user_id', auth.userId)
    .maybeSingle()

  const calendarConnected = calendarSettings?.is_sync_enabled === true

  if (!calendarConnected) {
    return apiSuccess({
      reply: 'カレンダーと連携するとスケジュール調整ができます。設定画面からGoogleカレンダーを接続してください。',
      shouldReset: false,
    })
  }

  // 利用可能なカレンダー一覧
  const { data: userCalendars } = await serviceClient
    .from('user_calendars')
    .select('google_calendar_id, name, is_primary')
    .eq('user_id', auth.userId)
    .order('is_primary', { ascending: false })

  const calendarIds = (userCalendars || []).map((c) => c.google_calendar_id).filter(Boolean)
  const defaultCalendarId = calendarSettings?.default_calendar_id || calendarIds[0] || 'primary'

  const calendarsContext = (userCalendars || [])
    .map((c) => `- ${c.name} (ID: ${c.google_calendar_id})${c.is_primary ? ' [デフォルト]' : ''}`)
    .join('\n')

  // 空き時間コンテキスト（会話開始時のみ取得）
  let freeTimeContext = ''
  const isFirstMessage = (history as ChatMessage[]).length === 0

  if (isFirstMessage && calendarIds.length > 0) {
    try {
      const result = await getFreeTimeContext(auth.userId, calendarIds, serviceClient)
      freeTimeContext = result.contextText
    } catch (err) {
      console.error('[v1/ai/scheduling] Failed to fetch calendar events:', err)
      freeTimeContext = '\n## 空き時間情報\n（取得に失敗しました。日時を直接お伝えください）'
    }
  } else if (!isFirstMessage) {
    freeTimeContext = '\n（空き時間情報は会話開始時に取得済みです。上の情報を参照してください）'
  }

  // プロジェクト一覧
  const { data: projects } = await serviceClient
    .from('projects')
    .select('id, title')
    .eq('user_id', auth.userId)
    .limit(20)

  const projectsContext = (projects || []).map((p) => `- ${p.title} (ID: ${p.id})`).join('\n')

  // 会話履歴
  const historyContext = (history as ChatMessage[])
    .map((m) => `${m.role === 'user' ? 'ユーザー' : 'AI'}: ${m.content}`)
    .join('\n')

  const nowJst = toJstDate(new Date())
  const todayStr = format(nowJst, 'yyyy-MM-dd')
  const nowTimeStr = format(nowJst, 'HH:mm')
  const days = ['日', '月', '火', '水', '木', '金', '土']
  const todayLabel = `${nowJst.getFullYear()}年${nowJst.getMonth() + 1}月${nowJst.getDate()}日(${days[nowJst.getDay()]})`

  const systemPrompt = `あなたはスケジューリング専門のAIアシスタントです。
ユーザーの予定を、実際のカレンダーの空き時間を確認しながら登録します。

## 会話の進め方（重要）
1. **予定タイトルの把握**：予定名が分からなければ「どんな予定ですか？」と聞く
2. **所要時間の確認**：所要時間が不明なら optionsブロック で選択肢を提示
3. **時間候補の提示**：空き時間データから2〜4候補を slotsブロック で提示
4. **最終確認・登録**：スロット選択後に actionブロック を出力

## slotsブロック（時間候補の提示）
\`\`\`slots
[{"date":"YYYY-MM-DD","startTime":"HH:MM","endTime":"HH:MM","label":"M月D日(曜) HH:MM〜HH:MM","scheduled_at":"YYYY-MM-DDTHH:MM:00+09:00"}]
\`\`\`

## optionsブロック（質問時の選択肢）
\`\`\`options
[{"label": "30分", "value": "30分でお願いします"}, {"label": "1時間", "value": "1時間でお願いします"}]
\`\`\`

## actionブロック（登録確認）
\`\`\`action
{"type": "add_calendar_event", "params": {"title": "予定名", "scheduled_at": "ISO8601+09:00", "estimated_time": 分数, "calendar_id": "カレンダーID"}, "description": "📅 M月D日(曜) HH:MM〜HH:MM 予定名 をカレンダーに登録します"}
\`\`\`

## 返答のルール
- 1回に1つだけ質問する
- 3文以内で簡潔に
- 日本語で返答
- 空き時間データにない時間は提案しない

## コンテキスト
今日: ${todayLabel}（${todayStr}）
現在時刻: ${nowTimeStr}
タイムゾーン: Asia/Tokyo
デフォルトカレンダーID: ${defaultCalendarId}
${calendarsContext ? `利用可能なカレンダー:\n${calendarsContext}` : ''}

ユーザーのプロジェクト一覧:
${projectsContext || '(プロジェクトなし)'}
${freeTimeContext}`

  const prompt = `${historyContext ? `## 会話履歴\n${historyContext}\n\n` : ''}ユーザー: ${message.trim()}`

  try {
    const skillConfig = getConfigForSkill('scheduling')
    const aiResult = await generateText({
      model: getModelForSkill('scheduling'),
      system: systemPrompt,
      prompt,
      maxOutputTokens: skillConfig.maxTokens,
      temperature: skillConfig.temperature,
    })

    const responseText = aiResult.text
    let replyText = responseText

    // actionブロックを抽出
    const actionMatch = replyText.match(/```action\s*\n([\s\S]*?)\n```/)
    let action: { type: string; params: Record<string, unknown>; description: string } | undefined
    if (actionMatch) {
      try {
        action = JSON.parse(actionMatch[1])
        replyText = replyText.replace(/```action\s*\n[\s\S]*?\n```/, '').trim()
      } catch { /* パース失敗時は無視 */ }
    }

    // slotsブロックを抽出
    const slotsMatch = replyText.match(/```slots\s*\n([\s\S]*?)\n```/)
    let slots: Array<{ date: string; startTime: string; endTime: string; label: string; scheduled_at: string }> | undefined
    if (slotsMatch) {
      try {
        const parsed = JSON.parse(slotsMatch[1])
        if (Array.isArray(parsed) && parsed.length > 0) {
          slots = parsed.slice(0, 4)
        }
        replyText = replyText.replace(/```slots\s*\n[\s\S]*?\n```/, '').trim()
      } catch { /* パース失敗時は無視 */ }
    }

    // optionsブロックを抽出
    const optionsMatch = replyText.match(/```options\s*\n([\s\S]*?)\n```/)
    let options: Array<{ label: string; value: string }> | undefined
    if (optionsMatch) {
      try {
        const parsed = JSON.parse(optionsMatch[1])
        if (Array.isArray(parsed) && parsed.length > 0) {
          options = parsed.slice(0, 4)
        }
        replyText = replyText.replace(/```options\s*\n[\s\S]*?\n```/, '').trim()
      } catch { /* パース失敗時は無視 */ }
    }

    // action の calendar_id / scheduled_at を正規化
    if (action?.type === 'add_calendar_event') {
      const params = { ...(action.params || {}) } as Record<string, unknown>
      const rawDuration = typeof params.estimated_time === 'number'
        ? params.estimated_time
        : Number(params.estimated_time)
      params.estimated_time = clampDuration(Number.isFinite(rawDuration) ? rawDuration : 60)

      if (typeof params.scheduled_at === 'string' && !Number.isNaN(new Date(params.scheduled_at).getTime())) {
        params.scheduled_at = toJstIsoString(snapToFiveMinutes(new Date(params.scheduled_at)))
      }

      const validCalendarIds = new Set(calendarIds)
      const rawCalendar = typeof params.calendar_id === 'string' ? params.calendar_id : undefined
      params.calendar_id = (rawCalendar && validCalendarIds.has(rawCalendar))
        ? rawCalendar
        : defaultCalendarId

      if (action.description && typeof params.scheduled_at === 'string' && typeof params.estimated_time === 'number') {
        action.description = `📅 ${formatOptionDateLabel(params.scheduled_at, params.estimated_time)} ${params.title ?? '予定'} を登録します`
      }

      action = { ...action, params }
    }

    return apiSuccess({ reply: replyText, action, slots, options })
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error'
    console.error('[v1/ai/scheduling] error:', errMsg)

    if (errMsg.includes('API key not valid') || errMsg.includes('API_KEY_INVALID')) {
      return apiError('SERVICE_UNAVAILABLE', 'AI設定を確認してください（APIキーエラー）', 503)
    }
    if (errMsg.includes('quota') || errMsg.includes('429') || errMsg.includes('RATE_LIMIT')) {
      return apiError('RATE_LIMITED', 'リクエスト上限に達しました。しばらくお待ちください', 429)
    }

    return apiError('SERVER_ERROR', 'スケジュール調整中にエラーが発生しました', 500)
  }
}
