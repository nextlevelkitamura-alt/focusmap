import { describe, expect, test } from "vitest"
import {
  codexMonitorToneClass,
  codexMonitorUiLabel,
  getCodexMonitorUiStatus,
} from "./task-progress-ui"

describe("task-progress-ui", () => {
  test("keeps completed Codex progress in review until the source node is checked", () => {
    expect(getCodexMonitorUiStatus("completed")).toBe("review")
    expect(codexMonitorUiLabel("completed")).toBe("確認待ち")
    expect(codexMonitorToneClass("completed")).toContain("amber")
  })

  test("keeps awaiting approval as review", () => {
    expect(getCodexMonitorUiStatus("awaiting_approval")).toBe("review")
    expect(codexMonitorUiLabel("awaiting_approval")).toBe("確認待ち")
  })
})
