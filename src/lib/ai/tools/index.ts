/**
 * AI ツール定義 — Vercel AI SDK の tool() で定義
 *
 * Phase 1: ツール定義のみ作成（まだ generateText に渡していない）
 * Phase 2: generateText の tools に渡してエージェントループを有効化
 */
import { tool } from 'ai'
import { z } from 'zod/v3'
import { createClient } from '@/utils/supabase/server'
import { normalizeVisibility, resolveAiTaskSpaceId } from '@/lib/space-access'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

const PROJECT_CONTEXT_STATUSES = ['not_started', 'in_progress', 'blocked', 'done', 'archived'] as const

function compactText(value: unknown, limit: number): string {
  if (typeof value !== 'string') return ''
  return Array.from(value.trim()).slice(0, limit).join('')
}

function minutesBetween(startTime: string, endTime: string): number {
  const startMs = new Date(startTime).getTime()
  const endMs = new Date(endTime).getTime()
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 0
  return Math.round((endMs - startMs) / 60000)
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000)
}

function normalizeLimit(value: number | undefined, fallback: number, max: number): number {
  if (!value || !Number.isFinite(value)) return fallback
  return Math.max(1, Math.min(max, Math.floor(value)))
}

function isWritableCalendar(accessLevel: string | null | undefined): boolean {
  return accessLevel === 'owner' || accessLevel === 'writer'
}

function eventTextMatches(
  event: { title?: string | null; description?: string | null; location?: string | null },
  query: string | undefined,
): boolean {
  const needle = query?.trim().toLowerCase()
  if (!needle) return true
  return [event.title, event.description, event.location]
    .filter((value): value is string => typeof value === 'string')
    .some(value => value.toLowerCase().includes(needle))
}

function recordTextMatches(record: Record<string, unknown>, keys: string[], query: string | undefined): boolean {
  const needle = query?.trim().toLowerCase()
  if (!needle) return true
  return keys.some(key => {
    const value = record[key]
    return typeof value === 'string' && value.toLowerCase().includes(needle)
  })
}

async function requireAuthedUser(supabase: SupabaseServerClient) {
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

async function getSelectedCalendarIds(
  supabase: SupabaseServerClient,
  userId: string,
  requestedCalendarIds?: string[],
): Promise<string[]> {
  const cleanedRequested = (requestedCalendarIds || [])
    .map(id => id.trim())
    .filter(Boolean)
  if (cleanedRequested.length > 0) return Array.from(new Set(cleanedRequested))

  const { data } = await supabase
    .from('user_calendars')
    .select('google_calendar_id, selected, is_primary')
    .eq('user_id', userId)

  const selected = (data || [])
    .filter(calendar => calendar.selected)
    .map(calendar => calendar.google_calendar_id)
    .filter(Boolean)
  if (selected.length > 0) return Array.from(new Set(selected))

  const primary = (data || []).find(calendar => calendar.is_primary)?.google_calendar_id
  return primary ? [primary] : ['primary']
}

async function findWritableCalendar(
  supabase: SupabaseServerClient,
  userId: string,
  calendarId: string,
) {
  if (calendarId === 'primary') return { google_calendar_id: calendarId, access_level: 'owner' }
  const { data, error } = await supabase
    .from('user_calendars')
    .select('google_calendar_id, access_level')
    .eq('user_id', userId)
    .eq('google_calendar_id', calendarId)
    .maybeSingle()

  if (error) throw error
  return data
}

async function findCalendarContainingGoogleEvent(
  userId: string,
  googleEventId: string,
  candidateCalendarIds: string[],
) {
  const { getCalendarClient } = await import('@/lib/google-calendar')
  const { calendar } = await getCalendarClient(userId)
  for (const calendarId of candidateCalendarIds) {
    try {
      const response = await calendar.events.get({ calendarId, eventId: googleEventId })
      if (response.data.id) return { calendarId, event: response.data }
    } catch {
      // Keep searching other calendars. The caller reports a clear not-found error.
    }
  }
  return null
}

// ━━━ タスク関連 ━━━

export const addTask = tool({
  description: 'マインドマップにタスクを追加する。ユーザーが「〜をやりたい」「〜を追加して」と言った時に使う。',
  inputSchema: z.object({
    title: z.string().describe('タスクのタイトル'),
    projectId: z.string().optional().describe('プロジェクトID（指定なしの場合はnull）'),
    parentTaskId: z.string().optional().describe('親タスクのID（サブタスクの場合）'),
  }),
  execute: async ({ title, projectId, parentTaskId }) => {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: '認証エラー' }

    const taskId = crypto.randomUUID()
    const { error } = await supabase.from('tasks').insert({
      id: taskId,
      title,
      user_id: user.id,
      project_id: projectId || null,
      parent_task_id: parentTaskId || null,
      status: 'pending',
    })
    if (error) return { success: false, error: error.message }
    return { success: true, taskId, title, message: `タスク「${title}」を追加しました` }
  },
})

