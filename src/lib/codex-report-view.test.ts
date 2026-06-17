import { describe, expect, test } from "vitest"
import { codexReportViewMessages } from "./codex-report-view"
import type { AiTaskActivityMessage } from "@/types/ai-task"

let nextMessageId = 0

function message(partial: Partial<AiTaskActivityMessage> & Pick<AiTaskActivityMessage, "body">): AiTaskActivityMessage {
  return {
    id: partial.id ?? `message-${nextMessageId += 1}`,
    task_id: "task-1",
    user_id: "user-1",
    role: partial.role ?? "codex",
    kind: partial.kind ?? "progress",
    body: partial.body,
    importance: partial.importance ?? "normal",
    metadata: partial.metadata ?? {},
    created_at: partial.created_at ?? "2026-06-17T00:00:00.000Z",
  }
}

describe("codexReportViewMessages", () => {
  test("keeps the sent request and final report while dropping fine-grained progress", () => {
    const messages = [
      message({ id: "1", role: "user", kind: "sent", body: "UIは変えず、送ったプロンプトと作業後の報告だけ表示して" }),
      message({ id: "2", body: "開発サーバーの起動待ちです。NextがreadyになったらAPIだけcurlで確認します。" }),
      message({ id: "3", body: "curlで確認します。" }),
      message({ id: "4", kind: "completed", body: "実装して main にコミットしました。AI要約はReport Viewだけを使います。" }),
    ]

    expect(codexReportViewMessages(messages).map(item => item.id)).toEqual(["1", "4"])
  })

  test("uses the latest non-noisy Codex response when older activity was stored as progress", () => {
    const messages = [
      message({ id: "1", role: "user", kind: "sent", body: "チャット履歴を整理して" }),
      message({ id: "2", body: "3001は空いています。npm run dev:desktopを起動します。" }),
      message({ id: "3", body: "Report Viewの方針に整理しました。全文確認はCodex側へ逃がします。" }),
    ]

    expect(codexReportViewMessages(messages).map(item => item.id)).toEqual(["1", "3"])
  })
})
