import type { NextRequest } from 'next/server'
import { getLocalDevAuthForRequest } from './local-dev-auth'

const FALLBACK_SUPABASE_URL = 'https://whsjsscgmkkkzgcwxjko.supabase.co'
const JWKS_CACHE_TTL_MS = 10 * 60_000
const CLOCK_TOLERANCE_SECONDS = 60

type SupabaseLikeWithAuth = {
  auth?: {
    getUser: () => Promise<{
      data?: { user?: { id?: string; email?: string | null } | null }
      error?: unknown
    }>
  }
}

export type SupabaseJwtClaims = {
  sub: string
  aud?: string | string[]
  iss?: string
  exp?: number
  nbf?: number
  email?: string
  role?: string
  [key: string]: unknown
}

export type SupabaseAuthUser = {
  id: string
  email: string | null
}

export type SupabaseRequestAuth = {
  user: SupabaseAuthUser
  claims: SupabaseJwtClaims | null
  source: 'jwt' | 'supabase' | 'local_dev'
}

type JwtHeader = {
  alg?: string
  kid?: string
  typ?: string
}

type JwksCache = {
  keys: SupabaseJwk[]
  expiresAt: number
}

type SupabaseJwk = JsonWebKey & {
  kid?: string
}

let jwksCache: JwksCache | null = null
const textEncoder = new TextEncoder()

function supabaseUrl() {
  return (process.env.NEXT_PUBLIC_SUPABASE_URL || FALLBACK_SUPABASE_URL).replace(/\/$/, '')
}

function expectedIssuer() {
  return process.env.SUPABASE_JWT_ISSUER || `${supabaseUrl()}/auth/v1`
}

function expectedAudience() {
  return process.env.SUPABASE_JWT_AUDIENCE || 'authenticated'
}

function base64UrlToBuffer(value: string): Buffer {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4))
  return Buffer.from(`${normalized}${padding}`, 'base64')
}

function base64UrlToJson(value: string): unknown {
  return JSON.parse(base64UrlToBuffer(value).toString('utf8'))
}

function arrayBufferFromBuffer(buffer: Buffer): ArrayBuffer {
  const copy = new Uint8Array(buffer.byteLength)
  copy.set(buffer)
  return copy.buffer
}

function arrayBufferFromString(value: string): ArrayBuffer {
  return textEncoder.encode(value).buffer
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isJwtLike(value: string) {
  return value.split('.').length === 3
}

function extractAccessTokenFromSessionCookie(rawValue: string): string | null {
  const decoded = (() => {
    try {
      return decodeURIComponent(rawValue)
    } catch {
      return rawValue
    }
  })()

  const plain = decoded.startsWith('base64-')
    ? base64UrlToBuffer(decoded.slice('base64-'.length)).toString('utf8')
    : decoded

  if (isJwtLike(plain)) return plain

  try {
    const parsed = JSON.parse(plain) as unknown
    if (Array.isArray(parsed) && typeof parsed[0] === 'string' && isJwtLike(parsed[0])) {
      return parsed[0]
    }
    if (isRecord(parsed)) {
      const direct = parsed.access_token
      if (typeof direct === 'string' && isJwtLike(direct)) return direct

      const currentSession = parsed.currentSession
      if (isRecord(currentSession) && typeof currentSession.access_token === 'string' && isJwtLike(currentSession.access_token)) {
        return currentSession.access_token
      }

      const session = parsed.session
      if (isRecord(session) && typeof session.access_token === 'string' && isJwtLike(session.access_token)) {
        return session.access_token
      }
    }
  } catch {
    return null
  }

  return null
}

function bearerTokenFromRequest(request: NextRequest) {
  const authHeader = request.headers.get('authorization') ?? ''
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim()
    if (isJwtLike(token)) return token
  }
  return null
}

