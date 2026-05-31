import { describe, expect, test } from "vitest"
import { getSelectableMindmapNotes } from "./mobile-ai-map-view"
import type { Project } from "@/types/database"
import type { Note } from "@/types/note"

const projects = [
  { id: "project-work", space_id: "space-work" },
  { id: "project-life", space_id: "space-life" },
] as Project[]

function note(overrides: Partial<Note>): Note {
  return {
    id: "note-1",
    user_id: "user-1",
    project_id: null,
    task_id: null,
    content: "memo",
    raw_input: null,
    input_type: "text",
    status: "pending",
    ai_analysis: null,
    image_urls: null,
    created_at: "2026-05-31T00:00:00.000Z",
    updated_at: "2026-05-31T00:00:00.000Z",
    ...overrides,
  }
}

describe("getSelectableMindmapNotes", () => {
  test("選択中プロジェクトの未整理かつ未リンクのメモだけを返す", () => {
    const result = getSelectableMindmapNotes({
      notes: [
        note({ id: "eligible", project_id: "project-work" }),
        note({ id: "processed", project_id: "project-work", status: "processed" }),
        note({ id: "linked", project_id: "project-work", task_id: "task-1" }),
        note({ id: "other-project", project_id: "project-life" }),
        note({ id: "unassigned", project_id: null }),
      ],
      projects,
      selectedProjectId: "project-work",
      selectedSpaceId: "space-work",
    })

    expect(result.map(item => item.id)).toEqual(["eligible"])
  })

  test("プロジェクト未選択でスペースだけ選択されている場合は、そのスペースのプロジェクトに属するメモだけを返す", () => {
    const result = getSelectableMindmapNotes({
      notes: [
        note({ id: "work", project_id: "project-work" }),
        note({ id: "life", project_id: "project-life" }),
        note({ id: "unassigned", project_id: null }),
      ],
      projects,
      selectedProjectId: null,
      selectedSpaceId: "space-work",
    })

    expect(result.map(item => item.id)).toEqual(["work"])
  })
})
