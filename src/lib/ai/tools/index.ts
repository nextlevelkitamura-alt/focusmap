/**
 * AI ツール定義 — Vercel AI SDK の tool() で定義
 *
 * Phase 1: ツール定義のみ作成（まだ generateText に渡していない）
 * Phase 2: generateText の tools に渡してエージェントループを有効化
 */
import { tool } from 'ai'
import { z } from 'zod/v3'
import { createClient } from '@/utils/supabase/server'
import { upsertMemoTags } from '@/lib/memo-tags-server'
import { normalizeVisibility, resolveAiTaskSpaceId } from '@/lib/space-access'
import { readMindmapLinks, readPayloadRecord } from '@/lib/mindmap-memo-links'
import { getHiddenCodexInboxTaskIds } from '@/lib/codex-inbox-visibility'
import { DEFAULT_WORKING_HOURS, type WorkingHours } from '@/lib/time-utils'
import { parseAgentCalendarPreferences } from '@/lib/ai/agent-preferences'
import { matchProjectSearch } from '@/lib/ai/project-search'
import {
  formatMindmapOrganizationTree,
  orderMindmapOrganizationNodes,
  suggestMindmapOrganizationCandidates,
  type MindmapOrganizationNodeInput,
} from '@/lib/ai/context/mindmap-organization-harness'
import { replaceActiveMindmapDraft, type SaveMindmapDraftNodeInput } from '@/lib/mindmap-draft-service'
import type { Json } from '@/types/database'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

const PROJECT_CONTEXT_STATUSES = ['not_started', 'in_progress', 'blocked', 'done', 'archived'] as const
const TASK_STAGES = ['plan', 'scheduled', 'executing', 'done', 'archived'] as const
const MEMO_LINK_ACTIONS = ['link', 'move', 'unlink'] as const
const MEMO_SOURCE_TYPES = ['wishlist', 'note'] as const
const NOTE_ORGANIZATION_RECORD_TYPES = ['wishlist', 'memo_item'] as const
const BULK_MEMO_STATUSES = ['unsorted', 'time_candidates', 'organized', 'scheduled'] as const
const TOKYO_TIME_ZONE = 'Asia/Tokyo'
const MAX_BULK_MEMO_ITEMS = 20

type MindmapTaskRow = {
  id: string
  project_id: string | null
  parent_task_id: string | null
  is_group: boolean
  title: string
  status: string
  stage: string
  priority: number | null
  order_index: number
  scheduled_at: string | null
  estimated_time: number
  calendar_id: string | null
  google_event_id: string | null
  memo: string | null
  source?: string | null
  mindmap_collapsed?: boolean | null
  created_at?: string
  updated_at?: string
}

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

function isMissingCalendarEventError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const status = 'status' in error ? (error as { status?: unknown }).status : undefined
  const code = 'code' in error ? (error as { code?: unknown }).code : undefined
  return status === 404 || code === 404
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

function compactPreview(value: string | null | undefined, limit = 120): string | null {
  const text = (value ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return null
  const chars = Array.from(text)
  return chars.length > limit ? `${chars.slice(0, limit).join('')}...` : text
}

function cleanNullableText(value: string | null | undefined, limit = 4000): string | null {
  const text = (value ?? '').trim()
  if (!text) return null
  return Array.from(text).slice(0, limit).join('')
}

function normalizedTextLength(value: string | null | undefined): number {
  return Array.from((value ?? '').replace(/\s+/g, ' ').trim()).length
}

function normalizeDurationMinutes(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.max(1, Math.min(720, Math.round(value)))
}

function normalizeMemoTags(tags: string[] | undefined): string[] {
  const normalized = (tags || [])
    .map(tag => tag.trim())
    .filter(Boolean)
  return Array.from(new Set(normalized)).slice(0, 8)
}

function normalizeMemoCategory(value: string | null | undefined): string | null {
  const text = cleanNullableText(value, 40)
  return text || null
}

function memoKey(title: string, body: string | null, projectId: string | null) {
  return [projectId ?? '', title.replace(/\s+/g, ' ').trim().toLowerCase(), (body ?? '').replace(/\s+/g, ' ').trim().toLowerCase()].join('\n')
}

function pushLinkId(map: Map<string, Set<string>>, key: string | null | undefined, taskId: string | null | undefined) {
  if (!key || !taskId) return
  const current = map.get(key) ?? new Set<string>()
  current.add(taskId)
  map.set(key, current)
}

function setToSortedArray(value: Set<string> | undefined): string[] {
  return Array.from(value ?? []).sort()
}

const tokyoDateKeyFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TOKYO_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function formatTokyoDateKey(date: Date): string {
  return tokyoDateKeyFormatter.format(date)
}

function parseTokyoDateKey(value: string | undefined): string | null {
  if (!value?.trim()) return formatTokyoDateKey(new Date())
  const trimmed = value.trim()
  const dateOnly = trimmed.match(/^\d{4}-\d{2}-\d{2}/)?.[0]
  if (dateOnly) return dateOnly
  const parsed = new Date(trimmed)
  if (isNaN(parsed.getTime())) return null
  return formatTokyoDateKey(parsed)
}

function addTokyoDays(dateKey: string, days: number): string {
  const base = new Date(`${dateKey}T00:00:00+09:00`)
  return formatTokyoDateKey(new Date(base.getTime() + days * 24 * 60 * 60 * 1000))
}

function tokyoDateTime(dateKey: string, timeString: string): Date | null {
  if (!/^\d{2}:\d{2}$/.test(timeString)) return null
  const [hours, minutes] = timeString.split(':').map(Number)
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null
  }
  return new Date(`${dateKey}T${timeString}:00+09:00`)
}

function normalizeWorkingHours(value: WorkingHours | undefined): WorkingHours | null {
  const hours = value ?? DEFAULT_WORKING_HOURS
  if (!tokyoDateTime('2026-01-01', hours.start) || !tokyoDateTime('2026-01-01', hours.end)) return null
  const start = tokyoDateTime('2026-01-01', hours.start)!
  const end = tokyoDateTime('2026-01-01', hours.end)!
  if (end <= start) return null
  return hours
}

type BusySlotSource = {
  id?: string | null
  title?: string | null
  start: string | Date
  end: string | Date
  source: 'calendar' | 'task'
  calendar_id?: string | null
  project_id?: string | null
}

type BusySlot = {
  id: string | null
  title: string
  source: 'calendar' | 'task'
  calendar_id: string | null
  project_id: string | null
  start: Date
  end: Date
}

type CalendarOpenSlot = {
  date: string
  start_time: string
  end_time: string
  free_until: string
  free_minutes: number
  duration_minutes: number
}

type UserCalendarSummary = {
  calendar_id: string
  name: string | null
  access_level: string | null
  selected: boolean | null
  is_primary: boolean | null
}

function toBusySlot(source: BusySlotSource): BusySlot | null {
  const start = source.start instanceof Date ? source.start : new Date(source.start)
  const end = source.end instanceof Date ? source.end : new Date(source.end)
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) return null
  return {
    id: source.id ?? null,
    title: source.title ?? '無題',
    source: source.source,
    calendar_id: source.calendar_id ?? null,
    project_id: source.project_id ?? null,
    start,
    end,
  }
}

function findOpenSlotsForDay({
  dateKey,
  busySlots,
  durationMinutes,
  workingHours,
  limit,
}: {
  dateKey: string
  busySlots: BusySlot[]
  durationMinutes: number
  workingHours: WorkingHours
  limit: number
}): CalendarOpenSlot[] {
  const workStart = tokyoDateTime(dateKey, workingHours.start)
  const workEnd = tokyoDateTime(dateKey, workingHours.end)
  if (!workStart || !workEnd) return []

  const durationMs = durationMinutes * 60_000
  const dayBusy = busySlots
    .filter(slot => slot.start < workEnd && slot.end > workStart)
    .map(slot => ({
      ...slot,
      start: slot.start < workStart ? workStart : slot.start,
      end: slot.end > workEnd ? workEnd : slot.end,
    }))
    .sort((a, b) => a.start.getTime() - b.start.getTime())

  const results: Array<{
    date: string
    start_time: string
    end_time: string
    free_until: string
    free_minutes: number
    duration_minutes: number
  }> = []
  let cursor = workStart
  for (const slot of dayBusy) {
    if (slot.end <= cursor) continue
    if (slot.start.getTime() - cursor.getTime() >= durationMs) {
      const freeMinutes = Math.floor((slot.start.getTime() - cursor.getTime()) / 60_000)
      results.push({
        date: dateKey,
        start_time: cursor.toISOString(),
        end_time: addMinutes(cursor, durationMinutes).toISOString(),
        free_until: slot.start.toISOString(),
        free_minutes: freeMinutes,
        duration_minutes: durationMinutes,
      })
    }
    if (slot.end > cursor) cursor = slot.end
    if (results.length >= limit) return results
  }
  if (workEnd.getTime() - cursor.getTime() >= durationMs) {
    const freeMinutes = Math.floor((workEnd.getTime() - cursor.getTime()) / 60_000)
    results.push({
      date: dateKey,
      start_time: cursor.toISOString(),
      end_time: addMinutes(cursor, durationMinutes).toISOString(),
      free_until: workEnd.toISOString(),
      free_minutes: freeMinutes,
      duration_minutes: durationMinutes,
    })
  }
  return results.slice(0, limit)
}

function buildMindmapOrder(nodes: MindmapTaskRow[]) {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const childrenByParent = new Map<string | null, MindmapTaskRow[]>()
  for (const node of nodes) {
    const key = node.parent_task_id ?? null
    const children = childrenByParent.get(key) ?? []
    children.push(node)
    childrenByParent.set(key, children)
  }
  for (const children of childrenByParent.values()) {
    children.sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0) || a.title.localeCompare(b.title))
  }

  const ordered: Array<MindmapTaskRow & {
    depth: number
    path: string
    parent_title: string | null
    children_count: number
  }> = []
  const visited = new Set<string>()

  const visit = (node: MindmapTaskRow, depth: number, parentPath: string[]) => {
    if (visited.has(node.id)) return
    visited.add(node.id)
    const children = childrenByParent.get(node.id) ?? []
    const pathParts = [...parentPath, node.title]
    ordered.push({
      ...node,
      depth,
      path: pathParts.join(' / '),
      parent_title: node.parent_task_id ? byId.get(node.parent_task_id)?.title ?? null : null,
      children_count: children.length,
    })
    children.forEach(child => visit(child, depth + 1, pathParts))
  }

  ;(childrenByParent.get(null) ?? []).forEach(root => visit(root, 0, []))
  nodes
    .filter(node => !visited.has(node.id))
    .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
    .forEach(node => visit(node, 0, []))

  return { ordered, byId, childrenByParent }
}

function getDescendantIds(nodes: MindmapTaskRow[], rootId: string): string[] {
  const childrenByParent = new Map<string, string[]>()
  for (const node of nodes) {
    if (!node.parent_task_id) continue
    const children = childrenByParent.get(node.parent_task_id) ?? []
    children.push(node.id)
    childrenByParent.set(node.parent_task_id, children)
  }
  const result: string[] = []
  const visit = (id: string) => {
    result.push(id)
    for (const childId of childrenByParent.get(id) ?? []) visit(childId)
  }
  visit(rootId)
  return Array.from(new Set(result))
}

async function loadMindmapTasks(
  supabase: SupabaseServerClient,
  userId: string,
  projectId: string,
): Promise<{ data: MindmapTaskRow[]; error: string | null }> {
  const { data, error } = await supabase
    .from('tasks')
    .select('id, project_id, parent_task_id, is_group, title, status, stage, priority, order_index, scheduled_at, estimated_time, calendar_id, google_event_id, memo, mindmap_collapsed, created_at, updated_at')
    .eq('user_id', userId)
    .eq('project_id', projectId)
    .is('deleted_at', null)
    .order('order_index', { ascending: true })
  if (error) return { data: [], error: error.message }
  return { data: (data || []) as MindmapTaskRow[], error: null }
}

async function loadTaskById(
  supabase: SupabaseServerClient,
  userId: string,
  nodeId: string,
): Promise<MindmapTaskRow | null> {
  const { data } = await supabase
    .from('tasks')
    .select('id, project_id, parent_task_id, is_group, title, status, stage, priority, order_index, scheduled_at, estimated_time, calendar_id, google_event_id, memo, mindmap_collapsed, created_at, updated_at')
    .eq('user_id', userId)
    .eq('id', nodeId)
    .is('deleted_at', null)
    .maybeSingle()
  return data as MindmapTaskRow | null
}

function mindmapStats(nodes: MindmapTaskRow[]) {
  const taskNodes = nodes.filter(node => !node.is_group)
  const done = taskNodes.filter(node => node.status === 'done' || node.stage === 'done').length
  const scheduled = taskNodes.filter(node => !!node.scheduled_at).length
  const progressPercent = taskNodes.length > 0 ? Math.round((done / taskNodes.length) * 100) : 0
  return {
    total_nodes: nodes.length,
    groups: nodes.filter(node => node.is_group).length,
    tasks: taskNodes.length,
    done_tasks: done,
    scheduled_tasks: scheduled,
    progress_percent: progressPercent,
  }
}

