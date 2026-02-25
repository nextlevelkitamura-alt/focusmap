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

type MissingField = 'duration' | 'time_preference' | 'calendar' | 'start_time'

// スケジューリング意図を検出するキーワード
const SCHEDULING_KEYWORDS = ['予定', 'カレンダー', '入れて', 'スケジュール', '会議', 'ミーティング', 'ランチ', '追加して', '登録', '予約']
const JST_OFFSET_MS = 9 * 60 * 60 * 1000

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
  const m = d.getMinutes()
  d.setMinutes(Math.round(m / 5) * 5)
  return d
}

function hasExplicitTimeMention(text: string): boolean {
  return /([01]?\d|2[0-3])\s*[:：時]\s*[0-5]?\d?/.test(text) || /(午前|午後|朝|昼|夕方|夜)/.test(text)
}

function isVagueTimeRequest(text: string): boolean {
  return /(いい感じ|適当|おすすめ|空いて|都合|任せ|ベスト|最適)/.test(text)
}

function keepWithinBusinessHoursForVagueRequest(date: Date, sourceText: string): Date {
  if (hasExplicitTimeMention(sourceText) || !isVagueTimeRequest(sourceText)) return date
  const d = new Date(date)
  const hour = d.getHours()
  if (hour >= 9 && hour <= 20) return d

  if (hour < 9) {
    d.setHours(10, 0, 0, 0)
    return d
  }

  d.setDate(d.getDate() + 1)
  d.setHours(10, 0, 0, 0)
  return d
}

function resolveCalendarIdFromText(
  text: string,
  calendars: Array<{ id: string; name: string }>,
): string | undefined {
  const normalized = text.toLowerCase()
  for (const cal of calendars) {
    const name = cal.name.trim()
    if (!name) continue
    if (normalized.includes(name.toLowerCase())) return cal.id
  }
  return undefined
}

function resolveCalendarIdFromTexts(
  texts: string[],
  calendars: Array<{ id: string; name: string }>,
): string | undefined {
  for (let i = texts.length - 1; i >= 0; i--) {
    const found = resolveCalendarIdFromText(texts[i], calendars)
    if (found) return found
  }
  return undefined
}

function isValidDateString(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(new Date(value).getTime())
}

function extractDurationFromTimeRange(text: string): number | undefined {
  const rangeMatch = text.match(/([01]?\d|2[0-3])\s*[:：時]\s*([0-5]?\d)?\s*[〜~\-]\s*([01]?\d|2[0-3])\s*[:：時]\s*([0-5]?\d)?/)
  if (!rangeMatch) return undefined

  const sh = Number(rangeMatch[1])
  const sm = Number(rangeMatch[2] || '0')
  const eh = Number(rangeMatch[3])
  const em = Number(rangeMatch[4] || '0')
  if ([sh, sm, eh, em].some(v => !Number.isFinite(v))) return undefined

  const start = sh * 60 + sm
  const end = eh * 60 + em
  const diff = end - start
  if (diff <= 0) return undefined
  return clampDuration(diff)
}

function extractDurationHints(texts: string[]): number | undefined {
  const explicit = extractExplicitDurationMinutes(texts)
  if (explicit) return explicit
  for (let i = texts.length - 1; i >= 0; i--) {
    const fromRange = extractDurationFromTimeRange(texts[i])
    if (fromRange) return fromRange
  }
  return undefined
}

