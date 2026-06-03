import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

type RouteContext = {
  params: Promise<{ id: string }>
}

type TaskCandidate = {
  id: string
  title: string
  memo: string | null
  parent_task_id: string | null
  is_group: boolean
  stage: string
}

function normalize(value: string | null | undefined) {
  return (value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function terms(value: string) {
  const normalized = normalize(value)
  const set = new Set<string>()
  for (const token of normalized.split(' ').filter(Boolean)) {
    if (token.length >= 2) set.add(token)
    const compact = token.replace(/\s+/g, '')
    for (let size = 2; size <= 3; size += 1) {
      for (let index = 0; index <= compact.length - size; index += 1) {
        set.add(compact.slice(index, index + size))
      }
    }
  }
  return set
}

function scoreText(itemText: string, task: TaskCandidate) {
  const itemTerms = terms(itemText)
  const taskTerms = terms(`${task.title} ${task.memo ?? ''}`)
  if (itemTerms.size === 0 || taskTerms.size === 0) return 0

  let overlap = 0
  for (const term of itemTerms) {
    if (taskTerms.has(term)) overlap += term.length >= 3 ? 2 : 1
  }

  const exactTitleBoost = normalize(itemText).includes(normalize(task.title)) || normalize(task.title).includes(normalize(itemText))
    ? 8
    : 0
  const groupBoost = task.is_group ? 2 : 0
  return overlap + exactTitleBoost + groupBoost
}

function buildPath(task: TaskCandidate, taskMap: Map<string, TaskCandidate>) {
  const path = [task.title]
  let current = task
  const visited = new Set<string>()
  while (current.parent_task_id && !visited.has(current.parent_task_id)) {
    visited.add(current.parent_task_id)
    const parent = taskMap.get(current.parent_task_id)
    if (!parent) break
    path.unshift(parent.title)
    current = parent
  }
  return path.join(' / ')
}

export async function GET(request: NextRequest, context: RouteContext) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await context.params
  const requestedProjectId = request.nextUrl.searchParams.get('project_id')?.trim() || null

  const { data: item, error: itemError } = await supabase
    .from('memo_items')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (itemError || !item) return NextResponse.json({ error: '構造化項目が見つかりません' }, { status: 404 })
  const projectId = requestedProjectId || item.project_id
  if (!projectId) return NextResponse.json({ candidates: [], recommended: { mode: 'root', task_id: null } })

  if (requestedProjectId && requestedProjectId !== item.project_id) {
    const { data: project } = await supabase
      .from('projects')
      .select('id')
      .eq('id', requestedProjectId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!project) return NextResponse.json({ error: 'プロジェクトが見つかりません' }, { status: 404 })
  }

  const { data: tasks, error: tasksError } = await supabase
    .from('tasks')
    .select('id, title, memo, parent_task_id, is_group, stage')
    .eq('user_id', user.id)
    .eq('project_id', projectId)
    .is('deleted_at', null)
    .neq('stage', 'archived')
    .limit(250)

  if (tasksError) return NextResponse.json({ error: tasksError.message }, { status: 500 })

  const taskCandidates = (tasks ?? []) as TaskCandidate[]
  const taskMap = new Map(taskCandidates.map(task => [task.id, task]))
  const itemText = `${item.title} ${item.body ?? ''}`

  const candidates = taskCandidates
    .map(task => {
      const score = scoreText(itemText, task)
      return {
        task_id: task.id,
        parent_task_id: task.parent_task_id,
        title: task.title,
        path: buildPath(task, taskMap),
        is_group: task.is_group,
        score,
        mode_hint: score >= 10 ? 'link_existing' : 'create_child',
        reason: score >= 10
          ? '内容が近いため、既存ノードへの紐付け候補'
          : task.is_group
            ? '関連グループ配下への追加候補'
            : '関連ノードの子として追加候補',
      }
    })
    .filter(candidate => candidate.score >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)

  const best = candidates[0]
  const recommended = best
    ? { mode: best.score >= 10 ? 'link_existing' : 'create_child', task_id: best.task_id }
    : { mode: 'root', task_id: null }

  return NextResponse.json({ candidates, recommended })
}
