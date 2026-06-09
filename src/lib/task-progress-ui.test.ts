import { describe, expect, test } from "vitest"
import {
  codexMonitorToneClass,
  codexMonitorUiLabel,
  getCodexMonitorUiStatus,
} from "./task-progress-ui"

describe("task-progress-ui", () => {
  test("labels completed Codex progress as done", () => {
    expect(getCodexMonitorUiStatus("completed")).toBe("done")
    expect(codexMonitorUiLabel("completed")).toBe("完了済み")
    expect(codexMonitorToneClass("completed")).toContain("emerald")
  })

  test("keeps awaiting approval as review", () => {
    expect(getCodexMonitorUiStatus("awaiting_approval")).toBe("review")
    expect(codexMonitorUiLabel("awaiting_approval")).toBe("確認待ち")
  })
})
