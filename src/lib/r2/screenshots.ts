export const SCREENSHOT_THUMBNAIL_MAX_BYTES = 120 * 1024
export const SCREENSHOT_PREVIEW_MAX_BYTES = 800 * 1024
export const SCREENSHOT_MIN_UPLOAD_INTERVAL_MS = 60_000

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
}

const BYPASS_INTERVAL_REASONS = new Set([
  'state_change',
  'error',
  'awaiting_approval',
  'user_requested',
  'manual',
])

export function screenshotExtensionForContentType(contentType: string) {
  return IMAGE_EXTENSIONS[contentType.toLowerCase()] ?? null
}

export function isAllowedScreenshotContentType(contentType: string) {
  return Boolean(screenshotExtensionForContentType(contentType))
}

export function screenshotObjectKey(input: {
  userId: string
  taskId: string
  screenshotId: string
  variant: 'thumbnail' | 'preview'
  contentType: string
}) {
  const ext = screenshotExtensionForContentType(input.contentType)
  if (!ext) throw new Error(`unsupported screenshot content type: ${input.contentType}`)
  return [
    'screenshots',
    encodeURIComponent(input.userId),
    encodeURIComponent(input.taskId),
    encodeURIComponent(input.screenshotId),
    `${input.variant}.${ext}`,
  ].join('/')
}

export function shouldBypassScreenshotInterval(reason: string | null | undefined) {
  return Boolean(reason && BYPASS_INTERVAL_REASONS.has(reason))
}

export function validateScreenshotImage(input: {
  variant: 'thumbnail' | 'preview'
  contentType: string
  size: number
}) {
  if (!isAllowedScreenshotContentType(input.contentType)) {
    return `unsupported ${input.variant} content type`
  }
  const max = input.variant === 'thumbnail'
    ? SCREENSHOT_THUMBNAIL_MAX_BYTES
    : SCREENSHOT_PREVIEW_MAX_BYTES
  if (input.size <= 0) return `${input.variant} is empty`
  if (input.size > max) return `${input.variant} must be ${max} bytes or less`
  return null
}
