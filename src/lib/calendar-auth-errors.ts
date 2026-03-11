export interface CalendarAuthErrorInfo {
  code: 'CALENDAR_NOT_CONNECTED' | 'NO_REFRESH_TOKEN' | 'CALENDAR_REAUTH_REQUIRED' | 'ACCESS_TOKEN_EXPIRED'
  message: string
  status: 401
}

function normalizeMessage(input: unknown): string {
  if (input instanceof Error) return input.message || String(input)
  return String(input ?? '')
}

export function shouldAttemptTokenRefresh(messageLike: unknown): boolean {
  const message = normalizeMessage(messageLike).toLowerCase()

  const definitelyReconnectRequired =
    message.includes('invalid_grant') ||
    message.includes('google oauth tokens not found') ||
    message.includes('missing tokens') ||
    message.includes('calendar not connected') ||
    message.includes('calendar settings not found')

  if (definitelyReconnectRequired) return false

  return (
    message.includes('token') ||
    message.includes('invalid credentials') ||
    message.includes('unauthorized')
  )
}

export function classifyCalendarAuthError(messageLike: unknown): CalendarAuthErrorInfo | null {
  const message = normalizeMessage(messageLike)
  const lower = message.toLowerCase()

  if (lower.includes('calendar not connected') || lower.includes('calendar settings not found')) {
    return {
      code: 'CALENDAR_NOT_CONNECTED',
      message: 'Calendar is not connected. Please reconnect.',
      status: 401,
    }
  }

  if (lower.includes('google oauth tokens not found') || lower.includes('missing tokens')) {
    return {
      code: 'NO_REFRESH_TOKEN',
      message: 'Calendar refresh token is missing. Please reconnect.',
      status: 401,
    }
  }

  if (lower.includes('invalid_grant')) {
    return {
      code: 'CALENDAR_REAUTH_REQUIRED',
      message: 'Calendar authorization expired. This may be caused by OAuth consent screen being in "Testing" mode (refresh tokens expire after 7 days). Please reconnect your Google Calendar.',
      status: 401,
    }
  }

  if (lower.includes('token') || lower.includes('invalid credentials')) {
    return {
      code: 'ACCESS_TOKEN_EXPIRED',
      message: 'Calendar access token expired. Please retry or reconnect.',
      status: 401,
    }
  }

  return null
}

