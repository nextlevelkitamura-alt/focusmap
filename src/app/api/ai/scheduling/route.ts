import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'
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

// UTCのDateをJSTのDateに変換（+9時間）
function toJstDate(date: Date): Date {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000)
}

function clampDuration(minutes: number): number {
  if (!Number.isFinite(minutes)) return 60
  return Math.max(5, Math.min(720, Math.round(minutes)))
}

function extractExplicitDurationMinutes(texts: string[]): number | undefined {
  for (let i = texts.length - 1; i >= 0; i--) {
    const text = texts[i]
    const minuteMatches = [...text.matchAll(/(\d{1,3})\s*分/g)]
    if (minuteMatches.length > 0) {
      const value = Number(minuteMatches[minuteMatches.length - 1][1])
      if (Number.isFinite(value) && value > 0) return clampDuration(value)
    }
    const hourMatches = [...text.matchAll(/(\d{1,2}(?:\.\d+)?)\s*時間/g)]
    if (hourMatches.length > 0) {
      const value = Number(hourMatches[hourMatches.length - 1][1])
      if (Number.isFinite(value) && value > 0) return clampDuration(value * 60)
    }
  }
  return undefined
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

function resolveCalendarIdFromTexts(
  texts: string[],
  calendars: Array<{ google_calendar_id: string; name: string | null }>,
): string | undefined {
  for (let i = texts.length - 1; i >= 0; i--) {
    const latest = texts[i].toLowerCase()
    for (const calendar of calendars) {
      if (!calendar.google_calendar_id || !calendar.name) continue
      if (latest.includes(calendar.name.toLowerCase())) {
        return calendar.google_calendar_id
      }
    }
  }
  return undefined
}

function isValidDateString(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(new Date(value).getTime())
}

function extractConfirmedDurationMinutes(texts: string[]): number | undefined {
  for (let i = texts.length - 1; i >= 0; i--) {
    const match = texts[i].match(/所要時間は(\d{1,3})分/)
    if (!match) continue
    return clampDuration(Number(match[1]))
  }
  return undefined
}

function extractConfirmedStartAt(texts: string[]): string | undefined {
  for (let i = texts.length - 1; i >= 0; i--) {
    const match = texts[i].match(/開始時間は([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\+09:00)/)
    if (!match) continue
    if (isValidDateString(match[1])) return match[1]
  }
  return undefined
}

function extractConfirmedCalendarId(texts: string[], validCalendarIds: Set<string>): string | undefined {
  for (let i = texts.length - 1; i >= 0; i--) {
    const match = texts[i].match(/カレンダーは([^\s]+)/)
    if (!match) continue
    const id = match[1].trim()
    if (validCalendarIds.has(id)) return id
  }
  return undefined
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

function buildStartTimeOptions(baseStart: Date, durationMin: number): Array<{ label: string; value: string }> {
  const offsets = [0, 60, 120, 180]
  const seen = new Set<string>()
  const options: Array<{ label: string; value: string }> = []

  for (const offsetMinutes of offsets) {
    const candidate = snapToFiveMinutes(new Date(baseStart.getTime() + offsetMinutes * 60 * 1000))
    const iso = toJstIsoString(candidate)
    if (seen.has(iso)) continue
    seen.add(iso)
    options.push({
      label: formatOptionDateLabel(iso, durationMin),
      value: `開始時間は${iso}`,
    })
  }

  return options.slice(0, 4)
}

// POST /api/ai/scheduling - スケジューリング特化AIチャット
export async function POST(request: Request) {
  try {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Vercel AI SDK (@ai-sdk/google) は GOOGLE_GENERATIVE_AI_API_KEY を自動で読む
    if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
      return NextResponse.json({ error: 'AI service not configured' }, { status: 503 })
    }

    const body = await request.json()
    const { message, history = [] } = body as {
      message: string
      history: ChatMessage[]
    }

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 })
    }

    // ラリー制限チェック
    const rallyCount = history.filter(m => m.role === 'user').length
    if (rallyCount >= MAX_RALLIES) {
      return NextResponse.json({
        reply: '会話が長くなりました。リセットして新しい会話を始めましょう。',
        shouldReset: true,
      })
    }

    // カレンダー設定を取得
    const { data: calendarSettings } = await supabase
      .from('user_calendar_settings')
      .select('is_sync_enabled, default_calendar_id')
      .eq('user_id', user.id)
      .maybeSingle()

    const calendarConnected = calendarSettings?.is_sync_enabled === true

    // カレンダーが未連携の場合はエラーメッセージ
    if (!calendarConnected) {
      return NextResponse.json({
        reply: 'カレンダーと連携するとスケジュール調整ができます。設定画面からGoogleカレンダーを接続してください。',
        shouldReset: false,
      })
    }

    // 利用可能なカレンダー一覧
    const { data: userCalendars } = await supabase
      .from('user_calendars')
      .select('google_calendar_id, name, is_primary')
      .eq('user_id', user.id)
      .order('is_primary', { ascending: false })

    const calendarIds = (userCalendars || []).map(c => c.google_calendar_id).filter(Boolean)
    const defaultCalendarId = calendarSettings?.default_calendar_id || calendarIds[0] || 'primary'

    const calendarsContext = (userCalendars || []).map(c =>
      `- ${c.name} (ID: ${c.google_calendar_id})${c.is_primary ? ' [デフォルト]' : ''}`
    ).join('\n')

    // 空き時間コンテキスト（会話開始時のみ取得）
    let freeTimeContext = ''
    const isFirstMessage = history.length === 0

    if (isFirstMessage && calendarIds.length > 0) {
      try {
        const result = await getFreeTimeContext(user.id, calendarIds, supabase)
        freeTimeContext = result.contextText
      } catch (err) {
        console.error('[scheduling] Failed to fetch calendar events:', err)
        freeTimeContext = '\n## 空き時間情報\n（取得に失敗しました。日時を直接お伝えください）'
      }
    } else if (!isFirstMessage) {
      freeTimeContext = '\n（空き時間情報は会話開始時に取得済みです。上の情報を参照してください）'
    }

    // プロジェクト一覧
    const { data: projects } = await supabase
      .from('projects')
      .select('id, title')
      .eq('user_id', user.id)
      .limit(20)

    const projectsContext = (projects || []).map(p => `- ${p.title} (ID: ${p.id})`).join('\n')

    // 会話履歴
    const historyContext = history.map(m =>
      `${m.role === 'user' ? 'ユーザー' : 'AI'}: ${m.content}`
    ).join('\n')

    const nowJstForPrompt = toJstDate(new Date())
    const todayStr = format(nowJstForPrompt, 'yyyy-MM-dd')
    const nowTimeStr = format(nowJstForPrompt, 'HH:mm')
    const days = ['日', '月', '火', '水', '木', '金', '土']
    const todayLabel = `${nowJstForPrompt.getFullYear()}年${nowJstForPrompt.getMonth() + 1}月${nowJstForPrompt.getDate()}日(${days[nowJstForPrompt.getDay()]})`

    const systemPrompt = `あなたはスケジューリング専門のAIアシスタントです。
ユーザーの予定を、実際のカレンダーの空き時間を確認しながら登録します。

## 会話の進め方（重要）
1. **予定タイトルの把握**：予定名が分からなければ「どんな予定ですか？」と聞く
2. **所要時間の確認**：所要時間が不明なら optionsブロック で選択肢を提示
   - ユーザーが「5分」「30分」「1時間」など明示した場合は、その時間を最優先する
   - デフォルト: 会議・打ち合わせ=60分, ランチ=60分, 作業=90分
   - 時間が明示されていればデフォルトを適用してスキップ可
3. **時間候補の提示**：空き時間データから2〜4候補を slotsブロック で提示
4. **最終確認・登録**：スロット選択後に actionブロック を出力

## slotsブロック（時間候補の提示）
ユーザーに時間を選ばせる場合は以下の形式で返す：
\`\`\`slots
[{"date":"YYYY-MM-DD","startTime":"HH:MM","endTime":"HH:MM","label":"M月D日(曜) HH:MM〜HH:MM","scheduled_at":"YYYY-MM-DDTHH:MM:00+09:00"}]
\`\`\`
- 2〜4候補、今日・明日を優先して近い順に提示
- 提供された「空き時間データ」にある時間のみ提案すること（存在しない時間は絶対に提案しない）
- slotsブロックと optionsブロック と actionブロック は同時に使わない（どれか1つだけ）

## optionsブロック（質問時の選択肢）
\`\`\`options
[{"label": "30分", "value": "30分でお願いします"}, {"label": "1時間", "value": "1時間でお願いします"}, ...]
\`\`\`
- 最大4つまで

## actionブロック（登録確認）
すべての情報が揃い、ユーザーが時間を選んだ後に出力：
\`\`\`action
{"type": "add_calendar_event", "params": {"title": "予定名", "scheduled_at": "ISO8601+09:00", "estimated_time": 分数, "calendar_id": "カレンダーID"}, "description": "📅 M月D日(曜) HH:MM〜HH:MM 予定名 をカレンダーに登録します"}
\`\`\`
- scheduled_atは必ず+09:00付きのISO8601形式
- calendar_idはデフォルト: ${defaultCalendarId}

## 返答のルール
- 1回に1つだけ質問する
- 3文以内で簡潔に
- 日本語で返答
- 空き時間データにない時間は提案しない
${calendarIds.length > 1 ? '- カレンダーが複数ある場合、optionsでどのカレンダーか聞く' : ''}

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

    // Vercel AI SDK で生成
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

    // 補正: 明示分数優先 + calendar_id/scheduled_at 正規化
    const allUserTexts = [...history.filter(h => h.role === 'user').map(h => h.content), message]
    const explicitDuration = extractExplicitDurationMinutes(allUserTexts)
    const validCalendarIds = new Set(calendarIds)
    const inferredCalendarId = resolveCalendarIdFromTexts(allUserTexts, userCalendars || [])
    let pendingAction: { type: string; params: Record<string, unknown>; description: string } | undefined
    let calendarChoices: Array<{ id: string; name: string; isDefault: boolean }> | undefined

    if (action?.type === 'add_calendar_event') {
      const params = { ...(action.params || {}) } as Record<string, unknown>
      const rawDuration = typeof params.estimated_time === 'number'
        ? params.estimated_time
        : Number(params.estimated_time)
      params.estimated_time = clampDuration(explicitDuration ?? (Number.isFinite(rawDuration) ? rawDuration : 60))

      if (typeof params.scheduled_at === 'string' && !Number.isNaN(new Date(params.scheduled_at).getTime())) {
        params.scheduled_at = toJstIsoString(snapToFiveMinutes(new Date(params.scheduled_at)))
      }

      const rawCalendar = typeof params.calendar_id === 'string' ? params.calendar_id : undefined
      const normalizedCalendarId = (rawCalendar && validCalendarIds.has(rawCalendar))
        ? rawCalendar
        : (inferredCalendarId || defaultCalendarId)
      const hasMultipleCalendars = validCalendarIds.size > 1
      if (hasMultipleCalendars && !inferredCalendarId) {
        delete params.calendar_id
        pendingAction = {
          ...action,
          params,
          description: 'どのカレンダーに登録しますか？',
        }
        calendarChoices = (userCalendars || [])
          .filter(c => !!c.google_calendar_id)
          .map((c) => ({
            id: c.google_calendar_id,
            name: c.name || c.google_calendar_id,
            isDefault: c.google_calendar_id === defaultCalendarId,
          }))
        action = undefined
        if (!replyText) {
          replyText = '保存先カレンダーを選んでください。'
        }
      } else {
        params.calendar_id = normalizedCalendarId
        action = { ...action, params }
      }
    }

    // --- Structured scheduling guard ---
    // 予定登録は「所要時間 -> 開始時間 -> カレンダー」を順に確定してから実行
    const confirmedDurationMin = extractConfirmedDurationMinutes(allUserTexts) ?? explicitDuration
    const confirmedStartAtFromOption = extractConfirmedStartAt(allUserTexts)
    const confirmedCalendarFromOption = extractConfirmedCalendarId(allUserTexts, validCalendarIds)

    const candidateStartRaw = confirmedStartAtFromOption
      || (isValidDateString(action?.params?.scheduled_at) ? String(action?.params?.scheduled_at) : undefined)
      || (slots?.[0]?.scheduled_at && isValidDateString(slots[0].scheduled_at) ? slots[0].scheduled_at : undefined)
    const candidateStartAt = candidateStartRaw && isValidDateString(candidateStartRaw)
      ? toJstIsoString(snapToFiveMinutes(new Date(candidateStartRaw)))
      : undefined

    const candidateCalendarId =
      confirmedCalendarFromOption
      || inferredCalendarId
      || (typeof action?.params?.calendar_id === 'string' && validCalendarIds.has(action.params.calendar_id) ? action.params.calendar_id : undefined)
      || (validCalendarIds.size === 1 ? [...validCalendarIds][0] : undefined)

    const missingDuration = !Number.isFinite(confirmedDurationMin)
    const missingStart = !candidateStartAt
    const missingCalendar = !candidateCalendarId

    if (missingDuration || missingStart || missingCalendar) {
      action = undefined
      pendingAction = undefined
      calendarChoices = undefined
      slots = undefined

      if (missingDuration) {
        replyText = '所要時間を先に決めましょう。近そうな時間を選んでください。'
        options = [15, 30, 45, 60].map((m) => ({ label: `${m}分`, value: `所要時間は${m}分` }))
      } else if (missingStart) {
        const durationMin = confirmedDurationMin || 30
        const baseStart = (() => {
          const now = new Date()
          const d = new Date(now)
          d.setHours(10, 0, 0, 0)
          if (d <= now) d.setDate(d.getDate() + 1)
          return d
        })()
        options = buildStartTimeOptions(baseStart, durationMin)
        replyText = '開始時間を決めましょう。候補から選んでください。'
      } else if (missingCalendar) {
        const candidates = (userCalendars || []).filter(c => !!c.google_calendar_id)
        options = (candidates.length > 0 ? candidates : [{ google_calendar_id: defaultCalendarId, name: 'デフォルトカレンダー', is_primary: true }])
          .slice(0, 4)
          .map((c) => ({
            label: c.name || c.google_calendar_id,
            value: `カレンダーは${c.google_calendar_id}`,
          }))
        replyText = '保存先カレンダーを選んでください。'
      }
    } else {
      const resolvedDuration = confirmedDurationMin || 30
      const resolvedStartAt = candidateStartAt!
      const resolvedCalendarId = candidateCalendarId!
      const resolvedTitle = typeof action?.params?.title === 'string' && action.params.title.trim().length > 0
        ? action.params.title
        : '新しい予定'

      action = {
        type: 'add_calendar_event',
        params: {
          title: resolvedTitle,
          scheduled_at: resolvedStartAt,
          estimated_time: resolvedDuration,
          calendar_id: resolvedCalendarId,
        },
        description: `📅 ${formatOptionDateLabel(resolvedStartAt, resolvedDuration)} ${resolvedTitle} を登録します`,
      }
      if (!/登録して|入れて|それで|お願いします|決定|確定|ok|ＯＫ/i.test(message)) {
        replyText = '必要情報がそろいました。内容を確認して、問題なければ登録してください。'
      }
    }

    return NextResponse.json({
      reply: replyText,
      action,
      pendingAction,
      calendarChoices,
      slots,
      options,
    })
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error'
    console.error('[scheduling] Chat error:', errMsg)

    if (errMsg.includes('API key not valid') || errMsg.includes('API_KEY_INVALID')) {
      return NextResponse.json({ error: 'AI設定を確認してください（APIキーエラー）', errorCode: 'API_KEY_INVALID' }, { status: 503 })
    }
    if (errMsg.includes('quota') || errMsg.includes('429') || errMsg.includes('RATE_LIMIT')) {
      return NextResponse.json({ error: 'リクエスト上限に達しました。しばらくお待ちください' }, { status: 429 })
    }

    return NextResponse.json({ error: 'スケジュール調整中にエラーが発生しました' }, { status: 500 })
  }
}
