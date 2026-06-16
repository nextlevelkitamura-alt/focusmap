import { NextRequest } from 'next/server'
import { authenticateApiKey, isAuthError } from '../../_lib/auth'
import { apiSuccess, apiError, handleCors } from '../../_lib/response'
import { createServiceClient } from '@/utils/supabase/service'
import {
  fetchActiveMindmapDraft,
  fetchProjectMindmapTasks,
} from '@/lib/mindmap-draft-service'

type MindmapTask = Awaited<ReturnType<typeof fetchProjectMindmapTasks>>[number]

function buildTree(nodes: MindmapTask[]) {
  const children = new Map<string | null, MindmapTask[]>()
  for (const node of nodes) {
    const parentId = node.parent_task_id ?? null
    const list = children.get(parentId) ?? []
    list.push(node)
    children.set(parentId, list)
  }
  const lines: string[] = []
  function render(node: MindmapTask, depth: number) {
    const prefix = '  '.repeat(depth)
    const type = node.is_group ? 'group' : 'task'
    lines.push(`${prefix}- ${node.title} [${type}:${node.id}]`)
    for (const child of children.get(node.id) ?? []) render(child, depth + 1)
  }
  for (const root of children.get(null) ?? []) render(root, 0)
  return lines.join('\n')
}

export async function OPTIONS() {
  return handleCors()
}

export async function GET(request: NextRequest) {
  const auth = await authenticateApiKey(request, ['mindmap:read', 'tasks:read'])
  if (isAuthError(auth)) return auth

  const projectId = request.nextUrl.searchParams.get('project_id')
  if (!projectId) return apiError('VALIDATION_ERROR', 'project_id is required', 400)

  let serviceClient
  try {
    serviceClient = createServiceClient()
  } catch {
    return apiError('SERVER_ERROR', 'Service configuration error', 500)
  }

  const [{ data: project, error: projectError }, { data: context, error: contextError }] = await Promise.all([
    serviceClient
      .from('projects')
      .select('id, title, description, purpose, status, repo_path, created_at')
      .eq('id', projectId)
      .eq('user_id', auth.userId)
      .maybeSingle(),
    serviceClient
      .from('project_contexts')
      .select('heading, details, progress, progress_status, updated_at')
      .eq('project_id', projectId)
      .eq('user_id', auth.userId)
      .maybeSingle(),
  ])
  if (projectError) return apiError('QUERY_ERROR', projectError.message, 500)
  if (contextError) return apiError('QUERY_ERROR', contextError.message, 500)
  if (!project) return apiError('NOT_FOUND', 'Project not found', 404)

  try {
    const tasks = await fetchProjectMindmapTasks(serviceClient, auth.userId, projectId)
    const activeDraft = await fetchActiveMindmapDraft(serviceClient, auth.userId, projectId)
    return apiSuccess({
      project,
      project_context: context ?? null,
      node_count: tasks.length,
      heading_tree: tasks.length > 0 ? buildTree(tasks) : '(ノードなし)',
      nodes: tasks.map(task => ({
        id: task.id,
        title: task.title,
        memo: task.memo,
        parent_task_id: task.parent_task_id,
        project_id: task.project_id,
        is_group: task.is_group,
        status: task.status,
        stage: task.stage,
        order_index: task.order_index,
        source: task.source,
      })),
      active_draft: activeDraft ? {
        id: activeDraft.draft.id,
        status: activeDraft.draft.status,
        summary: activeDraft.summary,
        node_count: activeDraft.nodes.length,
        updated_at: activeDraft.draft.updated_at,
      } : null,
    })
  } catch (error) {
    return apiError('QUERY_ERROR', error instanceof Error ? error.message : String(error), 500)
  }
}
