import { describe, expect, test } from "vitest"
import { getCodexTaskUiState, parseCodexRollout, shouldCompleteSourceTaskForCodexReview } from "./codex-run-state"

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
    expect(parsed.liveLog).not.toContain("[command:started] exec_command")
    expect(parsed.liveLog).not.toContain("internal instructions")
    expect(parsed.liveLog).not.toContain("AGENTS.md")
    expect(parsed.lastActivityAt).toBe("2026-05-30T08:00:02.000Z")
  })

  test("mirrors user follow-ups and tool starts from the Codex app thread", () => {
    const parsed = parseCodexRollout([
      row({ type: "task_started" }),
      row({ type: "user_message", message: "この方針で続けて" }, "2026-05-30T08:00:01.000Z"),
      row({
        type: "function_call",
        name: "exec_command",
        arguments: JSON.stringify({ cmd: "npm test -- --run src/lib/codex-run-state.test.ts" }),
      }, "2026-05-30T08:00:02.000Z"),
      row({ type: "agent_message", message: "続きの結果です" }, "2026-05-30T08:00:03.000Z"),
    ].join("\n"))

    expect(parsed.liveLog).toContain("[user] この方針で続けて")
    expect(parsed.liveLog).not.toContain("[command:started] npm test -- --run src/lib/codex-run-state.test.ts")
    expect(parsed.liveLog).toContain("[assistant] 続きの結果です")
    expect(parsed.lastActivityAt).toBe("2026-05-30T08:00:03.000Z")
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

  test("labels manual handoff without a thread as execution waiting", () => {
    expect(getCodexTaskUiState({
      executor: "codex_app",
      status: "awaiting_approval",
      result: { codex_manual_handoff: true, codex_run_state: "awaiting_approval" },
    })).toEqual({ state: "awaiting_approval", label: "実行待ち" })

    expect(getCodexTaskUiState({
      executor: "codex_app",
      status: "awaiting_approval",
      result: {
        codex_manual_handoff: true,
        codex_run_state: "awaiting_approval",
        codex_thread_id: "019e7961-30b1-7a82-ab25-da26ad30d8ed",
      },
    })).toEqual({ state: "awaiting_approval", label: "確認待ち" })
  })
})

describe("shouldCompleteSourceTaskForCodexReview", () => {
  test("only treats user-closed Codex sessions as source task completion", () => {
    expect(shouldCompleteSourceTaskForCodexReview("archived")).toBe(true)
    expect(shouldCompleteSourceTaskForCodexReview("thread_deleted")).toBe(true)
    expect(shouldCompleteSourceTaskForCodexReview("completed")).toBe(false)
    expect(shouldCompleteSourceTaskForCodexReview("monitoring_lost")).toBe(false)
    expect(shouldCompleteSourceTaskForCodexReview("approval_requested")).toBe(false)
  })
})
