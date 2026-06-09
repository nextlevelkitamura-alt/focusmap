import { execFile, spawn } from "child_process"
import fs from "fs"
import os from "os"
import path from "path"
import { randomUUID } from "crypto"
import { promisify } from "util"
import { NextRequest, NextResponse } from "next/server"
import { isLocalCodexOpenRequestHost } from "@/lib/codex-app-launch"
import { createClient } from "@/utils/supabase/server"

export const runtime = "nodejs"

const execFileAsync = promisify(execFile)
const CODEX_BUNDLE_ID = "com.openai.codex"

type OpenCodexBody = {
  repo_path?: unknown
  prompt?: unknown
  codex_url?: unknown
  origin_url?: unknown
  open_app?: unknown
  clipboard_image_url?: unknown
}

type ClipboardImageFile = {
  path: string
  pasteboardType: string
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
  return isLocalCodexOpenRequestHost({
    nextHostname: req.nextUrl.hostname,
    host: req.headers.get("host"),
    forwardedHost: req.headers.get("x-forwarded-host"),
  })
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

function buildCodexChatUrl(repoPath: string | null, originUrl: string | null): string {
  const url = new URL("codex://")
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
      env: {
        ...process.env,
        LANG: "en_US.UTF-8",
        LC_ALL: "en_US.UTF-8",
        LC_CTYPE: "UTF-8",
      },
    })
    timeout = setTimeout(() => {
      child.kill()
      finish(false)
    }, 3_000)

    child.on("error", () => finish(false))
    child.on("close", code => finish(code === 0))
    child.stdin.end(text, "utf8")
  })
}

async function readMacClipboardText(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("/usr/bin/pbpaste", [], {
      timeout: 3_000,
      windowsHide: true,
      env: {
        ...process.env,
        LANG: "en_US.UTF-8",
        LC_ALL: "en_US.UTF-8",
        LC_CTYPE: "UTF-8",
      },
    })
    return stdout
  } catch {
    return null
  }
}

async function macClipboardHasImage(): Promise<boolean> {
  const script = `
use framework "AppKit"
on run
  set imageTypes to {"public.png", "public.jpeg", "com.compuserve.gif", "public.tiff", "public.heic"}
  set pasteboard to current application's NSPasteboard's generalPasteboard()
  set pasteboardTypes to pasteboard's types()
  repeat with imageType in imageTypes
    if pasteboardTypes's containsObject:imageType then return "true"
  end repeat
  return "false"
end run
`
  try {
    const { stdout } = await execFileAsync("/usr/bin/osascript", ["-l", "AppleScript", "-e", script], {
      timeout: 3_000,
      windowsHide: true,
    })
    return stdout.trim() === "true"
  } catch {
    return false
  }
}

function pasteboardTypeForImageMime(type: string | null | undefined) {
  const normalized = type?.split(";")[0]?.trim().toLowerCase()
  if (normalized === "image/jpeg" || normalized === "image/jpg") return "public.jpeg"
  if (normalized === "image/gif") return "com.compuserve.gif"
  if (normalized === "image/tiff") return "public.tiff"
  return "public.png"
}

function imageExtensionForPasteboardType(type: string) {
  if (type === "public.jpeg") return "jpg"
  if (type === "com.compuserve.gif") return "gif"
  if (type === "public.tiff") return "tiff"
  return "png"
}

