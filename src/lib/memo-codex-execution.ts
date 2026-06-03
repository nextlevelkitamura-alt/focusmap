export function normalizeMemoExecutionBody(value: string) {
  return value.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim()
}

export function buildImmediateMemoCodexPrompt(body: string) {
  const memoBody = normalizeMemoExecutionBody(body)
  return [
    '以下のメモをもとに、すぐ実行してください。',
    '原文のニュアンスを優先し、不明点があれば最小限だけ確認してください。',
    '',
    '[メモ]',
    memoBody,
  ].join('\n')
}

export function memoBodyForCodexExecution(args: { title: string; body?: string | null }) {
  const body = normalizeMemoExecutionBody(args.body ?? '')
  if (body) return body
  return normalizeMemoExecutionBody(args.title)
}
