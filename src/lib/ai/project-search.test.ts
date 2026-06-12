import { describe, expect, test } from 'vitest'
import {
  buildProjectSearchNeedles,
  matchProjectSearch,
  normalizeProjectSearchText,
} from './project-search'

describe('project search matching', () => {
  test('normalizes Focusmap English and Japanese aliases', () => {
    expect(normalizeProjectSearchText('Focus map制作')).toBe('focusmap制作')
    expect(normalizeProjectSearchText('フォーカスマップ')).toBe('focusmap')
    expect(normalizeProjectSearchText('フォークスマップ')).toBe('focusmap')
  })

  test('extracts the project-specific term from a spoken query', () => {
    expect(buildProjectSearchNeedles('フォークスマップのプロジェクトの概要を見て')).toContain('focusmap')
  })

  test('strongly matches the Focusmap project by title', () => {
    const match = matchProjectSearch(
      {
        title: 'Focus map制作',
        description: '',
        repo_path: '~/Private/focusmap',
      },
      ['title', 'description', 'repo_path'],
      'フォークスマップのプロジェクト',
    )

    expect(match.matches).toBe(true)
    expect(match.confidence).toBe('strong')
    expect(match.matchedFields).toContain('title')
  })

  test('matches a repo path when the visible title differs', () => {
    const match = matchProjectSearch(
      {
        title: '制作アプリ',
        description: '',
        repo_path: '/Users/me/Private/focusmap',
      },
      ['title', 'description', 'repo_path'],
      'フォーカスマップ',
    )

    expect(match.matches).toBe(true)
    expect(match.confidence).toBe('strong')
    expect(match.matchedFields).toContain('repo_path')
  })
})
