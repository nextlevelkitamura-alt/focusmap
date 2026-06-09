export function normalizeMemoExecutionBody(value: string) {
  return value.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim()
}

export type MemoCodexImageAttachment = {
  file_name: string
  file_url: string
  file_type?: string | null
  file_size?: number | null
}

function formatFileSize(bytes: number | null | undefined) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return null
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

export function buildMemoCodexImageSection(images: MemoCodexImageAttachment[]) {
  const imageLines = images
    .filter(image => image.file_url.trim())
    .map((image, index) => {
      const details = [
        image.file_type?.trim() || null,
        formatFileSize(image.file_size),
      ].filter(Boolean).join(', ')
      const suffix = details ? ` (${details})` : ''
      return `${index + 1}. ${image.file_name || `image-${index + 1}`}${suffix}\n   ${image.file_url.trim()}`
    })

  if (imageLines.length === 0) return ''

  return ['添付画像:', ...imageLines].join('\n')
}

export function buildImmediateMemoCodexPrompt(body: string, images: MemoCodexImageAttachment[] = []) {
  const memoBody = normalizeMemoExecutionBody(body)
  const imageSection = buildMemoCodexImageSection(images)
  if (!imageSection) return memoBody
  return [memoBody, '', imageSection].join('\n')
}

export function memoBodyForCodexExecution(args: { title: string; body?: string | null }) {
  const title = normalizeMemoExecutionBody(args.title)
  const body = normalizeMemoExecutionBody(args.body ?? '')
  return [title, body].filter(Boolean).join('\n')
}