// ━━━ カレンダー関連 ━━━

export const addCalendarEvent = tool({
  description: 'Googleカレンダーに予定を追加する。日時が含まれる発言の時に使う。',
  inputSchema: z.object({
    title: z.string().describe('予定のタイトル'),
    scheduledAt: z.string().describe('開始日時（ISO 8601形式、例: 2026-03-01T10:00:00+09:00）'),
    estimatedTime: z.number().optional().describe('所要時間（分）。デフォルト60分'),
    calendarId: z.string().optional().describe('GoogleカレンダーID。未指定ならデフォルトカレンダー'),
    projectId: z.string().optional().describe('紐付けるプロジェクトID'),
  }),
  execute: async ({ title, scheduledAt, estimatedTime, calendarId, projectId }) => {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: '認証エラー' }

    // カレンダー所有権チェック
    if (calendarId) {
      const { data: ownedCalendar } = await supabase
        .from('user_calendars')
        .select('google_calendar_id')
        .eq('user_id', user.id)
        .eq('google_calendar_id', calendarId)
        .maybeSingle()
      if (!ownedCalendar) return { success: false, error: '選択したカレンダーは利用できません' }
    }

    const taskId = crypto.randomUUID()
    const estMin = estimatedTime || 60

    // タスク作成
    const { error: taskError } = await supabase.from('tasks').insert({
      id: taskId,
      title,
      user_id: user.id,
      project_id: projectId || null,
      scheduled_at: scheduledAt,
      estimated_time: estMin,
      calendar_id: calendarId || null,
      stage: 'scheduled',
      status: 'todo',
      priority: 3,
    })
    if (taskError) return { success: false, error: taskError.message }

    // Google Calendar 同期
    let calendarSynced = false
    let resolvedCalendarId = calendarId || null
    if (scheduledAt && estMin > 0) {
      if (!resolvedCalendarId) {
        const { data: settings } = await supabase
          .from('user_calendar_settings')
          .select('is_sync_enabled, default_calendar_id')
          .eq('user_id', user.id)
          .maybeSingle()
        if (settings?.is_sync_enabled) {
          resolvedCalendarId = settings.default_calendar_id || 'primary'
          await supabase.from('tasks').update({ calendar_id: resolvedCalendarId }).eq('id', taskId)
        }
      }
      if (resolvedCalendarId) {
        try {
          const { syncTaskToCalendar } = await import('@/lib/google-calendar')
          await syncTaskToCalendar(user.id, taskId, {
            title,
            scheduled_at: scheduledAt,
            estimated_time: estMin,
            calendar_id: resolvedCalendarId,
          })
          calendarSynced = true
        } catch (e) {
          console.error('[tool:addCalendarEvent] Calendar sync failed:', e)
        }
      }
    }

    return {
      success: true,
      taskId,
      title,
      scheduledAt,
      calendarSynced,
      message: calendarSynced
        ? `予定「${title}」をカレンダーに登録しました`
        : `予定「${title}」をタスクとして追加しました`,
    }
  },
})

// ━━━ プロジェクト / Focusmap DB 関連 ━━━

