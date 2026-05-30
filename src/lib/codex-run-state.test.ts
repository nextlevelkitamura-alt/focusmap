import { describe, expect, test } from "vitest"
import { getCodexTaskUiState, parseCodexRollout } from "./codex-run-state"

const row = (payload: Record<string, unknown>, timestamp = "2026-05-30T08:00:00.000Z") =>
  JSON.stringify({ timestamp, type: "event_msg", payload })

describe("parseCodexRollout", () => {
  test("keeps the run active after task_started", () => {
    const parsed = parseCodexRollout([
      row({ type: "task_started" }),
      row({ type: "message", role: "developer", content: "internal instructions" }, "2026-05-30T08:00:01.000Z"),
      row({ type: "user_message", content: "# AGENTS.md instructions" }, "2026-05-30T08:00:01.500Z"),
      row({ type: "function_call", name: "exec_command" }, "2026-05-30T08:00:01.700Z"),
      row({ type: "agent_message", message: "作業を始めます" }, "2026-05-30T08:00:02.000Z"),
      row({ type: "message", role: "assistant", content: "作業を始めます" }, "2026-05-30T08:00:02.000Z"),
    ].join("\n"))

    expect(parsed.state).toBe("running")
    expect(parsed.reviewReason).toBe("started")
    expect(parsed.liveLog).toContain("作業を始めます")
    expect(parsed.liveLog.match(/作業を始めます/g)?.length).toBe(1)
    expect(parsed.liveLog).not.toContain("internal instructions")
    expect(parsed.liveLog).not.toContain("AGENTS.md")
    expect(parsed.liveLog).not.toContain("exec_command")
    expect(parsed.lastActivityAt).toBe("2026-05-30T08:00:02.000Z")
  })

  test("moves to review when Codex completes", () => {
    const parsed = parseCodexRollout([
      row({ type: "task_started" }),
      row({ type: "task_complete" }, "2026-05-30T08:02:00.000Z"),
    ].join("\n"))

    expect(parsed.state).toBe("awaiting_approval")
    expect(parsed.reviewReason).toBe("completed")
    expect(parsed.liveLog).toContain("確認待ち")
  })

  test("moves to review when a turn is aborted or the thread is archived", () => {
    expect(parseCodexRollout(row({ type: "turn_aborted" })).reviewReason).toBe("aborted")
    expect(parseCodexRollout("", { archived: true, snapshot: { preview: "archived preview" } }).reviewReason).toBe("archived")
  })
})

describe("getCodexTaskUiState", () => {
  test("normalizes Codex tasks to running or review only", () => {
    expect(getCodexTaskUiState({ executor: "codex_app", status: "running", result: null })?.state).toBe("running")
    expect(getCodexTaskUiState({ executor: "codex_app", status: "failed", result: null })?.state).toBe("awaiting_approval")
    expect(getCodexTaskUiState({ executor: "codex_app", status: "failed", result: { codex_run_state: "running" } })?.state).toBe("awaiting_approval")
    expect(getCodexTaskUiState({ executor: "codex_app", status: "completed", result: null })).toBeNull()
    expect(getCodexTaskUiState({ executor: "claude", status: "running", result: null })).toBeNull()
  })
})
