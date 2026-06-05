import { createClient, type Client } from '@libsql/client'

let client: Client | null = null

export class TursoConfigurationError extends Error {
  constructor(message = 'Turso is not configured') {
    super(message)
    this.name = 'TursoConfigurationError'
  }
}

function readDatabaseUrl() {
  return process.env.TURSO_DATABASE_URL || process.env.LIBSQL_DATABASE_URL || ''
}

function readAuthToken() {
  return process.env.TURSO_AUTH_TOKEN || process.env.LIBSQL_AUTH_TOKEN || undefined
}

export function isTursoConfigured() {
  return Boolean(readDatabaseUrl())
}

export function getTursoClient(): Client {
  if (typeof window !== 'undefined') {
    throw new TursoConfigurationError('Turso client is server-only')
  }

  if (client) return client

  const url = readDatabaseUrl()
  if (!url) throw new TursoConfigurationError()

  const authToken = readAuthToken()
  if ((url.startsWith('libsql://') || url.startsWith('https://')) && !authToken) {
    throw new TursoConfigurationError('Turso auth token is required for remote databases')
  }

  client = createClient({ url, authToken })
  return client
}

export function jsonOrNull(value: unknown) {
  if (value === undefined || value === null) return null
  return JSON.stringify(value)
}

export function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string' || !value) return null
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}
