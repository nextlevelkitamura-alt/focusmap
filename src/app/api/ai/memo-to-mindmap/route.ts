import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'
import { generateMindmapDraft } from '@/lib/ai/memo-to-mindmap'
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
    const mode: MemoMindmapMode = body?.mode === 'deep' ? 'deep' : 'quick'
    const targetProjectId: string | undefined = body?.targetProjectId || undefined

    if (!Array.isArray(noteIds) || noteIds.length === 0) {
      return NextResponse.json({ error: 'noteIds が必要です' }, { status: 400 })
    }
    if (noteIds.length > 50) {
      return NextResponse.json({ error: 'メモは一度に50件までです' }, { status: 400 })
    }

    // 対象メモを取得（本人のメモのみ・削除済みは除外）
    const { data: notes, error: notesError } = await supabase
      .from('notes')
      .select('id, content')
      .in('id', noteIds as string[])
      .eq('user_id', user.id)
      .is('deleted_at', null)

    if (notesError) {
      return NextResponse.json({ error: notesError.message }, { status: 500 })
    }
    const validNotes = (notes || []).filter(n => n.content && n.content.trim().length > 0)
    if (validNotes.length === 0) {
      return NextResponse.json({ error: '有効なメモがありません' }, { status: 400 })
    }

    // 既存マップへの追記時は、既存ツリーをコンテキストとして渡す
    let existingTree: string | undefined
    if (targetProjectId) {
      const { treeText, nodeCount } = await loadMindmapStructure(supabase, user.id, targetProjectId)
      if (nodeCount > 0) existingTree = treeText
    }

    const { draft, modelName, inputTokens, outputTokens } = await generateMindmapDraft({
      notes: validNotes.map(n => ({ id: n.id, content: n.content })),
      mode,
      existingTree,
    })

    const { costUsd } = await logAiUsage(supabase, {
      userId: user.id,
      feature: 'memo_to_mindmap',
      modelName,
      inputTokens,
      outputTokens,
      metadata: { noteCount: validNotes.length, mode, targetProjectId: targetProjectId ?? null },
    })

    return NextResponse.json({
      draft,
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
