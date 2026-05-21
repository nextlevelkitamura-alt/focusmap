/**
 * プロジェクトコンテキスト移行スクリプト（一度きり）
 *
 * 散在していたコンテキストを projects.description の1フィールドへ集約する:
 *   - ai_project_context（purpose / current_status / key_insights）
 *   - ai_context_documents（folder_type='project' フォルダ配下の3ドキュメント）
 *   - projects.purpose
 *
 * 連結結果が長い場合は Gemini Flash-Lite で1段落に要約する。
 * description が既に埋まっているプロジェクトはスキップ（冪等）。
 *
 * 実行:
 *   npx tsx scripts/migrate-project-context.ts            # 実行
 *   npx tsx scripts/migrate-project-context.ts --dry-run  # 確認のみ（書き込まない）
 */
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { createClient } from '@supabase/supabase-js'
import { generateText } from 'ai'
import { google } from '@ai-sdk/google'

// .env.local を読み込む（既存の process.env を上書きしない）
function loadEnvLocal() {
  let text: string
  try {
    text = readFileSync(resolve(process.cwd(), '.env.local'), 'utf-8')
  } catch {
    console.warn('.env.local が見つかりません。process.env を使用します。')
    return
  }
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    let val = m[2].trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (!process.env[m[1]]) process.env[m[1]] = val
  }
}
loadEnvLocal()

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が必要です。')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)
const DRY_RUN = process.argv.includes('--dry-run')
const SUMMARY_THRESHOLD = 600

async function summarize(text: string): Promise<string> {
  try {
    const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite'
    const { text: out } = await generateText({
      model: google(modelName),
      prompt:
        '次のプロジェクト説明を、重複を除き1段落（300字程度）に要約してください。' +
        '説明文のみを出力（前置き不要）:\n\n' +
        text,
    })
    return out.trim() || text.slice(0, SUMMARY_THRESHOLD)
  } catch (err) {
    console.warn('  要約に失敗。連結テキストをそのまま使用:', err)
    return text.slice(0, SUMMARY_THRESHOLD)
  }
}

async function main() {
  const { data: projects, error } = await supabase
    .from('projects')
    .select('id, title, purpose, description')
  if (error) {
    console.error('projects 取得失敗:', error.message)
    process.exit(1)
  }
  if (!projects || projects.length === 0) {
    console.log('プロジェクトがありません。')
    return
  }

  console.log(`${projects.length} プロジェクトを処理${DRY_RUN ? '（dry-run）' : ''}`)
  let migrated = 0
  let skipped = 0

  for (const p of projects) {
    if (p.description && String(p.description).trim()) {
      skipped++
      continue
    }

    const parts: string[] = []
    if (p.purpose && String(p.purpose).trim()) parts.push(String(p.purpose).trim())

    const { data: ctx } = await supabase
      .from('ai_project_context')
      .select('purpose, current_status, key_insights')
      .eq('project_id', p.id)
      .maybeSingle()
    if (ctx) {
      if (ctx.purpose?.trim()) parts.push(`目的: ${ctx.purpose.trim()}`)
      if (ctx.current_status?.trim()) parts.push(`現状: ${ctx.current_status.trim()}`)
      if (ctx.key_insights?.trim()) parts.push(`重要点: ${ctx.key_insights.trim()}`)
    }

    const { data: folder } = await supabase
      .from('ai_context_folders')
      .select('id')
      .eq('project_id', p.id)
      .eq('folder_type', 'project')
      .maybeSingle()
    if (folder) {
      const { data: docs } = await supabase
        .from('ai_context_documents')
        .select('title, content')
        .eq('folder_id', folder.id)
        .order('order_index', { ascending: true })
      for (const doc of docs || []) {
        if (doc.content?.trim()) parts.push(`${doc.title}: ${doc.content.trim()}`)
      }
    }

    const combined = parts.join('\n')
    if (!combined.trim()) {
      skipped++
      continue
    }

    const description =
      combined.length > SUMMARY_THRESHOLD ? await summarize(combined) : combined

    console.log(`\n[${p.title}]`)
    console.log(`  → ${description.replace(/\n/g, ' ').slice(0, 120)}...`)

    if (!DRY_RUN) {
      const { error: upErr } = await supabase
        .from('projects')
        .update({ description })
        .eq('id', p.id)
      if (upErr) {
        console.error(`  更新失敗: ${upErr.message}`)
        continue
      }
    }
    migrated++
  }

  console.log(
    `\n完了: 移行 ${migrated} / スキップ ${skipped}${DRY_RUN ? '（dry-run・未書き込み）' : ''}`,
  )
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
