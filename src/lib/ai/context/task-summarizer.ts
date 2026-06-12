/**
 * タスクデータ構造化要約エンジン
 * プロジェクトのタスクデータをSQLクエリ + TypeScript集計で要約し、
 * AIプロンプトに注入可能なテキストに変換する
 */

import { SupabaseClient } from '@supabase/supabase-js'

interface TaskRow {
  id: string
  title: string
  status: string
  stage: string
  priority: number | null
  is_group: boolean
  parent_task_id: string | null
  estimated_time: number
  actual_time_minutes: number
  scheduled_at: string | null
}

interface ProjectChatMapBriefTaskRow {
  id: string
  title: string
  is_group: boolean
  parent_task_id: string | null
}

interface NoteHeadingRow {
  id: string
  title: string | null
  status?: string | null
  memo_status?: string | null
  is_completed?: boolean | null
  item_kind?: string | null
  updated_at?: string | null
}

interface GroupStat {
  name: string
  total: number
  done: number
  inProgress: number
  completionRate: number
}

const PROJECT_CHAT_MAP_NODE_LIMIT = 240
const PROJECT_CHAT_NOTE_LIMIT = 100
const PROJECT_CHAT_HEADING_LIMIT = 12

function formatApproxCount(count: number, truncated: boolean): string {
  return truncated ? `${count}件以上` : `${count}件`
}

function compactHeading(title: string | null | undefined): string {
  const normalized = (title ?? '').replace(/\s+/g, ' ').trim()
  if (!normalized) return '無題'
  return normalized.length > 80 ? `${normalized.slice(0, 80)}...` : normalized
}

function formatHeadingLines(headings: string[], hiddenCount: number): string[] {
  if (headings.length === 0) return ['- なし']
  const lines = headings.map(heading => `- ${heading}`)
  if (hiddenCount > 0) lines.push(`- ほか${hiddenCount}件`)
  return lines
}

function isActiveNote(row: NoteHeadingRow): boolean {
  if (row.is_completed) return false
  const status = row.status ?? ''
  const memoStatus = row.memo_status ?? ''
  return !['done', 'dismissed', 'archived'].includes(status) &&
    !['done', 'dismissed', 'archived'].includes(memoStatus)
}

/**
 * 単一プロジェクトのタスクデータを要約テキストに変換
 */