export const listProjects = tool({
  description:
    'Focusmapのプロジェクト一覧を確認する。ユーザーがプロジェクト名を曖昧に言った時、またはどのプロジェクトに記録するか確認したい時に使う。',
  inputSchema: z.object({
    query: z.string().optional().describe('プロジェクト名・説明の検索語。未指定なら最近のプロジェクトを返す。'),
    includeArchived: z.boolean().optional().describe('archived/completed も含めるか。通常はfalse。'),
    limit: z.number().optional().describe('返す件数。最大20件。'),
  }),
  execute: async ({ query, includeArchived, limit }) => {
    const supabase = await createClient()
    const user = await requireAuthedUser(supabase)
    if (!user) return { success: false, error: '認証エラー' }

    const maxRows = normalizeLimit(limit, 10, 20)
    let dbQuery = supabase
      .from('projects')
      .select('id, title, description, status, space_id, repo_path, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(query?.trim() ? Math.min(maxRows * 5, 100) : maxRows)

    if (!includeArchived) {
      dbQuery = dbQuery.not('status', 'in', '("archived","completed")')
    }

    const { data, error } = await dbQuery
    if (error) return { success: false, error: error.message }
    const projects = (data || [])
      .filter(project => recordTextMatches(project, ['title', 'description'], query))
      .slice(0, maxRows)
    return {
      success: true,
      projects,
      message: `${projects.length}件のプロジェクトを取得しました`,
    }
  },
})

export const getProjectContext = tool({
  description:
    'プロジェクトの概要、蓄積コンテキスト、最近のタスクをFocusmap DBから確認する。プロジェクトについて話す前提を読む時に使う。',
  inputSchema: z.object({
    projectId: z.string().describe('プロジェクトID'),
    includeTasks: z.boolean().optional().describe('最近のタスクも取得するか。通常はtrue。'),
    taskLimit: z.number().optional().describe('取得するタスク件数。最大30件。'),
  }),
  execute: async ({ projectId, includeTasks, taskLimit }) => {
    const supabase = await createClient()
    const user = await requireAuthedUser(supabase)
    if (!user) return { success: false, error: '認証エラー' }

    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id, title, description, purpose, status, space_id, repo_path, created_at')
      .eq('user_id', user.id)
      .eq('id', projectId)
      .maybeSingle()
    if (projectError) return { success: false, error: projectError.message }
    if (!project) return { success: false, error: 'プロジェクトが見つかりません' }

    const { data: context, error: contextError } = await supabase
      .from('project_contexts')
      .select('id, heading, details, progress, progress_status, progress_updated_at, updated_at')
      .eq('user_id', user.id)
      .eq('project_id', projectId)
      .maybeSingle()
    if (contextError) return { success: false, error: contextError.message }

    let tasks: unknown[] = []
    if (includeTasks !== false) {
      const maxRows = normalizeLimit(taskLimit, 12, 30)
      const { data: taskRows, error: taskError } = await supabase
        .from('tasks')
        .select('id, title, status, stage, priority, scheduled_at, estimated_time, parent_task_id, is_group, updated_at')
        .eq('user_id', user.id)
        .eq('project_id', projectId)
        .is('deleted_at', null)
        .order('updated_at', { ascending: false })
        .limit(maxRows)
      if (taskError) return { success: false, error: taskError.message }
      tasks = taskRows || []
    }

    return {
      success: true,
      project,
      context: context || null,
      tasks,
      message: `プロジェクト「${project.title}」のDB情報を取得しました`,
    }
  },
})

export const saveProjectContext = tool({
  description:
    'プロジェクトの概要や進捗メモをFocusmap DBへ記録・更新する。「このプロジェクトについて記録して」「概要を更新して」などで使う。',
  inputSchema: z.object({
    projectId: z.string().describe('プロジェクトID'),
    projectDescription: z.string().optional().describe('projects.description に保存するプロジェクト概要。未指定なら変更しない。'),
    heading: z.string().optional().describe('project_contexts.heading に保存する短い見出し。'),
    details: z.string().optional().describe('project_contexts.details に保存する詳細メモ。'),
    progress: z.string().optional().describe('project_contexts.progress に保存する進捗メモ。'),
    progressStatus: z.enum(PROJECT_CONTEXT_STATUSES).optional().describe('進捗状態。'),
  }),
  execute: async ({ projectId, projectDescription, heading, details, progress, progressStatus }) => {
    const supabase = await createClient()
    const user = await requireAuthedUser(supabase)
    if (!user) return { success: false, error: '認証エラー' }

    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id, title')
      .eq('user_id', user.id)
      .eq('id', projectId)
      .maybeSingle()
    if (projectError) return { success: false, error: projectError.message }
    if (!project) return { success: false, error: 'プロジェクトが見つかりません' }

    const updates: string[] = []
    if (typeof projectDescription === 'string') {
      const description = compactText(projectDescription, 3000)
      const { error } = await supabase
        .from('projects')
        .update({ description })
        .eq('user_id', user.id)
        .eq('id', projectId)
      if (error) return { success: false, error: error.message }
      updates.push('プロジェクト概要')
    }

    const contextPayload: Record<string, unknown> = {
      user_id: user.id,
      project_id: projectId,
    }
    if (typeof heading === 'string') contextPayload.heading = compactText(heading, 160)
    if (typeof details === 'string') contextPayload.details = compactText(details, 3000)
    if (typeof progress === 'string') contextPayload.progress = compactText(progress, 2000)
    if (progressStatus) contextPayload.progress_status = progressStatus

    const hasContextUpdate = ['heading', 'details', 'progress', 'progress_status']
      .some(key => Object.prototype.hasOwnProperty.call(contextPayload, key))
    if (hasContextUpdate) {
      const { error } = await supabase
        .from('project_contexts')
        .upsert(contextPayload, { onConflict: 'project_id,user_id' })
      if (error) return { success: false, error: error.message }
      updates.push('蓄積コンテキスト')
    }

    if (updates.length === 0) {
      return { success: false, error: '保存する内容が指定されていません' }
    }

    return {
      success: true,
      projectId,
      projectTitle: project.title,
      updated: updates,
      message: `「${project.title}」の${updates.join('・')}を更新しました`,
    }
  },
})

export const listProjectTasks = tool({
  description:
    'Focusmap DBのタスク/マップノードを確認する。プロジェクト内の記録・既存タスク・予定化済みタスクを確認したい時に使う。',
  inputSchema: z.object({
    projectId: z.string().optional().describe('プロジェクトID。未指定なら全プロジェクトから検索する。'),
    query: z.string().optional().describe('タスク名やメモ内の検索語。'),
    status: z.string().optional().describe('todo / pending / done などで絞り込む。'),
    includeGroups: z.boolean().optional().describe('グループノードも含めるか。通常はtrue。'),
    limit: z.number().optional().describe('返す件数。最大40件。'),
  }),
  execute: async ({ projectId, query, status, includeGroups, limit }) => {
    const supabase = await createClient()
    const user = await requireAuthedUser(supabase)
    if (!user) return { success: false, error: '認証エラー' }

    const maxRows = normalizeLimit(limit, 20, 40)
    let dbQuery = supabase
      .from('tasks')
      .select('id, project_id, parent_task_id, is_group, title, status, stage, priority, scheduled_at, estimated_time, calendar_id, google_event_id, memo, updated_at')
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
      .limit(query?.trim() ? Math.min(maxRows * 5, 200) : maxRows)

    if (projectId) dbQuery = dbQuery.eq('project_id', projectId)
    if (status) dbQuery = dbQuery.eq('status', status)
    if (includeGroups === false) dbQuery = dbQuery.eq('is_group', false)

    const { data, error } = await dbQuery
    if (error) return { success: false, error: error.message }
    const tasks = (data || [])
      .filter(task => recordTextMatches(task, ['title', 'memo'], query))
      .slice(0, maxRows)
    return {
      success: true,
      tasks,
      message: `${tasks.length}件のタスク/ノードを取得しました`,
    }
  },
})

// ━━━ 予定確認 / 既存予定編集 ━━━

export const listCalendarEvents = tool({
  description:
    '既存のGoogleカレンダー予定を確認する。予定の見出し/内容/時間を変更する前、空き状況を見る前、今日/明日/今週の予定確認に使う。',
  inputSchema: z.object({
    timeMin: z.string().optional().describe('取得開始日時（ISO 8601）。未指定なら現在時刻。'),
    timeMax: z.string().optional().describe('取得終了日時（ISO 8601）。未指定なら7日後。'),
    query: z.string().optional().describe('予定タイトル/説明/場所の検索語。'),
    calendarIds: z.array(z.string()).optional().describe('対象カレンダーID。未指定なら選択中カレンダー。'),
    limit: z.number().optional().describe('返す件数。最大50件。'),
  }),
  execute: async ({ timeMin, timeMax, query, calendarIds, limit }) => {
    const supabase = await createClient()
    const user = await requireAuthedUser(supabase)
    if (!user) return { success: false, error: '認証エラー' }

    const start = timeMin ? new Date(timeMin) : new Date()
    const end = timeMax ? new Date(timeMax) : addMinutes(start, 7 * 24 * 60)
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
      return { success: false, error: 'timeMin/timeMax は有効な期間にしてください' }
    }

    try {
      const resolvedCalendarIds = await getSelectedCalendarIds(supabase, user.id, calendarIds)
      const { fetchCalendarEvents, fetchMultipleCalendarEvents } = await import('@/lib/google-calendar')
      const rawEvents = resolvedCalendarIds.length > 1
        ? await fetchMultipleCalendarEvents(user.id, resolvedCalendarIds, { timeMin: start, timeMax: end })
        : await fetchCalendarEvents(user.id, { calendarId: resolvedCalendarIds[0], timeMin: start, timeMax: end })

      const maxRows = normalizeLimit(limit, 20, 50)
      const events = rawEvents
        .filter(event => eventTextMatches(event, query))
        .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
        .slice(0, maxRows)
        .map(event => ({
          id: event.google_event_id,
          google_event_id: event.google_event_id,
          calendar_id: event.calendar_id,
          title: event.title,
          description: event.description ?? null,
          location: event.location ?? null,
          start_time: event.start_time,
          end_time: event.end_time,
          duration_minutes: minutesBetween(event.start_time, event.end_time),
        }))

      return {
        success: true,
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
        events,
        message: `${events.length}件の予定を取得しました`,
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '予定取得に失敗しました' }
    }
  },
})

