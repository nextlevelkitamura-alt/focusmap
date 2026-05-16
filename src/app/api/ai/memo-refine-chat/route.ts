import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { chatCompletionWithTools, type AgentMessage, type ToolDef, type ToolCall } from "@/lib/ai-client"
import type { SupabaseClient } from "@supabase/supabase-js"

// ─── 与える道具 ─────────────────────────────────────────────────────────
const TOOLS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "update_current_memo",
      description: "現在話している元のメモの内容を更新する。タイトルと詳細を新しい内容に書き換える。",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "新しいタイトル（30字以内推奨、何をするかが一目で分かる）" },
          description: { type: "string", description: "新しい詳細（200-600字、背景・目的・想定アクション）" },
        },
        required: ["title", "description"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_new_memo",
      description: "新しい独立メモを作成する。元メモを複数の論点に分割したいときや、関連する別タスクを生やしたいときに使う。",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "新しいメモのタイトル（30字以内）" },
          description: { type: "string", description: "新しいメモの詳細（200-600字）" },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "任意のタグ（例: 仕事/生活/学習/健康/人間関係/お金）",
          },
        },
        required: ["title", "description"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_my_memos",
      description: "ユーザーの他のメモを検索する。コンテキストを把握するため、または重複を避けるために使う。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "検索キーワード（タイトル・詳細に含まれる文字列で部分一致）" },
          limit: { type: "number", description: "最大件数（1〜20、デフォルト10）" },
        },
      },
    },
  },
]

// ─── システムプロンプト ─────────────────────────────────────────────────
const SYSTEM_PROMPT = `あなたはユーザーのメモを対話で整理・改善するアシスタントです。

## あなたの権限
あなたには以下のツールが与えられており、対話中に自由に使えます:
- update_current_memo: 元メモを更新
- create_new_memo: 新メモを作成（分岐用）
- list_my_memos: 他メモを検索

ユーザーが「2つに分けて」と言ったら create_new_memo を呼び出すなど、
**ユーザーの意図に応じて積極的にツールを使ってください**。
ツール呼び出しは確認なしで実行されるので、ユーザーが望むときだけ使うこと。

## 対話のスタイル
- 質問は1ターンに1-2個まで
- 全体で 2-3 ターン以内に完結を目指す
- 質問には選択肢を提示できるなら提示
- 推測で勝手な要件を追加しない
- ユーザーが「これで」「OK」「保存して」「分けて」等の確定的な指示を出したら、
  即座にツール呼び出しで実行する

## ツール使用の例
- 「これで保存して」 → update_current_memo を呼ぶ
- 「2つに分けて。1つは A、もう1つは B」 → 元を update し、create_new_memo で B を作成
- 「3つに分けて、それぞれ詳細書いて」 → update + create × 2
- 「似たメモあったっけ？」 → list_my_memos で検索してから回答

## 注意
- ツール呼び出した直後の応答では、何をしたかを1-2文で簡潔に報告すること
- 元のメモは「現在話しているメモ」として update_current_memo の対象。新規は別IDで作成される`

interface ChatRequest {
  /** OpenAI 形式の会話履歴（フロントが保持） */
  messages: AgentMessage[]
  /** 元メモのコンテキスト */
  source: {
    id: string
    title: string
    description?: string
    repo_path?: string
  }
  model?: string
}

interface ToolActionLog {
  tool: string
  args: unknown
  result: unknown
}

