import { describe, expect, test } from 'vitest'
import { buildImmediateMemoCodexPrompt, memoBodyForCodexExecution } from './memo-codex-execution'

describe('memo Codex execution prompt', () => {
  test('wraps the raw memo body with the minimal execute-now template', () => {
    expect(buildImmediateMemoCodexPrompt('  これを直す\r\n\n詳細  ')).toBe('これを直す\n\n詳細')
  })

  test('copies the title and body with one newline between them', () => {
    expect(memoBodyForCodexExecution({ title: 'タイトル', body: '本文' })).toBe('タイトル\n本文')
    expect(memoBodyForCodexExecution({ title: 'タイトル', body: '   ' })).toBe('タイトル')
  })

  test('does not add attachment labels or signed URLs to the copied prompt', () => {
    expect(buildImmediateMemoCodexPrompt('本文', [
      {
        file_name: 'screen.png',
        file_url: 'https://example.com/signed/screen.png?token=abc',
        file_type: 'image/png',
        file_size: 1536,
      },
    ])).toBe('本文')
  })
})