export const checkCalendarAvailability = tool({
  description:
    '指定した時間に予定を入れてよいか確認する。候補時間の衝突予定を返し、空いていれば予定作成前の確認材料にする。',
  inputSchema: z.object({
    startTime: z.string().describe('候補の開始日時（ISO 8601）'),
    durationMinutes: z.number().optional().describe('所要時間（分）。デフォルト60分。'),
    calendarIds: z.array(z.string()).optional().describe('対象カレンダーID。未指定なら選択中カレンダー。'),
  }),
  execute: async ({ startTime, durationMinutes, calendarIds }) => {
    const supabase = await createClient()
    const user = await requireAuthedUser(supabase)
    if (!user) return { success: false, error: '認証エラー' }

    const start = new Date(startTime)
    const duration = normalizeLimit(durationMinutes, 60, 24 * 60)
    const end = addMinutes(start, duration)
    if (isNaN(start.getTime())) return { success: false, error: 'startTime が有効な日時ではありません' }

    try {
      const resolvedCalendarIds = await getSelectedCalendarIds(supabase, user.id, calendarIds)
      const { fetchCalendarEvents, fetchMultipleCalendarEvents } = await import('@/lib/google-calendar')
      const rawEvents = resolvedCalendarIds.length > 1
        ? await fetchMultipleCalendarEvents(user.id, resolvedCalendarIds, {
          timeMin: addMinutes(start, -1),
          timeMax: addMinutes(end, 1),
        })
        : await fetchCalendarEvents(user.id, {
          calendarId: resolvedCalendarIds[0],
          timeMin: addMinutes(start, -1),
          timeMax: addMinutes(end, 1),
        })

      const startMs = start.getTime()
      const endMs = end.getTime()
      const conflicts = rawEvents
        .filter(event => {
          const eventStart = new Date(event.start_time).getTime()
          const eventEnd = new Date(event.end_time).getTime()
          return eventStart < endMs && eventEnd > startMs
        })
        .map(event => ({
          google_event_id: event.google_event_id,
          calendar_id: event.calendar_id,
          title: event.title,
          start_time: event.start_time,
          end_time: event.end_time,
        }))

      return {
        success: true,
        available: conflicts.length === 0,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        conflicts,
        message: conflicts.length === 0
          ? 'この時間帯は空いています'
          : `${conflicts.length}件の予定と重なっています`,
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '空き時間確認に失敗しました' }
    }
  },
})

