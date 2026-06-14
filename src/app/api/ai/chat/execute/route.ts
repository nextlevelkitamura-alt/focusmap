import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'
import { getCalendarClient } from '@/lib/google-calendar'
import type { calendar_v3 } from 'googleapis'
import type { SupabaseClient } from '@supabase/supabase-js'

function isMissingCalendarEventError(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const status = 'status' in error ? (error as { status?: unknown }).status : undefined
  const code = 'code' in error ? (error as { code?: unknown }).code : undefined
  return status === 404 || code === 404
}

function toRestorableGoogleEvent(event: calendar_v3.Schema$Event): calendar_v3.Schema$Event {
  return {
    summary: event.summary || undefined,
    description: event.description || undefined,
    location: event.location || undefined,
    start: event.start || undefined,
    end: event.end || undefined,
    recurrence: event.recurrence || undefined,
    attendees: event.attendees || undefined,
    reminders: event.reminders || undefined,
    colorId: event.colorId || undefined,
    transparency: event.transparency || undefined,
    visibility: event.visibility || undefined,
    extendedProperties: event.extendedProperties || undefined,
  }
}

function dateFromGoogleEventTime(value: calendar_v3.Schema$EventDateTime | undefined): Date | null {
  const raw = value?.dateTime || value?.date
  if (!raw) return null
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? null : date
}

function isSameMinute(a: Date | null, b: Date | null, toleranceMinutes = 5) {
  if (!a || !b) return false
  return Math.abs(a.getTime() - b.getTime()) <= toleranceMinutes * 60 * 1000
}

function titleMatches(actual: string | null | undefined, expected: string | undefined) {
  if (!expected) return true
  const normalizedActual = (actual || '').trim().toLowerCase()
  const normalizedExpected = expected.trim().toLowerCase()
  if (!normalizedActual || !normalizedExpected) return false
  return normalizedActual === normalizedExpected ||
    normalizedActual.includes(normalizedExpected) ||
    normalizedExpected.includes(normalizedActual)
}

function buildDeleteSearchWindow(startTime?: string, endTime?: string) {
  const start = startTime ? new Date(startTime) : null
  const end = endTime ? new Date(endTime) : null
  if (start && !Number.isNaN(start.getTime())) {
    const windowStart = new Date(start.getTime() - 30 * 60 * 1000)
    const windowEnd = end && !Number.isNaN(end.getTime())
      ? new Date(end.getTime() + 30 * 60 * 1000)
      : new Date(start.getTime() + 2 * 60 * 60 * 1000)
    return { windowStart, windowEnd, expectedStart: start, expectedEnd: end && !Number.isNaN(end.getTime()) ? end : null }
  }

  const now = new Date()
  return {
    windowStart: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000),
    windowEnd: new Date(now.getTime() + 45 * 24 * 60 * 60 * 1000),
    expectedStart: null,
    expectedEnd: null,
  }
}

