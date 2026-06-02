type DesktopAuthSession = {
  accessToken: string
  refreshToken: string
  userId: string
  expiresAt: number
}

const DESKTOP_AUTH_SESSION_TTL_MS = 5 * 60 * 1000

const globalForDesktopAuth = globalThis as typeof globalThis & {
  __focusmapDesktopAuthSessions?: Map<string, DesktopAuthSession>
}

function sessionStore() {
  const store = globalForDesktopAuth.__focusmapDesktopAuthSessions ?? new Map<string, DesktopAuthSession>()
  globalForDesktopAuth.__focusmapDesktopAuthSessions = store
  const now = Date.now()
  for (const [nonce, session] of store.entries()) {
    if (session.expiresAt <= now) store.delete(nonce)
  }
  return store
}

export function registerDesktopAuthSession(input: {
  nonce: string
  accessToken: string
  refreshToken: string
  userId: string
}) {
  sessionStore().set(input.nonce, {
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    userId: input.userId,
    expiresAt: Date.now() + DESKTOP_AUTH_SESSION_TTL_MS,
  })
}

export function consumeDesktopAuthSession(nonce: string) {
  const store = sessionStore()
  const session = store.get(nonce)
  if (!session) return null
  store.delete(nonce)
  if (session.expiresAt <= Date.now()) return null
  return session
}