function cookieTokenFromRequest(request: NextRequest) {
  const cookies = request.cookies.getAll()
  const grouped = new Map<string, Array<{ index: number; value: string }>>()

  for (const cookie of cookies) {
    const baseName = cookie.name.replace(/\.\d+$/, '')
    if (!/^sb-[A-Za-z0-9_-]+-auth-token$/.test(baseName)) continue
    const suffix = cookie.name.slice(baseName.length)
    const index = suffix.startsWith('.') ? Number.parseInt(suffix.slice(1), 10) : 0
    const values = grouped.get(baseName) ?? []
    values.push({ index: Number.isFinite(index) ? index : 0, value: cookie.value })
    grouped.set(baseName, values)
  }

  for (const values of grouped.values()) {
    const joined = values
      .sort((a, b) => a.index - b.index)
      .map(part => part.value)
      .join('')
    const token = extractAccessTokenFromSessionCookie(joined)
    if (token) return token
  }

  return null
}

export function readSupabaseAccessToken(request: NextRequest) {
  return bearerTokenFromRequest(request) ?? cookieTokenFromRequest(request)
}

async function fetchJwks(forceRefresh = false): Promise<SupabaseJwk[]> {
  const now = Date.now()
  if (!forceRefresh && jwksCache && jwksCache.expiresAt > now) return jwksCache.keys

  const res = await fetch(`${supabaseUrl()}/auth/v1/.well-known/jwks.json`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(5_000),
  })
  if (!res.ok) throw new Error(`Supabase JWKS fetch failed: ${res.status}`)
  const json = await res.json() as unknown
  const keys = isRecord(json) && Array.isArray(json.keys)
    ? json.keys.filter(isRecord) as SupabaseJwk[]
    : []
  jwksCache = {
    keys,
    expiresAt: now + JWKS_CACHE_TTL_MS,
  }
  return keys
}

function hashNameForAlg(alg: string) {
  if (alg.endsWith('256')) return 'SHA-256'
  if (alg.endsWith('384')) return 'SHA-384'
  if (alg.endsWith('512')) return 'SHA-512'
  throw new Error(`Unsupported JWT alg: ${alg}`)
}

function ecdsaCurveForAlg(alg: string) {
  if (alg === 'ES256') return 'P-256'
  if (alg === 'ES384') return 'P-384'
  if (alg === 'ES512') return 'P-521'
  throw new Error(`Unsupported JWT alg: ${alg}`)
}

function keyAlgorithmForJwt(alg: string) {
  if (alg.startsWith('RS')) return { name: 'RSASSA-PKCS1-v1_5', hash: hashNameForAlg(alg) }
  if (alg.startsWith('PS')) return { name: 'RSA-PSS', hash: hashNameForAlg(alg) }
  if (alg.startsWith('ES')) return { name: 'ECDSA', namedCurve: ecdsaCurveForAlg(alg) }
  throw new Error(`Unsupported JWT alg: ${alg}`)
}

function verifyAlgorithmForJwt(alg: string) {
  if (alg.startsWith('PS')) {
    const saltLength = alg.endsWith('256') ? 32 : alg.endsWith('384') ? 48 : 64
    return { name: 'RSA-PSS', saltLength }
  }
  if (alg.startsWith('ES')) return { name: 'ECDSA', hash: hashNameForAlg(alg) }
  if (alg.startsWith('RS')) return { name: 'RSASSA-PKCS1-v1_5' }
  throw new Error(`Unsupported JWT alg: ${alg}`)
}

async function verifyAsymmetricJwtSignature(
  header: JwtHeader,
  signingInput: string,
  signature: Buffer,
) {
  const alg = header.alg
  if (!alg) throw new Error('JWT alg is missing')
  const keys = await fetchJwks()
  let jwk = keys.find(key => typeof key.kid === 'string' && key.kid === header.kid)
  if (!jwk && !header.kid && keys.length === 1) jwk = keys[0]
  if (!jwk) {
    const refreshed = await fetchJwks(true)
    jwk = refreshed.find(key => typeof key.kid === 'string' && key.kid === header.kid)
  }
  if (!jwk) throw new Error('JWT signing key not found')

  const key = await globalThis.crypto.subtle.importKey(
    'jwk',
    jwk,
    keyAlgorithmForJwt(alg),
    false,
    ['verify'],
  )

  return globalThis.crypto.subtle.verify(
    verifyAlgorithmForJwt(alg),
    key,
    arrayBufferFromBuffer(signature),
    arrayBufferFromString(signingInput),
  )
}