export const updateCalendarEvent = tool({
  description:
    '既存のGoogleカレンダー予定の見出し、内容、場所、開始/終了時刻を変更する。先にlistCalendarEventsで対象のgoogle_event_idとcalendar_idを確認してから使う。',
  inputSchema: z.object({
    googleEventId: z.string().describe('Google Calendar のイベントID'),
    calendarId: z.string().optional().describe('現在その予定が入っているカレンダーID。未指定なら選択中カレンダーから探索する。'),
    title: z.string().optional().describe('新しい見出し。未指定なら変更しない。'),
    description: z.string().optional().describe('新しい内容/説明。空文字なら説明を消す。未指定なら変更しない。'),
    location: z.string().optional().describe('新しい場所。空文字なら場所を消す。未指定なら変更しない。'),
    startTime: z.string().optional().describe('新しい開始日時（ISO 8601）。未指定なら変更しない。'),
    endTime: z.string().optional().describe('新しい終了日時（ISO 8601）。durationMinutes指定時は省略可。'),
    durationMinutes: z.number().optional().describe('startTimeからの所要時間（分）。endTime未指定時に使う。'),
  }),
  execute: async ({ googleEventId, calendarId, title, description, location, startTime, endTime, durationMinutes }) => {
    const supabase = await createClient()
    const user = await requireAuthedUser(supabase)
    if (!user) return { success: false, error: '認証エラー' }

    const { data: calendarRows, error: calendarRowsError } = await supabase
      .from('user_calendars')
      .select('google_calendar_id, access_level, selected, is_primary')
      .eq('user_id', user.id)
    if (calendarRowsError) return { success: false, error: calendarRowsError.message }

    const candidateCalendarIds = Array.from(new Set([
      calendarId,
      ...(calendarRows || []).filter(row => row.selected).map(row => row.google_calendar_id),
      (calendarRows || []).find(row => row.is_primary)?.google_calendar_id,
      'primary',
      ...(calendarRows || []).map(row => row.google_calendar_id),
    ].filter((id): id is string => typeof id === 'string' && id.trim().length > 0)))

    try {
      const found = await findCalendarContainingGoogleEvent(user.id, googleEventId, candidateCalendarIds)
      if (!found) return { success: false, error: '対象の予定が見つかりません' }

      const writable = await findWritableCalendar(supabase, user.id, found.calendarId)
      if (writable && !isWritableCalendar(writable.access_level)) {
        return { success: false, error: 'このカレンダーは閲覧専用のため編集できません' }
      }

      const { getCalendarClient } = await import('@/lib/google-calendar')
      const { calendar } = await getCalendarClient(user.id)
      const current = found.event
      const currentStart = current.start?.dateTime || current.start?.date
      const currentEnd = current.end?.dateTime || current.end?.date
      if (!currentStart || !currentEnd) return { success: false, error: '予定の現在時刻を取得できませんでした' }

      const resolvedStart = startTime ? new Date(startTime) : new Date(currentStart)
      const resolvedEnd = endTime
        ? new Date(endTime)
        : startTime && durationMinutes
          ? addMinutes(resolvedStart, durationMinutes)
          : new Date(currentEnd)
      if (isNaN(resolvedStart.getTime()) || isNaN(resolvedEnd.getTime()) || resolvedEnd <= resolvedStart) {
        return { success: false, error: '開始/終了日時が有効ではありません' }
      }

      const nextTitle = title ?? current.summary ?? '無題'
      const nextDescription = description !== undefined ? description : current.description
      const nextLocation = location !== undefined ? location : current.location

      await calendar.events.update({
        calendarId: found.calendarId,
        eventId: googleEventId,
        requestBody: {
          ...current,
          summary: nextTitle,
          description: nextDescription || undefined,
          location: nextLocation || undefined,
          start: {
            dateTime: resolvedStart.toISOString(),
            timeZone: 'Asia/Tokyo',
          },
          end: {
            dateTime: resolvedEnd.toISOString(),
            timeZone: 'Asia/Tokyo',
          },
        },
      })

      const now = new Date().toISOString()
      const eventPayload = {
        user_id: user.id,
        google_event_id: googleEventId,
        calendar_id: found.calendarId,
        title: nextTitle,
        description: nextDescription || null,
        location: nextLocation || null,
        start_time: resolvedStart.toISOString(),
        end_time: resolvedEnd.toISOString(),
        is_all_day: false,
        timezone: 'Asia/Tokyo',
        updated_at: now,
        synced_at: now,
      }
      await supabase
        .from('calendar_events')
        .upsert(eventPayload, { onConflict: 'user_id,google_event_id', ignoreDuplicates: false })

      const taskUpdates: Record<string, unknown> = {
        title: nextTitle,
        scheduled_at: resolvedStart.toISOString(),
        estimated_time: Math.max(1, minutesBetween(resolvedStart.toISOString(), resolvedEnd.toISOString())),
        calendar_id: found.calendarId,
        updated_at: now,
      }
      await supabase
        .from('tasks')
        .update(taskUpdates)
        .eq('user_id', user.id)
        .eq('google_event_id', googleEventId)

      await supabase
        .from('ideal_goals')
        .update({
          title: nextTitle,
          description: nextDescription || null,
          scheduled_at: resolvedStart.toISOString(),
          duration_minutes: taskUpdates.estimated_time,
          memo_status: 'scheduled',
          updated_at: now,
        })
        .eq('user_id', user.id)
        .eq('google_event_id', googleEventId)

      return {
        success: true,
        googleEventId,
        calendarId: found.calendarId,
        title: nextTitle,
        startTime: resolvedStart.toISOString(),
        endTime: resolvedEnd.toISOString(),
        message: `予定「${nextTitle}」を更新しました`,
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '予定更新に失敗しました' }
    }
  },
})

