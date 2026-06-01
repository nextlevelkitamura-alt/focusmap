import { execFile, spawn } from "child_process"
import fs from "fs"
import os from "os"
import path from "path"
import { promisify } from "util"
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"

export const runtime = "nodejs"

const execFileAsync = promisify(execFile)
const CODEX_BUNDLE_ID = "com.openai.codex"

type OpenCodexBody = {
  repo_path?: unknown
  prompt?: unknown
  codex_url?: unknown
  origin_url?: unknown
}

async function activateCodexApp(): Promise<boolean> {
  try {
    await execFileAsync("/usr/bin/osascript", [
      "-e",
      "tell application id \"com.openai.codex\" to reopen",
      "-e",
      "tell application id \"com.openai.codex\" to activate",
    ], {
      timeout: 5_000,
      windowsHide: true,
    })
    return true
  } catch (err) {
    console.warn("[codex/open-repo] Codex.app activation failed:", err instanceof Error ? err.message : err)
    return false
  }
}

function canOpenLocalApp(req: NextRequest): boolean {
  if (process.env.FOCUSMAP_ENABLE_LOCAL_CODEX_APP_OPEN === "true") return true
  return ["localhost", "127.0.0.1", "::1"].includes(req.nextUrl.hostname)
}

function expandHome(input: string): string {
  if (input === "~") return os.homedir()
  if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2))
  return input
}

async function isScannedRepo(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  candidates: string[],
): Promise<boolean> {
  const uniqueCandidates = Array.from(new Set(candidates.filter(Boolean)))
  if (uniqueCandidates.length === 0) return false

  const { data: availableRepo } = await supabase
    .from("available_repos")
    .select("id")
    .eq("user_id", userId)
    .in("absolute_path", uniqueCandidates)
    .limit(1)
    .maybeSingle()

  return !!availableRepo
}

async function resolveGitRoot(repoPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("/usr/bin/git", ["-C", repoPath, "rev-parse", "--show-toplevel"], {
      timeout: 5_000,
      windowsHide: true,
    })
    return fs.realpathSync(stdout.trim())
  } catch {
    return null
  }
}

function buildCodexChatUrl(prompt: string, repoPath: string | null, originUrl: string | null): string {
  const url = new URL("codex://")
  const normalizedPrompt = prompt.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").trim()
  if (normalizedPrompt) url.searchParams.set("prompt", normalizedPrompt)
  if (repoPath) url.searchParams.set("path", repoPath)
  if (originUrl?.trim()) url.searchParams.set("originUrl", originUrl.trim())
  return url.toString()
}

function copyToMacClipboard(text: string): Promise<boolean> {
  if (!text.trim()) return Promise.resolve(false)

  return new Promise((resolve) => {
    let settled = false
    let timeout: ReturnType<typeof setTimeout> | null = null
    const finish = (copied: boolean) => {
      if (settled) return
      settled = true
      if (timeout) clearTimeout(timeout)
      resolve(copied)
    }
    const child = spawn("/usr/bin/pbcopy", [], {
      stdio: ["pipe", "ignore", "ignore"],
    })
    timeout = setTimeout(() => {
      child.kill()
      finish(false)
    }, 3_000)

    child.on("error", () => finish(false))
    child.on("close", code => finish(code === 0))
    child.stdin.end(text)
  })
}

function resolveCodexUrl(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    const url = new URL(trimmed)
    return url.protocol === "codex:" ? trimmed : null
  } catch {
    return null
  }
}

export async function POST(req: NextRequest) {
  if (!canOpenLocalApp(req)) {
    return NextResponse.json(
      { error: "Codex.app の起動はローカル環境からのみ利用できます" },
      { status: 403 },
    )
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  if (process.platform !== "darwin") {
    return NextResponse.json(
      { error: "Codex.app のリポジトリ起動は macOS でのみ利用できます" },
      { status: 400 },
    )
  }

  const body = await req.json().catch(() => ({})) as OpenCodexBody
  const codexUrl = resolveCodexUrl(body.codex_url)
  if (typeof body.codex_url === "string" && body.codex_url.trim() && !codexUrl) {
    return NextResponse.json({ error: "codex_url must use the codex:// scheme" }, { status: 400 })
  }

  const rawRepoPath = typeof body.repo_path === "string" ? body.repo_path.trim() : ""
  let resolvedRepoPath: string | null = null
  let gitRoot: string | null = null

  if (rawRepoPath) {
    const expandedRepoPath = expandHome(rawRepoPath)
    if (!path.isAbsolute(expandedRepoPath)) {
      return NextResponse.json({ error: "repo_path must be an absolute path" }, { status: 400 })
    }

    try {
      resolvedRepoPath = fs.realpathSync(expandedRepoPath)
    } catch {
      return NextResponse.json({ error: "repo_path does not exist" }, { status: 400 })
    }

    const stat = fs.statSync(resolvedRepoPath)
    if (!stat.isDirectory()) {
      return NextResponse.json({ error: "repo_path must be a directory" }, { status: 400 })
    }

    gitRoot = await resolveGitRoot(resolvedRepoPath)
    if (!gitRoot) {
      return NextResponse.json({ error: "repo_path must be a git repository" }, { status: 400 })
    }
    if (gitRoot !== resolvedRepoPath) {
      return NextResponse.json(
        { error: "repo_path must point to the git repository root", git_root: gitRoot },
        { status: 400 },
      )
    }

    const registered = await isScannedRepo(supabase, user.id, [
      rawRepoPath,
      expandedRepoPath,
      path.resolve(expandedRepoPath),
      resolvedRepoPath,
    ])
    if (!registered) {
      return NextResponse.json(
        { error: "Focusmap に登録済みのリポジトリだけ Codex.app で開けます" },
        { status: 403 },
      )
    }
  }

  const prompt = typeof body.prompt === "string" ? body.prompt : ""
  let copiedToClipboard = false

  try {
    const originUrl = typeof body.origin_url === "string" ? body.origin_url : null
    copiedToClipboard = await copyToMacClipboard(prompt)
    if (codexUrl) {
      await execFileAsync("/usr/bin/open", [codexUrl], {
        timeout: 10_000,
        windowsHide: true,
      })
    } else if (prompt.trim() || resolvedRepoPath) {
      await execFileAsync("/usr/bin/open", [buildCodexChatUrl(prompt, resolvedRepoPath, originUrl)], {
        timeout: 10_000,
        windowsHide: true,
      })
    } else {
      await execFileAsync("/usr/bin/open", ["-b", CODEX_BUNDLE_ID], {
        timeout: 10_000,
        windowsHide: true,
      })
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Codex.app の起動に失敗しました" },
      { status: 500 },
    )
  }

  const activated = await activateCodexApp()

  return NextResponse.json({
    ok: true,
    repo_path: resolvedRepoPath,
    git_root: gitRoot,
    activated,
    copied_to_clipboard: copiedToClipboard,
    command: codexUrl
      ? "open codex:// url"
      : typeof body.prompt === "string" && body.prompt.trim()
        ? "open codex:// chat"
        : "open Codex.app",
  })
}