async function loadMindmapLinkSummaries(
  supabase: SupabaseServerClient,
  userId: string,
  taskIds: string[],
) {
  const uniqueTaskIds = Array.from(new Set(taskIds.filter(Boolean)))
  if (uniqueTaskIds.length === 0) return []

  const { data: structuredLinks } = await supabase
    .from('memo_node_links')
    .select('id, memo_item_id, source_type, source_id, task_id, project_id, link_type, status, created_at, updated_at')
    .eq('user_id', userId)
    .in('task_id', uniqueTaskIds)
    .eq('link_type', 'mindmap_node')
    .eq('status', 'active')

  const memoItemIds = Array.from(new Set(
    (structuredLinks || [])
      .map(link => link.memo_item_id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  ))
  const { data: memoItems } = memoItemIds.length > 0
    ? await supabase
      .from('memo_items')
      .select('id, title, body, item_kind, status, source_type, source_id, project_id, updated_at')
      .eq('user_id', userId)
      .in('id', memoItemIds)
    : { data: [] }
  const memoById = new Map((memoItems || []).map(item => [item.id, item]))

  const structuredSourceIds = Array.from(new Set(
    (structuredLinks || [])
      .filter(link => link.source_type === 'wishlist')
      .map(link => link.source_id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  ))

  const { data: legacyCandidates } = await supabase
    .from('ideal_goals')
    .select('id, title, description, project_id, memo_status, status, ai_source_payload, updated_at')
    .eq('user_id', userId)
    .in('status', ['wishlist', 'memo'])
    .not('ai_source_payload', 'is', null)
    .limit(500)

  const legacyRows = (legacyCandidates || [])
  const legacySourceIds = legacyRows
    .filter(row => readMindmapLinks(row.ai_source_payload).some(link =>
      typeof link.task_id === 'string' && uniqueTaskIds.includes(link.task_id),
    ))
    .map(row => row.id)

  const wishlistSourceIds = Array.from(new Set([...structuredSourceIds, ...legacySourceIds]))
  const { data: wishlistRows } = wishlistSourceIds.length > 0
    ? await supabase
      .from('ideal_goals')
      .select('id, title, description, project_id, memo_status, status, scheduled_at, updated_at')
      .eq('user_id', userId)
      .in('id', wishlistSourceIds)
    : { data: [] }
  const wishlistById = new Map((wishlistRows || []).map(item => [item.id, item]))

  const summaries = (structuredLinks || []).map(link => {
    const memo = memoById.get(link.memo_item_id)
    const source = link.source_type === 'wishlist' ? wishlistById.get(link.source_id) : null
    return {
      kind: 'structured',
      link_id: link.id,
      task_id: link.task_id,
      memo_item_id: link.memo_item_id,
      source_type: link.source_type,
      source_id: link.source_id,
      source_title: source?.title ?? null,
      memo_title: memo?.title ?? null,
      memo_kind: memo?.item_kind ?? null,
      memo_status: memo?.status ?? null,
      source_status: source?.memo_status ?? null,
      preview: compactPreview(memo?.body ?? source?.description ?? null, 100),
      updated_at: link.updated_at,
    }
  })

  for (const row of legacyRows) {
    const source = wishlistById.get(row.id) ?? row
    for (const link of readMindmapLinks(row.ai_source_payload)) {
      if (typeof link.task_id !== 'string' || !uniqueTaskIds.includes(link.task_id)) continue
      summaries.push({
        kind: 'legacy_payload',
        link_id: null,
        task_id: link.task_id,
        memo_item_id: null,
        source_type: 'wishlist',
        source_id: row.id,
        source_title: source?.title ?? null,
        memo_title: source?.title ?? null,
        memo_kind: 'legacy',
        memo_status: null,
        source_status: source?.memo_status ?? null,
        preview: compactPreview(source?.description ?? null, 100),
        updated_at: typeof link.linked_at === 'string' ? link.linked_at : row.updated_at,
      })
    }
  }

  return summaries
}

function addLegacyMindmapLink(payload: unknown, taskId: string) {
  const current = readPayloadRecord(payload)
  const links = readMindmapLinks(current)
  const nextLinks = links.some(link => link.task_id === taskId)
    ? links
    : [...links, { task_id: taskId, linked_at: new Date().toISOString(), source: 'chat_agent' }]
  return {
    ...current,
    mindmap_links: nextLinks,
    manual_column: 'mapped',
    manual_column_assigned_at: new Date().toISOString(),
  }
}

function removeLegacyMindmapLink(payload: unknown, taskId?: string | null) {
  const current = readPayloadRecord(payload)
  const links = readMindmapLinks(current)
  const nextLinks = taskId
    ? links.filter(link => link.task_id !== taskId)
    : []
  const next: Record<string, unknown> = { ...current, mindmap_links: nextLinks }
  if (nextLinks.length === 0) {
    delete next.manual_column
    delete next.manual_column_assigned_at
  }
  return next
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

async function listUserCalendarSummaries(
  supabase: SupabaseServerClient,
  userId: string,
): Promise<UserCalendarSummary[]> {
  const { data, error } = await supabase
    .from('user_calendars')
    .select('google_calendar_id, name, access_level, selected, is_primary')
    .eq('user_id', userId)
  if (error) throw error

  return (data || []).map(row => ({
    calendar_id: row.google_calendar_id,
    name: row.name ?? null,
    access_level: row.access_level ?? null,
    selected: row.selected ?? null,
    is_primary: row.is_primary ?? null,
  }))
}

function calendarNameMatches(value: string, calendar: UserCalendarSummary): boolean {
  const needle = value.trim().toLowerCase()
  if (!needle) return false
  const candidates = [
    calendar.calendar_id,
    calendar.name ?? '',
  ].map(candidate => candidate.trim().toLowerCase()).filter(Boolean)
  return candidates.some(candidate =>
    candidate === needle ||
    candidate.includes(needle) ||
    needle.includes(candidate)
  )
}

function resolveCalendarIdFromNameOrId(
  calendars: UserCalendarSummary[],
  value?: string,
): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  if (trimmed === 'primary') return 'primary'
  return calendars.find(calendar => calendarNameMatches(trimmed, calendar))?.calendar_id ?? null
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

async function getCachedCalendarEventForDeletion(
  supabase: SupabaseServerClient,
  userId: string,
  googleEventId: string,
  calendarId?: string,
) {
  let query = supabase
    .from('calendar_events')
    .select('calendar_id, google_event_id, recurring_event_id, title, start_time, end_time')
    .eq('user_id', userId)
    .eq('google_event_id', googleEventId)
    .limit(1)

  if (calendarId) query = query.eq('calendar_id', calendarId)

  const { data, error } = await query.maybeSingle()
  if (error) throw error
  return data
}

async function collectCalendarEventIdsForDeletion(
  supabase: SupabaseServerClient,
  userId: string,
  calendarId: string,
  googleEventId: string,
  targetGoogleEventId: string,
  deleteScope: 'this' | 'series',
): Promise<string[]> {
  const ids = new Set<string>([googleEventId])
  if (deleteScope !== 'series') return [...ids]

  ids.add(targetGoogleEventId)
  const { data, error } = await supabase
    .from('calendar_events')
    .select('google_event_id')
    .eq('user_id', userId)
    .eq('calendar_id', calendarId)
    .eq('recurring_event_id', targetGoogleEventId)

  if (error) throw error
  for (const row of data || []) {
    if (row.google_event_id) ids.add(row.google_event_id)
  }
  return [...ids]
}

async function cleanupDeletedCalendarEventState(params: {
  supabase: SupabaseServerClient
  userId: string
  calendarId: string
  googleEventIds: string[]
  targetGoogleEventId: string
  deleteScope: 'this' | 'series'
}) {
  const { supabase, userId, calendarId, googleEventIds, targetGoogleEventId, deleteScope } = params
  const now = new Date().toISOString()
  const ids = googleEventIds.filter(Boolean)
  if (ids.length === 0) return { importedTaskCount: 0, manualTaskCount: 0 }

  const { error: cacheDeleteError } = await supabase
    .from('calendar_events')
    .delete()
    .eq('user_id', userId)
    .eq('calendar_id', calendarId)
    .in('google_event_id', ids)
  if (cacheDeleteError) throw cacheDeleteError

  if (deleteScope === 'series') {
    const { error: seriesCacheDeleteError } = await supabase
      .from('calendar_events')
      .delete()
      .eq('user_id', userId)
      .eq('calendar_id', calendarId)
      .eq('recurring_event_id', targetGoogleEventId)
    if (seriesCacheDeleteError) throw seriesCacheDeleteError
  }

  const { data: relatedTasks, error: relatedTasksError } = await supabase
    .from('tasks')
    .select('id, source')
    .eq('user_id', userId)
    .eq('calendar_id', calendarId)
    .in('google_event_id', ids)
    .is('deleted_at', null)
  if (relatedTasksError) throw relatedTasksError

  const importedTaskIds = (relatedTasks || [])
    .filter(task => task.source === 'google_event')
    .map(task => task.id)
  const manualTaskIds = (relatedTasks || [])
    .filter(task => task.source !== 'google_event')
    .map(task => task.id)

  if (importedTaskIds.length > 0) {
    const { error } = await supabase
      .from('tasks')
      .update({
        deleted_at: now,
        is_timer_running: false,
        last_started_at: null,
        updated_at: now,
      })
      .eq('user_id', userId)
      .in('id', importedTaskIds)
    if (error) throw error
  }

  if (manualTaskIds.length > 0) {
    const { error } = await supabase
      .from('tasks')
      .update({
        google_event_id: null,
        calendar_id: null,
        updated_at: now,
      })
      .eq('user_id', userId)
      .in('id', manualTaskIds)
    if (error) throw error
  }

  const { error: memoResetError } = await supabase
    .from('ideal_goals')
    .update({
      scheduled_at: null,
      google_event_id: null,
      memo_status: 'unsorted',
      is_today: false,
      updated_at: now,
    })
    .eq('user_id', userId)
    .in('google_event_id', ids)
  if (memoResetError) throw memoResetError

  return {
    importedTaskCount: importedTaskIds.length,
    manualTaskCount: manualTaskIds.length,
  }
}

// ━━━ タスク関連 ━━━

export const bulkAddMemos = tool({
  description:
    'チャットの壁打ち、マインドマップ/ノート確認、AIの提案から、複数のメモを一括で追加する。各メモは見出し、内容、所要時間、タグ、プロジェクト紐づきを持てる。AIが新しく発案した複数案は、原則として候補を提示してユーザー承認後に使う。',
  inputSchema: z.object({
    projectId: z.string().optional().describe('紐づけるプロジェクトID。プロジェクトチャットでは原則このIDを指定する。未指定なら未分類メモに追加する。'),
    sourceContext: z.string().optional().describe('追加元の短い説明。例: チャット壁打ち、マインドマップ確認、未整理メモ整理。'),
    items: z.array(z.object({
      title: z.string().describe('メモの見出し。短く具体的にする。'),
      body: z.string().optional().describe('メモの内容。背景、理由、判断、次の検討点など。'),
      durationMinutes: z.number().optional().describe('所要時間の目安（分）。5, 15, 30, 60など。未定なら省略する。'),
      scheduledAt: z.string().optional().describe('予定候補日時（ISO 8601）。カレンダー登録はせず、メモの予定候補として保存する。'),
      category: z.string().optional().describe('カテゴリ。例: アイデア、調査、改善、保留。'),
      tags: z.array(z.string()).optional().describe('タグ。最大8個程度。'),
      memoStatus: z.enum(BULK_MEMO_STATUSES).optional().describe('保存後のメモ状態。通常はunsorted、日時候補つきならtime_candidates。'),
      subtaskSuggestions: z.array(z.object({
        title: z.string().describe('メモ配下の小タスク見出し'),
        estimatedMinutes: z.number().optional().describe('小タスクの所要時間（分）'),
        reason: z.string().optional().describe('小タスクの補足'),
      })).max(8).optional().describe('メモ内に残す小タスク案。必要な場合だけ使う。'),
    })).min(1).max(MAX_BULK_MEMO_ITEMS).describe(`追加するメモ一覧。最大${MAX_BULK_MEMO_ITEMS}件。`),
  }),
  execute: async ({ projectId, sourceContext, items }) => {
    const supabase = await createClient()
    const user = await requireAuthedUser(supabase)
    if (!user) return { success: false, error: '認証エラー' }

    const targetProjectId = projectId || null
    if (targetProjectId) {
      const { data: project, error: projectError } = await supabase
        .from('projects')
        .select('id, title')
        .eq('id', targetProjectId)
        .eq('user_id', user.id)
        .maybeSingle()
      if (projectError) return { success: false, error: projectError.message }
      if (!project) return { success: false, error: 'プロジェクトが見つかりません' }
    }

    const normalizedItems = items.map((item, index) => {
      const title = cleanNullableText(item.title, 120)
      const body = cleanNullableText(item.body, 4000)
      const durationMinutes = normalizeDurationMinutes(item.durationMinutes)
      const category = normalizeMemoCategory(item.category)
      const tags = normalizeMemoTags(item.tags)
      const scheduledAt = cleanNullableText(item.scheduledAt, 80)
      const memoStatus = item.memoStatus ?? (scheduledAt ? 'time_candidates' : 'unsorted')
      const subtaskSuggestions = (item.subtaskSuggestions || [])
        .map((subtask, subIndex) => ({
          title: cleanNullableText(subtask.title, 160),
          estimatedMinutes: normalizeDurationMinutes(subtask.estimatedMinutes),
          reason: cleanNullableText(subtask.reason, 1000),
          displayOrder: subIndex,
        }))
        .filter((subtask): subtask is {
          title: string
          estimatedMinutes: number | null
          reason: string | null
          displayOrder: number
        } => !!subtask.title)

      return {
        index,
        id: crypto.randomUUID(),
        title,
        body,
        durationMinutes,
        category,
        tags,
        scheduledAt,
        memoStatus,
        subtaskSuggestions,
      }
    })

    const invalidTitle = normalizedItems.find(item => !item.title)
    if (invalidTitle) {
      return { success: false, error: `${invalidTitle.index + 1}件目のtitleが空です` }
    }

    const invalidSchedule = normalizedItems.find(item =>
      item.scheduledAt && Number.isNaN(new Date(item.scheduledAt).getTime()),
    )
    if (invalidSchedule) {
      return { success: false, error: `${invalidSchedule.index + 1}件目のscheduledAtが有効なISO 8601日時ではありません` }
    }

    const seen = new Set<string>()
    const uniqueItems = normalizedItems.filter(item => {
      const key = memoKey(item.title!, item.body, targetProjectId)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    const reusedItems: Array<{ id: string; title: string; project_id: string | null }> = []
    const newItems: typeof uniqueItems = []
    for (const item of uniqueItems) {
      let existingQuery = supabase
        .from('ideal_goals')
        .select('id, title, description, project_id')
        .eq('user_id', user.id)
        .in('status', ['wishlist', 'memo'])
        .eq('title', item.title!)
        .limit(10)

      existingQuery = targetProjectId
        ? existingQuery.eq('project_id', targetProjectId)
        : existingQuery.is('project_id', null)

      const { data: existingRows, error: existingError } = await existingQuery
      if (existingError) return { success: false, error: existingError.message }
      const existing = (existingRows || []).find(row => memoKey(row.title, row.description ?? null, row.project_id ?? null) === memoKey(item.title!, item.body, targetProjectId))
      if (existing) {
        reusedItems.push({ id: existing.id, title: existing.title, project_id: existing.project_id ?? null })
      } else {
        newItems.push(item)
      }
    }

    const { count } = await supabase
      .from('ideal_goals')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .in('status', ['wishlist', 'memo'])
    const baseDisplayOrder = count ?? 0
    const now = new Date().toISOString()

    const insertRows = newItems.map((item, insertIndex) => ({
      id: item.id,
      user_id: user.id,
      title: item.title!,
      project_id: targetProjectId,
      description: item.body,
      category: item.category,
      scheduled_at: item.scheduledAt,
      duration_minutes: item.durationMinutes,
      tags: item.tags,
      memo_status: item.memoStatus,
      ai_source_payload: {
        source: 'agent_chat',
        tool: 'bulkAddMemos',
        source_context: cleanNullableText(sourceContext, 200),
        bulk_index: item.index,
        created_at: now,
      },
      status: 'memo',
      color: '#6366f1',
      display_order: baseDisplayOrder + insertIndex + 1,
      total_daily_minutes: 0,
      is_completed: false,
      is_today: false,
    }))

    const createdItems: Array<{
      id: string
      title: string
      project_id: string | null
      duration_minutes: number | null
      memo_status: string | null
    }> = []
    if (insertRows.length > 0) {
      const { data, error } = await supabase
        .from('ideal_goals')
        .insert(insertRows)
        .select('id, title, project_id, duration_minutes, memo_status')
      if (error) return { success: false, error: error.message }
      createdItems.push(...(data || []).map(item => ({
        id: item.id,
        title: item.title,
        project_id: item.project_id ?? null,
        duration_minutes: item.duration_minutes ?? null,
        memo_status: item.memo_status ?? null,
      })))

      const subtaskRows = newItems.flatMap(item =>
        item.subtaskSuggestions.map(subtask => ({
          ideal_id: item.id,
          user_id: user.id,
          title: subtask.title,
          item_type: 'task',
          frequency_type: 'once',
          frequency_value: 1,
          session_minutes: subtask.estimatedMinutes ?? 0,
          daily_minutes: 0,
          description: subtask.reason,
          display_order: subtask.displayOrder,
        })),
      )
      if (subtaskRows.length > 0) {
        const { error: subtaskError } = await supabase.from('ideal_items').insert(subtaskRows)
        if (subtaskError) {
          return {
            success: true,
            warning: `メモは追加しましたが、小タスク案の保存に失敗しました: ${subtaskError.message}`,
            created_count: createdItems.length,
            reused_count: reusedItems.length,
            items: [...createdItems, ...reusedItems],
            message: `${createdItems.length}件のメモを追加しました`,
          }
        }
      }

      for (const item of newItems) {
        await upsertMemoTags(supabase, user.id, item.category, item.tags)
      }
    }

    const totalTouched = createdItems.length + reusedItems.length
    return {
      success: true,
      created_count: createdItems.length,
      reused_count: reusedItems.length,
      skipped_duplicate_count: normalizedItems.length - uniqueItems.length,
      project_id: targetProjectId,
      items: [...createdItems, ...reusedItems],
      message: createdItems.length > 0
        ? `${createdItems.length}件のメモを追加しました${reusedItems.length > 0 ? `（既存${reusedItems.length}件は再利用）` : ''}`
        : `${totalTouched}件は既存メモとして確認済みです`,
    }
  },
})

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
    description: z.string().optional().describe('予定詳細。ユーザーが内容を指定した時だけ入れる'),
    projectId: z.string().optional().describe('紐付けるプロジェクトID'),
  }),
  execute: async ({ title, scheduledAt, estimatedTime, calendarId, description, projectId }) => {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: '認証エラー' }

    const { data: userContext } = await supabase
      .from('ai_user_context')
      .select('preferences')
      .eq('user_id', user.id)
      .maybeSingle()
    const calendarPreferences = parseAgentCalendarPreferences(userContext?.preferences)
    if (calendarPreferences.askCalendarOnEventCreate && !calendarId) {
      const calendars = await listUserCalendarSummaries(supabase, user.id)
      const candidates = calendars.length > 0
        ? calendars
        : [{
          calendar_id: 'primary',
          name: 'デフォルトカレンダー',
          access_level: 'owner',
          selected: true,
          is_primary: true,
        }]
      const writableCalendars = candidates.filter(calendar => isWritableCalendar(calendar.access_level) || calendar.calendar_id === 'primary')
      return {
        success: false,
        needs_calendar_selection: true,
        available_calendars: (writableCalendars.length > 0 ? writableCalendars : candidates).map(calendar => ({
          calendar_id: calendar.calendar_id,
          name: calendar.name,
          selected: calendar.selected,
          is_primary: calendar.is_primary,
        })),
        message: '予定を登録する前に、追加先カレンダーをユーザーに確認してください',
        error: 'カレンダー選択が必要です',
      }
    }

    // カレンダー所有権チェック
    if (calendarId && calendarId !== 'primary') {
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
      memo: description ? compactText(description, 12000) : null,
      stage: 'scheduled',
      status: 'todo',
      priority: 3,
    })
    if (taskError) return { success: false, error: taskError.message }

    // Google Calendar 同期
    let calendarSynced = false
    let resolvedCalendarId = calendarId || null
    let googleEventId: string | null = null
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
          const syncResult = await syncTaskToCalendar(user.id, taskId, {
            title,
            scheduled_at: scheduledAt,
            estimated_time: estMin,
            calendar_id: resolvedCalendarId,
            memo: description ? compactText(description, 12000) : null,
          })
          googleEventId = syncResult.googleEventId
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
      estimatedTime: estMin,
      calendarId: resolvedCalendarId,
      googleEventId,
      description: description ?? null,
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
    'Focusmapのプロジェクト一覧を確認する。ユーザーがプロジェクト名を言った時はqueryで検索する。resolved_projectが返ったら聞き返さず、そのprojectIdでgetProjectContextを呼ぶ。',
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
    const hasQuery = Boolean(query?.trim())
    let dbQuery = supabase
      .from('projects')
      .select('id, title, description, purpose, status, space_id, repo_path, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(hasQuery ? Math.min(maxRows * 5, 100) : maxRows)

    if (!includeArchived) {
      dbQuery = dbQuery.not('status', 'in', '("archived","completed")')
    }

    const { data, error } = await dbQuery
    if (error) return { success: false, error: error.message }
    const matchedProjects = (data || [])
      .map(project => {
        const match = matchProjectSearch(project, ['title', 'description', 'purpose', 'repo_path'], query)
        return { project, match }
      })
      .filter(({ match }) => match.matches)
      .sort((a, b) => b.match.score - a.match.score || String(b.project.created_at ?? '').localeCompare(String(a.project.created_at ?? '')))
      .slice(0, maxRows)
    const projects = matchedProjects.map(({ project, match }) => ({
      ...project,
      match: hasQuery
        ? {
          score: match.score,
          confidence: match.confidence,
          matched_fields: match.matchedFields,
          needles: match.needles,
        }
        : undefined,
    }))
    const [top, second] = matchedProjects
    const resolvedProject = hasQuery &&
      top &&
      (top.match.confidence === 'exact' || top.match.confidence === 'strong') &&
      (!second || top.match.score - second.match.score >= 20 || (top.match.score >= 90 && second.match.score < 70))
      ? {
        id: top.project.id,
        title: top.project.title,
        description: top.project.description ?? null,
        status: top.project.status ?? null,
        repo_path: top.project.repo_path ?? null,
        match: {
          score: top.match.score,
          confidence: top.match.confidence,
          matched_fields: top.match.matchedFields,
          needles: top.match.needles,
        },
      }
      : null
    return {
      success: true,
      projects,
      resolved_project: resolvedProject,
      project_resolution: {
        query: query?.trim() || null,
        confident_single_match: Boolean(resolvedProject),
        instruction: resolvedProject
          ? 'このresolved_projectを対象にして、ユーザーへどのプロジェクトか聞き返さずgetProjectContextを呼んでください。'
          : '候補が複数または弱一致です。誤認しそうな場合だけユーザーへ対象確認してください。',
      },
      message: resolvedProject
        ? `「${resolvedProject.title}」を対象プロジェクトとして解決しました`
        : `${projects.length}件のプロジェクトを取得しました`,
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
    'プロジェクトの概要や進捗メモをFocusmap DBへ記録・更新する。「このプロジェクトについて記録して」「概要を更新して」などで使う。安定概要はprojectDescription、AGENTS.md風の背景整理はdetails、現在地・次の論点・ブロッカーはprogressに分ける。',
  inputSchema: z.object({
    projectId: z.string().describe('プロジェクトID'),
    projectDescription: z.string().optional().describe('projects.description に保存する安定したプロジェクト概要。何のプロジェクトか・目的・対象を短くまとめる。未指定なら変更しない。'),
    heading: z.string().optional().describe('project_contexts.heading に保存する短い見出し。'),
    details: z.string().optional().describe('project_contexts.details に保存する背景メモ。必要に応じて ## 目的 / ## 判断基準 / ## 重要制約 / ## 最近の決定 のような小見出しで整理する。'),
    progress: z.string().optional().describe('project_contexts.progress に保存する状況メモ。必要に応じて ## 現在地 / ## 次の論点 / ## ブロッカー のような小見出しで整理する。'),
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

export const updateProject = tool({
  description:
    'Focusmapのプロジェクト本体を更新する。プロジェクト名、概要、目的、状態、リポジトリパス、優先度などを変更したい時に使う。',
  inputSchema: z.object({
    projectId: z.string().describe('プロジェクトID'),
    title: z.string().optional().describe('新しいプロジェクト名'),
    description: z.string().optional().describe('新しいプロジェクト概要'),
    purpose: z.string().nullable().optional().describe('目的。nullで消去。'),
    status: z.string().optional().describe('active / archived / completed などの状態'),
    repoPath: z.string().nullable().optional().describe('紐づくリポジトリ絶対パス。nullで消去。'),
    priority: z.number().optional().describe('優先度'),
    categoryTag: z.string().nullable().optional().describe('カテゴリタグ。nullで消去。'),
    colorTheme: z.string().optional().describe('色テーマ'),
  }),
  execute: async ({ projectId, title, description, purpose, status, repoPath, priority, categoryTag, colorTheme }) => {
    const supabase = await createClient()
    const user = await requireAuthedUser(supabase)
    if (!user) return { success: false, error: '認証エラー' }

    const updates: Record<string, unknown> = {}
    if (typeof title === 'string') updates.title = compactText(title, 160)
    if (typeof description === 'string') updates.description = compactText(description, 3000)
    if (purpose !== undefined) updates.purpose = purpose === null ? null : compactText(purpose, 1000)
    if (typeof status === 'string') updates.status = compactText(status, 50)
    if (repoPath !== undefined) updates.repo_path = repoPath === null ? null : compactText(repoPath, 1000)
    if (typeof priority === 'number' && Number.isFinite(priority)) updates.priority = Math.round(priority)
    if (categoryTag !== undefined) updates.category_tag = categoryTag === null ? null : compactText(categoryTag, 80)
    if (typeof colorTheme === 'string') updates.color_theme = compactText(colorTheme, 80)

    if (Object.keys(updates).length === 0) {
      return { success: false, error: '更新内容が指定されていません' }
    }

    const { data, error } = await supabase
      .from('projects')
      .update(updates)
      .eq('id', projectId)
      .eq('user_id', user.id)
      .select('id, title, description, purpose, status, priority, category_tag, color_theme, repo_path')
      .maybeSingle()

    if (error) return { success: false, error: error.message }
    if (!data) return { success: false, error: 'プロジェクトが見つかりません' }
    return { success: true, project: data, message: `プロジェクト「${data.title}」を更新しました` }
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

export const listNotesForOrganization = tool({
  description:
    'ノート/メモ整理用に、未整理メモや構造化メモの見出しと詳細冒頭だけを軽量取得する。マインドマップ整理やノート整理では最初に使い、本文全量を読まずに候補を判定する。',
  inputSchema: z.object({
    projectId: z.string().optional().describe('対象プロジェクトID。プロジェクトチャットでは原則このIDを指定する。'),
    query: z.string().optional().describe('見出し・本文冒頭の検索語。'),
    recordTypes: z.array(z.enum(NOTE_ORGANIZATION_RECORD_TYPES)).optional().describe('wishlist / memo_item のどちらを見るか。未指定なら両方。'),
    includeCompleted: z.boolean().optional().describe('完了・却下・アーカイブ済みも含めるか。通常はfalse。'),
    previewChars: z.number().optional().describe('詳細冒頭の文字数。通常は30文字、最大120文字。'),
    limit: z.number().optional().describe('返す件数。最大100件。'),
  }),
  execute: async ({ projectId, query, recordTypes, includeCompleted, previewChars, limit }) => {
    const supabase = await createClient()
    const user = await requireAuthedUser(supabase)
    if (!user) return { success: false, error: '認証エラー' }

    const maxRows = normalizeLimit(limit, 40, 100)
    const previewLimit = normalizeLimit(previewChars, 30, 120)
    const includeWishlist = !recordTypes || recordTypes.includes('wishlist')
    const includeMemoItems = !recordTypes || recordTypes.includes('memo_item')
    const records: Array<Record<string, unknown>> = []

    if (includeWishlist) {
      let wishlistQuery = supabase
        .from('ideal_goals')
        .select('id, title, description, project_id, memo_status, status, scheduled_at, duration_minutes, google_event_id, tags, ai_source_payload, is_completed, created_at, updated_at')
        .eq('user_id', user.id)
        .in('status', ['wishlist', 'memo'])
        .order('updated_at', { ascending: false })
        .limit(Math.min(maxRows * 3, 300))
      if (projectId) wishlistQuery = wishlistQuery.eq('project_id', projectId)

      const { data, error } = await wishlistQuery
      if (error) return { success: false, error: error.message }

      const wishlistRows = (data || [])
        .filter(row => includeCompleted || (!row.is_completed && !['done', 'dismissed', 'archived'].includes(row.memo_status ?? '')))
        .filter(row => recordTextMatches(row, ['title', 'description'], query))
        .slice(0, maxRows)

      const wishlistIds = wishlistRows.map(row => row.id)
      const linkMap = new Map<string, Set<string>>()
      const { data: structuredLinks } = wishlistIds.length > 0
        ? await supabase
          .from('memo_node_links')
          .select('source_id, task_id')
          .eq('user_id', user.id)
          .eq('source_type', 'wishlist')
          .eq('link_type', 'mindmap_node')
          .eq('status', 'active')
          .in('source_id', wishlistIds)
        : { data: [] }
      for (const link of structuredLinks || []) {
        pushLinkId(linkMap, link.source_id, link.task_id)
      }
      for (const row of wishlistRows) {
        for (const link of readMindmapLinks(row.ai_source_payload)) {
          if (typeof link.task_id === 'string') pushLinkId(linkMap, row.id, link.task_id)
        }
      }

      for (const row of wishlistRows) {
        const preview = compactPreview(row.description, previewLimit)
        const linkedTaskIds = setToSortedArray(linkMap.get(row.id))
        records.push({
          record_type: 'wishlist',
          id: row.id,
          title: row.title,
          detail_preview: preview,
          preview_chars: previewLimit,
          detail_chars: normalizedTextLength(row.description),
          detail_available: normalizedTextLength(row.description) > previewLimit,
          project_id: row.project_id,
          status: row.status,
          memo_status: row.memo_status,
          scheduled_at: row.scheduled_at,
          duration_minutes: row.duration_minutes,
          google_event_id: row.google_event_id,
          tags: row.tags,
          linked_mindmap_task_ids: linkedTaskIds,
          linked_mindmap_count: linkedTaskIds.length,
          updated_at: row.updated_at,
          created_at: row.created_at,
        })
      }
    }

    if (includeMemoItems) {
      let memoQuery = supabase
        .from('memo_items')
        .select('id, title, body, item_kind, status, source_type, source_id, parent_item_id, project_id, confidence, metadata, created_at, updated_at')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false })
        .limit(Math.min(maxRows * 3, 300))
      if (projectId) memoQuery = memoQuery.eq('project_id', projectId)

      const { data, error } = await memoQuery
      if (error) return { success: false, error: error.message }

      const memoRows = (data || [])
        .filter(row => includeCompleted || !['done', 'dismissed', 'archived'].includes(row.status))
        .filter(row => recordTextMatches(row, ['title', 'body'], query))
        .slice(0, maxRows)

      const memoItemIds = memoRows.map(row => row.id)
      const linkMap = new Map<string, Set<string>>()
      const { data: links } = memoItemIds.length > 0
        ? await supabase
          .from('memo_node_links')
          .select('memo_item_id, task_id')
          .eq('user_id', user.id)
          .eq('link_type', 'mindmap_node')
          .eq('status', 'active')
          .in('memo_item_id', memoItemIds)
        : { data: [] }
      for (const link of links || []) {
        pushLinkId(linkMap, link.memo_item_id, link.task_id)
      }

      for (const row of memoRows) {
        const preview = compactPreview(row.body, previewLimit)
        const linkedTaskIds = setToSortedArray(linkMap.get(row.id))
        records.push({
          record_type: 'memo_item',
          id: row.id,
          title: row.title,
          detail_preview: preview,
          preview_chars: previewLimit,
          detail_chars: normalizedTextLength(row.body),
          detail_available: normalizedTextLength(row.body) > previewLimit,
          project_id: row.project_id,
          item_kind: row.item_kind,
          status: row.status,
          source_type: row.source_type,
          source_id: row.source_id,
          parent_item_id: row.parent_item_id,
          confidence: row.confidence,
          linked_mindmap_task_ids: linkedTaskIds,
          linked_mindmap_count: linkedTaskIds.length,
          updated_at: row.updated_at,
          created_at: row.created_at,
        })
      }
    }

    const sortedRecords = records
      .sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')))
      .slice(0, maxRows)

    return {
      success: true,
      preview_chars: previewLimit,
      records: sortedRecords,
      truncated: records.length > maxRows,
      message: `${sortedRecords.length}件のノート/メモ候補を取得しました`,
    }
  },
})

export const getNoteOrganizationDetail = tool({
  description:
    'ノート/メモ整理で必要な候補だけ詳細を確認する。デフォルトは詳細冒頭30文字で、深い解析が必要な場合だけ detailChars を増やす。',
  inputSchema: z.object({
    recordType: z.enum(NOTE_ORGANIZATION_RECORD_TYPES).describe('wishlist または memo_item'),
    id: z.string().describe('確認するレコードID'),
    detailChars: z.number().optional().describe('返す詳細文字数。通常30文字、最大2000文字。'),
    includeLinks: z.boolean().optional().describe('マインドマップ紐づきも返すか。通常はtrue。'),
  }),
  execute: async ({ recordType, id, detailChars, includeLinks }) => {
    const supabase = await createClient()
    const user = await requireAuthedUser(supabase)
    if (!user) return { success: false, error: '認証エラー' }

    const detailLimit = normalizeLimit(detailChars, 30, 2000)
    let record: Record<string, unknown> | null = null
    let detailSource = ''
    const linkedTaskIds = new Set<string>()

    if (recordType === 'wishlist') {
      const { data, error } = await supabase
        .from('ideal_goals')
        .select('id, title, description, project_id, memo_status, status, scheduled_at, duration_minutes, google_event_id, tags, ai_source_payload, is_completed, created_at, updated_at')
        .eq('user_id', user.id)
        .eq('id', id)
        .maybeSingle()
      if (error) return { success: false, error: error.message }
      if (!data) return { success: false, error: 'メモが見つかりません' }
      record = data
      detailSource = data.description ?? ''
      for (const link of readMindmapLinks(data.ai_source_payload)) {
        if (typeof link.task_id === 'string') linkedTaskIds.add(link.task_id)
      }

      if (includeLinks !== false) {
        const { data: links } = await supabase
          .from('memo_node_links')
          .select('task_id')
          .eq('user_id', user.id)
          .eq('source_type', 'wishlist')
          .eq('source_id', id)
          .eq('link_type', 'mindmap_node')
          .eq('status', 'active')
        for (const link of links || []) {
          if (link.task_id) linkedTaskIds.add(link.task_id)
        }
      }
    } else {
      const { data, error } = await supabase
        .from('memo_items')
        .select('id, title, body, item_kind, status, source_type, source_id, parent_item_id, project_id, confidence, metadata, created_at, updated_at')
        .eq('user_id', user.id)
        .eq('id', id)
        .maybeSingle()
      if (error) return { success: false, error: error.message }
      if (!data) return { success: false, error: '構造化メモが見つかりません' }
      record = data
      detailSource = data.body ?? ''

      if (includeLinks !== false) {
        const { data: links } = await supabase
          .from('memo_node_links')
          .select('task_id')
          .eq('user_id', user.id)
          .eq('memo_item_id', id)
          .eq('link_type', 'mindmap_node')
          .eq('status', 'active')
        for (const link of links || []) {
          if (link.task_id) linkedTaskIds.add(link.task_id)
        }
      }
    }

    const linkedIds = Array.from(linkedTaskIds)
    const { data: linkedTasks } = linkedIds.length > 0
      ? await supabase
        .from('tasks')
        .select('id, title, project_id, parent_task_id, status, stage, scheduled_at, estimated_time, updated_at')
        .eq('user_id', user.id)
        .in('id', linkedIds)
        .is('deleted_at', null)
      : { data: [] }

    return {
      success: true,
      record_type: recordType,
      record,
      detail_text: compactPreview(detailSource, detailLimit),
      detail_chars: normalizedTextLength(detailSource),
      returned_chars: detailLimit,
      detail_truncated: normalizedTextLength(detailSource) > detailLimit,
      linked_mindmap_task_ids: linkedIds,
      linked_tasks: linkedTasks || [],
      message: `「${String(record?.title ?? '無題')}」の詳細を取得しました`,
    }
  },
})

export const getMindmapOverview = tool({
  description:
    '指定プロジェクトのマインドマップDB全体を確認する。ノード一覧、親子関係、進捗、予定化、メモ紐づきをまとめて見る時に使う。',
  inputSchema: z.object({
    projectId: z.string().describe('確認するプロジェクトID'),
    includeLinkedMemos: z.boolean().optional().describe('メモ/ノートとの紐づきも含めるか。通常はtrue。'),
    includeMemoPreview: z.boolean().optional().describe('ノードのmemo冒頭を含めるか。通常はtrue。'),
    limit: z.number().optional().describe('返すノード件数。最大200件。'),
  }),
  execute: async ({ projectId, includeLinkedMemos, includeMemoPreview, limit }) => {
    const supabase = await createClient()
    const user = await requireAuthedUser(supabase)
    if (!user) return { success: false, error: '認証エラー' }

    const [{ data: project, error: projectError }, { data: context }] = await Promise.all([
      supabase
        .from('projects')
        .select('id, title, description, purpose, status, repo_path, priority')
        .eq('id', projectId)
        .eq('user_id', user.id)
        .maybeSingle(),
      supabase
        .from('project_contexts')
        .select('heading, details, progress, progress_status, progress_updated_at, updated_at')
        .eq('project_id', projectId)
        .eq('user_id', user.id)
        .maybeSingle(),
    ])
    if (projectError) return { success: false, error: projectError.message }
    if (!project) return { success: false, error: 'プロジェクトが見つかりません' }

    const loaded = await loadMindmapTasks(supabase, user.id, projectId)
    if (loaded.error) return { success: false, error: loaded.error }
    const { ordered } = buildMindmapOrder(loaded.data)
    const maxRows = normalizeLimit(limit, 120, 200)
    const links = includeLinkedMemos === false
      ? []
      : await loadMindmapLinkSummaries(supabase, user.id, loaded.data.map(node => node.id))
    const linkedCountByTask = new Map<string, number>()
    for (const link of links) {
      if (!link.task_id) continue
      linkedCountByTask.set(link.task_id, (linkedCountByTask.get(link.task_id) ?? 0) + 1)
    }

    return {
      success: true,
      project,
      project_context: context ?? null,
      stats: mindmapStats(loaded.data),
      nodes: ordered.slice(0, maxRows).map(node => ({
        id: node.id,
        title: node.title,
        path: node.path,
        depth: node.depth,
        parent_task_id: node.parent_task_id,
        parent_title: node.parent_title,
        project_id: node.project_id,
        is_group: node.is_group,
        status: node.status,
        stage: node.stage,
        priority: node.priority,
        order_index: node.order_index,
        scheduled_at: node.scheduled_at,
        estimated_time: node.estimated_time,
        calendar_id: node.calendar_id,
        google_event_id: node.google_event_id,
        children_count: node.children_count,
        linked_memo_count: linkedCountByTask.get(node.id) ?? 0,
        mindmap_collapsed: node.mindmap_collapsed ?? false,
        memo_preview: includeMemoPreview === false ? null : compactPreview(node.memo, 140),
        updated_at: node.updated_at,
      })),
      linked_memos: includeLinkedMemos === false ? undefined : links,
      truncated: ordered.length > maxRows,
      message: `「${project.title}」のマインドマップ ${loaded.data.length} ノードを取得しました`,
    }
  },
})

export const proposeMindmapOrganization = tool({
  description:
    'マインドマップを整理・統合・まとめ直したい時に使う読み取り専用ハーネス。既定では現在マップ上のノードだけを読み、ユーザーが明示した場合だけCodex Inboxやノート見出しを含める。DBは変更しない。変更案を保存する場合は本番tasksではなく saveMindmapDraft を使う。',
  inputSchema: z.object({
    projectId: z.string().describe('整理提案するプロジェクトID'),
    focus: z.string().optional().describe('整理したい観点。例: チャット文脈、ノート整理、未分類ノードなど。'),
    maxNodes: z.number().optional().describe('見出しとして返す最大ノード数。通常90、最大180。'),
    maxNoteHeadings: z.number().optional().describe('返すノート/メモ見出し数。通常20、最大60。'),
    maxCandidates: z.number().optional().describe('機械的に拾うまとめ候補数。通常5、最大8。'),
    includeCodexInbox: z.boolean().optional().describe('Codex Inbox配下の未配置/未取り込み扱いのCodexチャット・作業も整理対象に含めるか。ユーザーに確認済みの場合だけtrue。未指定/falseなら現在マインドマップ上にある通常ノードだけを見る。'),
    includeNoteHeadings: z.boolean().optional().describe('ノート/メモ見出しも整理候補として含めるか。ユーザーが明示した場合だけtrue。未指定/falseなら現在マップ上のノードだけを見る。'),
  }),
  execute: async ({ projectId, focus, maxNodes, maxNoteHeadings, maxCandidates, includeCodexInbox, includeNoteHeadings }) => {
    const supabase = await createClient()
    const user = await requireAuthedUser(supabase)
    if (!user) return { success: false, error: '認証エラー' }

    const nodeLimit = normalizeLimit(maxNodes, 90, 180)
    const noteLimit = normalizeLimit(maxNoteHeadings, 20, 60)
    const candidateLimit = normalizeLimit(maxCandidates, 5, 8)
    const shouldIncludeNoteHeadings = includeNoteHeadings === true

    const wishlistHeadingsQuery = shouldIncludeNoteHeadings
      ? supabase
        .from('ideal_goals')
        .select('id, title, status, memo_status, is_completed, updated_at')
        .eq('user_id', user.id)
        .eq('project_id', projectId)
        .in('status', ['wishlist', 'memo'])
        .order('updated_at', { ascending: false })
        .limit(noteLimit)
      : Promise.resolve({ data: [] })
    const memoHeadingsQuery = shouldIncludeNoteHeadings
      ? supabase
        .from('memo_items')
        .select('id, title, status, item_kind, updated_at')
        .eq('user_id', user.id)
        .eq('project_id', projectId)
        .order('updated_at', { ascending: false })
        .limit(noteLimit)
      : Promise.resolve({ data: [] })

    const [{ data: project, error: projectError }, { data: context }] = await Promise.all([
      supabase
        .from('projects')
        .select('id, title, description, purpose, status, repo_path')
        .eq('id', projectId)
        .eq('user_id', user.id)
        .maybeSingle(),
      supabase
        .from('project_contexts')
        .select('heading, details, progress, progress_status, updated_at')
        .eq('project_id', projectId)
        .eq('user_id', user.id)
        .maybeSingle(),
    ])
    if (projectError) return { success: false, error: projectError.message }
    if (!project) return { success: false, error: 'プロジェクトが見つかりません' }

    const [{ data: taskRows, error: taskError }, { data: wishlistRows }, { data: memoRows }] = await Promise.all([
      supabase
        .from('tasks')
        .select('id, title, parent_task_id, is_group, status, stage, order_index, source')
        .eq('project_id', projectId)
        .eq('user_id', user.id)
        .is('deleted_at', null)
        .order('order_index', { ascending: true })
        .limit(nodeLimit),
      wishlistHeadingsQuery,
      memoHeadingsQuery,
    ])
    if (taskError) return { success: false, error: taskError.message }

    const allNodes = (taskRows || []) as MindmapOrganizationNodeInput[]
    const hiddenCodexIds = getHiddenCodexInboxTaskIds(allNodes.map(node => ({
      id: node.id,
      parent_task_id: node.parent_task_id,
      source: node.source ?? '',
      title: node.title,
    })))
    const rawNodes = includeCodexInbox === true
      ? allNodes
      : allNodes.filter(node => !hiddenCodexIds.has(node.id))
    const ordered = orderMindmapOrganizationNodes(rawNodes)
    const candidateGroups = suggestMindmapOrganizationCandidates(ordered, candidateLimit)
    const wishlistHeadings = shouldIncludeNoteHeadings ? (wishlistRows || [])
      .filter(row => !row.is_completed && !['done', 'dismissed', 'archived'].includes(row.memo_status ?? ''))
      .map(row => ({
        record_type: 'wishlist' as const,
        id: row.id,
        title: row.title ?? '無題',
        status: row.memo_status ?? row.status ?? null,
        updated_at: row.updated_at,
      })) : []
    const memoHeadings = shouldIncludeNoteHeadings ? (memoRows || [])
      .filter(row => !['done', 'dismissed', 'archived'].includes(row.status ?? ''))
      .map(row => ({
        record_type: 'memo_item' as const,
        id: row.id,
        title: row.title ?? '無題',
        status: row.status ?? null,
        item_kind: row.item_kind ?? null,
        updated_at: row.updated_at,
      })) : []
    const noteHeadings = [...wishlistHeadings, ...memoHeadings]
      .sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')))
      .slice(0, noteLimit)

    return {
      success: true,
      focus: focus ? compactText(focus, 200) : null,
      project: {
        id: project.id,
        title: project.title,
        status: project.status,
        repo_path: project.repo_path,
        description_preview: compactPreview(project.description, 800),
        purpose_preview: compactPreview(project.purpose, 500),
      },
      project_context: context ? {
        heading: context.heading,
        details_preview: compactPreview(context.details, 700),
        progress_preview: compactPreview(context.progress, 700),
        progress_status: context.progress_status,
        updated_at: context.updated_at,
      } : null,
      map_stats: {
        returned_nodes: ordered.length,
        truncated: (taskRows || []).length >= nodeLimit,
        groups: ordered.filter(node => node.is_group).length,
        tasks: ordered.filter(node => !node.is_group).length,
        done_tasks: ordered.filter(node => !node.is_group && (node.status === 'done' || node.stage === 'done')).length,
      },
      codex_scope: {
        include_codex_inbox: includeCodexInbox === true,
        excluded_codex_inbox_nodes: includeCodexInbox === true ? 0 : hiddenCodexIds.size,
        instruction: includeCodexInbox === true
          ? 'ユーザー確認済みとして、Codex Inbox配下の未配置/未取り込み扱いのチャット・作業も整理対象に含めています。'
          : 'Codex Inbox配下の未配置/未取り込み扱いのチャット・作業は除外し、現在マインドマップ上にある通常ノードだけを整理対象にしています。',
      },
      heading_tree: formatMindmapOrganizationTree(ordered, nodeLimit),
      nodes: ordered.map(node => ({
        id: node.id,
        title: node.title,
        parent_task_id: node.parent_task_id,
        depth: node.depth,
        is_group: node.is_group,
        status: node.status,
        stage: node.stage,
        children_count: node.children_count,
      })),
      note_headings: {
        count_returned: noteHeadings.length,
        included: shouldIncludeNoteHeadings,
        truncated: shouldIncludeNoteHeadings && (((wishlistRows || []).length >= noteLimit) || ((memoRows || []).length >= noteLimit)),
        records: noteHeadings,
      },
      candidate_groups: candidateGroups,
      response_hints: [
        'まず構造診断を行い、今のままでよい場合は saveMindmapDraft を呼ばない。',
        '必要な差分だけ saveMindmapDraft に保存する。追加候補はユーザー承認前にAI案へ入れない。',
        'AI案保存後も、追加候補と深掘り質問を短く添える。',
      ],
      message: `「${project.title}」のマインドマップ整理用に、見出し${ordered.length}件とノート/メモ見出し${noteHeadings.length}件を取得しました。`,
    }
  },
})

function looksLikeUuid(value: string | null | undefined) {
  return !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

export const saveMindmapDraft = tool({
  description:
    'マップチャットの整理結果を本番tasksへ直接反映せず、プロジェクト全体の最新AI案下書きとして保存する。新規ノード、既存ノード移動、ユーザー明示のタイトル調整、元メモ/チャット紐づきを保存対象にする。',
  inputSchema: z.object({
    projectId: z.string().describe('AI案を保存するプロジェクトID'),
    chatSessionId: z.string().optional().describe('内部連携用。マップチャットのセッションIDがある場合だけ自動で渡される'),
    focus: z.string().optional().describe('整理した観点。例: 優先度順、重複整理、次にやる順'),
    scope: z.object({
      includeCodexInbox: z.boolean().optional().describe('Codex Inbox/未配置チャットを含めた場合だけtrue'),
      includeNoteHeadings: z.boolean().optional().describe('未整理メモ/ノート見出しを含めた場合だけtrue'),
      note: z.string().optional().describe('整理範囲の補足'),
    }).optional(),
    summary: z.object({
      newNodes: z.number().optional(),
      movedNodes: z.number().optional(),
      adjustedNodes: z.number().optional(),
      text: z.string().optional(),
    }).optional(),
    nodes: z.array(z.object({
      clientKey: z.string().optional().describe('このAI案内だけで使う新規ノード参照キー。例: group-agent-visibility'),
      parentClientKey: z.string().optional().describe('親が同じAI案内の新規ノードなら、そのclientKeyを入れる'),
      taskId: z.string().nullable().optional().describe('既存ノードを移動/調整する場合のtasks.id。新規ノードでは未指定'),
      parentTaskId: z.string().nullable().optional().describe('親が既存ノードならtasks.id。プロジェクト直下ならnull/未指定'),
      title: z.string().describe('新規ノード名、またはユーザーがAI案上で手動調整した既存ノード名'),
      isGroup: z.boolean().optional().describe('まとめ/カテゴリノードならtrue'),
      orderIndex: z.number().optional().describe('同じ親配下の表示順'),
      changeType: z.enum(['new', 'moved', 'title_adjusted', 'moved_title_adjusted', 'link_adjusted']).optional(),
      origin: z.enum(['ai', 'user']).optional().describe('AI作成/移動案ならai。ユーザーがAI案上で手動調整したものだけuser'),
      sourceLinks: z.array(z.object({
        memoItemId: z.string().optional(),
        sourceType: z.string().optional(),
        sourceId: z.string().optional(),
        label: z.string().optional(),
      })).optional().describe('元メモ/チャット紐づき。memoItemId + sourceType(wishlist/note) + sourceId があるものは確定時にmemo_node_linksへ保存される'),
    })).describe('保存する差分ノード。既存ノードのAIタイトル一括変更、削除、状態/メモ/予定変更は入れない。'),
  }),
  execute: async ({ projectId, chatSessionId, focus, scope, summary, nodes }) => {
    const supabase = await createClient()
    const user = await requireAuthedUser(supabase)
    if (!user) return { success: false, error: '認証エラー' }

    const keyToDraftNodeId = new Map<string, string>()
    for (const node of nodes) {
      const key = node.clientKey?.trim()
      if (!key || node.taskId) continue
      keyToDraftNodeId.set(key, crypto.randomUUID())
    }

    const draftNodes: SaveMindmapDraftNodeInput[] = nodes.map(node => {
      const clientKey = node.clientKey?.trim()
      const taskId = node.taskId ?? null
      const parentFromClient = node.parentClientKey ? keyToDraftNodeId.get(node.parentClientKey.trim()) ?? null : null
      const draftNodeId = taskId
        ? taskId
        : (clientKey ? keyToDraftNodeId.get(clientKey) ?? crypto.randomUUID() : crypto.randomUUID())
      return {
        draftNodeId,
        taskId,
        parentDraftNodeId: parentFromClient ?? (looksLikeUuid(node.parentTaskId ?? null) ? node.parentTaskId ?? null : null),
        parentTaskId: looksLikeUuid(node.parentTaskId ?? null) ? node.parentTaskId ?? null : null,
        title: node.title,
        isGroup: node.isGroup ?? !taskId,
        orderIndex: node.orderIndex ?? 0,
        changeType: node.changeType ?? (taskId ? 'moved' : 'new'),
        origin: node.origin ?? 'ai',
        sourceLinks: (node.sourceLinks ?? []) as Json,
        metadata: {
          clientKey: clientKey ?? null,
          focus: focus ?? null,
          savedBy: 'saveMindmapDraft',
        } as Json,
      }
    })

    const draft = await replaceActiveMindmapDraft({
      supabase,
      userId: user.id,
      projectId,
      chatSessionId: looksLikeUuid(chatSessionId) ? chatSessionId : null,
      scope: {
        focus: focus ?? null,
        includeCodexInbox: scope?.includeCodexInbox === true,
        includeNoteHeadings: scope?.includeNoteHeadings === true,
        note: scope?.note ?? null,
      } as Json,
      summary: summary ? {
        newNodes: summary.newNodes ?? undefined,
        movedNodes: summary.movedNodes ?? undefined,
        adjustedNodes: summary.adjustedNodes ?? undefined,
        text: summary.text ?? undefined,
      } as Json : undefined,
      nodes: draftNodes,
      createdBy: 'ai',
    })

    return {
      success: true,
      draftId: draft.draft.id,
      projectId,
      summary: draft.summary,
      nodeCount: draft.nodes.length,
      message: `AI案を保存しました。画面のAI案で確認し、必要なら手動調整してから確定してください。`,
    }
  },
})

export const getMindmapNodeDetail = tool({
  description:
    'マインドマップの1ノードについて、親、子孫、メモ紐づき、予定情報、進捗状態を詳しく確認する。',
  inputSchema: z.object({
    nodeId: z.string().describe('確認するノードID'),
    includeDescendants: z.boolean().optional().describe('子孫ノードも含めるか。通常はtrue。'),
    includeLinkedMemos: z.boolean().optional().describe('メモ紐づきも含めるか。通常はtrue。'),
  }),
  execute: async ({ nodeId, includeDescendants, includeLinkedMemos }) => {
    const supabase = await createClient()
    const user = await requireAuthedUser(supabase)
    if (!user) return { success: false, error: '認証エラー' }

    const node = await loadTaskById(supabase, user.id, nodeId)
    if (!node) return { success: false, error: 'ノードが見つかりません' }
    const projectId = node.project_id
    if (!projectId) return { success: false, error: 'このノードはプロジェクトに紐づいていません' }

    const loaded = await loadMindmapTasks(supabase, user.id, projectId)
    if (loaded.error) return { success: false, error: loaded.error }
    const { ordered, byId } = buildMindmapOrder(loaded.data)
    const descendantIds = getDescendantIds(loaded.data, nodeId)
    const selectedIds = includeDescendants === false ? [nodeId] : descendantIds
    const selectedNodes = ordered.filter(item => selectedIds.includes(item.id))
    const links = includeLinkedMemos === false
      ? []
      : await loadMindmapLinkSummaries(supabase, user.id, selectedIds)

    return {
      success: true,
      node: {
        ...node,
        parent: node.parent_task_id ? byId.get(node.parent_task_id) ?? null : null,
      },
      descendants: includeDescendants === false ? undefined : selectedNodes.filter(item => item.id !== nodeId),
      descendant_stats: mindmapStats(selectedNodes),
      linked_memos: includeLinkedMemos === false ? undefined : links,
      message: `ノード「${node.title}」の詳細を取得しました`,
    }
  },
})

export const updateMindmapNode = tool({
  description:
    'マインドマップノードの内容を更新する。タイトル、メモ、状態、進捗段階、優先度、予定日時、所要時間、折りたたみ状態を変更できる。',
  inputSchema: z.object({
    nodeId: z.string().describe('更新するノードID'),
    title: z.string().optional().describe('新しいタイトル'),
    memo: z.string().nullable().optional().describe('ノードメモ。nullで消去。'),
    status: z.string().optional().describe('todo / pending / done などの状態'),
    stage: z.enum(TASK_STAGES).optional().describe('plan / scheduled / executing / done / archived'),
    priority: z.number().nullable().optional().describe('優先度。nullで消去。'),
    scheduledAt: z.string().nullable().optional().describe('予定日時。nullで消去。'),
    estimatedTime: z.number().optional().describe('所要時間（分）'),
    calendarId: z.string().nullable().optional().describe('GoogleカレンダーID。nullで消去。'),
    mindmapCollapsed: z.boolean().optional().describe('子ノードを折りたたむか'),
  }),
  execute: async ({ nodeId, title, memo, status, stage, priority, scheduledAt, estimatedTime, calendarId, mindmapCollapsed }) => {
    const supabase = await createClient()
    const user = await requireAuthedUser(supabase)
    if (!user) return { success: false, error: '認証エラー' }

    const node = await loadTaskById(supabase, user.id, nodeId)
    if (!node) return { success: false, error: 'ノードが見つかりません' }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (typeof title === 'string') updates.title = compactText(title, 300)
    if (memo !== undefined) updates.memo = memo === null ? null : compactText(memo, 12000)
    if (typeof status === 'string') updates.status = compactText(status, 40)
    if (stage) updates.stage = stage
    if (priority !== undefined) updates.priority = priority === null ? null : Math.round(priority)
    if (scheduledAt !== undefined) {
      if (scheduledAt !== null && isNaN(Date.parse(scheduledAt))) {
        return { success: false, error: 'scheduledAt が有効な日時ではありません' }
      }
      updates.scheduled_at = scheduledAt
      if (scheduledAt && !stage) updates.stage = 'scheduled'
    }
    if (typeof estimatedTime === 'number' && Number.isFinite(estimatedTime)) {
      updates.estimated_time = Math.max(0, Math.round(estimatedTime))
    }
    if (calendarId !== undefined) updates.calendar_id = calendarId
    if (typeof mindmapCollapsed === 'boolean') updates.mindmap_collapsed = mindmapCollapsed

    if (Object.keys(updates).length === 1) {
      return { success: false, error: '更新内容が指定されていません' }
    }

    const { data: updated, error } = await supabase
      .from('tasks')
      .update(updates)
      .eq('id', nodeId)
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .select('*')
      .maybeSingle()
    if (error) return { success: false, error: error.message }
    if (!updated) return { success: false, error: 'ノード更新に失敗しました' }

    const shouldSyncCalendar = Boolean(
      updated.scheduled_at &&
      updated.calendar_id &&
      ((scheduledAt !== undefined) || (estimatedTime !== undefined) || (calendarId !== undefined) || (title !== undefined) || (memo !== undefined))
    )
    if (shouldSyncCalendar) {
      try {
        const { syncTaskToCalendar } = await import('@/lib/google-calendar')
        await syncTaskToCalendar(user.id, nodeId, {
          title: updated.title,
          scheduled_at: updated.scheduled_at,
          estimated_time: updated.estimated_time || 60,
          google_event_id: updated.google_event_id || undefined,
          calendar_id: updated.calendar_id,
          memo: updated.memo,
        })
      } catch (calendarError) {
        return {
          success: true,
          task: updated,
          calendarSynced: false,
          warning: calendarError instanceof Error ? calendarError.message : 'Googleカレンダー同期に失敗しました',
          message: `ノード「${updated.title}」を更新しましたが、カレンダー同期は失敗しました`,
        }
      }
    }

    return {
      success: true,
      task: updated,
      calendarSynced: shouldSyncCalendar,
      message: `ノード「${updated.title}」を更新しました`,
    }
  },
})

export const moveMindmapNode = tool({
  description:
    'マインドマップノードを別の親ノード配下、ルート、または別プロジェクトへ移動する。子孫ノードとメモ紐づきのproject_idも追従する。',
  inputSchema: z.object({
    nodeId: z.string().describe('移動するノードID'),
    parentTaskId: z.string().nullable().optional().describe('新しい親ノードID。nullでプロジェクト直下。'),
    projectId: z.string().nullable().optional().describe('移動先プロジェクトID。未指定なら親または現在のプロジェクト。nullで未所属。'),
    orderIndex: z.number().optional().describe('移動先での表示順。未指定なら末尾。'),
  }),
  execute: async ({ nodeId, parentTaskId, projectId, orderIndex }) => {
    const supabase = await createClient()
    const user = await requireAuthedUser(supabase)
    if (!user) return { success: false, error: '認証エラー' }

    const node = await loadTaskById(supabase, user.id, nodeId)
    if (!node) return { success: false, error: 'ノードが見つかりません' }
    const currentProjectId = node.project_id
    if (!currentProjectId) return { success: false, error: 'このノードはプロジェクトに紐づいていません' }

    let targetParent: MindmapTaskRow | null = null
    if (parentTaskId) {
      targetParent = await loadTaskById(supabase, user.id, parentTaskId)
      if (!targetParent) return { success: false, error: '移動先の親ノードが見つかりません' }
    }
    const targetProjectId = projectId !== undefined
      ? projectId
      : targetParent?.project_id ?? currentProjectId

    if (targetProjectId) {
      const { data: project } = await supabase
        .from('projects')
        .select('id')
        .eq('id', targetProjectId)
        .eq('user_id', user.id)
        .maybeSingle()
      if (!project) return { success: false, error: '移動先プロジェクトが見つかりません' }
    }
    if (targetParent && targetParent.project_id !== targetProjectId) {
      return { success: false, error: '親ノードと移動先プロジェクトが一致していません' }
    }

    const currentLoaded = await loadMindmapTasks(supabase, user.id, currentProjectId)
    if (currentLoaded.error) return { success: false, error: currentLoaded.error }
    const movedIds = getDescendantIds(currentLoaded.data, nodeId)
    if (parentTaskId && movedIds.includes(parentTaskId)) {
      return { success: false, error: '自分自身または子孫ノード配下には移動できません' }
    }

    let resolvedOrderIndex = orderIndex
    if (resolvedOrderIndex === undefined) {
      let orderQuery = supabase
        .from('tasks')
        .select('order_index')
        .eq('user_id', user.id)
        .is('deleted_at', null)
        .order('order_index', { ascending: false })
        .limit(1)
      orderQuery = targetProjectId
        ? orderQuery.eq('project_id', targetProjectId)
        : orderQuery.is('project_id', null)
      orderQuery = parentTaskId
        ? orderQuery.eq('parent_task_id', parentTaskId)
        : orderQuery.is('parent_task_id', null)
      const { data: maxOrder } = await orderQuery.maybeSingle()
      resolvedOrderIndex = (maxOrder?.order_index ?? -1) + 1
    }

    const now = new Date().toISOString()
    const { data: movedRoot, error: rootError } = await supabase
      .from('tasks')
      .update({
        project_id: targetProjectId,
        parent_task_id: parentTaskId ?? null,
        order_index: Math.round(resolvedOrderIndex ?? 0),
        updated_at: now,
      })
      .eq('id', nodeId)
      .eq('user_id', user.id)
      .select('*')
      .maybeSingle()
    if (rootError) return { success: false, error: rootError.message }
    if (!movedRoot) return { success: false, error: 'ノード移動に失敗しました' }

    const descendantOnlyIds = movedIds.filter(id => id !== nodeId)
    if (descendantOnlyIds.length > 0) {
      const { error } = await supabase
        .from('tasks')
        .update({ project_id: targetProjectId, updated_at: now })
        .eq('user_id', user.id)
        .in('id', descendantOnlyIds)
      if (error) return { success: false, error: error.message }
    }

    await supabase
      .from('memo_node_links')
      .update({ project_id: targetProjectId, updated_at: now })
      .eq('user_id', user.id)
      .in('task_id', movedIds)
      .eq('link_type', 'mindmap_node')
      .eq('status', 'active')

    return {
      success: true,
      task: movedRoot,
      movedNodeIds: movedIds,
      message: `ノード「${movedRoot.title}」を移動しました`,
    }
  },
})

export const updateMindmapMemoLink = tool({
  description:
    'メモ/ノートとマインドマップノードの紐づきを追加・移動・解除する。どのメモがどのノードに紐づくかを変更したい時に使う。',
  inputSchema: z.object({
    action: z.enum(MEMO_LINK_ACTIONS).describe('link=追加、move=付け替え、unlink=解除'),
    taskId: z.string().optional().describe('追加/移動先のマインドマップノードID'),
    fromTaskId: z.string().optional().describe('解除または付け替え元のノードID。未指定なら対象メモの既存activeリンク全体。'),
    linkId: z.string().optional().describe('既存のmemo_node_links.id。指定時はこのリンクを対象にする。'),
    memoItemId: z.string().optional().describe('memo_items.id。構造化メモリンクを操作する時に使う。'),
    sourceType: z.enum(MEMO_SOURCE_TYPES).optional().describe('sourceId指定時の種類。通常 wishlist。'),
    sourceId: z.string().optional().describe('wishlist/notes側の元メモID。legacy payloadリンクも操作できる。'),
  }),
  execute: async ({ action, taskId, fromTaskId, linkId, memoItemId, sourceType, sourceId }) => {
    const supabase = await createClient()
    const user = await requireAuthedUser(supabase)
    if (!user) return { success: false, error: '認証エラー' }

    const needsTarget = action === 'link' || action === 'move'
    const targetTask = needsTarget && taskId ? await loadTaskById(supabase, user.id, taskId) : null
    if (needsTarget && !targetTask) return { success: false, error: '紐づけ先ノードが見つかりません' }

    const now = new Date().toISOString()
    const archivedLinkIds: string[] = []
    if (action === 'move' || action === 'unlink') {
      let query = supabase
        .from('memo_node_links')
        .select('id')
        .eq('user_id', user.id)
        .eq('link_type', 'mindmap_node')
        .eq('status', 'active')

      if (linkId) query = query.eq('id', linkId)
      else if (memoItemId) query = query.eq('memo_item_id', memoItemId)
      else if (sourceId) {
        query = query.eq('source_id', sourceId)
        if (sourceType) query = query.eq('source_type', sourceType)
      } else {
        return { success: false, error: '解除/付け替え対象の linkId / memoItemId / sourceId のいずれかが必要です' }
      }
      if (fromTaskId) query = query.eq('task_id', fromTaskId)

      const { data: links, error: linkLoadError } = await query
      if (linkLoadError) return { success: false, error: linkLoadError.message }
      const ids = (links || []).map(link => link.id).filter((id): id is string => typeof id === 'string')
      if (ids.length > 0) {
        const { error } = await supabase
          .from('memo_node_links')
          .update({ status: 'archived', updated_at: now })
          .eq('user_id', user.id)
          .in('id', ids)
        if (error) return { success: false, error: error.message }
        archivedLinkIds.push(...ids)
      }
    }

    let createdStructuredLink: unknown = null
    if ((action === 'link' || action === 'move') && memoItemId && targetTask) {
      const { data: memoItem, error: memoError } = await supabase
        .from('memo_items')
        .select('id, source_type, source_id, project_id, title')
        .eq('id', memoItemId)
        .eq('user_id', user.id)
        .maybeSingle()
      if (memoError) return { success: false, error: memoError.message }
      if (!memoItem) return { success: false, error: 'memoItem が見つかりません' }

      const { data: existing } = await supabase
        .from('memo_node_links')
        .select('id')
        .eq('user_id', user.id)
        .eq('memo_item_id', memoItemId)
        .eq('task_id', targetTask.id)
        .eq('link_type', 'mindmap_node')
        .eq('status', 'active')
        .maybeSingle()

      if (!existing) {
        const { data, error } = await supabase
          .from('memo_node_links')
          .insert({
            user_id: user.id,
            memo_item_id: memoItem.id,
            source_type: memoItem.source_type,
            source_id: memoItem.source_id,
            task_id: targetTask.id,
            project_id: targetTask.project_id,
            link_type: 'mindmap_node',
            status: 'active',
            metadata: { source: 'chat_agent' },
          })
          .select('id, memo_item_id, source_type, source_id, task_id, project_id, status')
          .single()
        if (error) return { success: false, error: error.message }
        createdStructuredLink = data
      } else {
        createdStructuredLink = existing
      }
    }

    let legacyUpdated = false
    if (sourceId && (sourceType ?? 'wishlist') === 'wishlist') {
      const { data: source, error: sourceError } = await supabase
        .from('ideal_goals')
        .select('id, title, ai_source_payload')
        .eq('id', sourceId)
        .eq('user_id', user.id)
        .maybeSingle()
      if (sourceError) return { success: false, error: sourceError.message }
      if (!source) return { success: false, error: '元メモが見つかりません' }

      let payload = source.ai_source_payload
      if (action === 'move' || action === 'unlink') {
        payload = removeLegacyMindmapLink(payload, fromTaskId || null)
      }
      if ((action === 'link' || action === 'move') && targetTask) {
        payload = addLegacyMindmapLink(payload, targetTask.id)
      }

      const { error } = await supabase
        .from('ideal_goals')
        .update({ ai_source_payload: payload, updated_at: now })
        .eq('id', source.id)
        .eq('user_id', user.id)
      if (error) return { success: false, error: error.message }
      legacyUpdated = true
    }

    return {
      success: true,
      action,
      archivedLinkIds,
      createdStructuredLink,
      legacyUpdated,
      targetTaskId: targetTask?.id ?? null,
      message: action === 'unlink'
        ? 'メモ紐づきを解除しました'
        : action === 'move'
          ? 'メモ紐づきを付け替えました'
          : 'メモ紐づきを追加しました',
    }
  },
})

// ━━━ 予定確認 / 既存予定編集 ━━━

export const listCalendarEvents = tool({
  description:
    '既存のGoogleカレンダー予定と利用可能カレンダー一覧を確認する。予定の見出し/内容/時間/所属カレンダーを変更する前、空き状況を見る前、今日/明日/今週の予定確認に使う。',
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
      const { data: calendarRows } = await supabase
        .from('user_calendars')
        .select('google_calendar_id, name, access_level, selected, is_primary')
        .eq('user_id', user.id)
      const calendars = (calendarRows || []).map(row => ({
        calendar_id: row.google_calendar_id,
        name: row.name ?? null,
        access_level: row.access_level ?? null,
        selected: row.selected ?? null,
        is_primary: row.is_primary ?? null,
      }))
      const calendarNameById = new Map(calendars.map(calendar => [calendar.calendar_id, calendar.name]))
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
          recurring_event_id: event.recurring_event_id ?? null,
          calendar_id: event.calendar_id,
          calendar_name: calendarNameById.get(event.calendar_id) ?? null,
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
        available_calendars: calendars,
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

export const findCalendarOpenSlots = tool({
  description:
    'Googleカレンダー予定とFocusmapの予定化済みタスクを合わせて、指定日から数日分の空き時間候補を探す。「どこが空いてる」「この予定を入れる候補を出して」の時に使う。',
  inputSchema: z.object({
    date: z.string().optional().describe('検索開始日。YYYY-MM-DD または ISO 8601。未指定なら今日（Asia/Tokyo）。'),
    days: z.number().optional().describe('検索日数。デフォルト7日、最大14日。'),
    durationMinutes: z.number().optional().describe('入れたい予定の長さ（分）。デフォルト60分、最大480分。'),
    workingHours: z.object({
      start: z.string().describe('検索する開始時刻 HH:mm。例: 09:00'),
      end: z.string().describe('検索する終了時刻 HH:mm。例: 18:00'),
    }).optional().describe('空き時間を探す時間帯。未指定なら9:00-18:00。'),
    calendarIds: z.array(z.string()).optional().describe('対象カレンダーID。未指定なら選択中カレンダー。'),
    includeScheduledTasks: z.boolean().optional().describe('Focusmap内の予定化済みタスクも埋まっている時間として扱うか。通常はtrue。'),
    limit: z.number().optional().describe('返す候補枠数。最大80件。'),
  }),
  execute: async ({ date, days, durationMinutes, workingHours, calendarIds, includeScheduledTasks, limit }) => {
    const supabase = await createClient()
    const user = await requireAuthedUser(supabase)
    if (!user) return { success: false, error: '認証エラー' }

    const startDateKey = parseTokyoDateKey(date)
    if (!startDateKey) return { success: false, error: 'date が有効な日付ではありません' }
    const dayCount = normalizeLimit(days, 7, 14)
    const duration = normalizeLimit(durationMinutes, 60, 480)
    const maxRows = normalizeLimit(limit, 20, 80)
    const hours = normalizeWorkingHours(workingHours)
    if (!hours) return { success: false, error: 'workingHours は start/end とも HH:mm 形式で、end が start より後である必要があります' }

    const endDateKey = addTokyoDays(startDateKey, dayCount)
    const rangeStart = tokyoDateTime(startDateKey, '00:00')
    const rangeEnd = tokyoDateTime(endDateKey, '00:00')
    if (!rangeStart || !rangeEnd) return { success: false, error: '検索期間を作成できませんでした' }

    try {
      const resolvedCalendarIds = await getSelectedCalendarIds(supabase, user.id, calendarIds)
      const { fetchCalendarEvents, fetchMultipleCalendarEvents } = await import('@/lib/google-calendar')
      const rawEvents = resolvedCalendarIds.length > 1
        ? await fetchMultipleCalendarEvents(user.id, resolvedCalendarIds, { timeMin: rangeStart, timeMax: rangeEnd })
        : await fetchCalendarEvents(user.id, { calendarId: resolvedCalendarIds[0], timeMin: rangeStart, timeMax: rangeEnd })

      const eventBusySlots = rawEvents
        .map(event => toBusySlot({
          id: event.google_event_id,
          title: event.title,
          start: event.start_time,
          end: event.end_time,
          source: 'calendar',
          calendar_id: event.calendar_id,
        }))
        .filter((slot): slot is BusySlot => slot !== null)

      let taskBusySlots: BusySlot[] = []
      if (includeScheduledTasks !== false) {
        const { data: tasks, error: taskError } = await supabase
          .from('tasks')
          .select('id, title, project_id, scheduled_at, estimated_time')
          .eq('user_id', user.id)
          .is('deleted_at', null)
          .not('scheduled_at', 'is', null)
          .gte('scheduled_at', rangeStart.toISOString())
          .lt('scheduled_at', rangeEnd.toISOString())
        if (taskError) return { success: false, error: taskError.message }

        taskBusySlots = (tasks || [])
          .map(task => {
            const start = new Date(task.scheduled_at!)
            const end = addMinutes(start, Math.max(1, task.estimated_time || duration))
            return toBusySlot({
              id: task.id,
              title: task.title,
              start,
              end,
              source: 'task',
              project_id: task.project_id,
            })
          })
          .filter((slot): slot is BusySlot => slot !== null)
      }

      const busySlots = [...eventBusySlots, ...taskBusySlots]
      const openSlots: CalendarOpenSlot[] = []
      for (let offset = 0; offset < dayCount; offset += 1) {
        const dateKey = addTokyoDays(startDateKey, offset)
        const remaining = maxRows - openSlots.length
        if (remaining <= 0) break
        openSlots.push(...findOpenSlotsForDay({
          dateKey,
          busySlots,
          durationMinutes: duration,
          workingHours: hours,
          limit: remaining,
        }))
      }

      return {
        success: true,
        date: startDateKey,
        days: dayCount,
        duration_minutes: duration,
        working_hours: hours,
        calendar_ids: resolvedCalendarIds,
        open_slots: openSlots,
        busy_summary: busySlots
          .sort((a, b) => a.start.getTime() - b.start.getTime())
          .slice(0, 30)
          .map(slot => ({
            id: slot.id,
            title: slot.title,
            source: slot.source,
            calendar_id: slot.calendar_id,
            project_id: slot.project_id,
            start_time: slot.start.toISOString(),
            end_time: slot.end.toISOString(),
          })),
        message: `${openSlots.length}件の空き時間候補を取得しました`,
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '空き時間候補の取得に失敗しました' }
    }
  },
})

export const updateCalendarEvent = tool({
  description:
    '既存のGoogleカレンダー予定の見出し、内容、場所、開始/終了時刻、所属カレンダーを変更する。先にlistCalendarEventsで対象のgoogle_event_id、現在のcalendar_id、移動先calendar_idまたはカレンダー名を確認してから使う。',
  inputSchema: z.object({
    googleEventId: z.string().describe('Google Calendar のイベントID'),
    calendarId: z.string().optional().describe('現在その予定が入っているカレンダーID。未指定なら選択中カレンダーから探索する。'),
    destinationCalendarId: z.string().optional().describe('移動先のGoogleカレンダーID。カレンダー変更しない場合は省略。'),
    destinationCalendarName: z.string().optional().describe('移動先カレンダー名。IDが不明な場合に使う。'),
    title: z.string().optional().describe('新しい見出し。未指定なら変更しない。'),
    description: z.string().optional().describe('新しい内容/説明。空文字なら説明を消す。未指定なら変更しない。'),
    location: z.string().optional().describe('新しい場所。空文字なら場所を消す。未指定なら変更しない。'),
    startTime: z.string().optional().describe('新しい開始日時（ISO 8601）。未指定なら変更しない。'),
    endTime: z.string().optional().describe('新しい終了日時（ISO 8601）。durationMinutes指定時は省略可。'),
    durationMinutes: z.number().optional().describe('startTimeからの所要時間（分）。endTime未指定時に使う。'),
  }),
  execute: async ({ googleEventId, calendarId, destinationCalendarId, destinationCalendarName, title, description, location, startTime, endTime, durationMinutes }) => {
    const supabase = await createClient()
    const user = await requireAuthedUser(supabase)
    if (!user) return { success: false, error: '認証エラー' }

    const { data: calendarRows, error: calendarRowsError } = await supabase
      .from('user_calendars')
      .select('google_calendar_id, name, access_level, selected, is_primary')
      .eq('user_id', user.id)
    if (calendarRowsError) return { success: false, error: calendarRowsError.message }

    const calendars: UserCalendarSummary[] = (calendarRows || []).map(row => ({
      calendar_id: row.google_calendar_id,
      name: row.name ?? null,
      access_level: row.access_level ?? null,
      selected: row.selected ?? null,
      is_primary: row.is_primary ?? null,
    }))
    const calendarAccessById = new Map(
      calendars.map(calendar => [calendar.calendar_id, calendar.access_level] as const)
    )
    const calendarNameById = new Map(calendars.map(calendar => [calendar.calendar_id, calendar.name]))

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

      const resolvedDestinationCalendarId =
        resolveCalendarIdFromNameOrId(calendars, destinationCalendarId)
        || resolveCalendarIdFromNameOrId(calendars, destinationCalendarName)
        || destinationCalendarId?.trim()
        || found.calendarId
      const destinationAccess = resolvedDestinationCalendarId === 'primary'
        ? 'owner'
        : calendarAccessById.get(resolvedDestinationCalendarId)
      if (destinationAccess && !isWritableCalendar(destinationAccess)) {
        return { success: false, error: '移動先カレンダーは閲覧専用のため変更できません' }
      }
      if (!destinationAccess && resolvedDestinationCalendarId !== found.calendarId) {
        return { success: false, error: '移動先カレンダーが見つかりません' }
      }

      const { getCalendarClient } = await import('@/lib/google-calendar')
      const { calendar } = await getCalendarClient(user.id)
      let current = found.event
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
      let effectiveGoogleEventId = googleEventId
      const movedCalendar = found.calendarId !== resolvedDestinationCalendarId

      if (movedCalendar) {
        const moveResponse = await calendar.events.move({
          calendarId: found.calendarId,
          eventId: googleEventId,
          destination: resolvedDestinationCalendarId,
        })
        effectiveGoogleEventId = moveResponse.data.id || googleEventId
        current = moveResponse.data.id ? moveResponse.data : current
      }

      await calendar.events.update({
        calendarId: resolvedDestinationCalendarId,
        eventId: effectiveGoogleEventId,
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
        google_event_id: effectiveGoogleEventId,
        calendar_id: resolvedDestinationCalendarId,
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
        .eq('calendar_id', resolvedDestinationCalendarId)
        .eq('google_event_id', googleEventId)
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

      const taskUpdates: Record<string, unknown> = {
        title: nextTitle,
        scheduled_at: resolvedStart.toISOString(),
        estimated_time: Math.max(1, minutesBetween(resolvedStart.toISOString(), resolvedEnd.toISOString())),
        calendar_id: resolvedDestinationCalendarId,
        google_event_id: effectiveGoogleEventId,
        updated_at: now,
      }
      if (description !== undefined) {
        taskUpdates.memo = nextDescription ? compactText(nextDescription, 12000) : null
      }
      await supabase
        .from('tasks')
        .update(taskUpdates)
        .eq('user_id', user.id)
        .eq('google_event_id', googleEventId)
        .in('calendar_id', Array.from(new Set([found.calendarId, resolvedDestinationCalendarId])))

      await supabase
        .from('ideal_goals')
        .update({
          title: nextTitle,
          description: nextDescription || null,
          scheduled_at: resolvedStart.toISOString(),
          duration_minutes: taskUpdates.estimated_time,
          google_event_id: effectiveGoogleEventId,
          memo_status: 'scheduled',
          updated_at: now,
        })
        .eq('user_id', user.id)
        .eq('google_event_id', googleEventId)

      return {
        success: true,
        googleEventId: effectiveGoogleEventId,
        originalGoogleEventId: googleEventId,
        calendarId: resolvedDestinationCalendarId,
        originalCalendarId: found.calendarId,
        calendarName: calendarNameById.get(resolvedDestinationCalendarId) ?? null,
        title: nextTitle,
        startTime: resolvedStart.toISOString(),
        endTime: resolvedEnd.toISOString(),
        movedCalendar,
        message: movedCalendar
          ? `予定「${nextTitle}」を「${calendarNameById.get(resolvedDestinationCalendarId) || resolvedDestinationCalendarId}」へ移動しました`
          : `予定「${nextTitle}」を更新しました`,
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '予定更新に失敗しました' }
    }
  },
})

export const deleteCalendarEvent = tool({
  description:
    '既存のGoogleカレンダー予定を削除する。ユーザーが削除を明示し、先にlistCalendarEventsで対象のgoogle_event_idとcalendar_idを確認してから使う。候補が複数ある場合は実行前にユーザーへ確認する。',
  inputSchema: z.object({
    googleEventId: z.string().describe('削除するGoogle CalendarのイベントID。listCalendarEventsのgoogle_event_idを使う。'),
    calendarId: z.string().optional().describe('予定が入っている現在のカレンダーID。listCalendarEventsのcalendar_idを渡す。'),
    title: z.string().optional().describe('削除対象の見出し。確認・完了メッセージ用。'),
    startTime: z.string().optional().describe('削除対象の開始日時（ISO 8601）。確認・完了メッセージ用。'),
    endTime: z.string().optional().describe('削除対象の終了日時（ISO 8601）。確認・完了メッセージ用。'),
    deleteScope: z.enum(['this', 'series']).optional().describe('繰り返し予定の削除範囲。通常はthis。全体削除はseries。'),
    recurringEventId: z.string().optional().describe('繰り返し予定全体を削除する場合のrecurring_event_id。'),
  }),
  execute: async ({ googleEventId, calendarId, title, startTime, endTime, deleteScope, recurringEventId }) => {
    const supabase = await createClient()
    const user = await requireAuthedUser(supabase)
    if (!user) return { success: false, error: '認証エラー' }

    const eventId = googleEventId.trim()
    const requestedCalendarId = calendarId?.trim()
    const requestedScope = deleteScope === 'series' ? 'series' : 'this'
    if (!eventId) return { success: false, error: 'googleEventId が必要です' }

    try {
      const calendars = await listUserCalendarSummaries(supabase, user.id)
      const candidateCalendarIds = Array.from(new Set([
        requestedCalendarId,
        ...calendars.filter(calendar => calendar.selected).map(calendar => calendar.calendar_id),
        calendars.find(calendar => calendar.is_primary)?.calendar_id,
        'primary',
        ...calendars.map(calendar => calendar.calendar_id),
      ].filter((id): id is string => typeof id === 'string' && id.trim().length > 0)))

      const cachedEvent = await getCachedCalendarEventForDeletion(supabase, user.id, eventId, requestedCalendarId)
      const found = await findCalendarContainingGoogleEvent(user.id, eventId, candidateCalendarIds)
      const resolvedCalendarId = found?.calendarId || requestedCalendarId || cachedEvent?.calendar_id
      if (!resolvedCalendarId) return { success: false, error: '削除対象のカレンダーを特定できません' }

      const writable = await findWritableCalendar(supabase, user.id, resolvedCalendarId)
      if (!writable && resolvedCalendarId !== 'primary') {
        return { success: false, error: '選択したカレンダーは利用できません' }
      }
      if (writable && !isWritableCalendar(writable.access_level)) {
        return { success: false, error: 'このカレンダーは閲覧専用のため削除できません' }
      }

      const eventTitle = title
        || found?.event.summary
        || cachedEvent?.title
        || '予定'
      const eventStart = startTime
        || found?.event.start?.dateTime
        || found?.event.start?.date
        || cachedEvent?.start_time
        || null
      const eventEnd = endTime
        || found?.event.end?.dateTime
        || found?.event.end?.date
        || cachedEvent?.end_time
        || null
      const targetGoogleEventId = requestedScope === 'series'
        ? (recurringEventId?.trim() || found?.event.recurringEventId || cachedEvent?.recurring_event_id || eventId)
        : eventId

      const scopedGoogleEventIds = await collectCalendarEventIdsForDeletion(
        supabase,
        user.id,
        resolvedCalendarId,
        eventId,
        targetGoogleEventId,
        requestedScope,
      )

      let deletedFromGoogle = false
      if (found) {
        const { getCalendarClient } = await import('@/lib/google-calendar')
        const { calendar } = await getCalendarClient(user.id)
        try {
          await calendar.events.delete({
            calendarId: resolvedCalendarId,
            eventId: targetGoogleEventId,
          })
          deletedFromGoogle = true
        } catch (error) {
          if (!isMissingCalendarEventError(error)) throw error
        }
      }

      const cleanup = await cleanupDeletedCalendarEventState({
        supabase,
        userId: user.id,
        calendarId: resolvedCalendarId,
        googleEventIds: scopedGoogleEventIds,
        targetGoogleEventId,
        deleteScope: requestedScope,
      })

      return {
        success: true,
        googleEventId: eventId,
        targetGoogleEventId,
        calendarId: resolvedCalendarId,
        title: eventTitle,
        startTime: eventStart,
        endTime: eventEnd,
        deleteScope: requestedScope,
        deleted: true,
        deletedFromGoogle,
        notFoundOnGoogle: !deletedFromGoogle,
        affectedGoogleEventIds: scopedGoogleEventIds,
        ...cleanup,
        message: deletedFromGoogle
          ? `予定「${eventTitle}」を削除しました`
          : `予定「${eventTitle}」はGoogleカレンダー上に見つかりませんでした。Focusmap側の同期情報を整理しました`,
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '予定削除に失敗しました' }
    }
  },
})

// ━━━ マインドマップ関連 ━━━

export const addMindmapGroup = tool({
  description: 'マインドマップにグループ（カテゴリ/まとめ）ノードを追加する。整理提案の承認後、まとめノードを作る時にも使う。',
  inputSchema: z.object({
    title: z.string().describe('グループのタイトル'),
    projectId: z.string().describe('プロジェクトID'),
    parentId: z.string().nullable().optional().describe('親ノードID。未指定またはnullならプロジェクト直下に作る。'),
  }),
  execute: async ({ title, projectId, parentId }) => {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: '認証エラー' }

    let parentNode: { id: string; title: string; project_id: string | null } | null = null
    if (parentId) {
      const { data, error } = await supabase
        .from('tasks')
        .select('id, title, project_id')
        .eq('id', parentId)
        .eq('user_id', user.id)
        .is('deleted_at', null)
        .maybeSingle()
      if (error) return { success: false, error: error.message }
      if (!data) return { success: false, error: '親ノードが見つかりません' }
      if (data.project_id !== projectId) return { success: false, error: '親ノードとプロジェクトが一致していません' }
      parentNode = data
    }

    let orderQuery = supabase
      .from('tasks')
      .select('order_index')
      .eq('user_id', user.id)
      .eq('project_id', projectId)
      .is('deleted_at', null)

    orderQuery = parentId
      ? orderQuery.eq('parent_task_id', parentId)
      : orderQuery.is('parent_task_id', null)

    const { data: maxOrder } = await orderQuery
      .order('order_index', { ascending: false })
      .limit(1)
      .maybeSingle()

    const insertPayload = {
      title,
      user_id: user.id,
      project_id: projectId,
      is_group: true,
      parent_task_id: parentId ?? null,
      status: 'todo',
      stage: 'plan',
      order_index: (maxOrder?.order_index ?? -1) + 1,
    }
    const { data: group, error } = await supabase
      .from('tasks')
      .insert(insertPayload)
      .select('id, title, project_id, parent_task_id, is_group, order_index')
      .maybeSingle()
    if (error) return { success: false, error: error.message }
    if (!group) return { success: false, error: 'グループ作成に失敗しました' }
    return {
      success: true,
      group,
      title,
      parentTitle: parentNode?.title ?? null,
      message: parentNode
        ? `「${parentNode.title}」配下にグループ「${title}」を追加しました`
        : `グループ「${title}」を追加しました`,
    }
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
      return { addTask, bulkAddMemos, addMindmapGroup, addMindmapTask }
    case 'project-consultation':
      return { addTask, bulkAddMemos, addCalendarEvent, addMindmapGroup, addMindmapTask, deleteMindmapNode }
    case 'brainstorm':
      return { addTask, bulkAddMemos, addMindmapGroup, addMindmapTask }
    case 'counseling':
      return {}  // カウンセリングはツール不要（対話のみ）
    default:
      return { addTask, bulkAddMemos, addCalendarEvent, addMindmapGroup, addMindmapTask }
  }
}