// ━━━ マインドマップ関連 ━━━

export const addMindmapGroup = tool({
  description: 'マインドマップにグループ（カテゴリ）ノードを追加する',
  inputSchema: z.object({
    title: z.string().describe('グループのタイトル'),
    projectId: z.string().describe('プロジェクトID'),
  }),
  execute: async ({ title, projectId }) => {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: '認証エラー' }

    const { data: maxOrder } = await supabase
      .from('tasks')
      .select('order_index')
      .eq('user_id', user.id)
      .eq('project_id', projectId)
      .is('parent_task_id', null)
      .is('deleted_at', null)
      .order('order_index', { ascending: false })
      .limit(1)
      .maybeSingle()

    const { error } = await supabase.from('tasks').insert({
      title,
      user_id: user.id,
      project_id: projectId,
      is_group: true,
      parent_task_id: null,
      status: 'todo',
      stage: 'plan',
      order_index: (maxOrder?.order_index ?? -1) + 1,
    })
    if (error) return { success: false, error: error.message }
    return { success: true, title, message: `グループ「${title}」を追加しました` }
  },
})

export const addMindmapTask = tool({
  description: 'マインドマップの特定のグループ配下にタスクを追加する',
  inputSchema: z.object({
    title: z.string().describe('タスクのタイトル'),
    parentId: z.string().describe('親ノード（グループ）のID'),
    projectId: z.string().describe('プロジェクトID'),
  }),
  execute: async ({ title, parentId, projectId }) => {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: '認証エラー' }

    // 親ノード存在確認
    const { data: parentNode } = await supabase
      .from('tasks')
      .select('id, title')
      .eq('id', parentId)
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .maybeSingle()
    if (!parentNode) return { success: false, error: '親ノードが見つかりません' }

    const { data: maxOrder } = await supabase
      .from('tasks')
      .select('order_index')
      .eq('user_id', user.id)
      .eq('parent_task_id', parentId)
      .is('deleted_at', null)
      .order('order_index', { ascending: false })
      .limit(1)
      .maybeSingle()

    const { error } = await supabase.from('tasks').insert({
      title,
      user_id: user.id,
      project_id: projectId,
      parent_task_id: parentId,
      is_group: false,
      status: 'todo',
      stage: 'plan',
      order_index: (maxOrder?.order_index ?? -1) + 1,
    })
    if (error) return { success: false, error: error.message }
    return { success: true, title, parentTitle: parentNode.title, message: `「${parentNode.title}」に「${title}」を追加しました` }
  },
})

