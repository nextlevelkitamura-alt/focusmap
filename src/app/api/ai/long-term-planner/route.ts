import { NextResponse } from 'next/server'
import { generateText } from 'ai'
import { createClient } from '@/utils/supabase/server'
import { getConfigForSkill, getModelForSkill } from '@/lib/ai/providers'
import { getFreeTimeContext } from '@/lib/free-time-context'

interface LongTermTaskDraft {
  title: string
  memo: string
  estimated_time: number
  priority: number | null
  reason: string
}

interface ScheduleProposalDraft {
  task_title: string
  title: string
  scheduled_at: string
  estimated_time: number
  calendar_id: string | null
  reason: string
}

interface LongTermPlanDraft {
  title: string
  horizon: string
  summary: string
  memo: string
  tasks: LongTermTaskDraft[]
  schedule_proposals: ScheduleProposalDraft[]
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000

function toJstIsoString(date: Date): string {
  const jst = new Date(date.getTime() + JST_OFFSET_MS)
  const year = jst.getUTCFullYear()
  const month = String(jst.getUTCMonth() + 1).padStart(2, '0')
  const day = String(jst.getUTCDate()).padStart(2, '0')
  const hour = String(jst.getUTCHours()).padStart(2, '0')
  const minute = String(jst.getUTCMinutes()).padStart(2, '0')
  return `${year}-${month}-${day}T${hour}:${minute}:00+09:00`
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```json\s*([\s\S]*?)\s*```/)
  const raw = fenced?.[1] ?? text
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('JSON object not found')
  }
  return JSON.parse(raw.slice(start, end + 1))
}

function clampMinutes(value: unknown, fallback = 60): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(15, Math.min(240, Math.round(n / 15) * 15))
}

function normalizePlan(value: unknown, defaultCalendarId: string | null): LongTermPlanDraft {
  const input = (value ?? {}) as Record<string, unknown>
  const tasksInput = Array.isArray(input.tasks) ? input.tasks : []
  const proposalsInput = Array.isArray(input.schedule_proposals) ? input.schedule_proposals : []

  const tasks = tasksInput.slice(0, 8).map((item) => {
    const t = (item ?? {}) as Record<string, unknown>
    const title = typeof t.title === 'string' && t.title.trim() ? t.title.trim() : '調べる'
    return {
      title,
      memo: typeof t.memo === 'string' ? t.memo.trim() : '',
      estimated_time: clampMinutes(t.estimated_time, 60),
      priority: typeof t.priority === 'number' ? Math.max(1, Math.min(3, Math.round(t.priority))) : null,
      reason: typeof t.reason === 'string' ? t.reason.trim() : '',
    }
  })

  const validTaskTitles = new Set(tasks.map(t => t.title))
  const schedule_proposals = proposalsInput.slice(0, 5).map((item) => {
    const p = (item ?? {}) as Record<string, unknown>
    const fallbackTaskTitle = tasks[0]?.title ?? '予定'
    const taskTitle = typeof p.task_title === 'string' && validTaskTitles.has(p.task_title)
      ? p.task_title
      : fallbackTaskTitle
    const title = typeof p.title === 'string' && p.title.trim() ? p.title.trim() : taskTitle
    const scheduledAt = typeof p.scheduled_at === 'string' && !Number.isNaN(new Date(p.scheduled_at).getTime())
      ? p.scheduled_at
      : toJstIsoString(new Date(Date.now() + 24 * 60 * 60 * 1000))
    return {
      task_title: taskTitle,
      title,
      scheduled_at: scheduledAt,
      estimated_time: clampMinutes(p.estimated_time, tasks.find(t => t.title === taskTitle)?.estimated_time ?? 60),
      calendar_id: typeof p.calendar_id === 'string' && p.calendar_id.trim() ? p.calendar_id.trim() : defaultCalendarId,
      reason: typeof p.reason === 'string' ? p.reason.trim() : '',
    }
  })

  return {
    title: typeof input.title === 'string' && input.title.trim() ? input.title.trim() : '長期プラン',
    horizon: typeof input.horizon === 'string' && input.horizon.trim() ? input.horizon.trim() : '数週間',
    summary: typeof input.summary === 'string' ? input.summary.trim() : '',
    memo: typeof input.memo === 'string' ? input.memo.trim() : '',
    tasks,
    schedule_proposals,
  }
}

