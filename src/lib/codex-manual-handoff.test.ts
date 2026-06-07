import { describe, expect, test } from "vitest"
import {
  buildManualCodexHandoffConfirmedResult,
  isManualCodexHandoffConfirmed,
  isManualCodexHandoffWaiting,
  MANUAL_CODEX_HANDOFF_CONFIRMED_MESSAGE,
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

  test("builds an awaiting approval result for external app screen switches", () => {
    const result = buildManualCodexHandoffConfirmedResult({
      codex_manual_handoff: true,
      codex_run_state: "prompt_waiting",
      steps: [{ key: "prompt_waiting", label: "プロンプト待ち", status: "active" }],
    }, {
      nowIso: "2026-06-07T08:00:00.000Z",
      event: "external_app_returned",
    })

    expect(result.codex_manual_handoff).toBe(true)
    expect(result.codex_run_state).toBe("awaiting_approval")
    expect(result.codex_review_reason).toBe("external_app_handoff")
    expect(result.message).toBe(MANUAL_CODEX_HANDOFF_CONFIRMED_MESSAGE)
    expect(result.progress_summary).toMatchObject({
      state: "needs_review",
      current_step: "ChatGPT/Codexアプリで確認待ち",
    })
    expect(Array.isArray(result.steps)).toBe(true)
    expect(Array.isArray(result.codex_visible_messages)).toBe(true)
    expect(isManualCodexHandoffConfirmed({
      executor: "codex_app",
      status: "awaiting_approval",
      result,
    })).toBe(true)
  })
})
