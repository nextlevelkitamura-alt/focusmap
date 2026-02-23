const DEFAULT_EVENT_COLOR = '#039BE5'

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

function readEventColorFromPalette(
  eventColor: string | undefined,
  eventColorPalette?: Map<string, string>
): string | undefined {
  if (!eventColor || !eventColorPalette) return undefined
  const mapped = eventColorPalette.get(eventColor)
  if (!mapped || !isHexColor(mapped)) return undefined
  return toHex6(mapped)
}

export interface ResolveCalendarEventColorParams {
  eventColor?: string
  eventBackgroundColor?: string
  calendarBackgroundColor?: string
  eventColorPalette?: Map<string, string>
}

/**
 * Googleイベント表示色の優先順位:
 * 1) event.colorId / event.color(HEX)  2) calendar backgroundColor  3) event.background_color  4) default
 */
export function resolveCalendarEventColor({
  eventColor,
  eventBackgroundColor,
  calendarBackgroundColor,
  eventColorPalette,
}: ResolveCalendarEventColorParams): string {
  if (isHexColor(eventColor)) {
    return toHex6(eventColor)
  }

  const fromPalette = readEventColorFromPalette(eventColor, eventColorPalette)
  if (fromPalette) return fromPalette

  if (isHexColor(calendarBackgroundColor)) {
    return toHex6(calendarBackgroundColor)
  }

  if (isHexColor(eventBackgroundColor)) {
    return toHex6(eventBackgroundColor)
  }

  return DEFAULT_EVENT_COLOR
}