// ─── ツール実行 ─────────────────────────────────────────────────────────
async function executeTool(
  call: ToolCall,
  ctx: { userId: string; sourceMemoId: string; supabase: SupabaseClient },
): Promise<unknown> {
  let args: Record<string, unknown>
  try {
    args = JSON.parse(call.function.arguments || "{}")
  } catch {
    return { success: false, error: "ツール引数のJSONパースに失敗" }
  }

  switch (call.function.name) {
    case "update_current_memo": {
      const title = String(args.title ?? "").trim()
      const description = String(args.description ?? "").trim()
      if (!title) return { success: false, error: "title は必須" }

      const { error } = await ctx.supabase
        .from("ideal_goals")
        .update({ title, description })
        .eq("id", ctx.sourceMemoId)
        .eq("user_id", ctx.userId)
      if (error) return { success: false, error: error.message }
      return { success: true, memo_id: ctx.sourceMemoId, message: `元メモを更新しました: 「${title.slice(0, 30)}」` }
    }

    case "create_new_memo": {
      const title = String(args.title ?? "").trim()
      const description = String(args.description ?? "").trim()
      const tags = Array.isArray(args.tags) ? args.tags.map(String).slice(0, 6) : null
      if (!title) return { success: false, error: "title は必須" }

      const { data, error } = await ctx.supabase
        .from("ideal_goals")
        .insert({
          user_id: ctx.userId,
          title,
          description,
          tags,
          memo_status: "unsorted",
          color: "#94a3b8",
        })
        .select("id")
        .single()
      if (error) return { success: false, error: error.message }
      return { success: true, memo_id: data.id, message: `新規メモ作成: 「${title.slice(0, 30)}」` }
    }

    case "list_my_memos": {
      const query = typeof args.query === "string" ? args.query.trim() : ""
      const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 20)
      let q = ctx.supabase
        .from("ideal_goals")
        .select("id, title, description, tags, memo_status")
        .eq("user_id", ctx.userId)
        .order("created_at", { ascending: false })
        .limit(limit)
      if (query) {
        q = q.or(`title.ilike.%${query}%,description.ilike.%${query}%`)
      }
      const { data, error } = await q
      if (error) return { success: false, error: error.message }
      return { success: true, count: data?.length ?? 0, memos: data ?? [] }
    }

    default:
      return { success: false, error: `unknown tool: ${call.function.name}` }
  }
}

// ─── ルートハンドラ ─────────────────────────────────────────────────────
export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = (await req.json()) as ChatRequest
  const messages = Array.isArray(body.messages) ? body.messages : []
  const source = body.source
  const model = body.model ?? "glm-5.1"

  if (!source?.id) {
    return NextResponse.json({ error: "source.id required" }, { status: 400 })
  }

  const contextBlock = [
    `## 元メモ`,
    `ID: ${source.id}`,
    source.title ? `タイトル: ${source.title}` : null,
    source.description ? `詳細:\n${source.description}` : null,
    source.repo_path ? `関連リポ: ${source.repo_path}` : null,
  ].filter(Boolean).join("\n")

  const history: AgentMessage[] = [
    { role: "system", content: `${SYSTEM_PROMPT}\n\n${contextBlock}` },
    ...messages,
  ]

  const actions: ToolActionLog[] = []
  let finalContent: string | null = null
  let touched = false  // ツールでデータ変更があったかどうか

  // Agentic loop（最大5回）
  for (let iteration = 0; iteration < 5; iteration++) {
    let result
    try {
      result = await chatCompletionWithTools(history, TOOLS, { model, temperature: 0.4 })
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "AI モデル呼び出し失敗" },
        { status: 500 },
      )
    }

    if (result.tool_calls && result.tool_calls.length > 0) {
      // ツール呼び出し → 実行 → 結果を履歴に追加してループ
      history.push({
        role: "assistant",
        content: result.content ?? null,
        tool_calls: result.tool_calls,
      })

      for (const call of result.tool_calls) {
        const toolResult = await executeTool(call, {
          userId: user.id,
          sourceMemoId: source.id,
          supabase,
        })
        actions.push({
          tool: call.function.name,
          args: (() => { try { return JSON.parse(call.function.arguments) } catch { return call.function.arguments } })(),
          result: toolResult,
        })
        if (call.function.name === "update_current_memo" || call.function.name === "create_new_memo") {
          touched = true
        }
        history.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(toolResult),
        })
      }
      // ループ続行（次のイテレーションで GLM の応答を取りに行く）
    } else {
      // テキストだけの応答 → ここで終了
      finalContent = result.content ?? ""
      break
    }
  }

  return NextResponse.json({
    /** GLM の最終テキスト応答（ユーザーに表示） */
    response: finalContent ?? "（応答なし）",
    /** このターンで実行されたツール一覧（UI に chip 表示） */
    actions,
    /** データが変更されたか（変更されたら親が memos リフレッシュすべき） */
    touched,
    /** 履歴の続き（フロントに保持してもらう） */
    history_appended: history.slice(messages.length + 1),  // system + 既存除いた追加分
  })
}