async function resolveCalendarEventForDeletion(params: {
  supabase: SupabaseClient
  calendar: calendar_v3.Calendar
  userId: string
  calendarId: string
  providedEventId: string
  title?: string
  startTime?: string
  endTime?: string
  deleteScope: 'this' | 'series'
  recurringEventId?: string
}) {
  const {
    supabase,
    calendar,
    userId,
    calendarId,
    providedEventId,
    title,
    startTime,
    endTime,
    deleteScope,
    recurringEventId,
  } = params
  const { windowStart, windowEnd, expectedStart, expectedEnd } = buildDeleteSearchWindow(startTime, endTime)

  const tryGoogleGet = async (eventId: string) => {
    try {
      const eventRes = await calendar.events.get({ calendarId, eventId })
      return eventRes.data
    } catch (error) {
      if (!isMissingCalendarEventError(error)) throw error
      return null
    }
  }

  const resolveFromGoogleEvent = (event: calendar_v3.Schema$Event, source: string) => {
    const instanceEventId = event.id
    if (!instanceEventId) return null
    return {
      eventId: deleteScope === 'series' ? (recurringEventId || event.recurringEventId || instanceEventId) : instanceEventId,
      instanceEventId,
      event,
      source,
    }
  }

  const directEvent = await tryGoogleGet(providedEventId)
  if (directEvent) return resolveFromGoogleEvent(directEvent, 'provided_google_id')

  if (recurringEventId && recurringEventId !== providedEventId) {
    const recurringEvent = await tryGoogleGet(recurringEventId)
    if (recurringEvent) return resolveFromGoogleEvent(recurringEvent, 'provided_recurring_id')
  }

  const cachedMatches = []
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (uuidPattern.test(providedEventId)) {
    const { data } = await supabase
      .from('calendar_events')
      .select('id, google_event_id, recurring_event_id, title, start_time, end_time')
      .eq('user_id', userId)
      .eq('calendar_id', calendarId)
      .eq('id', providedEventId)
      .maybeSingle()
    if (data) cachedMatches.push(data)
  }

  const { data: cachedByGoogleId } = await supabase
    .from('calendar_events')
    .select('id, google_event_id, recurring_event_id, title, start_time, end_time')
    .eq('user_id', userId)
    .eq('calendar_id', calendarId)
    .eq('google_event_id', providedEventId)
    .maybeSingle()
  if (cachedByGoogleId) cachedMatches.push(cachedByGoogleId)

  let query = supabase
    .from('calendar_events')
    .select('id, google_event_id, recurring_event_id, title, start_time, end_time')
    .eq('user_id', userId)
    .eq('calendar_id', calendarId)
    .gte('start_time', windowStart.toISOString())
    .lte('start_time', windowEnd.toISOString())
    .limit(10)
  if (title) query = query.ilike('title', `%${title}%`)
  const { data: cachedByTime } = await query
  if (cachedByTime) cachedMatches.push(...cachedByTime)

  const bestCached = cachedMatches.find(event => {
    const cachedStart = new Date(event.start_time)
    const cachedEnd = new Date(event.end_time)
    return titleMatches(event.title, title) &&
      (!expectedStart || isSameMinute(cachedStart, expectedStart)) &&
      (!expectedEnd || isSameMinute(cachedEnd, expectedEnd))
  }) || cachedMatches.find(event => titleMatches(event.title, title))

  if (bestCached?.google_event_id) {
    const cachedTargetId = deleteScope === 'series'
      ? (recurringEventId || bestCached.recurring_event_id || bestCached.google_event_id)
      : bestCached.google_event_id
    const cachedGoogleEvent = await tryGoogleGet(cachedTargetId)
    return {
      eventId: cachedTargetId,
      instanceEventId: bestCached.google_event_id,
      event: cachedGoogleEvent,
      source: cachedGoogleEvent ? 'cached_event_google_id' : 'cached_event_only',
    }
  }

  const listRes = await calendar.events.list({
    calendarId,
    timeMin: windowStart.toISOString(),
    timeMax: windowEnd.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    q: title,
    maxResults: 20,
  })
  const googleMatch = (listRes.data.items || []).find(event => {
    const eventStart = dateFromGoogleEventTime(event.start)
    const eventEnd = dateFromGoogleEventTime(event.end)
    return titleMatches(event.summary, title) &&
      (!expectedStart || isSameMinute(eventStart, expectedStart)) &&
      (!expectedEnd || isSameMinute(eventEnd, expectedEnd))
  }) || (listRes.data.items || []).find(event => titleMatches(event.summary, title))

  if (googleMatch) return resolveFromGoogleEvent(googleMatch, 'google_search')

  return null
}

async function findCalendarContainingEvent(
  calendar: calendar_v3.Calendar,
  calendarIds: string[],
  googleEventId: string,
) {
  for (const candidateCalendarId of Array.from(new Set(calendarIds))) {
    try {
      await calendar.events.get({
        calendarId: candidateCalendarId,
        eventId: googleEventId,
      })
      return candidateCalendarId
    } catch (error) {
      if (!isMissingCalendarEventError(error)) throw error
    }
  }
  return null
}

