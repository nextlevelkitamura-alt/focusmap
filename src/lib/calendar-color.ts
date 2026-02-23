function isHexColor(value?: string | null): value is string {
  if (!value) return false
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim())
}

function toHex6(value: string): string {
  const trimmed = value.trim()
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed.toUpperCase()
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    const [, hex] = trimmed.match(/^#([0-9a-f]{3})$/i) || []
    if (!hex) return trimmed.toUpperCase()
    return `#${hex.split('').map(ch => ch + ch).join('')}`.toUpperCase()
  }
  return trimmed.toUpperCase()
}

export interface ResolveCalendarEventColorParams {
  calendarBackgroundColor?: string
}

/**
 * Calendar color only:
 * event個別色は使用せず、calendar background color のみを返す。
 */
export function resolveCalendarEventColor({
  calendarBackgroundColor,
}: ResolveCalendarEventColorParams): string | undefined {
  if (isHexColor(calendarBackgroundColor)) {
    return toHex6(calendarBackgroundColor)
  }
  return undefined
}
