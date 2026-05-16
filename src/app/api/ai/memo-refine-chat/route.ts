import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { chatCompletion } from "@/lib/ai-client"

// GLM/Kimi（OpenCode Go経由）でユーザーと対話してメモを整理する
// 注意: このAPIは Claude Code を起動しない。メモ更新の素材を返すだけ。

const SYSTEM_PROMPT = `あなたはユーザーのメモを対話で整理するアシスタントです。

## 目的
ユーザーが雑に書いたメモを、本人が後から見返したとき分かる形に整理する。
このメモは「人間がやるタスク」かもしれないし「AIに依頼するタスク」かもしれない。
あなたの仕事は **メモを良くすること** であって、誰が実行するかは決めない。

## 対話ルール
- 質問は1ターンに1-2個まで
- 全体で 2-3 ターン以内に完結させる
- 質問は具体的かつ簡潔に（ユーザーが選択肢で答えられるなら選択肢を提示）
- ターンが3を超えたら必ず最終整理に進む
- 推測で勝手な要件を追加しない

## ステータス判定
毎ターンの最初に、現在のメッセージ履歴を見て判断:
- まだ質問が必要 → "type": "question"
- 整理に十分な情報がある → "type": "final"

## 出力フォーマット（必ずJSONのみ。前置きや後説明なし）

質問する時:
{
  "type": "question",
  "message": "ユーザーへの質問（丁寧、フレンドリー）",
  "options": ["選択肢A", "選択肢B", "選択肢C"]
}
※ options は答えやすい場合のみ。自由記述で十分なら省略可

最終整理する時:
{
  "type": "final",
  "title": "整理されたメモタイトル（30字以内、何をするかが一目で分かる）",
  "description": "整理されたメモ詳細（200-400字、人間が後で読んで分かる形。背景・目的・想定アクションなど）"
}`

interface ChatMessage {
  role: "user" | "assistant"
  content: string
}

interface ChatRequest {
  messages: ChatMessage[]            // フロントが保持する会話履歴
  source: {                          // 元メモのコンテキスト
    title: string
    description?: string
    repo_path?: string
  }
  model?: string
  turn?: number
}

interface QuestionResponse {
  type: "question"
  message: string
  options?: string[]
}

interface FinalResponse {
  type: "final"
  title: string
  description: string
}

type ChatResponse = QuestionResponse | FinalResponse

function safeParseJson(raw: string): ChatResponse | null {
  // ```json フェンスを剥がす
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  const cleaned = (fenced?.[1] ?? raw).trim()
  // 最初の { から始まる balanced JSON を探す
  const start = cleaned.indexOf("{")
  if (start < 0) return null
  let depth = 0
  let inStr = false
  let escaped = false
  for (let i = start; i < cleaned.length; i++) {
    const c = cleaned[i]
    if (inStr) {
      if (escaped) escaped = false
      else if (c === "\\") escaped = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === "{") depth++
    else if (c === "}") {
      depth--
      if (depth === 0) {
        const json = cleaned.slice(start, i + 1)
        try {
          return JSON.parse(json) as ChatResponse
        } catch {
          return null
        }
      }
    }
  }
  return null
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = (await req.json()) as ChatRequest
  const messages = Array.isArray(body.messages) ? body.messages : []
  const source = body.source ?? { title: "" }
  const model = body.model ?? "glm-5.1"
  const turn = body.turn ?? messages.filter(m => m.role === "user").length

  if (!source.title?.trim() && !source.description?.trim()) {
    return NextResponse.json({ error: "source.title or source.description required" }, { status: 400 })
  }

  // 元メモを最初のコンテキストとしてシステムプロンプトに含める
  const contextBlock = [
    `## 元メモ`,
    source.title ? `タイトル: ${source.title}` : null,
    source.description ? `詳細:\n${source.description}` : null,
    source.repo_path ? `関連リポ: ${source.repo_path}` : null,
    `## 現在ターン: ${turn} / 3`,
    turn >= 3 ? `※ 3ターンに達したので必ず "type": "final" を返してください` : null,
  ].filter(Boolean).join("\n")

  const fullMessages = [
    { role: "system" as const, content: `${SYSTEM_PROMPT}\n\n${contextBlock}` },
    ...messages.map(m => ({ role: m.role, content: m.content })),
  ]

  try {
    const raw = await chatCompletion(fullMessages, {
      temperature: 0.4,
      max_tokens: 1200,
      model,
    })
    const parsed = safeParseJson(raw)
    if (!parsed) {
      // JSON が取れなかった場合のフォールバック: そのまま質問として返す
      return NextResponse.json({
        type: "question",
        message: raw.trim().slice(0, 500),
      } satisfies QuestionResponse)
    }
    return NextResponse.json(parsed)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "AI モデルの呼び出しに失敗しました" },
      { status: 500 },
    )
  }
}
