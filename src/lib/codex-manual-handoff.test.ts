import { describe, expect, test } from "vitest"
import {
  isManualCodexHandoffWaiting,
  isPassiveManualCodexHandoffEvent,
} from "./codex-manual-handoff"

describe("manual Codex handoff confirmation", () => {
  test("detects only waiting manual Codex.app handoffs", () => {
    expect(isManualCodexHandoffWaiting({
      executor: "codex_app",
      status: "needs_input",
      result: { codex_manual_handoff: true, codex_run_state: "prompt_waiting" },
    })).toBe(true)

    expect(isManualCodexHandoffWaiting({
      executor: "codex_app",
      status: "awaiting_approval",
      result: { codex_manual_handoff: true, codex_run_state: "awaiting_approval" },
    })).toBe(false)

    expect(isManualCodexHandoffWaiting({
      executor: "codex",
      status: "needs_input",
      result: { codex_manual_handoff: true, codex_run_state: "prompt_waiting" },
    })).toBe(false)
  })

  test("treats external app screen switches as passive handoff events", () => {
    expect(isPassiveManualCodexHandoffEvent("external_app_opened")).toBe(true)
    expect(isPassiveManualCodexHandoffEvent("external_app_returned")).toBe(true)
    expect(isPassiveManualCodexHandoffEvent("screen_switched")).toBe(true)
    expect(isPassiveManualCodexHandoffEvent("execution_detected")).toBe(false)
  })
})