export const deleteMindmapNode = tool({
  description: 'マインドマップからノードを削除する（ソフトデリート）',
  inputSchema: z.object({
    nodeId: z.string().describe('削除するノードのID'),
  }),
  execute: async ({ nodeId }) => {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: '認証エラー' }

    const { data: targetNode } = await supabase
      .from('tasks')
      .select('id, title, is_group')
      .eq('id', nodeId)
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .maybeSingle()
    if (!targetNode) return { success: false, error: 'ノードが見つかりません' }

    const now = new Date().toISOString()
    const { error } = await supabase
      .from('tasks')
      .update({ deleted_at: now })
      .eq('id', nodeId)
      .eq('user_id', user.id)
    if (error) return { success: false, error: error.message }

    // グループなら子も削除
    if (targetNode.is_group) {
      await supabase
        .from('tasks')
        .update({ deleted_at: now })
        .eq('parent_task_id', nodeId)
        .eq('user_id', user.id)
        .is('deleted_at', null)
    }

    return { success: true, title: targetNode.title, message: `「${targetNode.title}」を削除しました` }
  },
})

// ━━━ 予約実行（サーバー側 ai_tasks キュー） ━━━

// cronのバリデーション（5フィールド形式）— /api/ai-tasks/schedule と同じ仕様
function isValidCron(expr: string): boolean {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return false
  const rangeCheck = (part: string, min: number, max: number) => {
    if (part === '*') return true
    const n = parseInt(part, 10)
    return !isNaN(n) && n >= min && n <= max
  }
  return (
    rangeCheck(parts[0], 0, 59) &&
    rangeCheck(parts[1], 0, 23) &&
    rangeCheck(parts[2], 1, 31) &&
    rangeCheck(parts[3], 1, 12) &&
    rangeCheck(parts[4], 0, 6)
  )
}

/**
 * 予約実行ツール。Mac がオフラインのときや「毎朝/明日やって」等の時間指定タスクを
 * サーバー側 ai_tasks キューに積む。実体は /api/ai-tasks/schedule と同じロジック。
 * spaceId をクロージャで束ねるためファクトリ形式。
 */
