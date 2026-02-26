/**
 * マインドマップ構造をAIプロンプト用のツリーテキストに変換する
 * 画像やメモの詳細は含めない（コスト最適化）
 */

import type { SupabaseClient } from '@supabase/supabase-js'

interface MindmapNode {
  id: string
  title: string
  is_group: boolean
  parent_task_id: string | null
  status: string
  order_index: number
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
    .select('id, title, is_group, parent_task_id, status, order_index')
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
    lines.push(`${prefix}${connector}${node.title}${doneMarker} [${typeTag}]`)

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
