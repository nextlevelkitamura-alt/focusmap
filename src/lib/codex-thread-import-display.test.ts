import { describe, expect, test } from "vitest"
import {
  codexThreadDisplayTitle,
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

  test("prefers the Codex generated thread title for history cards", () => {
    expect(codexThreadDisplayTitle({
      taskTitle: "うちの情報をネクストレベルの登録してくれた時に",
      progressTitle: "サービス案内メールを作成",
      aiResult: {
        meta: {
          source_task_title: "サービス案内メールの構成作成",
          thread_title: "うちの情報をネクストレベルの登録してくれた時に",
        },
      },
    })).toBe("サービス案内メールの構成作成")
  })

  test("uses progress snapshot title before the old task title", () => {
    expect(codexThreadDisplayTitle({
      taskTitle: "長い初回プロンプトの先頭",
      progressTitle: "Codex側で生成された短い見出し",
      aiResult: {
        meta: {
          thread_title: "Codex側の未確定タイトル",
        },
      },
    })).toBe("Codex側で生成された短い見出し")
  })

  test("uses thread title when progress title is still the old task title", () => {
    expect(codexThreadDisplayTitle({
      taskTitle: "うちの情報をネクストレベルの登録してくれた時に",
      progressTitle: "うちの情報をネクストレベルの登録してくれた時に",
      aiResult: {
        meta: {
          thread_title: "サービス案内メールを作成",
        },
      },
    })).toBe("サービス案内メールを作成")
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

  test("prefers Codex turn completion time over Focusmap import snapshot time", () => {
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
        result: {
          codex_turn_completed_at: "2026-06-18T00:45:00.000Z",
          last_activity_at: "2026-06-18T01:10:00.000Z",
          codex_activity_synced_at: "2026-06-18T01:15:00.000Z",
        },
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

  test("does not promote Focusmap sync or import timestamps into the history sort time", () => {
    expect(codexThreadImportActivityAt({
      task: {
        updated_at: "2026-06-18T01:00:00.000Z",
        created_at: "2026-06-18T01:00:00.000Z",
      },
      aiTask: {
        result: {
          last_activity_at: "2026-06-18T01:10:00.000Z",
          codex_activity_synced_at: "2026-06-18T01:15:00.000Z",
        },
        completed_at: "2026-06-18T01:20:00.000Z",
        started_at: "2026-06-18T00:59:00.000Z",
        created_at: "2026-06-18T00:58:00.000Z",
      },
      progressTask: {
        updated_at: "2026-06-18T01:25:00.000Z",
      },
      codexRun: {
        lastActivityAt: "2026-06-18T01:30:00.000Z",
        updatedAt: "2026-06-18T01:35:00.000Z",
      },
    })).toBeNull()
  })
})
