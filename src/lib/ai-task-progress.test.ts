import { describe, expect, test } from "vitest"
import { deterministicProgress, type AiTaskProgressTask, type ProgressEvidence } from "./ai-task-progress"

function task(overrides: Partial<AiTaskProgressTask> = {}): AiTaskProgressTask {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    prompt: "Implement the feature",
    status: "running",
    error: null,
    result: null,
    executor: "claude",
    started_at: "2026-05-18T00:00:00.000Z",
    completed_at: null,
    created_at: "2026-05-18T00:00:00.000Z",
    remote_session_url: "https://claude.ai/code/example",
    tmux_session_name: "memo-00000000",
    codex_thread_id: null,
    cwd: "/tmp/repo",
    ...overrides,
  }
}

function evidence(overrides: Partial<ProgressEvidence> = {}): ProgressEvidence {
  return {
    task_id: "00000000-0000-0000-0000-000000000001",
    executor: "claude",
    status: "running",
    checked_at: "2026-05-18T00:10:00.000Z",
    started_at: "2026-05-18T00:00:00.000Z",
    completed_at: null,
    created_at: "2026-05-18T00:00:00.000Z",
    remote_session_url: "https://claude.ai/code/example",
    codex_thread_id: null,
    tmux_session_name: "memo-00000000",
    tmux_alive: true,
    run_dir: "/tmp/run",
    stdout_log_path: "/tmp/run/stdout.log",
    tmp_log_path: "/tmp/claude-rc.log",
    transcript_path: "/tmp/session.jsonl",
    log_tail: "",
    log_chars: 0,
    events: [],
    transcript: {
      path: "/tmp/session.jsonl",
      line_count: 1,
      last_text: "",
      last_assistant_text: "",
      last_stop_reason: null,
      tool_names: [],
      files_touched: [],
      tests_seen: [],
      errors: [],
      done_evidence: [],
      remaining_work: [],
      last_timestamp: "2026-05-18T00:10:00.000Z",
    },
    last_activity_at: "2026-05-18T00:10:00.000Z",
    last_tool: null,
    files_touched: [],
    tests_seen: [],
    done_evidence: [],
    remaining_work: [],
    blocked_reason: null,
    session_health: "active",
    has_permission_denied: false,
    has_question_or_notification: false,
    has_error: false,
    ...overrides,
  }
}

describe("deterministicProgress", () => {
  test("marks pending tasks as not started", () => {
    const progress = deterministicProgress(
      task({ status: "pending", started_at: null, tmux_session_name: null }),
      evidence({ status: "pending", session_health: "unknown", tmux_alive: null }),
    )

    expect(progress.state).toBe("not_started")
    expect(progress.progress_percent).toBe(5)
    expect(progress.can_mark_completed).toBe(false)
  })

  test("keeps active sessions running while surfacing tools and files", () => {
    const progress = deterministicProgress(
      task(),
      evidence({
        session_health: "active",
        last_tool: "Edit",
        files_touched: ["src/app/page.tsx"],
        tests_seen: ["npm test"],
        done_evidence: ["file updated"],
      }),
    )

    expect(progress.state).toBe("running")
    expect(progress.progress_percent).toBeGreaterThanOrEqual(45)
    expect(progress.files_touched).toEqual(["src/app/page.tsx"])
    expect(progress.tests_seen).toEqual(["npm test"])
  })

  test("marks stopped sessions with completion evidence as likely completed", () => {
    const progress = deterministicProgress(
      task({ tmux_session_name: "memo-00000000" }),
      evidence({
        tmux_alive: false,
        session_health: "stopped",
        done_evidence: ["Stop hook detected", "tests passed"],
        tests_seen: ["npm test"],
      }),
    )

    expect(progress.state).toBe("likely_completed")
    expect(progress.confidence).toBeGreaterThanOrEqual(0.85)
    expect(progress.can_mark_completed).toBe(true)
  })

  test("treats permission or question evidence as review needed", () => {
    const progress = deterministicProgress(
      task(),
      evidence({
        blocked_reason: "Permission approval is required.",
        has_permission_denied: true,
        remaining_work: ["approval required"],
      }),
    )

    expect(progress.state).toBe("needs_review")
    expect(progress.can_mark_completed).toBe(false)
    expect(progress.blocked_reason).toContain("Permission")
  })

  test("detects lost running sessions after restart", () => {
    const progress = deterministicProgress(
      task(),
      evidence({
        tmux_alive: false,
        transcript_path: null,
        session_health: "lost_after_restart",
        blocked_reason: "process lost after restart",
      }),
    )

    expect(progress.state).toBe("blocked")
    expect(progress.session_health).toBe("lost_after_restart")
  })
})
