import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'
import { generateText, type ToolSet } from 'ai'
import { getModelForSkill, getConfigForSkill, getModelForAgent, getConfigForAgent } from '@/lib/ai/providers'
import { buildCoachSystemPrompt } from '@/lib/ai/agents/coach'
import { buildProjectPMSystemPrompt } from '@/lib/ai/agents/project-pm'
import { getToolsForSkill, isToolEnabledSkill } from '@/lib/ai/tools'
import { getFreeTimeContext } from '@/lib/free-time-context'
import { orchestrate } from '@/lib/ai/agents/orchestrator'
import { getSkillById, SKILLS } from '@/lib/ai/skills'
import type { SkillContext } from '@/lib/ai/skills/prompts/common'
import { buildSchedulingPrompt } from '@/lib/ai/skills/prompts/scheduling'
import { buildTaskPrompt } from '@/lib/ai/skills/prompts/task'
import { buildCounselingPrompt } from '@/lib/ai/skills/prompts/counseling'
import { buildMemoPrompt } from '@/lib/ai/skills/prompts/memo'
import { buildProjectConsultationPrompt } from '@/lib/ai/skills/prompts/project-consultation'
import { buildBrainstormPrompt } from '@/lib/ai/skills/prompts/brainstorm'
import { loadAllProjectContexts, formatProjectContextsForPrompt } from '@/lib/ai/context/project-context'
import { loadContextFromDocuments } from '@/lib/ai/context/document-context'
import { summarizeProjectTasks, summarizeAllProjects } from '@/lib/ai/context/task-summarizer'
import { buildMindmapContextForPrompt } from '@/lib/ai/context/mindmap-context'

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

