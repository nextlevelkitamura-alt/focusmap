import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { chatCompletion } from '@/lib/ai-client'

const SYSTEM_PROMPT = `あなたはやりたいこと整理アシスタントです。ユーザーが話した内容を構造化してください。
JSON のみで返答してください（マークダウン・説明文は不要）。

返すJSONのスキーマ:
{
  "title": string,           // 簡潔なタイトル（最大30文字）
  "category": string,        // 学習/調査/目標/アイデア/旅行/健康/趣味/その他 のいずれか
  "description": string,     // 1〜2文の要約
  "scheduled_at": string | null,    // 日時が含まれる場合のみ ISO 8601形式。なければ null
  "duration_minutes": number | null // 所要時間（分）。明示されていなければ null
}

現在の日時: ${new Date().toISOString()}`

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as { text?: string }
  if (!body.text?.trim()) return NextResponse.json({ error: 'text は必須です' }, { status: 400 })

  try {
    const raw = await chatCompletion([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user',   content: body.text },
    ])

    const suggestion = JSON.parse(raw) as {
      title: string
      category: string
      description: string
      scheduled_at: string | null
      duration_minutes: number | null
    }

    return NextResponse.json({ suggestion })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'AI解析に失敗しました'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
