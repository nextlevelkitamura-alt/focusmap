import { describe, expect, test } from "vitest"
import {
  detectCodexResumeAfterApproval,
  getCodexTaskUiState,
  parseCodexRollout,
  shouldCompleteSourceTaskForCodexReview,
} from "./codex-run-state"

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
    expect(parsed.visibleMessages).toEqual([{
      role: "assistant",
      body: "作業を始めます",
      kind: "progress",
      createdAt: "2026-05-30T08:00:02.000Z",
    }])
    expect(parsed.liveLog).not.toContain("[command:started] exec_command")
    expect(parsed.liveLog).not.toContain("internal instructions")
    expect(parsed.liveLog).not.toContain("AGENTS.md")
    expect(parsed.currentStep).toBe("作業を始めます")
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
    expect(parsed.visibleMessages.map(message => `${message.role}:${message.body}`)).toEqual([
      "user:この方針で続けて",
      "assistant:続きの結果です",
    ])
    expect(parsed.latestUserMessageAt).toBe("2026-05-30T08:00:01.000Z")
    expect(parsed.currentStep).toBe("続きの結果です")
    expect(parsed.lastActivityAt).toBe("2026-05-30T08:00:03.000Z")
  })

  test("moves to review when Codex completes", () => {
    const parsed = parseCodexRollout([
      row({ type: "task_started" }),
      row({ type: "task_complete" }, "2026-05-30T08:02:00.000Z"),
    ].join("\n"))

    expect(parsed.state).toBe("awaiting_approval")
    expect(parsed.reviewReason).toBe("completed")
    expect(parsed.currentStep).toBe("Codexが実行完了し確認待ちです")
    expect(parsed.liveLog).toContain("確認待ち")
  })

  test("keeps the final assistant message from task_complete", () => {
    const parsed = parseCodexRollout([
      row({ type: "task_started" }),
      row({
        type: "task_complete",
        last_agent_message: "候補者名なら状況確認、タスクなら追加できます。",
      }, "2026-05-30T08:02:00.000Z"),
    ].join("\n"))

    expect(parsed.state).toBe("awaiting_approval")
    expect(parsed.latestAgentMessage).toBe("候補者名なら状況確認、タスクなら追加できます。")
    expect(parsed.liveLog).toContain("[assistant] 候補者名なら状況確認")
    expect(parsed.visibleMessages.at(-1)).toMatchObject({
      role: "assistant",
      body: "候補者名なら状況確認、タスクなら追加できます。",
      kind: "completed",
    })
  })

  test("tracks user-visible questions", () => {
    const parsed = parseCodexRollout([
      row({ type: "task_started" }),
      row({ type: "agent_message", message: "どの方針で進めますか？" }, "2026-05-30T08:00:03.000Z"),
    ].join("\n"))

    expect(parsed.latestQuestion).toBe("どの方針で進めますか？")
    expect(parsed.currentStep).toBe("どの方針で進めますか？")
  })

  test("captures short mobile Codex replies that complete without task_started", () => {
    const parsed = parseCodexRollout([
      row({ type: "user_message", message: "アンドラ" }, "2026-06-06T17:30:55.420Z"),
      row({
        type: "agent_message",
        message: "アンドラについて、何を調べたいですか？\n\n例: 国の概要、旅行、税制、移住、場所、首都、治安、観光地など。",
      }, "2026-06-06T17:31:01.798Z"),
      row({
        type: "task_complete",
        last_agent_message: "アンドラについて、何を調べたいですか？\n\n例: 国の概要、旅行、税制、移住、場所、首都、治安、観光地など。",
      }, "2026-06-06T17:31:01.846Z"),
    ].join("\n"))

    expect(parsed.state).toBe("awaiting_approval")
    expect(parsed.reviewReason).toBe("completed")
    expect(parsed.latestQuestion).toContain("アンドラについて")
    expect(parsed.visibleMessages.map(message => `${message.role}:${message.kind}:${message.body.slice(0, 5)}`)).toEqual([
      "user:user_answer:アンドラ",
      "assistant:question:アンドラに",
    ])
  })

  test("moves to review when a turn is aborted or the thread is archived", () => {
    expect(parseCodexRollout(row({ type: "turn_aborted" })).reviewReason).toBe("aborted")
    expect(parseCodexRollout("", { archived: true, snapshot: { preview: "archived preview" } }).reviewReason).toBe("archived")
  })
})

describe("detectCodexResumeAfterApproval", () => {
  test("detects a user follow-up after awaiting approval", () => {
    const parsed = parseCodexRollout([
      row({ type: "task_started" }),
      row({ type: "task_complete" }, "2026-05-30T08:02:00.000Z"),
      row({ type: "user_message", message: "続けてください" }, "2026-05-30T08:03:00.000Z"),
    ].join("\n"))

    expect(detectCodexResumeAfterApproval(parsed, "2026-05-30T08:02:30.000Z")).toBe(true)
  })

  test("detects a later task_started or thread timestamp", () => {
    const parsed = parseCodexRollout([
      row({ type: "task_started" }, "2026-05-30T08:04:00.000Z"),
    ].join("\n"))

    expect(detectCodexResumeAfterApproval(parsed, "2026-05-30T08:03:59.000Z")).toBe(true)
    expect(detectCodexResumeAfterApproval(
      { latestUserMessageAt: null, latestTaskStartedAt: null },
      "2026-05-30T08:03:59.000Z",
      { updated_at_ms: Date.parse("2026-05-30T08:04:01.000Z") },
    )).toBe(true)
  })

  test("does not resume from older internal activity", () => {
    const parsed = parseCodexRollout([
      row({ type: "task_complete" }, "2026-05-30T08:02:00.000Z"),
      row({ type: "user_message", content: "# AGENTS.md instructions" }, "2026-05-30T08:03:00.000Z"),
    ].join("\n"))

    expect(detectCodexResumeAfterApproval(parsed, "2026-05-30T08:02:30.000Z")).toBe(false)
  })
})

