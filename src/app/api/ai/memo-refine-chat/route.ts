import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { chatCompletionWithTools, type AgentMessage, type ToolDef, type ToolCall } from "@/lib/ai-client"
import type { SupabaseClient } from "@supabase/supabase-js"
import { getCalendarClient } from "@/lib/google-calendar"

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
  {
    type: "function",
    function: {
      name: "schedule_memo",
      description: "メモに実施予定時刻と所要時間を設定する。まだカレンダーには登録しない（add_to_calendar が別途必要）。「明日8時から30分でやる」のような指示で使う。",
      parameters: {
        type: "object",
        properties: {
          memo_id: { type: "string", description: "対象メモのID。元メモなら source の id を使う。create_new_memo で作ったメモなら そのidを使う" },
          scheduled_at: { type: "string", description: "ISO 8601 形式の日時。タイムゾーンは +09:00 (JST) を含めること。例: 2026-05-17T08:00:00+09:00" },
          duration_minutes: { type: "number", description: "所要時間（分）。15/30/45/60/90/120 のいずれか推奨" },
        },
        required: ["memo_id", "scheduled_at", "duration_minutes"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_to_calendar",
      description: "予定時刻が設定済みのメモを Google カレンダーに登録する。先に schedule_memo で時刻設定済みであること。重複登録防止のため、google_event_id が既にあるメモには使わない。",
      parameters: {
        type: "object",
        properties: {
          memo_id: { type: "string", description: "対象メモのID" },
        },
        required: ["memo_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_calendar_events",
      description: "指定日のGoogleカレンダー既存予定を取得する。スケジュール提案前に空き時間を確認するために使う。",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "ISO 8601 日付（YYYY-MM-DD）。例: 2026-05-17" },
        },
        required: ["date"],
      },
    },
  },
]

