import { describe, expect, test } from "vitest"
import { CODEX_SOURCE_TASK_ARCHIVE_GRACE_MS, isPendingCodexArchiveRequest } from "./codex-source-completion"

describe("isPendingCodexArchiveRequest", () => {
  test("uses a one minute grace before a node check archives Codex", () => {
    expect(CODEX_SOURCE_TASK_ARCHIVE_GRACE_MS).toBe(60_000)
  })

  test("requires an uncancelled pending archive request for a completed source task", () => {
    expect(isPendingCodexArchiveRequest({
      codex_source_task_completed: true,
      codex_archive_request_state: "pending",
      codex_archive_requested_at: "2026-06-10T00:00:00.000Z",
    })).toBe(true)

    expect(isPendingCodexArchiveRequest({
      codex_source_task_completed: true,
      codex_archive_request_state: "waiting_for_grace",
      codex_archive_requested_at: "2026-06-10T00:00:00.000Z",
    })).toBe(false)

    expect(isPendingCodexArchiveRequest({
      codex_source_task_completed: true,
      codex_archive_request_state: "pending",
      codex_archive_requested_at: "2026-06-10T00:00:00.000Z",
      codex_archive_request_cancelled_at: "2026-06-10T00:00:03.000Z",
    })).toBe(false)

    expect(isPendingCodexArchiveRequest({
      codex_archive_request_state: "pending",
      codex_archive_requested_at: "2026-06-10T00:00:00.000Z",
    })).toBe(false)
  })
})
