import { NextResponse } from 'next/server'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

// macOS のネイティブフォルダ選択ダイアログを開き、選ばれた絶対パスを返す。
//   - サーバ＝Mac（localhost / Mac上のNext）でのみ機能する。
//   - ブラウザは仕様上ローカル絶対パスを取得できないため、サーバ側 osascript で実現する。
//   - 本番(別ホスト)では osascript が無く失敗 → UI は手入力/履歴にフォールバック。
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const script = [
      'tell application "System Events" to activate',
      'POSIX path of (choose folder with prompt "Codex の作業ディレクトリを選択")',
    ].join('\n')
    const { stdout } = await execFileAsync('osascript', ['-e', script], { timeout: 120_000 })
    const path = stdout.trim().replace(/\/+$/, '')
    if (!path) return NextResponse.json({ error: 'canceled' }, { status: 400 })
    return NextResponse.json({ path })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // ユーザーがキャンセルすると osascript は exit code 1 (User canceled / -128)
    if (msg.includes('User canceled') || msg.includes('-128') || msg.includes('canceled')) {
      return NextResponse.json({ error: 'canceled' }, { status: 400 })
    }
    return NextResponse.json(
      { error: `Finder を起動できませんでした（このMac上で動くサーバでのみ利用可）: ${msg}` },
      { status: 500 },
    )
  }
}
