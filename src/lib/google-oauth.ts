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
  // Priority 1: 明示的な環境変数（最優先）
  if (isValidAbsoluteUrl(process.env.GOOGLE_REDIRECT_URI)) {
    console.log('[resolveGoogleRedirectUri] Using GOOGLE_REDIRECT_URI env:', process.env.GOOGLE_REDIRECT_URI);
    return process.env.GOOGLE_REDIRECT_URI;
  }

  // Priority 2: x-forwarded-host（Cloud Run が付与する実際のサービスURL）
  const forwardedOrigin = getForwardedOrigin(request.headers);
  if (isValidAbsoluteUrl(forwardedOrigin)) {
    const uri = `${trimTrailingSlash(forwardedOrigin)}${GOOGLE_CALLBACK_PATH}`;
    console.log('[resolveGoogleRedirectUri] Using x-forwarded-host:', uri);
    return uri;
  }

  // Priority 3: NEXTAUTH_URL（ローカル開発等のフォールバック）
  if (isValidAbsoluteUrl(process.env.NEXTAUTH_URL)) {
    const uri = `${trimTrailingSlash(process.env.NEXTAUTH_URL)}${GOOGLE_CALLBACK_PATH}`;
    console.log('[resolveGoogleRedirectUri] Using NEXTAUTH_URL:', uri);
    return uri;
  }

  // Priority 4: リクエストURLのorigin（最後の手段）
  const requestOrigin = new URL(request.url).origin;
  const uri = `${trimTrailingSlash(requestOrigin)}${GOOGLE_CALLBACK_PATH}`;
  console.log('[resolveGoogleRedirectUri] Using request.url origin:', uri);
  return uri;
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
