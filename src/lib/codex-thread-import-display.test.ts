import { describe, expect, test } from "vitest"
import {
  codexThreadImportActivityAt,
  codexThreadPromptPreviewFromMemo,
  importedCodexThreadUpdatedAtFromMemo,
  markdownSectionBody,
} from "./codex-thread-import-display"

describe("codex thread import display helpers", () => {
  test("extracts the first request section from imported thread memo", () => {
    const memo = [
      "# 入力を確認",
      "",
      "## 取り込み情報",
      "- Thread ID: 019eb931-d4dc-7833-b4ce-3e05799b7d06",
      "- Repository: /Users/me/work",
      "",
      "## 初回依頼",
      "あああっs",
      "",
      "## 最新プレビュー",
      "preview",
    ].join("\n")

    expect(markdownSectionBody(memo, "初回依頼")).toBe("あああっs")
    expect(codexThreadPromptPreviewFromMemo(memo)).toBe("あああっs")
  })

  test("falls back only when the request section is missing", () => {
    expect(codexThreadPromptPreviewFromMemo("# 見出し", "fallback prompt")).toBe("fallback prompt")
    expect(codexThreadPromptPreviewFromMemo("# 見出し")).toBeNull()
  })

  test("reads the imported thread updated time from memo metadata", () => {
    const memo = [
      "# Codex thread",
      "",
      "## 取り込み情報",
      "- Thread ID: thread-1",
      "- Repository: /Users/me/work",
      "- 最終更新: 2026-06-18T00:30:00.000Z",
    ].join("\n")

    expect(importedCodexThreadUpdatedAtFromMemo(memo)).toBe("2026-06-18T00:30:00.000Z")
  })

  test("prefers Codex activity time over Focusmap import snapshot time", () => {
    const task = {
      memo: [
        "# Codex thread",
        "",
        "## 取り込み情報",
        "- 最終更新: 2026-06-18T00:30:00.000Z",
      ].join("\n"),
      updated_at: "2026-06-18T01:00:00.000Z",
      created_at: "2026-06-18T01:00:00.000Z",
    }

    expect(codexThreadImportActivityAt({
      task,
      aiTask: {
        result: { last_activity_at: "2026-06-18T00:45:00.000Z" },
        created_at: "2026-06-18T01:00:00.000Z",
      },
      progressTask: {
        updated_at: "2026-06-18T01:05:00.000Z",
      },
    })).toBe("2026-06-18T00:45:00.000Z")

    expect(codexThreadImportActivityAt({
      task,
      progressTask: {
        updated_at: "2026-06-18T01:05:00.000Z",
      },
    })).toBe("2026-06-18T00:30:00.000Z")
  })
})
