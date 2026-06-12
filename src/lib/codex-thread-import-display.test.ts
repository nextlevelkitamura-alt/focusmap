import { describe, expect, test } from "vitest"
import { codexThreadPromptPreviewFromMemo, markdownSectionBody } from "./codex-thread-import-display"

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
})
