const WINDOW_MS = 60 * 1000 // 1 minute
const MAX_REQUESTS = 60

interface RateLimitEntry {
  count: number
  resetAt: number
}

const store = new Map<string, RateLimitEntry>()

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) store.delete(key)
  }
}, 5 * 60 * 1000)

/**
 * In-memory rate limiter: 60 requests per minute per key.
 * Returns { allowed, remaining, resetAt }.
 */
export function checkRateLimit(keyHash: string): {
  allowed: boolean
  remaining: number
  resetAt: number
} {
  const now = Date.now()
  const entry = store.get(keyHash)

  if (!entry || entry.resetAt <= now) {
    store.set(keyHash, { count: 1, resetAt: now + WINDOW_MS })
    return { allowed: true, remaining: MAX_REQUESTS - 1, resetAt: now + WINDOW_MS }
  }

  entry.count++
  const remaining = Math.max(0, MAX_REQUESTS - entry.count)
  return {
    allowed: entry.count <= MAX_REQUESTS,
    remaining,
    resetAt: entry.resetAt,
  }
}