async function loadClipboardImageFile(value: unknown): Promise<ClipboardImageFile | null> {
  if (typeof value !== "string") return null
  const rawValue = value.trim()
  if (!rawValue) return null

  let buffer: Buffer | null = null
  let pasteboardType = "public.png"

  if (rawValue.startsWith("data:image/")) {
    const match = rawValue.match(/^data:([^;,]+)(?:;base64)?,([\s\S]*)$/)
    if (!match) return null
    pasteboardType = pasteboardTypeForImageMime(match[1])
    buffer = Buffer.from(match[2], "base64")
  } else {
    let url: URL
    try {
      url = new URL(rawValue)
    } catch {
      return null
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    const res = await fetch(url, { cache: "no-store" })
    if (!res.ok) return null
    const contentType = res.headers.get("content-type")
    if (!contentType?.toLowerCase().startsWith("image/")) return null
    const arrayBuffer = await res.arrayBuffer()
    buffer = Buffer.from(arrayBuffer)
    pasteboardType = pasteboardTypeForImageMime(contentType)
  }

  if (!buffer || buffer.length === 0 || buffer.length > 12 * 1024 * 1024) return null
  const filePath = path.join(os.tmpdir(), `focusmap-codex-clipboard-${randomUUID()}.${imageExtensionForPasteboardType(pasteboardType)}`)
  await fs.promises.writeFile(filePath, buffer)
  return { path: filePath, pasteboardType }
}

async function copyToMacClipboardWithImage(text: string, imageFile: ClipboardImageFile): Promise<boolean> {
  const script = `
use framework "AppKit"
use framework "Foundation"

on run argv
  set theText to item 1 of argv
  set imagePath to item 2 of argv
  set imagePasteboardType to item 3 of argv
  set pasteboardItem to current application's NSPasteboardItem's alloc()'s init()
  pasteboardItem's setString:theText forType:(current application's NSPasteboardTypeString)
  set imageData to current application's NSData's dataWithContentsOfFile:imagePath
  if imageData is not missing value then
    pasteboardItem's setData:imageData forType:imagePasteboardType
  end if
  set pasteboard to current application's NSPasteboard's generalPasteboard()
  pasteboard's clearContents()
  pasteboard's writeObjects:{pasteboardItem}
end run
`
  try {
    await execFileAsync("/usr/bin/osascript", ["-l", "AppleScript", "-e", script, text, imageFile.path, imageFile.pasteboardType], {
      timeout: 5_000,
      windowsHide: true,
    })
    return true
  } catch (err) {
    console.warn("[codex/open-repo] Pasteboard image copy failed:", err instanceof Error ? err.message : err)
    return false
  }
}

async function copyImageToMacClipboard(imageFile: ClipboardImageFile): Promise<boolean> {
  const script = `
use framework "AppKit"
use framework "Foundation"

on run argv
  set imagePath to item 1 of argv
  set imagePasteboardType to item 2 of argv
  set pasteboardItem to current application's NSPasteboardItem's alloc()'s init()
  set imageData to current application's NSData's dataWithContentsOfFile:imagePath
  if imageData is missing value then return
  pasteboardItem's setData:imageData forType:imagePasteboardType
  set pasteboard to current application's NSPasteboard's generalPasteboard()
  pasteboard's clearContents()
  pasteboard's writeObjects:{pasteboardItem}
end run
`
  try {
    await execFileAsync("/usr/bin/osascript", ["-l", "AppleScript", "-e", script, imageFile.path, imageFile.pasteboardType], {
      timeout: 5_000,
      windowsHide: true,
    })
    return true
  } catch (err) {
    console.warn("[codex/open-repo] Pasteboard image-only copy failed:", err instanceof Error ? err.message : err)
    return false
  }
}

async function copyCodexHandoffToMacClipboard(text: string, clipboardImageUrl: unknown) {
  const normalizedText = text.trim()
  const imageFile = await loadClipboardImageFile(clipboardImageUrl).catch(() => null)
  if (!normalizedText && !imageFile) {
    return { copiedToClipboard: false, copiedImageToClipboard: false }
  }

  if (!normalizedText && imageFile) {
    try {
      const copied = await copyImageToMacClipboard(imageFile)
      return {
        copiedToClipboard: false,
        copiedImageToClipboard: copied ? await macClipboardHasImage() : false,
      }
    } finally {
      await fs.promises.unlink(imageFile.path).catch(() => undefined)
    }
  }

  if (!imageFile) {
    return {
      copiedToClipboard: await copyToMacClipboard(text),
      copiedImageToClipboard: false,
    }
  }

  try {
    const copied = await copyToMacClipboardWithImage(text, imageFile)
    if (copied) {
      const copiedText = (await readMacClipboardText()) === text
      return {
        copiedToClipboard: copiedText,
        copiedImageToClipboard: await macClipboardHasImage(),
      }
    }
    return {
      copiedToClipboard: await copyToMacClipboard(text),
      copiedImageToClipboard: false,
    }
  } finally {
    await fs.promises.unlink(imageFile.path).catch(() => undefined)
  }
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
  const shouldOpenApp = body.open_app !== false
  let copiedToClipboard = false
  let copiedImageToClipboard = false

  try {
    const originUrl = typeof body.origin_url === "string" ? body.origin_url : null
    const copyResult = await copyCodexHandoffToMacClipboard(prompt, body.clipboard_image_url)
    copiedToClipboard = copyResult.copiedToClipboard
    copiedImageToClipboard = copyResult.copiedImageToClipboard
    if (prompt.trim() && !copiedToClipboard) {
      return NextResponse.json(
        { error: "プロンプトをクリップボードにコピーできませんでした" },
        { status: 500 },
      )
    }
    if (!shouldOpenApp) {
      return NextResponse.json({
        ok: true,
        repo_path: resolvedRepoPath,
        git_root: gitRoot,
        activated: false,
        copied_to_clipboard: copiedToClipboard,
        copied_image_to_clipboard: copiedImageToClipboard,
        command: "copy prompt",
      })
    }
    if (codexUrl) {
      await execFileAsync("/usr/bin/open", [codexUrl], {
        timeout: 10_000,
        windowsHide: true,
      })
    } else if (prompt.trim() || resolvedRepoPath) {
      await execFileAsync("/usr/bin/open", [buildCodexChatUrl(resolvedRepoPath, originUrl)], {
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
    copied_image_to_clipboard: copiedImageToClipboard,
    command: codexUrl
      ? "open codex:// url"
      : typeof body.prompt === "string" && body.prompt.trim()
        ? "open codex:// chat"
        : "open Codex.app",
  })
}