// ─── システムプロンプト ─────────────────────────────────────────────────
function buildSystemPrompt(): string {
  const now = new Date()
  const jstOffset = 9 * 60
  const localTime = new Date(now.getTime() + (jstOffset - now.getTimezoneOffset()) * 60_000)
  const isoLocal = localTime.toISOString().replace("Z", "+09:00")
  const weekday = ["日", "月", "火", "水", "木", "金", "土"][localTime.getUTCDay()]
  return `あなたはユーザーのメモを対話で整理・改善し、必要なら予定登録まで行うアシスタントです。

## 現在時刻（JST）
${isoLocal} (${weekday}曜日)

「今日」「明日」「来週」「今夜」等の相対表現はこの時刻を基準に解釈すること。

## あなたが使えるツール
- update_current_memo: 元メモを更新
- create_new_memo: 新規メモを作成（分岐用）
- list_my_memos: 他メモを検索
- schedule_memo: メモに予定時刻+所要時間を設定
- add_to_calendar: メモを Google カレンダーに登録（先に schedule_memo 必要）
- list_calendar_events: 指定日の既存予定を取得（空き時間提案前に使う）

**ユーザーの意図に応じて積極的に組み合わせて使ってください**。

## 対話のスタイル
- 質問は1ターンに1-2個まで
- 2-3 ターンで完結を目指す
- 選択肢を提示できるなら提示（例: 「8時 / 9時 / 10時、どれが良いですか?」）
- 推測で勝手な要件を追加しない
- 確定的な指示（「これで」「OK」「分けて」「カレンダーに入れて」等）が来たら即実行

## ツール組み合わせ例
- 「これで保存して」 → update_current_memo
- 「2つに分けて。①と②」 → update + create_new_memo
- 「明日朝8時に30分でやりたい」 → schedule_memo({scheduled_at: '明日8時のISO', duration_minutes: 30}) → カレンダーに入れるか確認
- 「カレンダーに入れて」 → add_to_calendar
- 「いつ空いてる?」 → list_calendar_events({date: '対象日'}) → 結果見て提案
- 「明日早めにやりたいけどいつがいい?」
  → list_calendar_events({date: '明日'}) で空き確認
  → 候補時刻を提案
  → ユーザー確定後 schedule_memo + add_to_calendar

## 注意
- ツール呼び出し後の応答では、何をしたかを1-2文で報告
- schedule_memo の scheduled_at は必ず JST タイムゾーン付き（+09:00）の ISO 文字列
- 新規メモを作って予定登録する場合: create_new_memo → 返値の memo_id を使って schedule_memo`
}

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

    case "schedule_memo": {
      const memoId = String(args.memo_id ?? "").trim()
      const scheduledAt = String(args.scheduled_at ?? "").trim()
      const durationMinutes = Number(args.duration_minutes)
      if (!memoId) return { success: false, error: "memo_id は必須" }
      if (!scheduledAt || isNaN(Date.parse(scheduledAt))) {
        return { success: false, error: "scheduled_at は ISO 8601 (例: 2026-05-17T08:00:00+09:00)" }
      }
      if (!durationMinutes || durationMinutes <= 0 || durationMinutes > 600) {
        return { success: false, error: "duration_minutes は 1-600 分" }
      }
      const { error } = await ctx.supabase
        .from("ideal_goals")
        .update({ scheduled_at: scheduledAt, duration_minutes: durationMinutes })
        .eq("id", memoId)
        .eq("user_id", ctx.userId)
      if (error) return { success: false, error: error.message }
      return {
        success: true,
        memo_id: memoId,
        message: `予定時刻を設定: ${new Date(scheduledAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })} (${durationMinutes}分)`,
      }
    }

    case "add_to_calendar": {
      const memoId = String(args.memo_id ?? "").trim()
      if (!memoId) return { success: false, error: "memo_id は必須" }

      // メモ取得
      const { data: memo, error: fetchErr } = await ctx.supabase
        .from("ideal_goals")
        .select("id, title, description, scheduled_at, duration_minutes, google_event_id")
        .eq("id", memoId)
        .eq("user_id", ctx.userId)
        .single()
      if (fetchErr || !memo) return { success: false, error: "メモが見つかりません" }
      if (!memo.scheduled_at || !memo.duration_minutes) {
        return { success: false, error: "先に schedule_memo で時刻と所要時間を設定してください" }
      }
      if (memo.google_event_id) {
        return { success: false, error: "このメモは既にカレンダー登録済みです" }
      }

      // カレンダー設定取得
      const { data: settings } = await ctx.supabase
        .from("user_calendar_settings")
        .select("is_sync_enabled, default_calendar_id")
        .eq("user_id", ctx.userId)
        .maybeSingle()
      if (!settings?.is_sync_enabled) {
        return { success: false, error: "Googleカレンダー未連携です。設定から連携してください" }
      }

      const startTime = new Date(memo.scheduled_at)
      const endTime = new Date(startTime.getTime() + memo.duration_minutes * 60 * 1000)
      const calendarId = settings.default_calendar_id ?? "primary"

      try {
        const { calendar } = await getCalendarClient(ctx.userId)
        const gcalRes = await calendar.events.insert({
          calendarId,
          requestBody: {
            summary: memo.title,
            description: memo.description ?? "",
            start: { dateTime: startTime.toISOString(), timeZone: "Asia/Tokyo" },
            end: { dateTime: endTime.toISOString(), timeZone: "Asia/Tokyo" },
          },
        })
        await ctx.supabase
          .from("ideal_goals")
          .update({ google_event_id: gcalRes.data.id, memo_status: "scheduled" })
          .eq("id", memoId)
          .eq("user_id", ctx.userId)
        return {
          success: true,
          memo_id: memoId,
          google_event_id: gcalRes.data.id,
          message: `カレンダー登録完了: ${startTime.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}`,
        }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : "カレンダー登録失敗" }
      }
    }

    case "list_calendar_events": {
      const dateStr = String(args.date ?? "").trim()
      if (!dateStr) return { success: false, error: "date は必須 (YYYY-MM-DD)" }

      const { data: settings } = await ctx.supabase
        .from("user_calendar_settings")
        .select("is_sync_enabled, default_calendar_id")
        .eq("user_id", ctx.userId)
        .maybeSingle()
      if (!settings?.is_sync_enabled) {
        return { success: false, error: "Googleカレンダー未連携。空き時間を推測で提案してください" }
      }

      try {
        const { calendar } = await getCalendarClient(ctx.userId)
        const calendarId = settings.default_calendar_id ?? "primary"
        // JST 00:00 〜 翌 00:00
        const timeMin = new Date(`${dateStr}T00:00:00+09:00`).toISOString()
        const timeMax = new Date(`${dateStr}T23:59:59+09:00`).toISOString()
        const res = await calendar.events.list({
          calendarId,
          timeMin,
          timeMax,
          singleEvents: true,
          orderBy: "startTime",
          maxResults: 30,
        })
        const events = (res.data.items ?? []).map(e => ({
          summary: e.summary,
          start: e.start?.dateTime ?? e.start?.date,
          end: e.end?.dateTime ?? e.end?.date,
        }))
        return { success: true, date: dateStr, count: events.length, events }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : "予定取得失敗" }
      }
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
    { role: "system", content: `${buildSystemPrompt()}\n\n${contextBlock}` },
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
        if ([
          "update_current_memo",
          "create_new_memo",
          "schedule_memo",
          "add_to_calendar",
        ].includes(call.function.name)) {
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
