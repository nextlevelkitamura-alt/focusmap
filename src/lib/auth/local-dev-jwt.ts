import { createHmac, randomUUID } from 'node:crypto'
import type { LocalDevAuthUser } from './local-dev-auth'

const DEFAULT_TOKEN_TTL_SECONDS = 12 * 60 * 60

function configuredJwtSecret() {
  return process.env.SUPABASE_JWT_SECRET || process.env.SUPABASE_AUTH_JWT_SECRET || ''
}

function configuredTtlSeconds() {
  const raw = Number.parseInt(process.env.FOCUSMAP_DEV_AUTH_TTL_SECONDS || '', 10)
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_TOKEN_TTL_SECONDS
  return Math.min(Math.max(raw, 60), 7 * 24 * 60 * 60)
}

function base64UrlJson(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function signHs256(input: string, secret: string) {
  return createHmac('sha256', secret).update(input).digest('base64url')
}

export function createLocalDevSupabaseJwt(user: LocalDevAuthUser) {
  const secret = configuredJwtSecret()
  if (!secret) return null

  const now = Math.floor(Date.now() / 1000)
  const expiresAt = now + configuredTtlSeconds()
  const header = base64UrlJson({ alg: 'HS256', typ: 'JWT' })
  const payload = base64UrlJson({
    aud: 'authenticated',
    exp: expiresAt,
    iat: now,
    iss: 'supabase',
    sub: user.id,
    email: user.email,
    phone: '',
    role: 'authenticated',
    aal: 'aal1',
    session_id: randomUUID(),
    app_metadata: {
      provider: 'local_dev',
      providers: ['local_dev'],
    },
    user_metadata: {
      local_dev_auth: true,
    },
  })
  const signingInput = `${header}.${payload}`
  return {
    accessToken: `${signingInput}.${signHs256(signingInput, secret)}`,
    expiresAt,
  }
}
