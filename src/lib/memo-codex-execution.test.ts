import { describe, expect, test } from 'vitest'
import { buildImmediateMemoCodexPrompt, memoBodyForCodexExecution } from './memo-codex-execution'

describe('memo Codex execution prompt', () => {
  test('wraps the raw memo body with the minimal execute-now template', () => {
    expect(buildImmediateMemoCodexPrompt('  これを直す\r\n\n詳細  ')).toBe('これを直す\n\n詳細')
  })

  test('uses body first and falls back to title', () => {
    expect(memoBodyForCodexExecution({ title: 'タイトル', body: '本文' })).toBe('本文')
    expect(memoBodyForCodexExecution({ title: 'タイトル', body: '   ' })).toBe('タイトル')
  })

  test('adds image references when memo has attachments', () => {
    expect(buildImmediateMemoCodexPrompt('本文', [
      {
        file_name: 'screen.png',
        file_url: 'https://example.com/signed/screen.png?token=abc',
        file_type: 'image/png',
        file_size: 1536,
      },
    ])).toContain([
      '添付画像:',
      '1. screen.png (image/png, 2KB)',
      '   https://example.com/signed/screen.png?token=abc',
    ].join('\n'))
  })
})
