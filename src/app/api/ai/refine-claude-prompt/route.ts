import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { chatCompletion } from "@/lib/ai-client"

// GLM/Kimi にメモを Claude Code への明確な作業依頼に書き直してもらう
const SYSTEM_PROMPT = `あなたはユーザーの雑なメモを、Claude Code（コーディング AI エージェント）への明確な作業依頼に書き直すアシスタントです。

## 入力
- メモのタイトル
- メモの詳細（任意）
- 対象リポジトリの絶対パス

## 出力
作業依頼文だけを返してください。説明・前置き・自分の感想は不要。日本語で書くこと。

## 書き換え方針
1. **何をすべきか具体的に書く** — 「整理して」だけでなく「ファイルAのB項目を〇〇形式に書き直す」など
2. **期待する成果物を明示する** — 「コミットして」「Markdown で出力」「PR作成」など
3. **必要な背景情報を補う** — メモから読み取れる目的・前提を1-2文で説明
4. **メモに無い要件は勝手に追加しない** — 想像で要件を膨らませない
5. **作業の境界を明確に** — 「これは不要」「ここまでで止める」を必要なら書く
6. **箇条書きを活用** — 複数手順がある場合は番号付き or 箇条書きで

## リサーチが必要なとき
メモが抽象的すぎて Claude Code が何をしていいか分からないと感じたら、あなたが知っている一般的なベストプラクティスや関連知識を1-2行だけ補足してください。ただし**推測で具体的なファイル名や数値を作らない**こと。

## 文字数の目安
- 短すぎず長すぎず、200〜600 字程度
- メモが既に具体的なら、無理に膨らませず簡潔に整える`

interface RefineRequest {
  title?: string
  description?: string
  repo_path?: string
  /** モデルID。既存メモ整理と同じ glm-5.1 / kimi-k2.6 等。省略時はai-client側のデフォルト */
  model?: string
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = (await req.json()) as RefineRequest
  const title = (body.title ?? "").trim()
  const description = (body.description ?? "").trim()
  const repoPath = (body.repo_path ?? "").trim()
  const model = (body.model ?? "glm-5.1").trim()

  if (!title && !description) {
    return NextResponse.json({ error: "title or description required" }, { status: 400 })
  }

  // GLM/Kimi への入力を整形（OpenCode Goプラン経由）
  const userMessage = [
    repoPath ? `対象リポジトリ: ${repoPath}` : null,
    title ? `メモタイトル: ${title}` : null,
    description ? `メモ詳細:\n${description}` : null,
  ].filter(Boolean).join("\n\n")

  try {
    const refined = await chatCompletion(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      { temperature: 0.3, max_tokens: 1000, model },
    )
    const cleaned = refined.trim()
    return NextResponse.json({
      refined_prompt: cleaned,
      original_chars: (title + description).length,
      refined_chars: cleaned.length,
      model_used: model,
    })
  } catch (e) {
    console.error("[refine-claude-prompt]", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "AI モデルの呼び出しに失敗しました" },
      { status: 500 },
    )
  }
}
