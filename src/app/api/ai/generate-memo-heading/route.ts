import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { chatCompletion } from "@/lib/ai-client"
import { DEFAULT_GEMINI_MODEL } from "@/lib/ai/providers"
import {
  cleanGeneratedMemoHeading,
  MEMO_HEADING_HARD_MAX_CHARS,
  MEMO_HEADING_TARGET_MAX_CHARS,
  MEMO_HEADING_TARGET_MIN_CHARS,
} from "@/lib/memo-ai-generation"

const SYSTEM_PROMPT = `あなたはメモ詳細から短い日本語の見出しを作るアシスタントです。

出力ルール:
- 見出しだけを返す
- 説明、引用符、箇条書き、接頭辞は不要
- ${MEMO_HEADING_TARGET_MIN_CHARS}〜${MEMO_HEADING_TARGET_MAX_CHARS}文字程度
- 長くても${MEMO_HEADING_HARD_MAX_CHARS}文字以内
- 以前の30〜35文字級の見出しより6〜7割くらいの短さに圧縮する
- 具体的な作業や目的が分かる表現にする
- 本文を丸写しせず、核になる作業・目的だけを短いラベルにする
- 「メモ」「詳細」「タスク」などの管理用語だけの見出しにしない`

type GenerateMemoHeadingRequest = {
  detail?: string
  currentHeading?: string
  model?: string
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as GenerateMemoHeadingRequest
  const detail = (body.detail ?? "").trim()
  const currentHeading = (body.currentHeading ?? "").trim()
  const model = (body.model ?? DEFAULT_GEMINI_MODEL).trim()

  if (!detail) {
    return NextResponse.json({ error: "detail is required" }, { status: 400 })
  }

  const userMessage = [
    currentHeading ? `現在の見出し: ${currentHeading}` : null,
    `メモ詳細:\n${detail}`,
  ].filter(Boolean).join("\n\n")

  try {
    const generated = await chatCompletion(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      { temperature: 0.2, max_tokens: 50, model },
    )

    const heading = cleanGeneratedMemoHeading(generated)
    if (!heading) {
      return NextResponse.json({ error: "empty heading" }, { status: 502 })
    }

    return NextResponse.json({ heading, model_used: model })
  } catch (e) {
    console.error("[generate-memo-heading]", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "見出し生成に失敗しました" },
      { status: 500 },
    )
  }
}
