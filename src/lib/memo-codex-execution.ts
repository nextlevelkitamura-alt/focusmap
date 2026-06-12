export function normalizeMemoExecutionBody(value: string) {
  return value.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim()
}

export type MemoCodexImageAttachment = {
  file_name: string
  file_url: string
  file_type?: string | null
  file_size?: number | null
}

export function buildMemoCodexImageSection(images: MemoCodexImageAttachment[]) {
  void images
  return ''
}

export function buildImmediateMemoCodexPrompt(body: string, images: MemoCodexImageAttachment[] = []) {
  void images
  return normalizeMemoExecutionBody(body)
}

export function memoBodyForCodexExecution(args: { title: string; body?: string | null }) {
  const title = normalizeMemoExecutionBody(args.title)
  const body = normalizeMemoExecutionBody(args.body ?? '')
  return [title, body].filter(Boolean).join('\n')
}
