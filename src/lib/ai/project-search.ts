export type ProjectSearchConfidence = 'none' | 'partial' | 'strong' | 'exact'

export interface ProjectSearchMatch {
  matches: boolean
  score: number
  confidence: ProjectSearchConfidence
  matchedFields: string[]
  needles: string[]
}

const GENERIC_PROJECT_QUERY_WORDS = [
  'プロジェクト',
  'ぷろじぇくと',
  'project',
  '概要',
  '内容',
  '状況',
  '現状',
  '進捗',
  '文脈',
  'コンテキスト',
  '壁打ち',
  '相談',
  '整理',
  '確認',
  '読んで',
  '見て',
  'して',
  'ください',
  'について',
  'の',
  'を',
  'は',
  'が',
]

const FOCUSMAP_ALIASES = [
  'focusmap',
  'focus map',
  'focus-map',
  'focus_map',
  'フォーカスマップ',
  'フォーカスmap',
  'フォーカス MAP',
  'フォークスマップ',
  'フォークスmap',
  'フォーカマップ',
  'フォーカスマツプ',
]

function normalizeBase(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’']/g, '')
    .trim()
}

export function normalizeProjectSearchText(value: unknown): string {
  let text = normalizeBase(value).replace(/[\s_\-・/\\.|:()（）［\]【】「」『』,，.。]+/g, '')
  for (const alias of FOCUSMAP_ALIASES) {
    const normalizedAlias = normalizeBase(alias)
      .replace(/[\s_\-・/\\.|:()（）［\]【】「」『』,，.。]+/g, '')
    text = text.replaceAll(normalizedAlias, 'focusmap')
  }
  return text
}

function withoutGenericWords(value: string): string {
  return GENERIC_PROJECT_QUERY_WORDS.reduce(
    (current, word) => current.replaceAll(normalizeProjectSearchText(word), ''),
    value,
  )
}

export function buildProjectSearchNeedles(query?: string | null): string[] {
  const normalized = normalizeProjectSearchText(query ?? '')
  if (!normalized) return []

  const candidates = new Set<string>([normalized])
  const stripped = withoutGenericWords(normalized)
  if (stripped) candidates.add(stripped)

  if (normalized.includes('focusmap')) candidates.add('focusmap')

  for (const token of normalizeBase(query ?? '').split(/[\s　]+/)) {
    const normalizedToken = withoutGenericWords(normalizeProjectSearchText(token))
    if (normalizedToken.length >= 2) candidates.add(normalizedToken)
  }

  return Array.from(candidates)
    .map(needle => needle.trim())
    .filter(needle => needle.length >= 2)
    .sort((a, b) => b.length - a.length)
}

function confidenceFromScore(score: number): ProjectSearchConfidence {
  if (score >= 100) return 'exact'
  if (score >= 70) return 'strong'
  if (score > 0) return 'partial'
  return 'none'
}

export function matchProjectSearch(
  record: Record<string, unknown>,
  keys: string[],
  query?: string | null,
): ProjectSearchMatch {
  const needles = buildProjectSearchNeedles(query)
  if (needles.length === 0) {
    return {
      matches: true,
      score: 0,
      confidence: 'none',
      matchedFields: [],
      needles,
    }
  }

  let score = 0
  const matchedFields = new Set<string>()
  for (const key of keys) {
    const text = normalizeProjectSearchText(record[key])
    if (!text) continue

    for (const needle of needles) {
      if (text === needle) {
        score = Math.max(score, key === 'title' ? 110 : 95)
        matchedFields.add(key)
      } else if (text.includes(needle)) {
        const fieldScore = key === 'title'
          ? 90
          : key === 'repo_path'
            ? 85
            : 65
        score = Math.max(score, fieldScore)
        matchedFields.add(key)
      } else if (needle.length >= 4 && needle.includes(text) && text.length >= 4) {
        const fieldScore = key === 'title' ? 70 : 55
        score = Math.max(score, fieldScore)
        matchedFields.add(key)
      }
    }
  }

  return {
    matches: score > 0,
    score,
    confidence: confidenceFromScore(score),
    matchedFields: Array.from(matchedFields),
    needles,
  }
}
