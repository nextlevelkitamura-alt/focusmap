import { beforeEach, describe, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  stat: vi.fn(),
  realpath: vi.fn(),
  execFile: vi.fn(),
}))

vi.mock("node:fs/promises", () => ({
  default: {
    stat: mocks.stat,
    realpath: mocks.realpath,
  },
  stat: mocks.stat,
  realpath: mocks.realpath,
}))

vi.mock("node:child_process", () => ({
  default: {
    execFile: mocks.execFile,
  },
  execFile: mocks.execFile,
}))

import { resolveProjectRepoPath } from "./project-repo-path"

function supabaseWithAvailableRepo(data: { absolute_path?: string } | null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data, error: null })
  const limit = vi.fn(() => ({ maybeSingle }))
  const eq2 = vi.fn(() => ({ limit }))
  const eq1 = vi.fn(() => ({ eq: eq2 }))
  const select = vi.fn(() => ({ eq: eq1 }))
  return {
    client: {
      from: vi.fn(() => ({ select })),
    },
    maybeSingle,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.stat.mockResolvedValue({ isDirectory: () => true })
  mocks.realpath.mockImplementation(async (value: string) => value)
  mocks.execFile.mockImplementation((_cmd, _args, _options, callback) => {
    callback(null, "/Users/me/project\n", "")
  })
})

describe("resolveProjectRepoPath", () => {
  test("keeps scanned repo paths from available_repos", async () => {
    const { client } = supabaseWithAvailableRepo({ absolute_path: "/Users/me/scanned" })

    await expect(resolveProjectRepoPath(client, "user-1", "/Users/me/scanned")).resolves.toEqual({
      repoPath: "/Users/me/scanned",
    })
    expect(mocks.stat).not.toHaveBeenCalled()
  })

  test("accepts a local git folder even when it has not been scanned yet", async () => {
    const { client } = supabaseWithAvailableRepo(null)

    await expect(resolveProjectRepoPath(client, "user-1", "/Users/me/project/")).resolves.toEqual({
      repoPath: "/Users/me/project",
    })
    expect(mocks.execFile).toHaveBeenCalledWith(
      "git",
      ["-C", "/Users/me/project", "rev-parse", "--show-toplevel"],
      { timeout: 5_000 },
      expect.any(Function),
    )
  })

  test("normalizes a selected subfolder to the git repository root", async () => {
    const { client } = supabaseWithAvailableRepo(null)
    mocks.realpath.mockImplementation(async (value: string) => value)
    mocks.execFile.mockImplementation((_cmd, _args, _options, callback) => {
      callback(null, "/Users/me/project\n", "")
    })

    await expect(resolveProjectRepoPath(client, "user-1", "/Users/me/project/src")).resolves.toEqual({
      repoPath: "/Users/me/project",
    })
  })

  test("rejects a folder that is not a git repository", async () => {
    const { client } = supabaseWithAvailableRepo(null)
    mocks.execFile.mockImplementation((_cmd, _args, _options, callback) => {
      callback(new Error("not a git repo"), "", "")
    })

    await expect(resolveProjectRepoPath(client, "user-1", "/Users/me/plain-folder")).resolves.toEqual({
      error: "repo_path must be a git repository folder",
    })
  })
})
