import { describe, expect, test } from "vitest"
import { boundedTaskProgressJson, sanitizeTaskProgressJson } from "./task-progress-payload"

describe("task progress payload sanitizer", () => {
  test("drops raw logs, full thread snapshots, and image bodies recursively", () => {
    const sanitized = sanitizeTaskProgressJson({
      executor: "codex_app",
      live_log: "raw log must not be stored",
      output: "raw output must not be stored",
      nested: {
        keep: "compact metadata",
        raw_output: "nested output must not be stored",
        codex_thread_snapshot: { entries: ["full history"] },
      },
      images: [
        { image_body: "base64 image body must not be stored", label: "thumbnail metadata" },
      ],
    }) as Record<string, unknown>

    const serialized = JSON.stringify(sanitized)
    expect(serialized).not.toContain("raw log must not be stored")
    expect(serialized).not.toContain("raw output must not be stored")
    expect(serialized).not.toContain("full history")
    expect(serialized).not.toContain("base64 image body must not be stored")
    expect(sanitized.executor).toBe("codex_app")
    expect((sanitized.nested as Record<string, unknown>).keep).toBe("compact metadata")
    expect(((sanitized.images as Array<Record<string, unknown>>)[0]).label).toBe("thumbnail metadata")
  })

  test("rejects oversized compact metadata payloads", () => {
    const payload = Object.fromEntries(
      Array.from({ length: 40 }, (_, index) => [`key_${index}`, "x".repeat(600)]),
    )

    expect(() => boundedTaskProgressJson(payload)).toThrow("json payload must be 6000 chars or less")
  })
})