describe("getCodexTaskUiState", () => {
  test("normalizes Codex tasks to prompt waiting, running or review", () => {
    expect(getCodexTaskUiState({ executor: "codex_app", status: "running", result: null })?.state).toBe("running")
    expect(getCodexTaskUiState({ executor: "codex_app", status: "failed", result: null })).toEqual({ state: "connection_failed", label: "接続失敗" })
    expect(getCodexTaskUiState({ executor: "codex_app", status: "failed", result: { codex_run_state: "running" } })).toEqual({ state: "connection_failed", label: "接続失敗" })
    expect(getCodexTaskUiState({ executor: "codex_app", status: "completed", result: null })).toEqual({ state: "completed", label: "完了済み" })
    expect(getCodexTaskUiState({ executor: "codex_app", status: "pending", result: { codex_run_state: "running" } })).toEqual({ state: "prompt_waiting", label: "未送信" })
    expect(getCodexTaskUiState({
      executor: "codex_app",
      status: "pending",
      result: {
        codex_manual_handoff: false,
        codex_run_state: "running",
        codex_review_reason: "queued",
        last_activity_at: new Date().toISOString(),
        message: "Codex.app app-server で実行待ちです。",
      },
    })).toEqual({ state: "running", label: "実行中" })
    expect(getCodexTaskUiState({
      executor: "codex_app",
      status: "pending",
      codex_thread_id: "019e9811-3f91-79c1-84b2-b5d0803fea8e",
      result: {
        codex_run_state: "prompt_waiting",
        last_activity_at: new Date().toISOString(),
        message: "`work-skill-guide` を入口にして確認します。",
      },
    })).toEqual({ state: "running", label: "実行中" })
    expect(getCodexTaskUiState({
      executor: "codex_app",
      status: "pending",
      codex_thread_id: "019e9811-3f91-79c1-84b2-b5d0803fea8e",
      result: {
        codex_run_state: "prompt_waiting",
        last_activity_at: "2020-01-01T00:00:00.000Z",
        message: "どうしました？ Focusmapでやりたい作業があれば、そのまま投げてください。",
      },
    })).toEqual({ state: "awaiting_approval", label: "確認待ち" })
    expect(getCodexTaskUiState({ executor: "claude", status: "running", result: null })).toBeNull()
  })

  test("labels manual handoff without a thread as prompt waiting", () => {
    expect(getCodexTaskUiState({
      executor: "codex_app",
      status: "awaiting_approval",
      result: { codex_manual_handoff: true, codex_run_state: "prompt_waiting" },
    })).toEqual({ state: "prompt_waiting", label: "未送信" })

    expect(getCodexTaskUiState({
      executor: "codex_app",
      status: "awaiting_approval",
      result: {
        codex_manual_handoff: true,
        codex_run_state: "awaiting_approval",
        codex_thread_id: "019e7961-30b1-7a82-ab25-da26ad30d8ed",
      },
    })).toEqual({ state: "awaiting_approval", label: "確認待ち" })

    expect(getCodexTaskUiState({
      executor: "codex_app",
      status: "awaiting_approval",
      result: {
        codex_manual_handoff: true,
        codex_run_state: "awaiting_approval",
        codex_review_reason: "external_app_handoff",
      },
    })).toEqual({ state: "prompt_waiting", label: "未送信" })
  })

  test("labels the node Codex badge as completed after a closed thread completes the source task", () => {
    expect(getCodexTaskUiState({
      executor: "codex_app",
      status: "completed",
      result: {
        codex_source_task_completed: true,
        codex_review_reason: "archived",
      },
    })).toEqual({ state: "completed", label: "完了済み" })

    expect(getCodexTaskUiState({
      executor: "codex_app",
      status: "completed",
      result: {
        codex_source_task_completed: true,
        codex_review_reason: "thread_deleted",
      },
    })).toEqual({ state: "completed", label: "完了済み" })

    expect(getCodexTaskUiState({
      executor: "codex_app",
      status: "completed",
      result: {
        codex_review_reason: "completed",
      },
    })).toEqual({ state: "completed", label: "完了済み" })

    expect(getCodexTaskUiState({
      executor: "codex_app",
      status: "completed",
      result: {
        codex_source_task_completed: true,
        codex_source_task_completion_suppressed: true,
        codex_review_reason: "archived",
      },
    })).toEqual({ state: "awaiting_approval", label: "確認待ち" })
  })

  test("keeps an opened but unsent Codex thread in prompt waiting", () => {
    expect(getCodexTaskUiState({
      executor: "codex_app",
      status: "needs_input",
      result: {
        codex_manual_handoff: true,
        codex_run_state: "prompt_waiting",
        codex_thread_id: "019e7961-30b1-7a82-ab25-da26ad30d8ed",
      },
    })).toEqual({ state: "prompt_waiting", label: "未送信" })
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
