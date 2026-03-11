import { randomBytes, createHash } from 'crypto'

const API_KEY_PREFIX = 'sk_shikumika_'

/**
 * Generate a new API key with its hash.
 * Returns the raw key (shown once to user) and its SHA-256 hash (stored in DB).
 */
export function generateApiKey(): { rawKey: string; keyHash: string; keyPrefix: string } {
  const randomPart = randomBytes(24).toString('base64url').slice(0, 32)
  const rawKey = `${API_KEY_PREFIX}${randomPart}`
  const keyHash = hashApiKey(rawKey)
  const keyPrefix = rawKey.slice(0, API_KEY_PREFIX.length + 4) + '...'

  return { rawKey, keyHash, keyPrefix }
}

/**
 * Hash an API key using SHA-256.
 */
export function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex')
}
