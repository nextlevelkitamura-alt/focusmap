import { describe, expect, test } from "vitest"
import {
  cleanGeneratedMemoHeading,
  buildLongNodeMemoDetail,
  MEMO_AI_INGEST_TITLE_MAX_CHARS,
  MEMO_HEADING_HARD_MAX_CHARS,
  normalizeAiIngestTitle,
  preserveMemoInputBody,
} from "./memo-ai-generation"

describe("memo AI generation helpers", () => {
  test("cleans generated headings and clamps them to the hard max", () => {
    const heading = cleanGeneratedMemoHeading(
      "見出し: 「カゴデックスのプロンプト送信プロセスをもっとより良くクリックして進める」",
    )

    expect(heading).not.toMatch(/^(見出し|タイトル)[:：]/)
    expect(Array.from(heading).length).toBeLessThanOrEqual(MEMO_HEADING_HARD_MAX_CHARS)
  })

  test("normalizes AI ingest titles to the shorter memo heading length", () => {
    const title = normalizeAiIngestTitle(
      "新しい挑戦への考え方とカゴデックス送信部分の改善",
      "何か新しいことに挑戦することは非常にダメだと思って",
    )

    expect(Array.from(title).length).toBeLessThanOrEqual(MEMO_AI_INGEST_TITLE_MAX_CHARS)
  })

  test("keeps meaningful leading numbers while removing numbered-list prefixes", () => {
    expect(cleanGeneratedMemoHeading("2026年の税制確認")).toBe("2026年の税制確認")
    expect(cleanGeneratedMemoHeading("1. 税制確認")).toBe("税制確認")
  })

  test("preserves memo body content except surrounding whitespace", () => {
    const body = preserveMemoInputBody(`
何か新しいことに挑戦することは非常にダメだと思って
それこそカゴデックスにプロンプトを送る部分に関して
もっとよりよりクリックしていきたいと思ってます
`)

    expect(body).toContain("それこそカゴデックスにプロンプトを送る部分に関して")
    expect(body.split("\n")).toHaveLength(3)
  })

  test("builds memo detail for long mind map nodes without dropping existing memo", () => {
    const detail = buildLongNodeMemoDetail("長いノード本文", "既存メモ")

    expect(detail).toBe("長いノード本文\n\n既存メモ")
    expect(buildLongNodeMemoDetail("長いノード本文", "長いノード本文")).toBe("長いノード本文")
  })
})
