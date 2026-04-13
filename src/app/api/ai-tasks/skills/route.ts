import { NextResponse } from 'next/server'
import * as fs from 'fs'
import * as path from 'path'

// スキルが存在するリポジトリのリスト
// ローカル Mac のパスを返す（task-runner が使う cwd）
const SKILL_REPOS = [
  { label: '仕事', path: '/Users/kitamuranaohiro/Private/仕事' },
  { label: '人生管理', path: '/Users/kitamuranaohiro/Private/人生管理' },
  { label: 'AI カンパニー', path: '/Users/kitamuranaohiro/Private/AI カンパニー' },
  { label: 'リモートワーカー', path: '/Users/kitamuranaohiro/Private/リモートワーカー' },
  { label: 'focusmap', path: '/Users/kitamuranaohiro/Private/P dev/focusmap' },
]

interface SkillInfo {
  name: string
  description: string | null
}

function readSkillDescription(skillDir: string): string | null {
  // スキルディレクトリ内の .md ファイルから description を読む
  try {
    const files = fs.readdirSync(skillDir)
    const mdFile = files.find(f => f.endsWith('.md'))
    if (!mdFile) return null
    const content = fs.readFileSync(path.join(skillDir, mdFile), 'utf-8')
    // 最初の行（# を除く）を description として使う
    const firstLine = content.split('\n').find(l => l.trim() && !l.startsWith('#'))
    return firstLine?.trim().slice(0, 100) || null
  } catch {
    return null
  }
}

// GET /api/ai-tasks/skills — ローカルリポのスキル一覧
export async function GET() {
  const repos: { label: string; path: string; skills: SkillInfo[] }[] = []

  for (const repo of SKILL_REPOS) {
    const skillsDir = path.join(repo.path, '.claude', 'skills')
    let skills: SkillInfo[] = []

    if (fs.existsSync(skillsDir)) {
      try {
        const entries = fs.readdirSync(skillsDir, { withFileTypes: true })
        skills = entries
          .filter(e => e.isDirectory())
          .map(e => ({
            name: e.name,
            description: readSkillDescription(path.join(skillsDir, e.name)),
          }))
      } catch {
        // ディレクトリ読み取り失敗は無視
      }
    }

    // スキルの有無に関わらず全リポを返す（cwd 設定用）
    repos.push({ label: repo.label, path: repo.path, skills })
  }

  return NextResponse.json(repos)
}
