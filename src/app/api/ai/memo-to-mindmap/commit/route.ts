import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { MindmapDraftSchema, type MindmapDraftNode } from '@/lib/ai/memo-to-mindmap'

// POST /api/ai/memo-to-mindmap/commit — ドラフトを tasks ツリーとして保存し、メモを紐付ける
export async function POST(request: Request) {
  try {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const source: 'notes' | 'wishlist' = body?.source === 'wishlist' ? 'wishlist' : 'notes'

    const parsed = MindmapDraftSchema.safeParse(body?.draft)
    if (!parsed.success) {
      return NextResponse.json({ error: 'draft の形式が不正です' }, { status: 400 })
    }
    const draft = parsed.data
    if (draft.nodes.length === 0) {
      return NextResponse.json({ error: 'ノードがありません' }, { status: 400 })
    }

    const target = body?.target
    if (!target || (target.type !== 'new' && target.type !== 'existing')) {
      return NextResponse.json({ error: 'target が必要です' }, { status: 400 })
    }

    // --- 保存先プロジェクトを解決 ---
    let projectId: string
    let createdProject = false

    if (target.type === 'existing') {
      const { data: project } = await supabase
        .from('projects')
        .select('id')
        .eq('id', target.projectId)
        .eq('user_id', user.id)
        .single()
      if (!project) {
        return NextResponse.json({ error: 'プロジェクトが見つかりません' }, { status: 404 })
      }
      projectId = project.id
    } else {
      const spaceId: string | undefined = target.spaceId
      const projectTitle: string =
        (typeof target.projectTitle === 'string' && target.projectTitle.trim()) ||
        draft.projectTitle ||
        '新しいマインドマップ'
      if (!spaceId) {
        return NextResponse.json({ error: '新規プロジェクトには spaceId が必要です' }, { status: 400 })
      }
      const { data: space } = await supabase
        .from('spaces')
        .select('id')
        .eq('id', spaceId)
        .eq('user_id', user.id)
        .single()
      if (!space) {
        return NextResponse.json({ error: 'スペースが見つかりません' }, { status: 404 })
      }
      const { data: newProject, error: projectError } = await supabase
        .from('projects')
        .insert({ user_id: user.id, space_id: spaceId, title: projectTitle, status: 'active', priority: 3 })
        .select('id')
        .single()
      if (projectError || !newProject) {
        return NextResponse.json({ error: projectError?.message || 'プロジェクト作成に失敗しました' }, { status: 500 })
      }
      projectId = newProject.id
      createdProject = true
    }

    // --- ドラフト → tasks 行へ変換 ---
    const nodeByTempId = new Map<string, MindmapDraftNode>()
    for (const node of draft.nodes) nodeByTempId.set(node.tempId, node)

    const realIdByTempId = new Map<string, string>()
    for (const node of draft.nodes) realIdByTempId.set(node.tempId, randomUUID())

    const allDraftNoteIds = [...new Set(draft.nodes.flatMap(n => n.sourceNoteIds))]
    const sourceNoteContentById = new Map<string, { content: string; image_urls: string[] | null }>()
    if (source === 'notes' && allDraftNoteIds.length > 0) {
      const { data: sourceNotes, error: sourceNotesError } = await supabase
        .from('notes')
        .select('id, content, image_urls')
        .in('id', allDraftNoteIds)
        .eq('user_id', user.id)
        .is('deleted_at', null)

      if (sourceNotesError) {
        console.warn('[memo-to-mindmap/commit] source note fetch failed:', sourceNotesError.message)
      } else {
        for (const note of sourceNotes || []) {
          sourceNoteContentById.set(note.id, {
            content: note.content || '',
            image_urls: Array.isArray(note.image_urls) ? note.image_urls : null,
          })
        }
      }
    }

    // 親が存在しない参照はルート扱い
    const effectiveParent = (node: MindmapDraftNode): string | null =>
      node.parentTempId && nodeByTempId.has(node.parentTempId) ? node.parentTempId : null

    // 深さ計算（循環ガード付き）
    const depthCache = new Map<string, number>()
    const depthOf = (tempId: string, seen: Set<string> = new Set()): number => {
      if (depthCache.has(tempId)) return depthCache.get(tempId)!
      if (seen.has(tempId)) return 0
      seen.add(tempId)
      const node = nodeByTempId.get(tempId)!
      const parent = effectiveParent(node)
      const d = parent ? depthOf(parent, seen) + 1 : 0
      depthCache.set(tempId, d)
      return d
    }

    // is_group 判定（子を持つノード）
    const hasChildren = new Set<string>()
    for (const node of draft.nodes) {
      const parent = effectiveParent(node)
      if (parent) hasChildren.add(parent)
    }

    // 兄弟内の order_index（draft.nodes の出現順）
    const orderCounter = new Map<string, number>()
    const rows = draft.nodes.map(node => {
      const parentTempId = effectiveParent(node)
      const groupKey = parentTempId ?? '__root__'
      const orderIndex = orderCounter.get(groupKey) ?? 0
      orderCounter.set(groupKey, orderIndex + 1)
      const sourceNotes = node.sourceNoteIds
        .map(noteId => sourceNoteContentById.get(noteId))
        .filter((note): note is { content: string; image_urls: string[] | null } => !!note)
      const sourceMemo = sourceNotes
        .map(note => note.content.trim())
        .filter(Boolean)
        .join('\n\n---\n\n')
      const sourceImages = sourceNotes.flatMap(note => note.image_urls || []).filter(Boolean)
      return {
        id: realIdByTempId.get(node.tempId)!,
        user_id: user.id,
        project_id: projectId,
        parent_task_id: parentTempId ? realIdByTempId.get(parentTempId)! : null,
        title: node.title.trim() || '無題',
        status: 'todo',
        order_index: orderIndex,
        estimated_time: 0,
        actual_time_minutes: 0,
        is_group: hasChildren.has(node.tempId),
        source: source === 'notes' ? 'memo' : 'wishlist',
        memo: sourceMemo || null,
        memo_images: sourceImages.length > 0 ? sourceImages : null,
        _depth: depthOf(node.tempId),
      }
    })

    // FK 制約のため、親が先に入るよう深さ昇順で挿入
    rows.sort((a, b) => a._depth - b._depth)
    const insertRows = rows.map(row => {
      const { _depth: _omit, ...rest } = row
      void _omit
      return rest
    })

    const { error: insertError } = await supabase.from('tasks').insert(insertRows)
    if (insertError) {
      console.error('[memo-to-mindmap/commit] tasks 挿入失敗:', insertError)
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    // --- メモを紐付け（task_id / project_id / status） ---
    const taskIdByNoteId = new Map<string, string>()
    const taskTitleByNoteId = new Map<string, string>()
    const taskLinksByNoteId = new Map<string, Array<{ task_id: string; task_title: string }>>()
    for (const node of draft.nodes) {
      const realId = realIdByTempId.get(node.tempId)!
      const title = node.title.trim() || '無題'
      for (const noteId of node.sourceNoteIds) {
        if (!taskIdByNoteId.has(noteId)) taskIdByNoteId.set(noteId, realId)
        if (!taskTitleByNoteId.has(noteId)) taskTitleByNoteId.set(noteId, title)
        const links = taskLinksByNoteId.get(noteId) || []
        links.push({ task_id: realId, task_title: title })
        taskLinksByNoteId.set(noteId, links)
      }
    }
    const allNoteIds = allDraftNoteIds
    if (source === 'notes') {
      await Promise.all(
        allNoteIds.map(noteId =>
          supabase
            .from('notes')
            .update({
              task_id: taskIdByNoteId.get(noteId) ?? null,
              project_id: projectId,
              status: 'processed',
            })
            .eq('id', noteId)
          .eq('user_id', user.id),
        ),
      )
    } else if (allNoteIds.length > 0) {
      const linkedAt = new Date().toISOString()
      const { data: memos, error: memoFetchError } = await supabase
        .from('ideal_goals')
        .select('id, ai_source_payload')
        .in('id', allNoteIds)
        .eq('user_id', user.id)

      if (memoFetchError) {
        console.error('[memo-to-mindmap/commit] メモリンク取得失敗:', memoFetchError)
      } else {
        await Promise.all(
          (memos || []).map(memo => {
            const payload = normalizePayload(memo.ai_source_payload)
            const existingLinks = Array.isArray(payload.mindmap_links) ? payload.mindmap_links : []
            const newLinks = (taskLinksByNoteId.get(memo.id) || []).map(link => ({
              ...link,
              project_id: projectId,
              linked_at: linkedAt,
              source: 'memo_to_mindmap',
            }))
            const newTaskIds = new Set(newLinks.map(link => link.task_id))
            const nextLinks = [
              ...existingLinks.filter(link => !isTaskLinkInSet(link, newTaskIds)),
              ...newLinks,
            ]
            return supabase
              .from('ideal_goals')
              .update({
                ai_source_payload: {
                  ...payload,
                  mindmap_links: nextLinks,
                },
                updated_at: linkedAt,
              })
              .eq('id', memo.id)
              .eq('user_id', user.id)
          }),
        )
      }
    }

    const rootTaskIds = draft.nodes
      .filter(n => effectiveParent(n) === null)
      .map(n => realIdByTempId.get(n.tempId)!)

    return NextResponse.json({
      projectId,
      createdProject,
      rootTaskIds,
      taskIds: insertRows.map(row => row.id),
      taskCount: insertRows.length,
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[memo-to-mindmap/commit] error:', msg, error)
    return NextResponse.json({ error: 'マインドマップの保存に失敗しました' }, { status: 500 })
  }
}

function normalizePayload(payload: unknown): Record<string, unknown> {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return { ...(payload as Record<string, unknown>) }
  }
  if (payload == null) return {}
  return { previous_payload: payload }
}

function isTaskLinkInSet(link: unknown, taskIds: Set<string>): boolean {
  return !!link &&
    typeof link === 'object' &&
    typeof (link as { task_id?: unknown }).task_id === 'string' &&
    taskIds.has((link as { task_id: string }).task_id)
}
