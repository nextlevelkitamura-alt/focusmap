import { execFile } from "child_process"
import fs from "fs"
import os from "os"
import path from "path"
import { promisify } from "util"
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"

export const runtime = "nodejs"

const execFileAsync = promisify(execFile)

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

async function isRegisteredRepo(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  candidates: string[],
): Promise<boolean> {
  const uniqueCandidates = Array.from(new Set(candidates.filter(Boolean)))
  if (uniqueCandidates.length === 0) return false

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("user_id", userId)
    .in("repo_path", uniqueCandidates)
    .limit(1)
    .maybeSingle()
  if (project) return true

  const { data: availableRepo } = await supabase
    .from("available_repos")
    .select("id")
    .eq("user_id", userId)
    .in("absolute_path", uniqueCandidates)
    .limit(1)
    .maybeSingle()

  return !!availableRepo
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

  const body = await req.json().catch(() => ({})) as { repo_path?: unknown }
  if (typeof body.repo_path !== "string" || body.repo_path.trim().length === 0) {
    return NextResponse.json({ error: "repo_path is required" }, { status: 400 })
  }

  const rawRepoPath = body.repo_path.trim()
  const expandedRepoPath = expandHome(rawRepoPath)
  if (!path.isAbsolute(expandedRepoPath)) {
    return NextResponse.json({ error: "repo_path must be an absolute path" }, { status: 400 })
  }

  let resolvedRepoPath: string
  try {
    resolvedRepoPath = fs.realpathSync(expandedRepoPath)
  } catch {
    return NextResponse.json({ error: "repo_path does not exist" }, { status: 400 })
  }

  const stat = fs.statSync(resolvedRepoPath)
  if (!stat.isDirectory()) {
    return NextResponse.json({ error: "repo_path must be a directory" }, { status: 400 })
  }

  const registered = await isRegisteredRepo(supabase, user.id, [
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

  try {
    await execFileAsync("/usr/bin/open", ["-a", "Codex", resolvedRepoPath], {
      timeout: 10_000,
      windowsHide: true,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Codex.app の起動に失敗しました" },
      { status: 500 },
    )
  }

  const activated = await activateCodexApp()

  return NextResponse.json({ ok: true, repo_path: resolvedRepoPath, activated })
}
