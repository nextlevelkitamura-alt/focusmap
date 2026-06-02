import { describe, expect, test } from "vitest"
import {
  keepOnlyExistingMindmapLinks,
  removeManualMappedColumn,
  removeMindmapLinksForTaskIds,
  shouldPreserveMemoColumn,
} from "./mindmap-memo-links"

describe("mindmap memo link helpers", () => {
  test("removes only links whose task no longer exists", () => {
    const result = keepOnlyExistingMindmapLinks({
      manual_column: "mapped",
      mindmap_links: [
        { task_id: "task-1", task_title: "keep" },
        { task_id: "task-missing", task_title: "remove" },
        { task_title: "invalid" },
      ],
    }, new Set(["task-1"]))

    expect(result.remainingLinks.map(link => link.task_id)).toEqual(["task-1"])
    expect(result.removedLinks).toHaveLength(2)
    expect(result.payload.mindmap_links).toEqual([{ task_id: "task-1", task_title: "keep" }])
  })

  test("removes links for deleted map nodes", () => {
    const result = removeMindmapLinksForTaskIds({
      mindmap_links: [
        { task_id: "deleted" },
        { task_id: "other" },
      ],
    }, new Set(["deleted"]))

    expect(result.remainingLinks.map(link => link.task_id)).toEqual(["other"])
    expect(result.removedLinks.map(link => link.task_id)).toEqual(["deleted"])
  })

  test("clears only mapped manual column metadata", () => {
    expect(removeManualMappedColumn({
      manual_column: "mapped",
      manual_column_assigned_at: "2026-06-02T00:00:00.000Z",
      mindmap_links: [],
    })).toEqual({ mindmap_links: [] })

    expect(removeManualMappedColumn({ manual_column: "today" })).toEqual({ manual_column: "today" })
  })

  test("preserves today, scheduled, and completed memo columns", () => {
    expect(shouldPreserveMemoColumn({ is_today: true })).toBe(true)
    expect(shouldPreserveMemoColumn({ memo_status: "scheduled" })).toBe(true)
    expect(shouldPreserveMemoColumn({ is_completed: true })).toBe(true)
    expect(shouldPreserveMemoColumn({ memo_status: "organized" })).toBe(false)
  })
})
