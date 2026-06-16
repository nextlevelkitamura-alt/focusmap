import { describe, expect, test } from "vitest"
import { missingTaskProgressSourceIds } from "./task-progress-source-refresh"

const NOW = Date.parse("2026-06-17T00:00:00.000Z")

describe("missingTaskProgressSourceIds", () => {
  test("running snapshotのsource taskがstateに無ければ再取得対象にする", () => {
    expect(missingTaskProgressSourceIds({
      nowMs: NOW,
      snapshots: [{
        status: "running",
        source_type: "mindmap",
        source_id: "task-1",
        updated_at: "2026-06-16T23:59:59.000Z",
      }],
      tasks: [],
    })).toEqual(["task-1"])
  })

  test("既にtask stateにあるsource taskは再取得対象にしない", () => {
    expect(missingTaskProgressSourceIds({
      nowMs: NOW,
      snapshots: [{
        status: "running",
        source_type: "mindmap",
        source_id: "task-1",
        updated_at: "2026-06-16T23:59:59.000Z",
      }],
      tasks: [{ id: "task-1", deleted_at: null }],
    })).toEqual([])
  })

  test("最近の確認待ちsnapshotはRealtime取りこぼし補完対象にする", () => {
    expect(missingTaskProgressSourceIds({
      nowMs: NOW,
      snapshots: [{
        status: "awaiting_approval",
        source_type: "mindmap",
        source_id: "task-1",
        updated_at: "2026-06-16T23:59:10.000Z",
      }],
      tasks: [],
    })).toEqual(["task-1"])
  })

  test("古い確認待ちsnapshotはSupabaseの短周期再取得を起こさない", () => {
    expect(missingTaskProgressSourceIds({
      nowMs: NOW,
      snapshots: [{
        status: "awaiting_approval",
        source_type: "mindmap",
        source_id: "task-1",
        updated_at: "2026-06-16T23:30:00.000Z",
      }],
      tasks: [],
    })).toEqual([])
  })

  test("mindmap以外のsnapshotは対象外にする", () => {
    expect(missingTaskProgressSourceIds({
      nowMs: NOW,
      snapshots: [{
        status: "running",
        source_type: "note",
        source_id: "note-1",
        updated_at: "2026-06-16T23:59:59.000Z",
      }],
      tasks: [],
    })).toEqual([])
  })
})