function fallbackPlan(message: string, defaultCalendarId: string | null): LongTermPlanDraft {
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(10, 0, 0, 0)
  const title = message.trim().split(/[。.\n]/)[0]?.slice(0, 36) || '長期的に進めたいこと'
  return {
    title,
    horizon: '2〜4週間',
    summary: '入力内容を、調査・整理・実行の順に進める長期タスクとして仮整理しました。',
    memo: message.trim(),
    tasks: [
      {
        title: `${title}を調べる`,
        memo: '目的、必要な情報、最初に読む資料を整理する。',
        estimated_time: 60,
        priority: 2,
        reason: '最初に不明点を減らすため',
      },
      {
        title: `${title}のメモをまとめる`,
        memo: '調べた内容を判断材料と次の行動に分けてまとめる。',
        estimated_time: 45,
        priority: 2,
        reason: '予定に落とし込む前に内容を薄めないため',
      },
    ],
    schedule_proposals: [
      {
        task_title: `${title}を調べる`,
        title: `${title}を調べる`,
        scheduled_at: toJstIsoString(tomorrow),
        estimated_time: 60,
        calendar_id: defaultCalendarId,
        reason: '最初の着手枠として短めに確保',
      },
    ],
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const message = typeof body.message === 'string' ? body.message.trim() : ''
    if (!message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 })
    }

    const [{ data: calendarSettings }, { data: userCalendars }, { data: projects }] = await Promise.all([
      supabase
        .from('user_calendar_settings')
        .select('is_sync_enabled, default_calendar_id')
        .eq('user_id', user.id)
        .maybeSingle(),
      supabase
        .from('user_calendars')
        .select('google_calendar_id, name, is_primary')
        .eq('user_id', user.id)
        .order('is_primary', { ascending: false }),
      supabase
        .from('projects')
        .select('id, title')
        .eq('user_id', user.id)
        .limit(20),
    ])

    const calendarIds = (userCalendars || []).map(c => c.google_calendar_id).filter(Boolean)
    const defaultCalendarId = calendarSettings?.default_calendar_id || calendarIds[0] || null
    const calendarsContext = (userCalendars || []).map(c =>
      `- ${c.name || c.google_calendar_id} (ID: ${c.google_calendar_id})${c.is_primary ? ' [default]' : ''}`
    ).join('\n')
    const projectsContext = (projects || []).map(p => `- ${p.title} (ID: ${p.id})`).join('\n')

    let freeTimeContext = ''
    if (calendarSettings?.is_sync_enabled && calendarIds.length > 0) {
      try {
        const freeTime = await getFreeTimeContext(user.id, calendarIds, supabase)
        freeTimeContext = freeTime.contextText
      } catch {
        freeTimeContext = '空き時間情報の取得に失敗しました。具体日時がない予定案は近い平日の日中に寄せてください。'
      }
    }

    let plan: LongTermPlanDraft
    let provider: 'gemini' | 'fallback' = 'fallback'

    if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
      const skillConfig = getConfigForSkill('long-term-planner')
      const aiResult = await generateText({
        model: getModelForSkill('long-term-planner'),
        system: `あなたはFocusmapの長期タスク設計AIです。
自然文の「勉強したい」「調べたい」「いつかやりたい」を、承認しやすい予定案に整えます。

返答は必ずJSONのみ:
{
  "title": "全体タイトル",
  "horizon": "期間感。例: 2週間 / 1ヶ月 / 今月中",
  "summary": "1〜2文の要約",
  "memo": "内容が濃い場合の保存用メモ。背景・論点・判断材料・次に調べることを含める",
  "tasks": [
    {"title":"タスク名","memo":"タスクに残すメモ","estimated_time":60,"priority":2,"reason":"なぜ必要か"}
  ],
  "schedule_proposals": [
    {"task_title":"tasks内のtitle","title":"カレンダー予定名","scheduled_at":"YYYY-MM-DDTHH:mm:00+09:00","estimated_time":60,"calendar_id":"カレンダーIDまたはnull","reason":"この時間に置く理由"}
  ]
}

制約:
- tasksは2〜6件。曖昧な希望を、調査、学習、実験、整理、判断のような次の行動に分ける。
- 内容が濃い場合はmemoを厚めにする。空なら短くてよい。
- schedule_proposalsは1〜3件。空き時間情報がある場合はそこから選ぶ。
- scheduled_atは必ずAsia/TokyoのISO8601 +09:00。
- calendar_idは利用可能なカレンダーから選ぶ。分からなければnull。
- 予定は詰め込みすぎず、最初の一歩を優先する。`,
        prompt: `今日: ${toJstIsoString(new Date()).slice(0, 10)}

ユーザー入力:
${message}

既存プロジェクト:
${projectsContext || '(なし)'}

利用可能なカレンダー:
${calendarsContext || '(なし)'}

空き時間:
${freeTimeContext || '(未取得)'}`,
        maxOutputTokens: Math.max(skillConfig.maxTokens, 1800),
        temperature: 0.35,
      })
      plan = normalizePlan(extractJson(aiResult.text), defaultCalendarId)
      provider = 'gemini'
    } else {
      plan = fallbackPlan(message, defaultCalendarId)
    }

    const { data: suggestion } = await supabase
      .from('ai_suggestions')
      .insert({
        user_id: user.id,
        suggestion_type: 'long_term_planning',
        payload: {
          input: message,
          plan,
          provider,
        },
        status: 'pending',
      })
      .select('id')
      .single()

    return NextResponse.json({
      plan,
      suggestionId: suggestion?.id ?? null,
      provider,
      calendarConnected: calendarSettings?.is_sync_enabled === true,
    })
  } catch (error) {
    console.error('[long-term-planner] failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to build plan' },
      { status: 500 },
    )
  }
}
