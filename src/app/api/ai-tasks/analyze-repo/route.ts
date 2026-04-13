import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import * as fs from 'fs'
import * as path from 'path'

interface SkillAnalysis {
  name: string
  description: string
  suggestedPrompt: string
}

interface RepoAnalysis {
  summary: string
  skills: SkillAnalysis[]
  analyzedAt: string
}

/**
 * スキルの .md ファイルから description と suggestedPrompt を抽出する
 * frontmatter の description と本文の最初の段落を使用
 */
function parseSkillFile(skillDir: string, skillName: string): SkillAnalysis {
  const mdFiles = ['SKILL.md', 'skill.md', `${skillName}.md`]
  let content = ''

  for (const f of mdFiles) {
    const p = path.join(skillDir, f)
    if (fs.existsSync(p)) {
      content = fs.readFileSync(p, 'utf-8')
      break
    }
  }

  // フォールバック: 最初の .md ファイル
  if (!content) {
    try {
      const files = fs.readdirSync(skillDir).filter(f => f.endsWith('.md'))
      if (files.length > 0) {
        content = fs.readFileSync(path.join(skillDir, files[0]), 'utf-8')
      }
    } catch { /* 読めない */ }
  }

  if (!content) {
    return { name: skillName, description: '', suggestedPrompt: `${skillName}を実行して` }
  }

  // frontmatter から description を抽出
  let description = ''
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
  if (fmMatch) {
    const descMatch = fmMatch[1].match(/description:\s*\|?\s*\n?\s*(.+)/)
    if (descMatch) {
      description = descMatch[1].trim()
    }
  }

  // frontmatter に description がなければ、本文の最初の実質的な行を使う
  if (!description) {
    const body = content.replace(/^---[\s\S]*?---\n*/, '') // frontmatter を除去
    const lines = body.split('\n').filter(l => l.trim() && !l.startsWith('#'))
    description = lines[0]?.trim().slice(0, 100) || skillName
  }

  // suggestedPrompt: スキルの description からトリガーワードを抽出して自然言語プロンプトを生成
  // 例: "交通費・経理処理の自動入力。以下の言葉に反応: 「経理」「交通費」..."
  //   → "経理を実行して"
  const triggerMatch = description.match(/[「『]([^」』]+)[」』]/)
  const prompt = triggerMatch
    ? `${triggerMatch[1]}を実行して`
    : `${skillName}を実行して`

  return { name: skillName, description, suggestedPrompt: prompt }
}

/**
 * リポジトリの CLAUDE.md から summary を抽出
 */
function getRepoSummary(repoPath: string): string {
  const candidates = ['CLAUDE.md', '.claude/CLAUDE.md', 'README.md']
  for (const f of candidates) {
    const p = path.join(repoPath, f)
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, 'utf-8')
      // 最初の段落（# 以外）を取得
      const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#') && !l.startsWith('---'))
      if (lines.length > 0) return lines[0].trim().slice(0, 120)
    }
  }
  return path.basename(repoPath)
}

// GET /api/ai-tasks/analyze-repo?repoPath=... — スキル情報を取得
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const repoPath = new URL(req.url).searchParams.get('repoPath')
  if (!repoPath) return NextResponse.json({ error: 'repoPath is required' }, { status: 400 })

  if (!fs.existsSync(repoPath)) {
    return NextResponse.json({ error: 'Repository not found' }, { status: 404 })
  }

  const skillsDir = path.join(repoPath, '.claude', 'skills')
  if (!fs.existsSync(skillsDir)) {
    return NextResponse.json({ exists: true, summary: path.basename(repoPath), skills: [] })
  }

  try {
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true })
    const skills: SkillAnalysis[] = entries
      .filter(e => e.isDirectory())
      .map(e => parseSkillFile(path.join(skillsDir, e.name), e.name))

    const analysis: RepoAnalysis = {
      summary: getRepoSummary(repoPath),
      skills,
      analyzedAt: new Date().toISOString(),
    }

    return NextResponse.json({ exists: true, ...analysis })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[analyze-repo]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