export function createScheduleTask(spaceId: string | null) {
  return tool({
    description:
      '指定した日時または繰り返しスケジュールでAIタスクを予約実行する。「明日の朝やって」「毎週月曜に巡回して」などの時間指定や、Macがオフラインで後で実行したいときに使う。実行はサーバー側で行われる。',
    inputSchema: z.object({
      prompt: z.string().describe('予約実行するタスクの指示内容（実行時にこの内容でAIが動く）'),
      scheduledAt: z
        .string()
        .describe('実行開始日時（ISO 8601形式、例: 2026-06-01T08:00:00+09:00）。繰り返しの場合は初回基準時刻。'),
      recurrenceCron: z
        .string()
        .optional()
        .describe('繰り返し実行する場合の5フィールドcron式（例: 毎朝8時なら "0 8 * * *"）。一度きりなら省略。'),
      cwd: z
        .string()
        .optional()
        .describe('実行時の作業ディレクトリ。仕事リポ/求人更新なら /Users/kitamuranaohiro/Private/仕事 などの絶対パスを指定する。'),
      skillId: z
        .string()
        .optional()
        .describe('予約タスクのスキルID。求人更新なら job-update、仕事リポ定期実行なら staff-status-schedule など。'),
      executor: z
        .enum(['claude', 'codex', 'codex_app'])
        .optional()
        .describe('実行器。未指定なら claude。Codexで実行したい場合だけ codex/codex_app を指定する。'),
    }),
    execute: async ({ prompt, scheduledAt, recurrenceCron, cwd, skillId, executor }) => {
      const supabase = await createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return { success: false, error: '認証エラー' }

      if (!prompt || prompt.trim().length === 0) {
        return { success: false, error: 'prompt が空です' }
      }
      if (!scheduledAt || isNaN(Date.parse(scheduledAt))) {
        return { success: false, error: 'scheduledAt は有効なISO8601日時である必要があります' }
      }
      if (!recurrenceCron && new Date(scheduledAt).getTime() < Date.now() - 5 * 60_000) {
        return { success: false, error: 'scheduledAt は未来の日時にしてください' }
      }
      if (recurrenceCron && !isValidCron(recurrenceCron)) {
        return { success: false, error: 'recurrenceCron は有効な5フィールドcron式である必要があります' }
      }

      const resolvedSpace = await resolveAiTaskSpaceId(supabase, user.id, { space_id: spaceId || null })
      if (resolvedSpace.error) return { success: false, error: resolvedSpace.error }

      const { data, error } = await supabase
        .from('ai_tasks')
        .insert({
          user_id: user.id,
          space_id: resolvedSpace.spaceId,
          prompt: prompt.trim(),
          approval_type: 'auto',
          status: 'pending',
          scheduled_at: scheduledAt,
          recurrence_cron: recurrenceCron || null,
          cwd: cwd || null,
          skill_id: skillId || null,
          executor: executor || 'claude',
          run_visibility: normalizeVisibility(undefined, resolvedSpace.spaceId ? 'space' : 'private'),
        })
        .select('id')
        .single()

      if (error) return { success: false, error: error.message }
      return {
        success: true,
        taskId: data.id,
        scheduledAt,
        recurrence: recurrenceCron || null,
        message: recurrenceCron
          ? `繰り返し予約（${recurrenceCron}）を登録しました`
          : `${scheduledAt} に予約を登録しました`,
      }
    },
  })
}

// ━━━ ツール自動実行の有効化判定 ━━━

const TOOL_ENABLED_SKILLS = new Set<string>()

export function isToolEnabledSkill(skillId: string): boolean {
  return TOOL_ENABLED_SKILLS.has(skillId)
}

// ━━━ スキルごとのツールセット ━━━

export function getToolsForSkill(skillId: string) {
  switch (skillId) {
    case 'scheduling':
      return { addCalendarEvent }
    case 'task':
      return { addTask, addMindmapGroup, addMindmapTask }
    case 'project-consultation':
      return { addTask, addCalendarEvent, addMindmapGroup, addMindmapTask, deleteMindmapNode }
    case 'brainstorm':
      return { addTask, addMindmapGroup, addMindmapTask }
    case 'counseling':
      return {}  // カウンセリングはツール不要（対話のみ）
    default:
      return { addTask, addCalendarEvent, addMindmapGroup, addMindmapTask }
  }
}
