import { describe, expect, test } from "vitest"
import { hydrateTaskProgressMindMapSources } from "./task-progress-source"
import type { AiTask } from "@/types/ai-task"
import type { TaskProgressSnapshotTask } from "@/types/task-progress"

function progressTask(overrides: Partial<TaskProgressSnapshotTask> = {}): TaskProgressSnapshotTask {
  return {
    id: "ai-task-1",
    title: "Codexタスク",
    status: "awaiting_approval",
    executor: "codex_app",
    codex_thread_id: null,
    current_step: "確認待ち",
    progress_percent: null,
    summary: null,
    updated_at: "2026-06-10T00:00:00.000Z",
    ...overrides,
  }
}

function aiTask(overrides: Partial<AiTask> = {}): AiTask {
  return {
    id: "ai-task-1",
    user_id: "user-1",
    space_id: "space-1",
    package_id: null,
    package_version_id: null,
    claimed_runner_id: null,
    claim_expires_at: null,
    run_visibility: "private",
    package_snapshot: null,
    prompt: "実行して",
    status: "completed",
    executor: "codex_app",
    approval_type: "confirm",
    result: null,
    error: null,
    parent_task_id: null,
    created_at: "2026-06-10T00:00:00.000Z",
    started_at: null,
    completed_at: null,
    scheduled_at: null,
    recurrence_cron: null,
    cwd: null,
    skill_id: null,
    source_task_id: "node-1",
    source_note_id: null,
    source_ideal_goal_id: null,
    remote_session_url: null,
    tmux_session_name: null,
    codex_thread_id: null,
    ...overrides,
  }
}

describe("hydrateTaskProgressMindMapSources", () => {
  test("snapshotにsource_idが無いCodex taskを現在のai_tasks紐付けから補完する", () => {
    const hydrated = hydrateTaskProgressMindMapSources(
      [progressTask()],
      new Map([["node-1", aiTask()]]),
    )

    expect(hydrated[0]).toMatchObject({
      id: "ai-task-1",
      source_type: "mindmap",
      source_id: "node-1",
    })
  })

  test("既にsource_idがあるsnapshotは上書きしない", () => {
    const original = progressTask({ source_type: "mindmap", source_id: "node-existing" })
    const hydrated = hydrateTaskProgressMindMapSources(
      [original],
      new Map([["node-1", aiTask()]]),
    )

    expect(hydrated[0]).toBe(original)
  })

  test("最新ai_tasksが確認待ちなら古いrunning snapshotを確認待ちへ補正する", () => {
    const hydrated = hydrateTaskProgressMindMapSources(
      [progressTask({
        status: "running",
        source_type: "mindmap",
        source_id: "node-1",
      })],
      new Map([[
        "node-1",
        aiTask({
          status: "awaiting_approval",
          result: { codex_run_state: "awaiting_approval" },
        }),
      ]]),
    )

    expect(hydrated[0]).toMatchObject({
      status: "awaiting_approval",
      source_type: "mindmap",
      source_id: "node-1",
    })
  })

  test("最新ai_tasksがneeds_inputなら確認待ちレーン用にneeds_inputを保つ", () => {
    const hydrated = hydrateTaskProgressMindMapSources(
      [progressTask({
        status: "running",
        source_type: "mindmap",
        source_id: "node-1",
      })],
      new Map([[
        "node-1",
        aiTask({
          status: "needs_input",
          result: { codex_run_state: "awaiting_approval" },
        }),
      ]]),
    )

    expect(hydrated[0]?.status).toBe("needs_input")
  })
})
