import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'
import {
  MAX_CONVERSATION_LOG_CHARS,
  generateMindmapDraft,
  type MindmapDraftInputKind,
} from '@/lib/ai/memo-to-mindmap'
import { loadMindmapStructure } from '@/lib/ai/context/mindmap-context'
import { logAiUsage } from '@/lib/ai/usage'
import type { MemoMindmapMode } from '@/lib/ai/providers'

// POST /api/ai/memo-to-mindmap — メモ群からマインドマップのドラフトを生成（プレビュー）
// DB の tasks には書き込まない。確定は /commit エンドポイントで行う。
export async function POST(request: Request) {
  try {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const noteIds: unknown = body?.noteIds
    const source: 'notes' | 'wishlist' = body?.source === 'wishlist' ? 'wishlist' : 'notes'
    const inputKind: MindmapDraftInputKind = body?.inputKind === 'conversation_log' ? 'conversation_log' : 'memo'
    const mode: MemoMindmapMode = inputKind === 'conversation_log' || body?.mode === 'deep' ? 'deep' : 'quick'
    const targetProjectId: string | undefined = body?.targetProjectId || undefined

    if (!Array.isArray(noteIds) || noteIds.length === 0) {
      return NextResponse.json({ error: 'noteIds が必要です' }, { status: 400 })
    }
    if (noteIds.length > 50) {
      return NextResponse.json({ error: 'メモは一度に50件までです' }, { status: 400 })
    }

    // 対象メモを取得（本人のメモのみ・削除済みは除外）
    let validNotes: { id: string; content: string }[] = []
    if (source === 'wishlist') {
      const { data: memos, error: memosError } = await supabase
        .from('ideal_goals')
        .select('id, title, description')
        .in('id', noteIds as string[])
        .eq('user_id', user.id)
        .in('status', ['wishlist', 'memo'])

      if (memosError) {
        return NextResponse.json({ error: memosError.message }, { status: 500 })
      }
      validNotes = (memos || [])
        .map(m => ({
          id: m.id,
          content: inputKind === 'conversation_log'
            ? (m.description || m.title || '')
            : [m.title, m.description].filter(Boolean).join('\n\n'),
        }))
        .filter(n => n.content.trim().length > 0)
    } else {
      const { data: notes, error: notesError } = await supabase
        .from('notes')
        .select('id, content')
        .in('id', noteIds as string[])
        .eq('user_id', user.id)
        .is('deleted_at', null)

      if (notesError) {
        return NextResponse.json({ error: notesError.message }, { status: 500 })
      }
      validNotes = (notes || []).filter(n => n.content && n.content.trim().length > 0)
    }
    if (validNotes.length === 0) {
      return NextResponse.json({ error: '有効なメモがありません' }, { status: 400 })
    }
    if (inputKind === 'conversation_log') {
      const totalChars = validNotes.reduce((sum, note) => sum + note.content.length, 0)
      if (totalChars > MAX_CONVERSATION_LOG_CHARS) {
        return NextResponse.json(
          { error: `会話ログは${MAX_CONVERSATION_LOG_CHARS}文字までです` },
          { status: 400 },
        )
      }
    }

    // 既存マップへの追記時は、既存ツリーをコンテキストとして渡す
    let existingTree: string | undefined
    let existingTasks: Array<{ id: string; title: string }> = []
    if (targetProjectId) {
      const { treeText, nodeCount } = await loadMindmapStructure(supabase, user.id, targetProjectId)
      if (nodeCount > 0) existingTree = treeText
      const { data: tasks, error: tasksError } = await supabase
        .from('tasks')
        .select('id, title')
        .eq('user_id', user.id)
        .eq('project_id', targetProjectId)
        .is('deleted_at', null)

      if (tasksError) {
        return NextResponse.json({ error: tasksError.message }, { status: 500 })
      }
      existingTasks = tasks || []
    }

    const { draft, modelName, inputTokens, outputTokens } = await generateMindmapDraft({
      notes: validNotes.map(n => ({ id: n.id, content: n.content })),
      mode,
      existingTree,
      inputKind,
    })

    const { costUsd } = await logAiUsage(supabase, {
      userId: user.id,
      feature: 'memo_to_mindmap',
      modelName,
      inputTokens,
      outputTokens,
      metadata: { noteCount: validNotes.length, mode, source, inputKind, targetProjectId: targetProjectId ?? null },
    })

    return NextResponse.json({
      draft,
      existingTasks,
      usage: { model: modelName, inputTokens, outputTokens, costUsd },
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[memo-to-mindmap] error:', msg, error)
    if (msg.includes('429') || msg.includes('RATE_LIMIT') || msg.includes('quota')) {
      return NextResponse.json(
        { error: 'リクエスト上限に達しました。しばらくお待ちください', errorCode: 'RATE_LIMIT' },
        { status: 429 },
      )
    }
    return NextResponse.json({ error: 'マインドマップ生成に失敗しました' }, { status: 500 })
  }
}
