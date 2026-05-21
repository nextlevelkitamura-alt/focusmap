import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'
import { generateObject } from 'ai'
import { z } from 'zod'
import { getModelForMemoMindmap } from '@/lib/ai/providers'
import { logAiUsage } from '@/lib/ai/usage'

// POST /api/projects/[id]/context-chat
// ユーザーの発言を現在の説明文に統合し、更新後の projects.description を返す。
const DescriptionSchema = z.object({
  description: z.string().describe('統合後のプロジェクト説明の全文'),
})

const SYSTEM_PROMPT = `あなたはプロジェクトの説明文を整理する編集者です。
現在の説明文とユーザーの新しい発言を受け取り、両者を統合した「更新後の説明文の全文」を返します。

ルール:
- ユーザーの発言の内容を説明文に取り込む。重複は除き、矛盾する情報は新しい発言を優先する。
- 「何のプロジェクトか・目的・対象・現状」が分かる自由文1つにまとめる。小見出しで細分化しない。
- 簡潔に。600字程度を目安の上限とし、超えそうなら要約して収める。
- description には説明文の全文だけを入れる（差分や前置きは不要）。`

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const message: unknown = body?.message
    if (typeof message !== 'string' || message.trim().length === 0) {
      return NextResponse.json({ error: 'message が必要です' }, { status: 400 })
    }

    const { data: project } = await supabase
      .from('projects')
      .select('id, title, description')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()
    if (!project) {
      return NextResponse.json({ error: 'プロジェクトが見つかりません' }, { status: 404 })
    }

    const { model, modelName } = getModelForMemoMindmap('quick')
    const result = await generateObject({
      model,
      schema: DescriptionSchema,
      system: SYSTEM_PROMPT,
      prompt:
        `プロジェクト名: ${project.title}\n\n` +
        `現在の説明文:\n${project.description?.trim() || '(まだ説明がありません)'}\n\n` +
        `ユーザーの新しい発言:\n${message.trim()}\n\n` +
        `両者を統合した説明文の全文を出力してください。`,
    })

    const description = result.object.description.trim()

    const { error: upErr } = await supabase
      .from('projects')
      .update({ description })
      .eq('id', id)
      .eq('user_id', user.id)
    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 500 })
    }

    await logAiUsage(supabase, {
      userId: user.id,
      feature: 'project_context_chat',
      modelName,
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
      metadata: { projectId: id },
    })

    return NextResponse.json({ description })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[project context-chat] error:', msg)
    if (msg.includes('429') || msg.includes('RATE_LIMIT') || msg.includes('quota')) {
      return NextResponse.json({ error: 'リクエスト上限に達しました。しばらくお待ちください' }, { status: 429 })
    }
    return NextResponse.json({ error: '説明の更新に失敗しました' }, { status: 500 })
  }
}