async function verifyLegacyHmacJwtSignature(
  alg: string,
  signingInput: string,
  signature: Buffer,
) {
  if (alg !== 'HS256') throw new Error(`Unsupported legacy JWT alg: ${alg}`)
  const secret = process.env.SUPABASE_JWT_SECRET || process.env.SUPABASE_AUTH_JWT_SECRET
  if (!secret) return false
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    arrayBufferFromString(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  )
  return globalThis.crypto.subtle.verify(
    'HMAC',
    key,
    arrayBufferFromBuffer(signature),
    arrayBufferFromString(signingInput),
  )
}

function validateClaims(claims: SupabaseJwtClaims) {
  const now = Math.floor(Date.now() / 1000)
  if (!claims.sub || typeof claims.sub !== 'string') throw new Error('JWT sub is missing')
  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_TOLERANCE_SECONDS < now) {
    throw new Error('JWT is expired')
  }
  if (typeof claims.nbf === 'number' && claims.nbf - CLOCK_TOLERANCE_SECONDS > now) {
    throw new Error('JWT is not active yet')
  }

  const expectedAud = expectedAudience()
  const aud = claims.aud
  const audienceOk = Array.isArray(aud)
    ? aud.includes(expectedAud)
    : aud === expectedAud
  if (!audienceOk) throw new Error('JWT aud is invalid')

  const issuer = claims.iss
  const issuerOk = issuer === expectedIssuer() || issuer === 'supabase'
  if (!issuerOk) throw new Error('JWT iss is invalid')
}

export async function verifySupabaseJwt(token: string): Promise<SupabaseJwtClaims> {
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('Invalid JWT shape')
  const [headerPart, payloadPart, signaturePart] = parts
  const header = base64UrlToJson(headerPart) as JwtHeader
  const claims = base64UrlToJson(payloadPart) as SupabaseJwtClaims
  const alg = header.alg
  if (!alg || alg === 'none') throw new Error('JWT alg is invalid')

  const signingInput = `${headerPart}.${payloadPart}`
  const signature = base64UrlToBuffer(signaturePart)
  const verified = alg.startsWith('HS')
    ? await verifyLegacyHmacJwtSignature(alg, signingInput, signature)
    : await verifyAsymmetricJwtSignature(header, signingInput, signature)

  if (!verified) throw new Error('JWT signature is invalid')
  validateClaims(claims)
  return claims
}

export async function authenticateSupabaseRequest(
  request: NextRequest,
  supabase?: SupabaseLikeWithAuth,
  options: { allowSupabaseFallback?: boolean } = {},
): Promise<SupabaseRequestAuth | null> {
  const localDevAuth = getLocalDevAuthForRequest(request)
  if (localDevAuth) {
    return {
      user: localDevAuth.user,
      claims: null,
      source: 'local_dev',
    }
  }

  const token = readSupabaseAccessToken(request)
  if (token) {
    try {
      const claims = await verifySupabaseJwt(token)
      return {
        user: {
          id: claims.sub,
          email: typeof claims.email === 'string' ? claims.email : null,
        },
        claims,
        source: 'jwt',
      }
    } catch {
      // Fall through to Supabase Auth only for compatibility with stale cookies.
    }
  }

  if (options.allowSupabaseFallback === false || !supabase?.auth?.getUser) return null

  const { data } = await supabase.auth.getUser()
  const fallbackUser = data?.user
  if (!fallbackUser?.id) return null
  return {
    user: {
      id: fallbackUser.id,
      email: fallbackUser.email ?? null,
    },
    claims: null,
    source: 'supabase',
  }
}
