const GOOGLE_CALLBACK_PATH = '/api/calendar/callback';

function isValidAbsoluteUrl(value: string | undefined | null): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function trimTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

function getForwardedOrigin(headers: Headers): string | null {
  const forwardedHost = headers.get('x-forwarded-host');
  if (!forwardedHost) return null;

  const forwardedProto = headers.get('x-forwarded-proto') || 'https';
  return `${forwardedProto}://${forwardedHost}`;
}

export function resolveGoogleRedirectUriFromRequest(request: Request): string {
  if (isValidAbsoluteUrl(process.env.GOOGLE_REDIRECT_URI)) {
    return process.env.GOOGLE_REDIRECT_URI;
  }

  if (isValidAbsoluteUrl(process.env.NEXTAUTH_URL)) {
    return `${trimTrailingSlash(process.env.NEXTAUTH_URL)}${GOOGLE_CALLBACK_PATH}`;
  }

  const forwardedOrigin = getForwardedOrigin(request.headers);
  if (isValidAbsoluteUrl(forwardedOrigin)) {
    return `${trimTrailingSlash(forwardedOrigin)}${GOOGLE_CALLBACK_PATH}`;
  }

  const requestOrigin = new URL(request.url).origin;
  return `${trimTrailingSlash(requestOrigin)}${GOOGLE_CALLBACK_PATH}`;
}

export function resolveGoogleRedirectUriFromEnv(): string | undefined {
  if (isValidAbsoluteUrl(process.env.GOOGLE_REDIRECT_URI)) {
    return process.env.GOOGLE_REDIRECT_URI;
  }

  if (isValidAbsoluteUrl(process.env.NEXTAUTH_URL)) {
    return `${trimTrailingSlash(process.env.NEXTAUTH_URL)}${GOOGLE_CALLBACK_PATH}`;
  }

  return undefined;
}

interface CalendarOAuthState {
  userId: string;
  next: string;
}

export function encodeCalendarOAuthState(userId: string, next = '/dashboard'): string {
  const payload: CalendarOAuthState = { userId, next };
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function decodeCalendarOAuthState(state: string): CalendarOAuthState {
  try {
    const parsed = JSON.parse(Buffer.from(state, 'base64url').toString('utf8')) as Partial<CalendarOAuthState>;
    if (typeof parsed.userId === 'string' && typeof parsed.next === 'string') {
      return { userId: parsed.userId, next: parsed.next };
    }
  } catch {
    // Legacy format fallback
  }

  return { userId: state, next: '/dashboard' };
}

export function buildCalendarReauthUrl(request: Request, next = '/dashboard'): string {
  const forwardedOrigin = getForwardedOrigin(request.headers);
  const origin = forwardedOrigin && isValidAbsoluteUrl(forwardedOrigin)
    ? forwardedOrigin
    : new URL(request.url).origin;
  const url = new URL('/api/calendar/connect', origin);
  url.searchParams.set('next', next);
  return `${url.pathname}${url.search}`;
}
