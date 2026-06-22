import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createRequire } from "node:module"
import { describe, expect, test } from "vitest"

const require = createRequire(import.meta.url)
const { codexRepoListSql } = require("./codex-repos.cjs") as {
  codexRepoListSql: () => string
}

function sqlite(dbPath: string, sql: string) {
  return execFileSync("/usr/bin/sqlite3", [dbPath, sql], { encoding: "utf8" })
}

describe("codexRepoListSql", () => {
  test("counts only non-archived threads and hides archived-only repos", () => {
    const dir = mkdtempSync(join(tmpdir(), "focusmap-codex-repos-"))
    const dbPath = join(dir, "state_5.sqlite")

    try {
      sqlite(dbPath, `
        CREATE TABLE threads (
          id TEXT PRIMARY KEY,
          cwd TEXT,
          archived INTEGER NOT NULL DEFAULT 0,
          thread_source TEXT,
          updated_at_ms INTEGER
        );
        INSERT INTO threads (id, cwd, archived, thread_source, updated_at_ms) VALUES
          ('side-active', '/repo/side-business', 0, 'user', 2000),
          ('side-archived-newer', '/repo/side-business', 1, 'user', 9000),
          ('work-active-newer', '/repo/work', 0, 'user', 5000),
          ('archived-only', '/repo/archived-only', 1, 'user', 7000),
          ('legacy-non-user', '/repo/playnote', 0, '', 7000),
          ('blank-cwd', '', 0, 'user', 8000),
          ('null-cwd', NULL, 0, 'user', 8000);
      `)

      const stdout = execFileSync("/usr/bin/sqlite3", ["-json", dbPath, codexRepoListSql()], {
        encoding: "utf8",
      })
      const rows = JSON.parse(stdout || "[]") as Array<{
        absolute_path: string
        thread_count: number
        total_thread_count: number
        updated_at_ms: number
      }>

      expect(rows.map(row => row.absolute_path)).toEqual(["/repo/work", "/repo/side-business"])
      expect(rows.find(row => row.absolute_path === "/repo/side-business")).toMatchObject({
        thread_count: 1,
        total_thread_count: 2,
        updated_at_ms: 2000,
      })
      expect(rows.some(row => row.absolute_path === "/repo/playnote")).toBe(false)
      expect(rows.some(row => row.absolute_path === "/repo/archived-only")).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
