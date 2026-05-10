import { NextResponse } from "next/server"
import { spawn } from "node:child_process"

export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Only available locally" }, { status: 403 })
  }

  spawn("open", ["x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"], {
    detached: true,
    stdio: "ignore",
  }).unref()

  return NextResponse.json({ ok: true })
}