type MissingField = 'duration' | 'calendar' | 'start_time'

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

    // Vercel AI SDK (@ai-sdk/google) は GOOGLE_GENERATIVE_AI_API_KEY を自動で読む
    if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
      return NextResponse.json({ error: 'AI service not configured' }, { status: 503 })
    }

    const body = await request.json()
    const { message, history = [], context = {}, skillId: requestedSkillId, summaryContext: clientSummaryContext } = body as {
      message: string
      history: ChatMessage[]
      context: {
        activeProjectId?: string
      }
      skillId?: string
      summaryContext?: string
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

    // 過去の会話要約を取得
    let previousSummaryContext = ''
    if (clientSummaryContext) {
      // クライアントから要約コンテキストが送られた場合（要約後の継続会話）
      previousSummaryContext = `\n## 前の会話の要約\n${clientSummaryContext}`
    } else if (rallyCount <= 1) {
      // 新規セッション or 序盤のみDBから取得
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

    // ユーザーコンテキスト（パーソナライズ）を取得 — フォルダ/ドキュメント型（旧テーブルフォールバック付き）
    const contextInjection = await loadContextFromDocuments(supabase, user.id)
    const userContextCategories = contextInjection.userContextCategories
    const userPreferences = contextInjection.userPreferences
    let userPersonaContext = contextInjection.personalContext + contextInjection.projectContext + contextInjection.freshnessAlerts

    // プロジェクトコンテキスト（AIの記憶）を読み込み
    const projectContexts = await loadAllProjectContexts(supabase, user.id)
    const projectContextPrompt = formatProjectContextsForPrompt(projectContexts, 3)
    if (projectContextPrompt) {
      userPersonaContext += projectContextPrompt
    }

    // Skill ルーティング: orchestrator 経由（UIから指定 or 自然言語判定）
    const { agentId, skillId: routedSkillId } = orchestrate(message, requestedSkillId || undefined)
    const resolvedSkillId = routedSkillId ?? null
    const isFirstMessage = history.length === 0
    const hasNoUserContext = !userContextCategories.life_personality && !userContextCategories.life_purpose && !userContextCategories.current_situation

    // Skill未確定の場合 → Skill選択ボタンを返す
    if (!resolvedSkillId && isFirstMessage) {
      // 初回利用で未コンテキストの場合 → 軽いオンボーディング
      if (hasNoUserContext) {
        return NextResponse.json({
          reply: 'はじめまして！まずはあなたのことを少し教えてください。',
          skillId: 'counseling',
          options: [
            { label: '相談してみる', value: '自分のことを話したい' },
            { label: 'まず予定を入れたい', value: '予定を入れたい' },
          ],
        })
      }
      return NextResponse.json({
        reply: '何をしましょうか？',
        skillSelector: SKILLS.map(s => ({ id: s.id, label: s.label, icon: s.icon, description: s.description })),
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

    // Skill別のプロンプトを構築
    const activeSkillId = resolvedSkillId || 'scheduling' // フォールバック
    const skillDef = getSkillById(activeSkillId)

    // プロジェクト相談Skill用: タスクデータの構造化要約 + マインドマップ構造 + プロジェクト要約を取得
    let taskSummaryContext = ''
    let mindmapContext = ''
    let projectSummary = ''
    if (activeSkillId === 'project-consultation') {
      try {
        if (context.activeProjectId) {
          taskSummaryContext = await summarizeProjectTasks(supabase, user.id, context.activeProjectId)

          // マインドマップ構造をツリーテキストで取得
          const project = (projects || []).find(p => p.id === context.activeProjectId)
          if (project) {
            mindmapContext = await buildMindmapContextForPrompt(
              supabase, user.id, context.activeProjectId, project.title
            )
          }

          // プロジェクト要約を ai_context_documents から動的読み込み
          const { data: projectDocs } = await supabase
            .from('ai_context_documents')
            .select('content, document_type, ai_context_folders!inner(project_id)')
            .eq('user_id', user.id)
            .eq('ai_context_folders.project_id', context.activeProjectId)
            .order('is_pinned', { ascending: false })
            .limit(5)

          if (projectDocs && projectDocs.length > 0) {
            const summaryParts = projectDocs
              .filter((d: { content: string | null }) => d.content)
              .map((d: { content: string | null; document_type: string }) => d.content)
            projectSummary = summaryParts.join('\n')
          }
        } else {
          taskSummaryContext = await summarizeAllProjects(supabase, user.id)
        }
      } catch (err) {
        console.error('[chat] Task summary / mindmap context generation failed:', err)
      }
    }

    // Skill用のコンテキストを組み立て
    const skillContext: SkillContext = {
      todayDate: new Date().toISOString().split('T')[0],
      currentTime: new Date().toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' }),
      userContext: {},
      userPreferences: userPreferences,
      projectsContext: projectsContext || undefined,
      calendar: calendarSettings?.is_sync_enabled ? {
        isEnabled: true,
        defaultCalendarId,
        defaultCalendarName: defaultCalendarName || 'デフォルトカレンダー',
        calendarsContext,
        calendarCount,
      } : undefined,
      freeTimeContext: freeTimeContext || undefined,
      projectContextPrompt: projectContextPrompt || undefined,
      previousSummaryContext: previousSummaryContext || undefined,
      taskSummaryContext: taskSummaryContext || undefined,
      mindmapContext: mindmapContext || undefined,
      projectSummary: projectSummary || undefined,
    }

    // Skillが必要とするコンテキストカテゴリだけを注入
    if (skillDef) {
      for (const cat of skillDef.contextCategories) {
        if (userContextCategories[cat]) {
          skillContext.userContext[cat] = userContextCategories[cat]
        }
      }
    }

    // Skill別プロンプトを生成
    let systemPrompt: string
    switch (activeSkillId) {
      case 'scheduling':
        systemPrompt = buildSchedulingPrompt(skillContext)
        break
      case 'task':
        systemPrompt = buildTaskPrompt(skillContext)
        break
      case 'counseling':
        systemPrompt = agentId === 'coach'
          ? buildCoachSystemPrompt(contextInjection, activeSkillId)
          : buildCounselingPrompt(skillContext)
        break
      case 'memo':
        systemPrompt = buildMemoPrompt(skillContext)
        break
      case 'project-consultation':
        systemPrompt = agentId === 'project-pm'
          ? buildProjectPMSystemPrompt(contextInjection, projectsContext)
          : buildProjectConsultationPrompt(skillContext)
        break
      case 'brainstorm':
        systemPrompt = agentId === 'coach'
          ? buildCoachSystemPrompt(contextInjection, activeSkillId)
          : buildBrainstormPrompt(skillContext)
        break
      default:
        // 未知のskillIdの場合、タスク管理にフォールバック（汎用性が高い）
        systemPrompt = buildTaskPrompt(skillContext)
        break
    }

    const prompt = `${historyContext ? `## 会話履歴\n${historyContext}\n\n` : ''}ユーザー: ${message.trim()}`

    // Vercel AI SDK で生成（ツール有効スキルはエージェントループ付き）
    const isAgentMode = agentId === 'coach' || agentId === 'project-pm'
    const skillConfig = isAgentMode ? getConfigForAgent(agentId) : getConfigForSkill(activeSkillId)
    const useTools = isToolEnabledSkill(activeSkillId)
    const tools = useTools ? getToolsForSkill(activeSkillId) as ToolSet : undefined

    const aiResult = await generateText({
      model: isAgentMode ? getModelForAgent(agentId) : getModelForSkill(activeSkillId),
      system: systemPrompt,
      prompt,
      maxOutputTokens: skillConfig.maxTokens,
      temperature: skillConfig.temperature,
      ...(tools && Object.keys(tools).length > 0 ? { tools, maxSteps: 5 } : {}),
    })

    const responseText = aiResult.text

    // ツール実行結果を収集（全ステップから）
    interface ToolResultEntry {
      toolName: string
      input: Record<string, unknown>
      output: Record<string, unknown>
    }
    const allToolResults: ToolResultEntry[] = []
    if (useTools && aiResult.steps) {
      for (const step of aiResult.steps) {
        if (step.toolResults) {
          for (const tr of step.toolResults) {
            allToolResults.push({
              toolName: tr.toolName,
              input: (tr.input ?? {}) as Record<string, unknown>,
              output: (tr.output ?? {}) as Record<string, unknown>,
            })
          }
        }
      }
    }
    const toolsExecuted = allToolResults.length > 0

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
    if (!toolsExecuted && actionBlock.value && typeof actionBlock.value === 'object') {
      action = actionBlock.value as ChatMessage['action']
    }

    // best_proposal ブロックを抽出
    const bestProposalBlock = extractJsonBlock(replyText, 'best_proposal')
    let bestProposal: BestProposal | undefined
    if (!toolsExecuted && bestProposalBlock.value && typeof bestProposalBlock.value === 'object') {
      bestProposal = bestProposalBlock.value as BestProposal
    }
    replyText = bestProposalBlock.text

    // planner_state ブロックを抽出
    const plannerStateBlock = extractJsonBlock(replyText, 'planner_state')
    let plannerState: PlannerState | undefined
    if (!toolsExecuted && typeof plannerStateBlock.value === 'string') {
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
    let options: { label: string; value: string; silent?: boolean }[] | undefined

    if (Array.isArray(optionsBlock.value) && optionsBlock.value.length > 0) {
      options = optionsBlock.value.slice(0, 4)
    }
    replyText = optionsBlock.text

    // タスクスキルの場合: optionsにUUIDが含まれていたらプロジェクト名ベースに修正 + silent化
    if (activeSkillId === 'task' && options && projects) {
      const UUID_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
      options = options.map(opt => {
        // value にUUIDが含まれる場合、プロジェクト名ベースに置換
        const uuidMatch = opt.value.match(UUID_REGEX)
        if (uuidMatch) {
          const project = projects.find(p => p.id === uuidMatch[0])
          if (project) {
            return {
              label: project.title,
              value: `プロジェクト「${project.title}」に追加して`,
              silent: true,
            }
          }
        }
        // label にプロジェクト名が含まれる場合もsilent化
        const matchByLabel = projects.find(p => opt.label.includes(p.title))
        if (matchByLabel) {
          return {
            label: matchByLabel.title,
            value: `プロジェクト「${matchByLabel.title}」に追加して`,
            silent: true,
          }
        }
        return opt
      })
    }

    // context_update ブロックを抽出（カウンセリングSkill用）→ 新テーブルに直接保存
    const contextUpdateBlock = extractJsonBlock(replyText, 'context_update')
    let contextUpdate: { category: string; content: string } | undefined
    if (contextUpdateBlock.value && typeof contextUpdateBlock.value === 'object') {
      const cu = contextUpdateBlock.value as { category?: string; content?: string }
      if (cu.category && cu.content) {
        contextUpdate = { category: cu.category, content: cu.content }

        // 新テーブル (ai_context_documents) に保存を試みる
        const categoryToDocType: Record<string, string> = {
          life_personality: 'personality',
          life_purpose: 'purpose',
          current_situation: 'situation',
        }
        const docType = categoryToDocType[cu.category]
        if (docType) {
          const { data: existingDoc } = await supabase
            .from('ai_context_documents')
            .select('id, content')
            .eq('user_id', user.id)
            .eq('document_type', docType)
            .maybeSingle()

          if (existingDoc) {
            // 既存ドキュメントにマージ（追記）
            const merged = existingDoc.content
              ? `${existingDoc.content}\n${cu.content}`.slice(0, 500)
              : cu.content.slice(0, 500)
            await supabase
              .from('ai_context_documents')
              .update({ content: merged, content_updated_at: new Date().toISOString(), source: 'ai_auto' })
              .eq('id', existingDoc.id)
          }
          // 新テーブルにドキュメントがない場合は旧APIにフォールバック（クライアント側で処理）
        }
      }
    }
    replyText = contextUpdateBlock.text

    // project_context_update ブロックを抽出（プロジェクト相談Skill用）
    // v2: 再要約上書き型 — 追記ではなく、AIが統合・再要約した内容で上書きする
    const projectContextUpdateBlock = extractJsonBlock(replyText, 'project_context_update')
    let projectContextUpdated = false
    if (projectContextUpdateBlock.value && typeof projectContextUpdateBlock.value === 'object') {
      const pcu = projectContextUpdateBlock.value as { project_id?: string; field?: string; content?: string; mode?: string }
      if (pcu.project_id && pcu.field && pcu.content) {
        const allowedFields = ['key_insights', 'current_status', 'purpose']
        if (allowedFields.includes(pcu.field)) {
          try {
            // ai_project_context テーブルに上書き保存
            const content = pcu.content.slice(0, 500)
            await supabase
              .from('ai_project_context')
              .upsert({
                user_id: user.id,
                project_id: pcu.project_id,
                [pcu.field]: content,
                updated_at: new Date().toISOString(),
              }, { onConflict: 'user_id,project_id' })

            // ai_context_documents にも保存（フォルダ構造）
            const fieldToDocType: Record<string, string> = {
              purpose: 'project_summary',
              current_status: 'project_status',
              key_insights: 'project_insights',
            }
            const docType = fieldToDocType[pcu.field]
            if (docType) {
              // プロジェクトフォルダを取得/作成
              let { data: folder } = await supabase
                .from('ai_context_folders')
                .select('id')
                .eq('user_id', user.id)
                .eq('project_id', pcu.project_id)
                .eq('folder_type', 'project')
                .maybeSingle()

              if (!folder) {
                const { data: newFolder } = await supabase
                  .from('ai_context_folders')
                  .insert({
                    user_id: user.id,
                    project_id: pcu.project_id,
                    folder_type: 'project',
                    name: 'プロジェクト',
                  })
                  .select('id')
                  .single()
                folder = newFolder
              }

              if (folder) {
                // 既存ドキュメントを検索
                const { data: existingDoc } = await supabase
                  .from('ai_context_documents')
                  .select('id')
                  .eq('user_id', user.id)
                  .eq('folder_id', folder.id)
                  .eq('document_type', docType)
                  .maybeSingle()

                const docTitle = pcu.field === 'purpose' ? 'プロジェクト概要'
                  : pcu.field === 'current_status' ? '現在の状況'
                  : '重要な知見'

                if (existingDoc) {
                  // 上書き更新
                  await supabase
                    .from('ai_context_documents')
                    .update({
                      content,
                      content_updated_at: new Date().toISOString(),
                      source: 'ai_auto',
                    })
                    .eq('id', existingDoc.id)
                } else {
                  // 新規作成
                  await supabase
                    .from('ai_context_documents')
                    .insert({
                      user_id: user.id,
                      folder_id: folder.id,
                      title: docTitle,
                      content,
                      document_type: docType,
                      source: 'ai_auto',
                      content_updated_at: new Date().toISOString(),
                    })
                }
              }
            }

            projectContextUpdated = true
          } catch (err) {
            console.error('[chat] project_context_update save failed:', err)
          }
        }
      }
    }
    replyText = projectContextUpdateBlock.text

    // 残存するJSONコードブロックをクリーンアップ（AIが中途半端なJSONを返した場合）
    replyText = replyText.replace(/```\w*\s*\n[\s\S]*?(\n```|$)/g, '').trim()

    // --- Task skill: プロジェクト名→ID逆引き（ツール未使用時のみ） ---
    // AIがproject_idにプロジェクト名を入れた場合、UUIDに変換する
    if (action?.type === 'add_task' && projects) {
      const projectIdRaw = String(action.params.project_id || '')
      const UUID_REGEX_CHECK = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      if (projectIdRaw && !UUID_REGEX_CHECK.test(projectIdRaw)) {
        // プロジェクト名からIDを逆引き
        const matchedProject = projects.find(p =>
          projectIdRaw.includes(p.title) || p.title.includes(projectIdRaw)
        )
        if (matchedProject) {
          action = {
            ...action,
            params: { ...action.params, project_id: matchedProject.id },
          }
        } else if (projects.length === 1) {
          // プロジェクトが1つしかない場合はそれを使う
          action = {
            ...action,
            params: { ...action.params, project_id: projects[0].id },
          }
        }
      }
      // project_idが未設定でプロジェクトが1つの場合は自動設定
      if (!action.params.project_id && projects.length === 1) {
        action = {
          ...action,
          params: { ...action.params, project_id: projects[0].id },
        }
      }
    }

    // 会話テキストからプロジェクト名を解決（「プロジェクト「〇〇」に追加して」パターン）
    if (activeSkillId === 'task' && !action && projects) {
      const projectNameMatch = message.match(/プロジェクト「([^」]+)」/)
      if (projectNameMatch) {
        const targetProject = projects.find(p => p.title === projectNameMatch[1])
        if (targetProject) {
          // プロジェクトが確定したことをAIの文脈に追加（次のリクエストでactionが生成されやすくなる）
          // この場合はoptionsを返さず、AIに再度actionを生成させるための情報を追加
        }
      }
    }

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
    // 予定登録は「所要時間 → カレンダー(複数時のみ) → 開始時間」を順に確定してから実行する
    // time_preference は独立ステップではなく、start_time 選定時の内部パラメータとして使用
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

      // カレンダー自動選択: 1つしかない場合はデフォルトを使う
      const hasSingleCalendar = validCalendarIds.size <= 1
      const candidateCalendarId =
        confirmedCalendarFromOption
        || inferredCalendarFromText
        || (typeof action?.params?.calendar_id === 'string' && validCalendarIds.has(action.params.calendar_id) ? action.params.calendar_id : undefined)
        || (bestProposal && validCalendarIds.has(bestProposal.calendarId) ? bestProposal.calendarId : undefined)
        || (hasSingleCalendar ? defaultCalendarId : undefined)

      const hasKnownDuration = Number.isFinite(confirmedDurationMin)
      // 明示的な開始時間(「10時から」等)があれば start_time も確定とみなす
      const hasKnownStart = !!candidateStartAt || hasExplicitStart
      const hasKnownCalendar = !!candidateCalendarId

      // 順序: duration → calendar(複数時のみ) → start_time
      const nextMissing: MissingField[] = []
      if (!hasKnownDuration) nextMissing.push('duration')
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
          // 空き時間データから根拠付きの候補を生成（時間帯の好みも考慮）
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
      skillId: activeSkillId,
      contextUpdate,
      projectContextUpdated,
      ...(toolsExecuted ? { toolResults: allToolResults } : {}),
    })
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error'
    console.error('Chat error:', errMsg, error)

    // Google API固有のエラーをユーザーフレンドリーなメッセージに変換
    if (errMsg.includes('API key not valid') || errMsg.includes('API_KEY_INVALID')) {
      return NextResponse.json({ error: 'AI設定を確認してください（APIキーエラー）', errorCode: 'API_KEY_INVALID' }, { status: 503 })
    }
    if (errMsg.includes('quota') || errMsg.includes('429') || errMsg.includes('RATE_LIMIT')) {
      return NextResponse.json({ error: 'リクエスト上限に達しました。しばらくお待ちください', errorCode: 'RATE_LIMIT' }, { status: 429 })
    }
    if (errMsg.includes('No available Gemini model')) {
      return NextResponse.json({ error: 'AIモデルに接続できません。しばらくお待ちください', errorCode: 'MODEL_UNAVAILABLE' }, { status: 503 })
    }

    return NextResponse.json({ error: 'AIチャット中にエラーが発生しました', errorCode: 'UNKNOWN' }, { status: 500 })
  }
}
