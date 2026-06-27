import { describe, expect, test } from "vitest"
import { sanitizeCodexDisplayText } from "./codex-display-sanitize"

describe("sanitizeCodexDisplayText", () => {
  test("shows only the Codex request body and attachment counts for wrapped prompts", () => {
    const raw = `# Files mentioned by the user:

## 新宿（保険関係）2枠.pdf: /Users/me/Drive/求人票/新宿（保険関係）2枠.pdf

## 三田・田町（データ入力など）3枠.pdf: /Users/me/Drive/求人票/三田・田町（データ入力など）3枠.pdf

# Applications mentioned by the user:

<appshot app="Focusmap" bundle-identifier="com.focusmap.desktop">
細かな画面構造
</appshot>

## My request for Codex:
ねねラインの求人配信したいんだけど

三田 田町はこれは普通に事務業務っぽい写真にして
アダルトの内容入れないようにしてほしい`

    const result = sanitizeCodexDisplayText(raw, { maxChars: 2_000 })

    expect(result.text).toBe(`ねねラインの求人配信したいんだけど

三田 田町はこれは普通に事務業務っぽい写真にして
アダルトの内容入れないようにしてほしい

添付ファイル
PDF: 2件
Appshot: 1件`)
    expect(result.text).not.toContain("/Users/me/Drive")
    expect(result.text).not.toContain("Files mentioned")
    expect(result.text).not.toContain("My request for Codex")
    expect(result.text).not.toContain("プロンプト")
    expect(result.text).not.toContain("細かな画面構造")
  })

  test("summarizes attachments without duplicating an image tag already listed as a file", () => {
    const raw = `# Files mentioned by the user:

## codex-clipboard.png: /var/folders/codex-clipboard.png

<image name=[Image #1] path="/var/folders/codex-clipboard.png">
raw image payload
</image>

## My request for Codex:
この見た目に合わせて`

    expect(sanitizeCodexDisplayText(raw, { maxChars: 2_000 }).text).toBe(`この見た目に合わせて

添付ファイル
画像: 1件`)
  })

  test("hides Focusmap handoff sync ids from visible prompt text", () => {
    expect(sanitizeCodexDisplayText(`依頼本文です

Focusmap同期ID: FM-token-123`, { maxChars: 2_000 }).text).toBe("依頼本文です")
  })
})