export async function summarizeProjectTasks(
  supabase: SupabaseClient,
  userId: string,
  projectId: string,
): Promise<string> {
  // プロジェクト名を取得
  const { data: project } = await supabase
    .from('projects')
    .select('title')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!project) return ''

  // 全タスクを取得
  const { data: tasks } = await supabase
    .from('tasks')
    .select('id, title, status, stage, priority, is_group, parent_task_id, estimated_time, actual_time_minutes, scheduled_at')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('order_index', { ascending: true })

  if (!tasks || tasks.length === 0) {
    return `## プロジェクトタスク分析: ${project.title}\nタスクはまだありません。`
  }

  const allTasks = tasks as TaskRow[]
  const groups = allTasks.filter(t => t.is_group)
  const leafTasks = allTasks.filter(t => !t.is_group)

  // 全体統計
  const total = leafTasks.length
  const done = leafTasks.filter(t => t.status === 'done').length
  const inProgress = leafTasks.filter(t => t.status === 'in_progress').length
  const todo = leafTasks.filter(t => t.status === 'todo').length
  const completionRate = total > 0 ? Math.round((done / total) * 100) : 0

  // グループ別統計
  const groupStats: GroupStat[] = groups.map(g => {
    const children = leafTasks.filter(t => t.parent_task_id === g.id)
    const gTotal = children.length
    const gDone = children.filter(t => t.status === 'done').length
    const gInProgress = children.filter(t => t.status === 'in_progress').length
    return {
      name: g.title,
      total: gTotal,
      done: gDone,
      inProgress: gInProgress,
      completionRate: gTotal > 0 ? Math.round((gDone / gTotal) * 100) : 0,
    }
  }).filter(g => g.total > 0)

  // 高優先度未完了タスク（priority 3 = 高）
  const highPriorityPending = leafTasks
    .filter(t => t.priority === 3 && t.status !== 'done')
    .slice(0, 5)
    .map(t => t.title)

  // 期限超過タスク
  const now = new Date()
  const overdueTasks = leafTasks
    .filter(t => t.scheduled_at && new Date(t.scheduled_at) < now && t.status !== 'done')
    .slice(0, 5)
    .map(t => {
      const date = new Date(t.scheduled_at!)
      return `${t.title} (予定: ${date.getMonth() + 1}/${date.getDate()})`
    })

  // 見積vs実績
  const totalEstimated = leafTasks.reduce((sum, t) => sum + (t.estimated_time || 0), 0)
  const totalActual = leafTasks.reduce((sum, t) => sum + (t.actual_time_minutes || 0), 0)

  // テキスト構築
  const parts: string[] = [
    `## プロジェクトタスク分析: ${project.title}`,
    `全体: ${total}タスク (完了${done} / 進行中${inProgress} / 未着手${todo})`,
    `完了率: ${completionRate}%`,
  ]

  if (groupStats.length > 0) {
    parts.push('\nグループ別:')
    for (const g of groupStats.slice(0, 8)) {
      parts.push(`- ${g.name}: ${g.done}/${g.total} (${g.completionRate}%)`)
    }
  }

  const alerts: string[] = []
  if (highPriorityPending.length > 0) {
    alerts.push(`高優先度未完了: ${highPriorityPending.join(', ')}`)
  }
  if (overdueTasks.length > 0) {
    alerts.push(`期限超過: ${overdueTasks.join(', ')}`)
  }
  if (alerts.length > 0) {
    parts.push('\n要注意:')
    for (const a of alerts) {
      parts.push(`- ${a}`)
    }
  }

  if (totalEstimated > 0 || totalActual > 0) {
    parts.push(`\n見積vs実績: 見積${totalEstimated}分 / 実績${totalActual}分`)
  }

  return parts.join('\n')
}

/**
 * プロジェクトチャット初期文脈用の軽量ブリーフ。
 * ノード本文やメモ本文は含めず、件数と見出しだけを渡す。
 */