function hasApprovalIntent(text: string): boolean {
  return /(登録して|入れて|それで|それでお願い|それでOK|ok|ＯＫ|お願いします|決定|確定)/i.test(text)
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

type TimePreference = 'morning' | 'afternoon' | 'evening' | 'any'

function extractTimePreference(texts: string[]): TimePreference | undefined {
  for (let i = texts.length - 1; i >= 0; i--) {
    const text = texts[i]
    if (/午前中にお願い|午前がいい|午前中/.test(text)) return 'morning'
    if (/午後にお願い|午後がいい|午後/.test(text)) return 'afternoon'
    if (/夕方以降にお願い|夕方|夜/.test(text)) return 'evening'
    if (/いい感じの時間|おまかせ|任せ/.test(text)) return 'any'
  }
  return undefined
}

function hasExplicitStartTimeMention(texts: string[]): boolean {
  for (let i = texts.length - 1; i >= 0; i--) {
    if (/([01]?\d|2[0-3])\s*[:：時]\s*[0-5]?\d?\s*(から|に|で|〜|~|-)/.test(texts[i])) return true
  }
  return false
}

function getSmartDurationOptions(title: string): Array<{ label: string; value: string }> {
  const t = title.toLowerCase()
  let durations: number[]
  if (/電話|通話|コール|call/.test(t)) {
    durations = [15, 30, 60]
  } else if (/会議|ミーティング|打ち合わせ|mtg|meeting/.test(t)) {
    durations = [30, 60, 90]
  } else if (/ランチ|食事|昼食|夕食|飲み|dinner|lunch/.test(t)) {
    durations = [60, 90, 120]
  } else {
    durations = [30, 60, 90]
  }
  return durations.map(m => ({ label: `${m}分`, value: `所要時間は${m}分` }))
}

function buildSmartStartTimeOptions(
  freeTimeContextText: string,
  durationMin: number,
  preference: TimePreference | undefined,
  baseDate: Date,
): Array<{ label: string; value: string }> {
  // freeTimeContextText から空き時間を解析
  const slots: Array<{ startHour: number; startMin: number; endHour: number; endMin: number; date: Date }> = []

  const lines = freeTimeContextText.split('\n')
  for (const line of lines) {
    // "2月26日(水): 09:00-11:00(120分), 14:00-17:00(180分)" のような形式
    const dateMatch = line.match(/(\d{1,2})月(\d{1,2})日/)
    if (!dateMatch) continue
    const month = Number(dateMatch[1]) - 1
    const day = Number(dateMatch[2])
    const lineDate = new Date(baseDate.getFullYear(), month, day)

    const slotMatches = [...line.matchAll(/(\d{2}):(\d{2})-(\d{2}):(\d{2})/g)]
    for (const m of slotMatches) {
      const sh = Number(m[1]), sm = Number(m[2]), eh = Number(m[3]), em = Number(m[4])
      const slotDuration = (eh * 60 + em) - (sh * 60 + sm)
      if (slotDuration >= durationMin) {
        slots.push({ startHour: sh, startMin: sm, endHour: eh, endMin: em, date: lineDate })
      }
    }
  }

  // 時間帯の好みでフィルタリング
  const filtered = slots.filter(s => {
    if (!preference || preference === 'any') return true
    if (preference === 'morning') return s.startHour < 12
    if (preference === 'afternoon') return s.startHour >= 12 && s.startHour < 17
    if (preference === 'evening') return s.startHour >= 17
    return true
  })

  const source = filtered.length > 0 ? filtered : slots
  const options: Array<{ label: string; value: string }> = []
  const seen = new Set<string>()

  for (const slot of source) {
    if (options.length >= 3) break
    // スロットの先頭をスナップして候補に
    const candidate = new Date(slot.date)
    candidate.setHours(slot.startHour, slot.startMin, 0, 0)
    const snapped = snapToFiveMinutes(candidate)
    const iso = toJstIsoString(snapped)
    if (seen.has(iso)) continue
    seen.add(iso)

    const endTime = new Date(snapped.getTime() + durationMin * 60 * 1000)
    const slotEndMinutes = slot.endHour * 60 + slot.endMin
    const endMinutes = endTime.getHours() * 60 + endTime.getMinutes()
    const marginMin = slotEndMinutes - endMinutes

    let reason = ''
    if (marginMin >= 60) {
      reason = '前後に余裕あり'
    } else if (marginMin >= 30) {
      reason = '後ろに30分の余裕'
    } else {
      reason = 'ちょうど空いている'
    }

    const label = `${formatOptionDateLabel(iso, durationMin)}（${reason}）`
    options.push({ label, value: `開始時間は${iso}` })
  }

  // 空き時間から候補が見つからない場合はフォールバック
  if (options.length === 0) {
    return buildStartTimeOptions(baseDate, durationMin)
  }

  return options
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

function findJsonFragment(source: string, startIndex: number) {
  let start = -1
  for (let i = startIndex; i < source.length; i++) {
    const ch = source[i]
    if (ch === '{' || ch === '[') {
      start = i
      break
    }
  }
  if (start < 0) return undefined

  const stack: string[] = []
  let inString = false
  let escape = false

  for (let i = start; i < source.length; i++) {
    const ch = source[i]

    if (inString) {
      if (escape) {
        escape = false
        continue
      }
      if (ch === '\\') {
        escape = true
        continue
      }
      if (ch === '"') {
        inString = false
      }
      continue
    }

    if (ch === '"') {
      inString = true
      continue
    }

    if (ch === '{' || ch === '[') {
      stack.push(ch)
      continue
    }

    if (ch === '}' || ch === ']') {
      const open = stack[stack.length - 1]
      if ((open === '{' && ch === '}') || (open === '[' && ch === ']')) {
        stack.pop()
      } else {
        return undefined
      }

      if (stack.length === 0) {
        return {
          start,
          end: i + 1,
          raw: source.slice(start, i + 1),
        }
      }
    }
  }

  return undefined
}

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

    // 15ラリー制限チェック
    const rallyCount = history.filter(m => m.role === 'user').length
    if (rallyCount >= 15) {
      return NextResponse.json({
        reply: '会話が長くなりました。内容を要約して続けます。',
        shouldSummarize: true,
      })
    }

    // 過去の会話要約を取得（新規セッション or 序盤のみ）
    let previousSummaryContext = ''
    if (rallyCount <= 1) {
      const { data: previousSummaries } = await supabase
        .from('ai_chat_summaries')
        .select('summary, topics, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(3)

      if (previousSummaries && previousSummaries.length > 0) {
        previousSummaryContext = `\n## 過去の会話サマリー\n${previousSummaries.map(s =>
          `- ${s.summary}${s.topics?.length ? ` (${s.topics.join(', ')})` : ''}`
        ).join('\n')}`
      }
    }

    // ユーザーコンテキスト（パーソナライズ）を取得
    let userPersonaContext = ''
    const { data: userContext } = await supabase
      .from('ai_user_context')
      .select('persona, preferences')
      .eq('user_id', user.id)
      .maybeSingle()

    if (userContext?.persona) {
      userPersonaContext = `\n## ユーザーの傾向\n${userContext.persona}`
      if (userContext.preferences && Object.keys(userContext.preferences).length > 0) {
        const prefs = userContext.preferences as Record<string, unknown>
        if (prefs.preferred_time_of_day) {
          userPersonaContext += `\n好みの時間帯: ${prefs.preferred_time_of_day}`
        }
        if (Array.isArray(prefs.common_event_types) && prefs.common_event_types.length > 0) {
          userPersonaContext += `\nよく登録する予定: ${prefs.common_event_types.join(', ')}`
        }
      }
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
    let defaultCalendarName = ''
    let calendarCount = 0
    let userCalendarsForResolution: Array<{ id: string; name: string }> = []
    if (calendarSettings?.is_sync_enabled) {
      const { data: userCalendars } = await supabase
        .from('user_calendars')
        .select('google_calendar_id, name, is_primary')
        .eq('user_id', user.id)
        .order('is_primary', { ascending: false })

      if (userCalendars && userCalendars.length > 0) {
        calendarCount = userCalendars.length
        userCalendarsForResolution = userCalendars
          .filter(c => !!c.google_calendar_id)
          .map(c => ({ id: c.google_calendar_id, name: c.name || '' }))
        calendarsContext = userCalendars.map(c =>
          `- ${c.name} (ID: ${c.google_calendar_id})${c.is_primary ? ' [デフォルト]' : ''}`
        ).join('\n')
        defaultCalendarId = calendarSettings.default_calendar_id || userCalendars[0].google_calendar_id || 'primary'
        const defaultCal = userCalendars.find(c => c.google_calendar_id === defaultCalendarId)
        defaultCalendarName = defaultCal?.name || ''
      }
    }

    // スケジューリング意図を検出
    const allMessages = [...history.map(m => m.content), message]
    const isSchedulingIntent = SCHEDULING_KEYWORDS.some(kw =>
      allMessages.some(text => text.includes(kw))
    )
    const allUserTexts = [...history.filter(h => h.role === 'user').map(h => h.content), message]
    const explicitDuration = extractDurationHints(allUserTexts)
    // Duration prompt bypass を廃止: AIが対話ステップで所要時間を聞くようにする

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
- **対話優先**: ユーザーと情報を交換しながら質の高い提案をする。選択肢を提示し、ユーザーの意思を確認してから行動する
- 削除操作は実行不可。「削除はメモ画面から行ってください」と案内する
- 親しみやすく応答する（2文以内 + options）
- 日本語で応答する

## 重要な実行前条件（最優先）
- 予定登録前に **所要時間 / 時間帯 / カレンダー / 開始時間** の4項目を必ず確定する
- 1つでも未確定なら action や best_proposal は返さず、options で1項目だけ質問する
- 候補は2〜4件で提示し、ユーザーが選んでから次へ進む

## カレンダー予定追加（対話優先モード・最重要ルール）
ユーザーがスケジューリング意図を示した場合、**即座にbest_proposalを返さない**。
以下の対話ステップを順に進め、**1回の応答で聞くのは1つだけ**。

### 対話ステップ（この順番で進める）

**ステップ1: 意図確認 + 所要時間**
「〇〇ですね！」と共感し、イベント種別に応じた所要時間候補をoptionsで提示:
- 電話・通話・コール: options → ["15分", "30分", "60分"]
- 会議・打ち合わせ・MTG・ミーティング: options → ["30分", "60分", "90分"]
- ランチ・食事・飲み: options → ["60分", "90分", "120分"]
- 一般タスク・作業: options → ["30分", "60分", "90分"]
※ ユーザーが「30分」等と明示済みならこのステップはスキップ

**ステップ2: 時間帯の好み**
optionsで時間帯を聞く: ["午前がいい", "午後がいい", "夕方以降", "おまかせ"]
※ ユーザーが「午前中に」「10時に」等と明示済みならスキップ

**ステップ3: カレンダー選択**
必ずoptionsでカレンダーを選ばせる（カレンダーが1つでも確認する）
${calendarCount <= 1 ? `options → ["${defaultCalendarName || 'デフォルトカレンダー'}"]` : '利用可能なカレンダーをoptionsで提示'}
※ ユーザーが「仕事用に」等とカレンダー名を明示済みならスキップ

**ステップ4: 開始時間の提案（根拠付き）**
空き時間データとユーザーの時間帯希望を元に、2〜3つの具体的な開始時間候補をoptionsで提示。
各候補には**根拠**を含める:
- 空き状況（「前後に余裕あり」「ちょうど空いている」）
- 予定との関係（「次の予定まで2時間空き」）
例: options → [{"label":"10:00〜10:30（前後に余裕あり）","value":"開始時間は2026-02-26T10:00:00+09:00"}, ...]
※ ユーザーが「10時から」等と明示済みならスキップ

**ステップ5: 最終提案**
全情報が揃ったらbest_proposalで提案。reasonに選択根拠を詳しく記載。

### スキップの判定
ユーザーが会話の中で明示的に情報を提供した場合、該当ステップをスキップして次へ進む。
例: 「明日の午前に30分の電話」→ ステップ1,2スキップ → ステップ3(カレンダー)へ
例: 「明日10時から30分の電話」→ ステップ1,2,4スキップ → ステップ3(カレンダー)へ

### best_proposal ブロック（必須形式）
予定を提案するときは**必ずこの形式のみ**を使う:
\`\`\`best_proposal
{"title":"予定名","startAt":"2026-02-26T14:00:00+09:00","endAt":"2026-02-26T15:00:00+09:00","calendarId":"${defaultCalendarId}","duration":60,"reason":"午前10時は前後に余裕があり、電話に集中しやすい時間帯です"}
\`\`\`
**絶対ルール**:
- startAt/endAt は必ず ISO8601 JST (+09:00) 形式
- duration は分数（整数）
- calendarId は必ず実際のカレンダーIDを入れる
- reason は「なぜこの時間を選んだか」を**具体的な根拠**で書く（例: 「前後に余裕があり集中しやすい」「空き時間がちょうど30分でぴったり」）
- best_proposalを返すとき、actionブロックやoptionsブロックやproposal_cardsブロックは絶対に返さない
- best_proposalは**全ステップの情報が確定した後にのみ**出力する

### ユーザーが提案を承認した場合
「登録して」「OK」「それで」等の承認メッセージが来たら、actionブロックを返す:
\`\`\`action
{"type":"add_calendar_event","params":{"title":"予定名","scheduled_at":"ISO8601+09:00","estimated_time":60,"calendar_id":"${defaultCalendarId}"},"description":"📅 M/D(曜) HH:MM〜HH:MM 予定名 をカレンダーに登録します"}
\`\`\`
- estimated_time は分数（必ず含める）
- calendar_id は必ず含める

### ユーザーが「他の候補」「変えたい」等を要求した場合
別の時間帯で新しい best_proposal を返す（proposal_cardsは使わない）。
新しい候補にも根拠を必ず含める。

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
${freeTimeContext}
${previousSummaryContext}
${userPersonaContext}`

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
      if (match) {
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

      const keywordRegex = new RegExp(`(?:^|\\n)\\s*${blockName}\\s*\\n?`, 'i')
      const keywordMatch = source.match(keywordRegex)
      if (!keywordMatch || keywordMatch.index === undefined) {
        return { value: undefined as unknown, text: source }
      }

      const fragment = findJsonFragment(source, keywordMatch.index + keywordMatch[0].length)
      if (!fragment) return { value: undefined as unknown, text: source }

      try {
        const value = JSON.parse(fragment.raw)
        const start = keywordMatch.index
        const text = (source.slice(0, start) + source.slice(fragment.end)).trim()
        return { value, text }
      } catch {
        return { value: undefined as unknown, text: source }
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

    // --- Safety normalization layer ---
    // AIの揺らぎで不自然な時間・duration・calendar_idが出ても、サーバー側で補正する
    const explicitDurationForNormalization = extractDurationHints(allUserTexts)
    const lastUserText = allUserTexts[allUserTexts.length - 1] || ''
    const inferredCalendarFromText = resolveCalendarIdFromTexts(allUserTexts, userCalendarsForResolution)
    const validCalendarIds = new Set(userCalendarsForResolution.map(c => c.id))
    let pendingAction: ChatMessage['action'] | undefined
    let calendarChoices: Array<{ id: string; name: string; isDefault: boolean }> | undefined
    let missingFields: MissingField[] | undefined

    if (bestProposal) {
      const startDate = isValidDateString(bestProposal.startAt) ? new Date(bestProposal.startAt) : null
      const endDate = isValidDateString(bestProposal.endAt) ? new Date(bestProposal.endAt) : null
      if (startDate) {
        let normalizedStart = snapToFiveMinutes(startDate)
        normalizedStart = keepWithinBusinessHoursForVagueRequest(normalizedStart, lastUserText)
        const inferredDuration = endDate
          ? Math.round((endDate.getTime() - startDate.getTime()) / 60000)
          : bestProposal.duration
        const normalizedDuration = clampDuration(explicitDurationForNormalization ?? inferredDuration ?? 60)
        const normalizedEnd = new Date(normalizedStart.getTime() + normalizedDuration * 60 * 1000)
        const normalizedCalendarId = validCalendarIds.has(bestProposal.calendarId)
          ? bestProposal.calendarId
          : (inferredCalendarFromText || defaultCalendarId)

        bestProposal = {
          ...bestProposal,
          startAt: toJstIsoString(normalizedStart),
          endAt: toJstIsoString(normalizedEnd),
          duration: normalizedDuration,
          calendarId: normalizedCalendarId,
        }
      }
    }

    if (action?.type === 'add_calendar_event') {
      const params = { ...(action.params || {}) } as Record<string, unknown>
      const proposedStart = isValidDateString(params.scheduled_at)
        ? new Date(params.scheduled_at)
        : (bestProposal && isValidDateString(bestProposal.startAt) ? new Date(bestProposal.startAt) : null)

      const proposedDurationRaw = typeof params.estimated_time === 'number'
        ? params.estimated_time
        : Number(params.estimated_time)
      const proposedDuration = Number.isFinite(proposedDurationRaw)
        ? proposedDurationRaw
        : (bestProposal?.duration ?? 60)
      const normalizedDuration = clampDuration(explicitDurationForNormalization ?? proposedDuration)

      if (proposedStart) {
        let normalizedStart = snapToFiveMinutes(proposedStart)
        normalizedStart = keepWithinBusinessHoursForVagueRequest(normalizedStart, lastUserText)
        params.scheduled_at = toJstIsoString(normalizedStart)
      }
      params.estimated_time = normalizedDuration

      const rawCalendarId = typeof params.calendar_id === 'string' ? params.calendar_id : undefined
      const hasMultipleCalendars = validCalendarIds.size > 1
      const explicitCalendarId = inferredCalendarFromText
      const normalizedCalendarId = rawCalendarId && validCalendarIds.has(rawCalendarId)
        ? rawCalendarId
        : (explicitCalendarId || bestProposal?.calendarId || defaultCalendarId)

      if (hasMultipleCalendars && !explicitCalendarId) {
        delete params.calendar_id
        pendingAction = {
          ...action,
          params,
          description: 'どのカレンダーに登録しますか？',
        }
        calendarChoices = userCalendarsForResolution.map((calendar) => ({
          id: calendar.id,
          name: calendar.name || calendar.id,
          isDefault: calendar.id === defaultCalendarId,
        }))
        action = undefined
        if (!replyText) {
          replyText = '保存先カレンダーを選んでください。'
        }
      } else {
        params.calendar_id = normalizedCalendarId
        action = {
          ...action,
          params,
        }
      }
    }

    // --- Structured scheduling guard ---
    // 予定登録は「所要時間 → 時間帯 → カレンダー → 開始時間」を順に確定してから実行する
    if (isSchedulingIntent) {
      const confirmedDurationMin = extractConfirmedDurationMinutes(allUserTexts) ?? explicitDurationForNormalization
      const confirmedStartAtFromOption = extractConfirmedStartAt(allUserTexts)
      const confirmedCalendarFromOption = extractConfirmedCalendarId(allUserTexts, validCalendarIds)
      const confirmedTimePreference = extractTimePreference(allUserTexts)
      const hasExplicitStart = hasExplicitStartTimeMention(allUserTexts)

      const candidateStartRaw = confirmedStartAtFromOption
        || (isValidDateString(action?.params?.scheduled_at) ? String(action?.params?.scheduled_at) : undefined)
        || (bestProposal && isValidDateString(bestProposal.startAt) ? bestProposal.startAt : undefined)
      const candidateStartAt = candidateStartRaw && isValidDateString(candidateStartRaw)
        ? toJstIsoString(snapToFiveMinutes(new Date(candidateStartRaw)))
        : undefined

      // カレンダー自動選択を廃止: 必ずユーザーに確認する
      const candidateCalendarId =
        confirmedCalendarFromOption
        || inferredCalendarFromText
        || (typeof action?.params?.calendar_id === 'string' && validCalendarIds.has(action.params.calendar_id) ? action.params.calendar_id : undefined)
        || (bestProposal && validCalendarIds.has(bestProposal.calendarId) ? bestProposal.calendarId : undefined)

      const hasKnownDuration = Number.isFinite(confirmedDurationMin)
      const hasKnownTimePreference = !!confirmedTimePreference || hasExplicitStart
      const hasKnownCalendar = !!candidateCalendarId
      const hasKnownStart = !!candidateStartAt

      // 順序: duration → time_preference → calendar → start_time
      const nextMissing: MissingField[] = []
      if (!hasKnownDuration) nextMissing.push('duration')
      if (!hasKnownTimePreference) nextMissing.push('time_preference')
      if (!hasKnownCalendar) nextMissing.push('calendar')
      if (!hasKnownStart) nextMissing.push('start_time')

      missingFields = nextMissing.length > 0 ? nextMissing : undefined

      if (nextMissing.length > 0) {
        // タイトルを保存してから変数をクリア
        const eventTitle = bestProposal?.title || (action?.params?.title as string) || message
        action = undefined
        pendingAction = undefined
        calendarChoices = undefined
        bestProposal = undefined
        plannerState = 'capture_intent'

        const firstMissing = nextMissing[0]
        if (firstMissing === 'duration') {
          // イベント種別に応じたスマートな所要時間候補
          replyText = replyText || 'どのくらいの時間になりそうですか？'
          options = getSmartDurationOptions(eventTitle)
        } else if (firstMissing === 'time_preference') {
          replyText = replyText || '何時頃がいいですか？'
          options = [
            { label: '午前がいい', value: '午前中にお願いします' },
            { label: '午後がいい', value: '午後にお願いします' },
            { label: '夕方以降', value: '夕方以降にお願いします' },
            { label: 'おまかせ', value: 'いい感じの時間でお願いします' },
          ]
        } else if (firstMissing === 'calendar') {
          const candidates = userCalendarsForResolution.length > 0
            ? userCalendarsForResolution
            : [{ id: defaultCalendarId, name: defaultCalendarName || 'デフォルトカレンダー' }]
          replyText = replyText || 'どのカレンダーに登録しますか？'
          options = candidates.slice(0, 4).map((c) => ({
            label: `${c.name || c.id}${c.id === defaultCalendarId ? ' ✓' : ''}`,
            value: `カレンダーは${c.id}`,
          }))
        } else if (firstMissing === 'start_time') {
          const durationMin = confirmedDurationMin || 30
          const baseStart = (() => {
            const now = new Date()
            const d = new Date(now)
            d.setHours(10, 0, 0, 0)
            if (d <= now) d.setDate(d.getDate() + 1)
            return d
          })()
          // 空き時間データから根拠付きの候補を生成
          const startOptions = buildSmartStartTimeOptions(
            freeTimeContext, durationMin, confirmedTimePreference || undefined, baseStart
          )
          replyText = replyText || '空き時間から候補を見つけました。'
          options = startOptions
        }
      } else {
        const resolvedDuration = confirmedDurationMin || 30
        const resolvedStartAt = candidateStartAt!
        const resolvedCalendarId = candidateCalendarId!
        const resolvedTitle = typeof action?.params?.title === 'string' && action.params.title.trim().length > 0
          ? action.params.title
          : (bestProposal?.title || '新しい予定')

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
        plannerState = 'confirm_and_execute'
        if (!hasApprovalIntent(lastUserText)) {
          replyText = '必要情報がそろいました。内容を確認して、問題なければ実行してください。'
        }
      }
    }

    return NextResponse.json({
      reply: replyText,
      action,
      pendingAction,
      calendarChoices,
      options,
      plannerState,
      bestProposal,
      missingFields,
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