// POST /api/ai/chat/execute - AIチャットのアクション実行
export async function POST(request: Request) {
  try {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { action } = body as {
      action: { type: string; params: Record<string, unknown> }
    }

    if (!action?.type) {
      return NextResponse.json({ error: 'Action is required' }, { status: 400 })
    }

    switch (action.type) {
      case 'add_task': {
        const { title, project_id, parent_task_id } = action.params as {
          title: string; project_id?: string; parent_task_id?: string
        }
        const taskId = crypto.randomUUID()
        const { error } = await supabase
          .from('tasks')
          .insert({
            id: taskId,
            title,
            user_id: user.id,
            project_id: project_id || null,
            parent_task_id: parent_task_id || null,
            status: 'pending',
          })
        if (error) throw error
        return NextResponse.json({
          success: true,
          message: `✅ タスク「${title}」をマップに追加しました`,
          taskData: { id: taskId, title, project_id: project_id || null, parent_task_id: parent_task_id || null },
          continueOptions: [
            { label: '別のタスクを追加', value: 'タスクを追加したい', silent: true },
            { label: '完了', value: '', silent: true },
          ],
        })
      }

      case 'add_calendar_event': {
        const { title, scheduled_at, estimated_time, calendar_id, project_id } = action.params as {
          title: string; scheduled_at: string; estimated_time?: number
          calendar_id?: string; project_id?: string
        }

        if (calendar_id) {
          const { data: ownedCalendar, error: calendarLookupError } = await supabase
            .from('user_calendars')
            .select('google_calendar_id')
            .eq('user_id', user.id)
            .eq('google_calendar_id', calendar_id)
            .maybeSingle()
          if (calendarLookupError) throw calendarLookupError
          if (!ownedCalendar) {
            return NextResponse.json({ success: false, message: '❌ 選択したカレンダーは利用できません' }, { status: 400 })
          }
        }

        const taskId = crypto.randomUUID()
        const estMin = estimated_time || 60

        // 1. タスク作成（stage='scheduled'で今日ビューに表示可能）
        const { error: taskError } = await supabase
          .from('tasks')
          .insert({
            id: taskId,
            title,
            user_id: user.id,
            project_id: project_id || null,
            scheduled_at,
            estimated_time: estMin,
            calendar_id: calendar_id || null,
            stage: 'scheduled',
            status: 'todo',
            priority: 3,
          })
        if (taskError) throw taskError

        // 2. Google Calendar同期
        let calendarSynced = false
        let resolvedCalendarId: string | null = calendar_id || null
        if (scheduled_at && estMin > 0) {
          if (!resolvedCalendarId) {
            // calendar_id未指定ならデフォルトカレンダーを使用
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
                scheduled_at,
                estimated_time: estMin,
                calendar_id: resolvedCalendarId,
              })
              calendarSynced = true
            } catch (syncError) {
              console.error('[execute] Calendar sync failed:', syncError)
              // タスク作成は成功しているのでエラーにはしない
            }
          }
        }

        const msg = calendarSynced
          ? `✅ 予定「${title}」をカレンダーに登録しました`
          : `✅ 予定「${title}」をタスクとして追加しました`
        return NextResponse.json({
          success: true,
          message: msg,
          eventData: {
            id: taskId,
            title,
            scheduled_at,
            estimated_time: estMin,
            calendar_id: resolvedCalendarId,
          },
        })
      }

      case 'update_calendar_event': {
        const {
          calendar_id,
          calendarId,
          event_id,
          google_event_id,
          googleEventId,
          destination_calendar_id,
          destinationCalendarId,
          title,
          description,
          location,
          start_time,
          startTime,
          end_time,
          endTime,
          estimated_time,
        } = action.params as {
          calendar_id?: string
          calendarId?: string
          event_id?: string
          google_event_id?: string
          googleEventId?: string
          destination_calendar_id?: string
          destinationCalendarId?: string
          title?: string
          description?: string
          location?: string
          start_time?: string
          startTime?: string
          end_time?: string
          endTime?: string
          estimated_time?: number
        }
        const sourceCalendarHint = (calendar_id || calendarId || '').trim()
        const targetCalendarId = (destination_calendar_id || destinationCalendarId || '').trim()
        const eventId = (event_id || google_event_id || googleEventId || '').trim()

        if (!eventId || !targetCalendarId) {
          return NextResponse.json({
            success: false,
            message: '❌ 変更対象の予定または移動先カレンダーを特定できませんでした',
          }, { status: 400 })
        }

        const { data: calendarRows, error: calendarLookupError } = await supabase
          .from('user_calendars')
          .select('google_calendar_id, name, access_level')
          .eq('user_id', user.id)
        if (calendarLookupError) throw calendarLookupError

        const calendarAccessById = new Map(
          (calendarRows || []).map(row => [row.google_calendar_id, row.access_level] as const)
        )
        const calendarNameById = new Map(
          (calendarRows || []).map(row => [row.google_calendar_id, row.name] as const)
        )
        const destinationAccess = targetCalendarId === 'primary' ? 'owner' : calendarAccessById.get(targetCalendarId)
        if (destinationAccess && !['owner', 'writer'].includes(destinationAccess || '')) {
          return NextResponse.json({
            success: false,
            message: '❌ 移動先カレンダーは閲覧専用のため変更できません',
          }, { status: 403 })
        }
        if (!destinationAccess && targetCalendarId !== 'primary') {
          return NextResponse.json({
            success: false,
            message: '❌ 移動先カレンダーが見つかりません',
          }, { status: 400 })
        }

        const { calendar } = await getCalendarClient(user.id)
        const candidateCalendarIds = Array.from(new Set([
          sourceCalendarHint,
          targetCalendarId,
          'primary',
          ...(calendarRows || []).map(row => row.google_calendar_id),
        ].filter((id): id is string => typeof id === 'string' && id.trim().length > 0)))

        const found = sourceCalendarHint
          ? await findCalendarContainingEvent(calendar, [sourceCalendarHint, ...candidateCalendarIds], eventId)
          : await findCalendarContainingEvent(calendar, candidateCalendarIds, eventId)
        if (!found) {
          return NextResponse.json({
            success: false,
            message: '❌ 変更対象の予定が見つかりませんでした',
          }, { status: 404 })
        }

        const sourceCalendarId = found
        const sourceAccess = sourceCalendarId === 'primary' ? 'owner' : calendarAccessById.get(sourceCalendarId)
        if (sourceAccess && !['owner', 'writer'].includes(sourceAccess || '')) {
          return NextResponse.json({
            success: false,
            message: '❌ 移動元カレンダーは閲覧専用のため変更できません',
          }, { status: 403 })
        }

        let currentEvent = (await calendar.events.get({
          calendarId: sourceCalendarId,
          eventId,
        })).data
        const currentStart = currentEvent.start?.dateTime || currentEvent.start?.date
        const currentEnd = currentEvent.end?.dateTime || currentEvent.end?.date
        if (!currentStart || !currentEnd) {
          return NextResponse.json({
            success: false,
            message: '❌ 予定の現在日時を取得できませんでした',
          }, { status: 400 })
        }

        const resolvedStart = new Date(start_time || startTime || currentStart)
        const resolvedEnd = new Date(end_time || endTime || currentEnd)
        if (Number.isNaN(resolvedStart.getTime()) || Number.isNaN(resolvedEnd.getTime()) || resolvedEnd <= resolvedStart) {
          return NextResponse.json({
            success: false,
            message: '❌ 開始/終了日時が不正です',
          }, { status: 400 })
        }

        const nextTitle = title || currentEvent.summary || '予定'
        const nextDescription = description !== undefined ? description : currentEvent.description
        const nextLocation = location !== undefined ? location : currentEvent.location
        const movedCalendar = sourceCalendarId !== targetCalendarId
        let effectiveGoogleEventId = eventId

        if (movedCalendar) {
          const moveResponse = await calendar.events.move({
            calendarId: sourceCalendarId,
            eventId,
            destination: targetCalendarId,
          })
          effectiveGoogleEventId = moveResponse.data.id || eventId
          currentEvent = moveResponse.data.id ? moveResponse.data : currentEvent
        }

        await calendar.events.update({
          calendarId: targetCalendarId,
          eventId: effectiveGoogleEventId,
          requestBody: {
            ...currentEvent,
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
        const durationMinutes = estimated_time && Number.isFinite(estimated_time)
          ? Math.max(1, Math.round(estimated_time))
          : Math.max(1, Math.round((resolvedEnd.getTime() - resolvedStart.getTime()) / 60000))
        const eventPayload = {
          user_id: user.id,
          google_event_id: effectiveGoogleEventId,
          calendar_id: targetCalendarId,
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
        const { data: existingCachedEvent } = await supabase
          .from('calendar_events')
          .select('id')
          .eq('user_id', user.id)
          .eq('calendar_id', targetCalendarId)
          .eq('google_event_id', eventId)
          .maybeSingle()

        if (existingCachedEvent?.id) {
          await supabase
            .from('calendar_events')
            .update(eventPayload)
            .eq('user_id', user.id)
            .eq('id', existingCachedEvent.id)
        } else {
          await supabase
            .from('calendar_events')
            .upsert(eventPayload, { onConflict: 'user_id,calendar_id,google_event_id', ignoreDuplicates: false })
        }

        await supabase
          .from('tasks')
          .update({
            title: nextTitle,
            scheduled_at: resolvedStart.toISOString(),
            estimated_time: durationMinutes,
            calendar_id: targetCalendarId,
            google_event_id: effectiveGoogleEventId,
            updated_at: now,
          })
          .eq('user_id', user.id)
          .eq('google_event_id', eventId)
          .in('calendar_id', Array.from(new Set([sourceCalendarId, targetCalendarId])))

        await supabase
          .from('ideal_goals')
          .update({
            title: nextTitle,
            description: nextDescription || null,
            scheduled_at: resolvedStart.toISOString(),
            duration_minutes: durationMinutes,
            google_event_id: effectiveGoogleEventId,
            memo_status: 'scheduled',
            updated_at: now,
          })
          .eq('user_id', user.id)
          .eq('google_event_id', eventId)

        const destinationLabel = calendarNameById.get(targetCalendarId) || targetCalendarId
        return NextResponse.json({
          success: true,
          message: movedCalendar
            ? `✅ 予定「${nextTitle}」を「${destinationLabel}」へ移動しました`
            : `✅ 予定「${nextTitle}」を更新しました`,
          eventData: {
            id: existingCachedEvent?.id || eventId,
            title: nextTitle,
            scheduled_at: resolvedStart.toISOString(),
            estimated_time: durationMinutes,
            calendar_id: targetCalendarId,
            google_event_id: effectiveGoogleEventId,
            original_google_event_id: eventId,
            start_time: resolvedStart.toISOString(),
            end_time: resolvedEnd.toISOString(),
          },
        })
      }

      case 'delete_calendar_event': {
        const {
          calendar_id,
          event_id,
          google_event_id,
          title,
          start_time,
          end_time,
          delete_scope,
          recurring_event_id,
        } = action.params as {
          calendar_id?: string
          event_id?: string
          google_event_id?: string
          title?: string
          start_time?: string
          end_time?: string
          delete_scope?: 'this' | 'series'
          recurring_event_id?: string
        }
        const calendarId = calendar_id?.trim()
        const eventId = (event_id || google_event_id)?.trim()

        if (!calendarId || !eventId) {
          return NextResponse.json({
            success: false,
            message: '❌ 削除対象の予定を特定できませんでした',
          }, { status: 400 })
        }

        const { data: ownedCalendar, error: calendarLookupError } = await supabase
          .from('user_calendars')
          .select('google_calendar_id, access_level')
          .eq('user_id', user.id)
          .eq('google_calendar_id', calendarId)
          .maybeSingle()
        if (calendarLookupError) throw calendarLookupError
        if (!ownedCalendar && calendarId !== 'primary') {
          return NextResponse.json({
            success: false,
            message: '❌ 選択したカレンダーは利用できません',
          }, { status: 400 })
        }
        if (ownedCalendar && !['owner', 'writer'].includes(ownedCalendar.access_level || '')) {
          return NextResponse.json({
            success: false,
            message: '❌ このカレンダーは閲覧専用のため削除できません',
          }, { status: 403 })
        }

        const { calendar } = await getCalendarClient(user.id)
        const requestedScope = delete_scope === 'series' ? 'series' : 'this'
        let targetEventId = requestedScope === 'series'
          ? (recurring_event_id?.trim() || eventId)
          : eventId
        let instanceEventId = eventId
        let eventSnapshot: calendar_v3.Schema$Event | null = null
        try {
          const eventRes = await calendar.events.get({
            calendarId,
            eventId: targetEventId,
          })
          eventSnapshot = eventRes.data
        } catch (error) {
          if (!isMissingCalendarEventError(error)) throw error
        }

        let resolvedSource = 'provided'
        if (!eventSnapshot) {
          const resolved = await resolveCalendarEventForDeletion({
            supabase,
            calendar,
            userId: user.id,
            calendarId,
            providedEventId: eventId,
            title,
            startTime: start_time,
            endTime: end_time,
            deleteScope: requestedScope,
            recurringEventId: recurring_event_id,
          })
          if (resolved) {
            console.warn('[execute/delete_calendar_event] Resolved stale event id:', {
              providedEventId: eventId,
              resolvedEventId: resolved.eventId,
              instanceEventId: resolved.instanceEventId,
              calendarId,
              source: resolved.source,
            })
            targetEventId = resolved.eventId
            instanceEventId = resolved.instanceEventId
            eventSnapshot = resolved.event || null
            resolvedSource = resolved.source
          }
        }

        if (!eventSnapshot && resolvedSource === 'provided') {
          return NextResponse.json({
            success: false,
            message: '❌ 削除対象の予定IDを特定できませんでした。予定名・日時・カレンダー名を確認してください。',
          }, { status: 404 })
        }

        const undoLog = eventSnapshot
          ? await supabase
              .from('calendar_sync_log')
              .insert({
                user_id: user.id,
                google_event_id: targetEventId,
                action: 'delete_with_undo',
                direction: 'to_calendar',
                status: 'pending',
                sync_data: {
                  calendar_id: calendarId,
                  event_id: targetEventId,
                  original_event_id: eventId,
                  resolved_from: resolvedSource,
                  delete_scope: requestedScope,
                  recurring_event_id: recurring_event_id || eventSnapshot.recurringEventId || null,
                  title: title || eventSnapshot.summary || null,
                  start_time: start_time || eventSnapshot.start?.dateTime || eventSnapshot.start?.date || null,
                  end_time: end_time || eventSnapshot.end?.dateTime || eventSnapshot.end?.date || null,
                  restore_event: toRestorableGoogleEvent(eventSnapshot),
                  restore_mode: requestedScope === 'this' && (recurring_event_id || eventSnapshot.recurringEventId)
                    ? 'standalone_equivalent'
                    : 'event_insert',
                },
              })
              .select('id')
              .single()
          : null
        if (undoLog?.error) throw undoLog.error

        let deletedFromGoogle = false
        try {
          await calendar.events.delete({
            calendarId,
            eventId: targetEventId,
          })
          deletedFromGoogle = true
        } catch (error) {
          if (!isMissingCalendarEventError(error)) throw error
        }

        if (undoLog?.data?.id) {
          await supabase
            .from('calendar_sync_log')
            .update({ status: deletedFromGoogle ? 'success' : 'not_found' })
            .eq('id', undoLog.data.id)
            .eq('user_id', user.id)
        }

        let calendarEventDeleteQuery = supabase
          .from('calendar_events')
          .delete()
          .eq('user_id', user.id)
          .eq('calendar_id', calendarId)

        calendarEventDeleteQuery = requestedScope === 'series'
          ? calendarEventDeleteQuery.or(`google_event_id.eq.${targetEventId},recurring_event_id.eq.${targetEventId}`)
          : calendarEventDeleteQuery.eq('google_event_id', instanceEventId)

        await calendarEventDeleteQuery

        await supabase
          .from('tasks')
          .update({
            deleted_at: new Date().toISOString(),
            is_timer_running: false,
            last_started_at: null,
          })
          .eq('user_id', user.id)
          .eq('calendar_id', calendarId)
          .eq('google_event_id', instanceEventId)
          .is('deleted_at', null)

        await supabase
          .from('ideal_goals')
          .update({
            scheduled_at: null,
            google_event_id: null,
            memo_status: 'unsorted',
            is_today: false,
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', user.id)
          .eq('google_event_id', instanceEventId)

        const dateLabel = start_time
          ? new Date(start_time).toLocaleString('ja-JP', {
              timeZone: 'Asia/Tokyo',
              month: 'numeric',
              day: 'numeric',
              weekday: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })
          : ''
        const displayTitle = title || '予定'
        return NextResponse.json({
          success: true,
          message: deletedFromGoogle
            ? `✅ ${dateLabel ? `${dateLabel}の` : ''}予定「${displayTitle}」をカレンダーから削除しました`
            : `✅ 予定「${displayTitle}」はGoogleカレンダー上に見つかりませんでした。Focusmap側の同期情報を整理しました`,
          eventData: {
            google_event_id: targetEventId,
            original_google_event_id: instanceEventId,
            calendar_id: calendarId,
            title: displayTitle,
            start_time,
            end_time,
            deleted: true,
            delete_scope: requestedScope,
            undo_id: undoLog?.data?.id || null,
          },
        })
      }

      case 'restore_calendar_event': {
        const { undo_id } = action.params as { undo_id?: string }
        if (!undo_id) {
          return NextResponse.json({
            success: false,
            message: '❌ 復元対象が見つかりません',
          }, { status: 400 })
        }

        const { data: undoLog, error: undoLookupError } = await supabase
          .from('calendar_sync_log')
          .select('id, google_event_id, sync_data, created_at')
          .eq('id', undo_id)
          .eq('user_id', user.id)
          .maybeSingle()
        if (undoLookupError) throw undoLookupError
        if (!undoLog?.sync_data || typeof undoLog.sync_data !== 'object') {
          return NextResponse.json({
            success: false,
            message: '❌ 復元データが見つかりません',
          }, { status: 404 })
        }
        const createdAt = new Date(undoLog.created_at).getTime()
        const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000)
        const startOfJstDayUtc = Date.UTC(
          jstNow.getUTCFullYear(),
          jstNow.getUTCMonth(),
          jstNow.getUTCDate(),
          -9,
          0,
          0,
          0,
        )
        if (!Number.isFinite(createdAt) || createdAt < startOfJstDayUtc) {
          return NextResponse.json({
            success: false,
            message: '❌ 復元できるのは当日中に削除した予定のみです',
          }, { status: 400 })
        }

        const syncData = undoLog.sync_data as {
          calendar_id?: string
          restore_event?: calendar_v3.Schema$Event
          title?: string | null
          start_time?: string | null
          end_time?: string | null
        }
        const calendarId = syncData.calendar_id
        const restoreEvent = syncData.restore_event
        if (!calendarId || !restoreEvent) {
          return NextResponse.json({
            success: false,
            message: '❌ 復元データが不完全です',
          }, { status: 400 })
        }

        const { calendar } = await getCalendarClient(user.id)
        const restored = await calendar.events.insert({
          calendarId,
          requestBody: restoreEvent,
        })
        const restoredEventId = restored.data.id
        if (!restoredEventId) {
          throw new Error('Google Calendar did not return a restored event id')
        }

        await supabase
          .from('calendar_sync_log')
          .insert({
            user_id: user.id,
            google_event_id: restoredEventId,
            action: 'restore_delete',
            direction: 'to_calendar',
            status: 'success',
            sync_data: {
              undo_id,
              calendar_id: calendarId,
              restored_google_event_id: restoredEventId,
              original_google_event_id: undoLog.google_event_id,
            },
          })

        const displayTitle = syncData.title || restoreEvent.summary || '予定'
        const dateLabel = syncData.start_time
          ? new Date(syncData.start_time).toLocaleString('ja-JP', {
              timeZone: 'Asia/Tokyo',
              month: 'numeric',
              day: 'numeric',
              weekday: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })
          : ''
        return NextResponse.json({
          success: true,
          message: `✅ ${dateLabel ? `${dateLabel}の` : ''}予定「${displayTitle}」を復元しました`,
          eventData: {
            google_event_id: restoredEventId,
            calendar_id: calendarId,
            title: displayTitle,
            start_time: syncData.start_time,
            end_time: syncData.end_time,
            restored: true,
          },
        })
      }

      case 'edit_memo': {
        const { note_id, content } = action.params as { note_id: string; content: string }
        const { error } = await supabase
          .from('notes')
          .update({ content })
          .eq('id', note_id)
          .eq('user_id', user.id)
        if (error) throw error
        return NextResponse.json({ success: true, message: '✅ メモを更新しました' })
      }

      case 'link_project': {
        const { note_id, project_id } = action.params as { note_id: string; project_id: string }
        const { error } = await supabase
          .from('notes')
          .update({ project_id })
          .eq('id', note_id)
          .eq('user_id', user.id)
        if (error) throw error
        return NextResponse.json({ success: true, message: '✅ プロジェクトを紐付けました' })
      }

      case 'archive_memo': {
        const { note_id } = action.params as { note_id: string }
        const { error } = await supabase
          .from('notes')
          .update({ status: 'archived' })
          .eq('id', note_id)
          .eq('user_id', user.id)
        if (error) throw error
        return NextResponse.json({ success: true, message: '✅ メモを処理済みにしました' })
      }

      case 'update_priority': {
        const { task_id, priority } = action.params as { task_id: string; priority: number }
        const { error } = await supabase
          .from('tasks')
          .update({ priority })
          .eq('id', task_id)
          .eq('user_id', user.id)
        if (error) throw error
        return NextResponse.json({ success: true, message: `✅ 優先度を${priority}に変更しました` })
      }

      case 'set_deadline': {
        const { task_id, scheduled_at, estimated_time } = action.params as {
          task_id: string; scheduled_at: string; estimated_time?: number
        }
        const updateData: Record<string, unknown> = { scheduled_at }
        if (estimated_time) updateData.estimated_time = estimated_time
        const { error } = await supabase
          .from('tasks')
          .update(updateData)
          .eq('id', task_id)
          .eq('user_id', user.id)
        if (error) throw error
        return NextResponse.json({ success: true, message: '✅ 締切を設定しました' })
      }

      case 'add_mindmap_group': {
        const { title, project_id } = action.params as {
          title: string; project_id: string
        }
        // 現在の最大order_indexを取得
        const { data: maxOrderGroup } = await supabase
          .from('tasks')
          .select('order_index')
          .eq('user_id', user.id)
          .eq('project_id', project_id)
          .is('parent_task_id', null)
          .is('deleted_at', null)
          .order('order_index', { ascending: false })
          .limit(1)
          .maybeSingle()

        const nextOrder = (maxOrderGroup?.order_index ?? -1) + 1

        const { error } = await supabase
          .from('tasks')
          .insert({
            title,
            user_id: user.id,
            project_id,
            is_group: true,
            parent_task_id: null,
            status: 'todo',
            stage: 'plan',
            order_index: nextOrder,
          })
        if (error) throw error
        return NextResponse.json({
          success: true,
          message: `✅ マインドマップに「${title}」グループを追加しました`,
          actionType: 'mindmap_updated',
        })
      }

      case 'add_mindmap_task': {
        const { title, parent_id, project_id } = action.params as {
          title: string; parent_id: string; project_id: string
        }
        // 親ノードの存在確認
        const { data: parentNode } = await supabase
          .from('tasks')
          .select('id, title')
          .eq('id', parent_id)
          .eq('user_id', user.id)
          .is('deleted_at', null)
          .maybeSingle()

        if (!parentNode) {
          return NextResponse.json({
            success: false,
            message: '❌ 指定された親ノードが見つかりません',
          }, { status: 400 })
        }

        // 現在の最大order_indexを取得
        const { data: maxOrderTask } = await supabase
          .from('tasks')
          .select('order_index')
          .eq('user_id', user.id)
          .eq('parent_task_id', parent_id)
          .is('deleted_at', null)
          .order('order_index', { ascending: false })
          .limit(1)
          .maybeSingle()

        const nextTaskOrder = (maxOrderTask?.order_index ?? -1) + 1

        const { error } = await supabase
          .from('tasks')
          .insert({
            title,
            user_id: user.id,
            project_id,
            parent_task_id: parent_id,
            is_group: false,
            status: 'todo',
            stage: 'plan',
            order_index: nextTaskOrder,
          })
        if (error) throw error
        return NextResponse.json({
          success: true,
          message: `✅ 「${parentNode.title}」に「${title}」を追加しました`,
          actionType: 'mindmap_updated',
        })
      }

      case 'delete_mindmap_node': {
        const { node_id, node_title } = action.params as {
          node_id: string; node_title?: string
        }
        // ノードの存在確認（所有者チェック）
        const { data: targetNode } = await supabase
          .from('tasks')
          .select('id, title, is_group')
          .eq('id', node_id)
          .eq('user_id', user.id)
          .is('deleted_at', null)
          .maybeSingle()

        if (!targetNode) {
          return NextResponse.json({
            success: false,
            message: '❌ 指定されたノードが見つかりません',
          }, { status: 400 })
        }

        // ソフトデリート（deleted_at を設定）
        const now = new Date().toISOString()
        const { error } = await supabase
          .from('tasks')
          .update({ deleted_at: now })
          .eq('id', node_id)
          .eq('user_id', user.id)

        if (error) throw error

        // グループの場合は子タスクもソフトデリート
        if (targetNode.is_group) {
          await supabase
            .from('tasks')
            .update({ deleted_at: now })
            .eq('parent_task_id', node_id)
            .eq('user_id', user.id)
            .is('deleted_at', null)
        }

        const displayTitle = node_title || targetNode.title
        return NextResponse.json({
          success: true,
          message: `✅ マインドマップから「${displayTitle}」を削除しました`,
          actionType: 'mindmap_updated',
        })
      }

      default:
        return NextResponse.json({ success: false, message: `未対応のアクション: ${action.type}` }, { status: 400 })
    }
  } catch (error) {
    console.error('Execute action error:', error)
    const errMsg = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ success: false, message: `❌ 実行に失敗しました: ${errMsg}` }, { status: 500 })
  }
}
