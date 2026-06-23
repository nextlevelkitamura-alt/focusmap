import { describe, expect, test } from "vitest"
import { aiHistoryRepoMatchesFilter } from "./ai-history-display"

describe("aiHistoryRepoMatchesFilter", () => {
  test("matches all repos when the filter is all", () => {
    expect(aiHistoryRepoMatchesFilter({
      repoPath: "/Users/me/focusmap",
      worktreePath: null,
    }, "all")).toBe(true)
  })

  test("matches by normalized repo path", () => {
    expect(aiHistoryRepoMatchesFilter({
      repoPath: "/Users/me/focusmap/",
      worktreePath: null,
    }, "/Users/me/focusmap")).toBe(true)
  })

  test("matches by worktree path when the selected Codex folder is a worktree", () => {
    expect(aiHistoryRepoMatchesFilter({
      repoPath: "/Users/me/focusmap",
      worktreePath: "/Users/me/focusmap-codex-reconcile-main",
    }, "/Users/me/focusmap-codex-reconcile-main")).toBe(true)
  })

  test("does not match unrelated repos", () => {
    expect(aiHistoryRepoMatchesFilter({
      repoPath: "/Users/me/focusmap",
      worktreePath: "/Users/me/focusmap-codex-reconcile-main",
    }, "/Users/me/side-business")).toBe(false)
  })
})