export async function summarizeProjectChatMapBrief(
  supabase: SupabaseClient,
  userId: string,
  projectId: string,
): Promise<string> {
  const { data: project } = await supabase
    .from('projects')
    .select('title')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!project) return ''

  const [{ data: taskRows }, { data: wishlistRows }, { data: memoRows }] = await Promise.all([
    supabase
      .from('tasks')
      .select('id, title, is_group, parent_task_id')
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .is('deleted_at', null)
      .order('order_index', { ascending: true })
      .limit(PROJECT_CHAT_MAP_NODE_LIMIT),
    supabase
      .from('ideal_goals')
      .select('id, title, status, memo_status, is_completed, updated_at')
      .eq('user_id', userId)
      .eq('project_id', projectId)
      .in('status', ['wishlist', 'memo'])
      .order('updated_at', { ascending: false })
      .limit(PROJECT_CHAT_NOTE_LIMIT),
    supabase
      .from('memo_items')
      .select('id, title, status, item_kind, updated_at')
      .eq('user_id', userId)
      .eq('project_id', projectId)
      .order('updated_at', { ascending: false })
      .limit(PROJECT_CHAT_NOTE_LIMIT),
  ])

  const tasks = (taskRows || []) as ProjectChatMapBriefTaskRow[]
  const groups = tasks.filter(task => task.is_group)
  const leafTasks = tasks.filter(task => !task.is_group)
  const childrenByParent = new Map<string, number>()
  for (const task of tasks) {
    if (!task.parent_task_id) continue
    childrenByParent.set(task.parent_task_id, (childrenByParent.get(task.parent_task_id) ?? 0) + 1)
  }

  const topLevelNodes = tasks.filter(task => !task.parent_task_id)
  const mapHeadingSource = (groups.length > 0 ? groups : topLevelNodes.length > 0 ? topLevelNodes : tasks)
  const mapHeadings = mapHeadingSource
    .slice(0, PROJECT_CHAT_HEADING_LIMIT)
    .map(task => {
      const childCount = childrenByParent.get(task.id) ?? 0
      return childCount > 0 ? `${compactHeading(task.title)} (${childCount}件)` : compactHeading(task.title)
    })

  const wishlistNotes = ((wishlistRows || []) as NoteHeadingRow[]).filter(isActiveNote)
  const memoNotes = ((memoRows || []) as NoteHeadingRow[]).filter(isActiveNote)
  const noteHeadings = [...wishlistNotes, ...memoNotes]
    .sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')))
    .slice(0, PROJECT_CHAT_HEADING_LIMIT)
    .map(note => compactHeading(note.title))

  const taskRowsTruncated = tasks.length >= PROJECT_CHAT_MAP_NODE_LIMIT
  const wishlistRowsTruncated = (wishlistRows || []).length >= PROJECT_CHAT_NOTE_LIMIT
  const memoRowsTruncated = (memoRows || []).length >= PROJECT_CHAT_NOTE_LIMIT
  const hiddenMapHeadingCount = Math.max(mapHeadingSource.length - mapHeadings.length, 0)
  const hiddenNoteHeadingCount = Math.max(wishlistNotes.length + memoNotes.length - noteHeadings.length, 0)

  return [
    `## マインドマップ/ノート概要: ${project.title}`,
    `マインドマップ: ${formatApproxCount(tasks.length, taskRowsTruncated)}（見出し${groups.length}件 / タスク${leafTasks.length}件）`,
    '主な見出し:',
    ...formatHeadingLines(mapHeadings, hiddenMapHeadingCount),
    '',
    `ノート/メモ: ${formatApproxCount(wishlistNotes.length + memoNotes.length, wishlistRowsTruncated || memoRowsTruncated)}（メモ${wishlistNotes.length}件 / 構造化メモ${memoNotes.length}件）`,
    '主なノート見出し:',
    ...formatHeadingLines(noteHeadings, hiddenNoteHeadingCount),
    '',
    '初期文脈は件数と見出しだけです。本文、ノード詳細、メモ詳細、親子関係の深掘りは必要になった時だけ getMindmapOverview / getMindmapNodeDetail / listNotesForOrganization / getNoteOrganizationDetail で確認してください。',
  ].join('\n')
}

/**
 * 全プロジェクトの概要を要約テキストに変換
 */
export async function summarizeAllProjects(
  supabase: SupabaseClient,
  userId: string,
): Promise<string> {
  const { data: projects } = await supabase
    .from('projects')
    .select('id, title, status')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(10)

  if (!projects || projects.length === 0) {
    return '## プロジェクト全体の状況\nアクティブなプロジェクトはありません。'
  }

  // 全タスクを一括取得
  const projectIds = projects.map(p => p.id)
  const { data: allTasks } = await supabase
    .from('tasks')
    .select('id, title, status, priority, is_group, project_id, scheduled_at')
    .eq('user_id', userId)
    .in('project_id', projectIds)
    .is('deleted_at', null)

  const tasks = (allTasks || []) as Array<{
    id: string; title: string; status: string; priority: number | null;
    is_group: boolean; project_id: string; scheduled_at: string | null
  }>
  const now = new Date()

  const lines: string[] = [`## プロジェクト全体の状況`, `${projects.length}プロジェクト稼働中\n`]

  for (const p of projects) {
    const pTasks = tasks.filter(t => t.project_id === p.id && !t.is_group)
    const total = pTasks.length
    const done = pTasks.filter(t => t.status === 'done').length
    const rate = total > 0 ? Math.round((done / total) * 100) : 0
    const highPri = pTasks.filter(t => t.priority === 3 && t.status !== 'done').length
    const overdue = pTasks.filter(t => t.scheduled_at && new Date(t.scheduled_at) < now && t.status !== 'done').length

    let detail = `${done}/${total}タスク完了 (${rate}%)`
    const flags: string[] = []
    if (highPri > 0) flags.push(`高優先度${highPri}件`)
    if (overdue > 0) flags.push(`期限超過${overdue}件`)
    if (flags.length > 0) detail += ` - ${flags.join(', ')}`

    lines.push(`- ${p.title}: ${detail}`)
  }

  return lines.join('\n')
}
