import { describe, expect, test } from 'vitest'
import { buildImmediateMemoCodexPrompt, memoBodyForCodexExecution } from './memo-codex-execution'

describe('memo Codex execution prompt', () => {
  test('wraps the raw memo body with the minimal execute-now template', () => {
    expect(buildImmediateMemoCodexPrompt('  これを直す\r\n\n詳細  ')).toBe([
      '以下のメモをもとに、すぐ実行してください。',
      '原文のニュアンスを優先し、不明点があれば最小限だけ確認してください。',
      '',
      '[メモ]',
      'これを直す\n\n詳細',
    ].join('\n'))
  })

  test('uses body first and falls back to title', () => {
    expect(memoBodyForCodexExecution({ title: 'タイトル', body: '本文' })).toBe('本文')
    expect(memoBodyForCodexExecution({ title: 'タイトル', body: '   ' })).toBe('タイトル')
  })
})
