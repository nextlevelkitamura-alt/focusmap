/**
 * マインドマップ構造をAIプロンプト用のツリーテキストに変換する
 * 画像や長文メモは含めず、既存ノードの判断に必要な短いプレビューだけを含める
 */

import type { SupabaseClient } from '@supabase/supabase-js'

const NODE_MEMO_PREVIEW_CHARS = 30
const PROJECT_CONTEXT_PREVIEW_CHARS = 220

interface MindmapNode {
  id: string
  title: string
  is_group: boolean
  parent_task_id: string | null
  status: string
  order_index: number
  memo: string | null
}

interface ProjectSummary {
  id: string
  title: string
  description: string | null
  purpose: string | null
}

interface ProjectContextSummary {
  heading: string
  details: string
  progress: string
  progress_status: string
}

function compactText(value: string | null | undefined, maxChars: number): string {
  const text = (value ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return ''
  return text.length > maxChars ? `${text.slice(0, maxChars)}...` : text
}

/**
 * 指定プロジェクトのマインドマップ構造をツリー形式テキストで返す
 */
export async function loadMindmapStructure(
  supabase: SupabaseClient,
  userId: string,
  projectId: string,
): Promise<{ treeText: string; nodeCount: number }> {
  const { data: tasks } = await supabase
    .from('tasks')
    .select('id, title, is_group, parent_task_id, status, order_index, memo')
    .eq('user_id', userId)
    .eq('project_id', projectId)
    .is('deleted_at', null)
    .order('order_index', { ascending: true })

  if (!tasks || tasks.length === 0) {
    return { treeText: '(ノードなし)', nodeCount: 0 }
  }

  const nodes: MindmapNode[] = tasks

  // グループ（ルートノード）を取得
  const groups = nodes
    .filter(n => n.is_group && !n.parent_task_id)
    .sort((a, b) => a.order_index - b.order_index)

  // 親ノードIDでインデックス
  const childrenMap = new Map<string, MindmapNode[]>()
  for (const node of nodes) {
    if (node.parent_task_id) {
      const children = childrenMap.get(node.parent_task_id) || []
      children.push(node)
      childrenMap.set(node.parent_task_id, children)
    }
  }

  const lines: string[] = []

  function renderNode(node: MindmapNode, prefix: string, isLast: boolean) {
    const connector = isLast ? '└─ ' : '├─ '
    const doneMarker = node.status === 'done' ? ' ✅' : ''
    const typeTag = node.is_group ? `group:${node.id}` : `task:${node.id}`
    const memoPreview = compactText(node.memo, NODE_MEMO_PREVIEW_CHARS)
    const memoTag = memoPreview ? ` / memo: ${memoPreview}` : ''
    lines.push(`${prefix}${connector}${node.title}${doneMarker} [${typeTag}]${memoTag}`)

    const children = (childrenMap.get(node.id) || [])
      .sort((a, b) => a.order_index - b.order_index)
    const childPrefix = prefix + (isLast ? '   ' : '│  ')
    children.forEach((child, i) => {
      renderNode(child, childPrefix, i === children.length - 1)
    })
  }

  groups.forEach((group, i) => {
    renderNode(group, '', i === groups.length - 1)
  })

  // ルートタスク（グループに属さないタスク）
  const orphanTasks = nodes.filter(n => !n.is_group && !n.parent_task_id)
  if (orphanTasks.length > 0) {
    orphanTasks.forEach((task, i) => {
      renderNode(task, '', i === orphanTasks.length - 1)
    })
  }

  return {
    treeText: lines.join('\n'),
    nodeCount: nodes.length,
  }
}

/**
 * メモ→マインドマップ生成に使う追記先プロジェクト文脈。
 * プロジェクト概要、保存済みproject_contexts、既存ノードの見出しとメモ冒頭をまとめる。
 */
export async function loadMindmapGenerationContext(
  supabase: SupabaseClient,
  userId: string,
  projectId: string,
): Promise<{ contextText: string; nodeCount: number }> {
  const [{ data: project }, { data: projectContexts }, mindmap] = await Promise.all([
    supabase
      .from('projects')
      .select('id, title, description, purpose')
      .eq('id', projectId)
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('project_contexts')
      .select('heading, details, progress, progress_status')
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(3),
    loadMindmapStructure(supabase, userId, projectId),
  ])

  const projectSummary = project as ProjectSummary | null
  const contextRows = (projectContexts ?? []) as ProjectContextSummary[]
  const sections: string[] = []

  if (projectSummary) {
    const projectLines = [
      `title: ${projectSummary.title}`,
      projectSummary.purpose ? `purpose: ${compactText(projectSummary.purpose, PROJECT_CONTEXT_PREVIEW_CHARS)}` : '',
      projectSummary.description ? `description: ${compactText(projectSummary.description, PROJECT_CONTEXT_PREVIEW_CHARS)}` : '',
    ].filter(Boolean)
    sections.push(`# プロジェクト概要\n${projectLines.join('\n')}`)
  }

  if (contextRows.length > 0) {
    sections.push(`# プロジェクト文脈\n${contextRows.map((row, index) => {
      const details = compactText(row.details, PROJECT_CONTEXT_PREVIEW_CHARS)
      const progress = compactText(row.progress, PROJECT_CONTEXT_PREVIEW_CHARS)
      return [
        `${index + 1}. ${row.heading || '文脈'} (${row.progress_status})`,
        details ? `details: ${details}` : '',
        progress ? `progress: ${progress}` : '',
      ].filter(Boolean).join('\n')
    }).join('\n\n')}`)
  }

  sections.push(`# 既存マインドマップ\n${mindmap.nodeCount > 0 ? mindmap.treeText : '(ノードなし)'}`)

  return {
    contextText: sections.join('\n\n'),
    nodeCount: mindmap.nodeCount,
  }
}

/**
 * プロジェクト名付きのマインドマップコンテキストテキストを生成
 */
export async function buildMindmapContextForPrompt(
  supabase: SupabaseClient,
  userId: string,
  projectId: string,
  projectTitle: string,
): Promise<string> {
  const { treeText, nodeCount } = await loadMindmapStructure(supabase, userId, projectId)

  if (nodeCount === 0) {
    return `\n## マインドマップ構造（${projectTitle}）\n(まだノードがありません)`
  }

  return `\n## マインドマップ構造（${projectTitle}）\n${treeText}`
}
