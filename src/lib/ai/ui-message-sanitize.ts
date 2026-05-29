import type { UIMessage } from 'ai'

const DEFAULT_MAX_MESSAGES = 18
const DEFAULT_MAX_JSON_CHARS = 220_000
const MAX_STRING_CHARS = 16_000
const MAX_ARRAY_ITEMS = 80
const MAX_OBJECT_KEYS = 100

export const MAX_CURRENT_IMAGE_DATA_URL_CHARS = 1_200_000

type UIPart = UIMessage['parts'][number]

function truncateString(value: string): string {
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(value)) {
    return '[image data omitted from model context; still visible in the chat UI]'
  }
  if (value.length <= MAX_STRING_CHARS) return value
  return `${value.slice(0, MAX_STRING_CHARS)}\n...[truncated ${value.length - MAX_STRING_CHARS} chars]`
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return truncateString(value)
  if (typeof value !== 'object' || value === null) return value
  if (depth > 6) return '[nested object omitted]'
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_ITEMS).map(item => sanitizeValue(item, depth + 1))
    if (value.length > MAX_ARRAY_ITEMS) {
      items.push(`[${value.length - MAX_ARRAY_ITEMS} items omitted]`)
    }
    return items
  }
  const entries = Object.entries(value).slice(0, MAX_OBJECT_KEYS)
  const next: Record<string, unknown> = {}
  for (const [key, child] of entries) {
    next[key] = sanitizeValue(child, depth + 1)
  }
  const extraKeys = Object.keys(value).length - entries.length
  if (extraKeys > 0) next._omitted_keys = extraKeys
  return next
}

function isImageFilePart(part: UIPart): part is UIPart & {
  type: 'file'
  mediaType: string
  url: string
  filename?: string
} {
  return part.type === 'file' &&
    typeof part.mediaType === 'string' &&
    part.mediaType.toLowerCase().startsWith('image/') &&
    typeof part.url === 'string'
}

function filePlaceholder(part: Extract<UIPart, { type: 'file' }>): UIPart {
  const filename = part.filename ? ` ${part.filename}` : ''
  const mediaType = part.mediaType ? ` ${part.mediaType}` : ''
  return {
    type: 'text',
    text: `[過去の添付ファイル${filename}${mediaType} は履歴肥大化防止のためモデル送信から除外しました]`,
  }
}

function sanitizePart(part: UIPart, preserveCurrentImages: boolean): UIPart {
  if (part.type === 'file') {
    if (isImageFilePart(part) && preserveCurrentImages && part.url.length <= MAX_CURRENT_IMAGE_DATA_URL_CHARS) return part
    return filePlaceholder(part)
  }

  const record = { ...(part as Record<string, unknown>) }
  if (typeof record.text === 'string') record.text = truncateString(record.text)
  if ('input' in record) record.input = sanitizeValue(record.input)
  if ('output' in record) record.output = sanitizeValue(record.output)
  if ('errorText' in record && typeof record.errorText === 'string') record.errorText = truncateString(record.errorText)
  return record as UIPart
}

function findLastUserMessageId(messages: UIMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') return messages[index].id
  }
  return null
}

export function sanitizeUIMessagesForModel(
  messages: UIMessage[],
  options: {
    currentUserMessageId?: string | null
    maxMessages?: number
    maxJsonChars?: number
  } = {},
): UIMessage[] {
  const maxMessages = options.maxMessages ?? DEFAULT_MAX_MESSAGES
  const maxJsonChars = options.maxJsonChars ?? DEFAULT_MAX_JSON_CHARS
  const currentUserMessageId = options.currentUserMessageId ?? findLastUserMessageId(messages)
  const sliced = messages.slice(Math.max(0, messages.length - maxMessages))
  const sanitized = sliced.map(message => ({
    ...message,
    parts: message.parts.map(part => sanitizePart(part, message.id === currentUserMessageId)),
  }))

  while (sanitized.length > 1 && JSON.stringify(sanitized).length > maxJsonChars) {
    const removableIndex = sanitized.findIndex(message => message.id !== currentUserMessageId)
    if (removableIndex < 0) break
    sanitized.splice(removableIndex, 1)
  }

  if (JSON.stringify(sanitized).length <= maxJsonChars) return sanitized

  return sanitized.map(message => {
    if (message.id !== currentUserMessageId) return message
    return {
      ...message,
      parts: message.parts.map(part => sanitizePart(part, false)),
    }
  })
}
