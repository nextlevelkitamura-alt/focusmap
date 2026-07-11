import { createClient, type Client } from '@libsql/client'

let client: Client | null = null
let personalOsBoardClient: Client | null = null
let personalOsInboxClient: Client | null = null

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

function createConfiguredClient(url: string, authToken?: string): Client {
  if (!url) throw new TursoConfigurationError()

  if ((url.startsWith('libsql://') || url.startsWith('https://')) && !authToken) {
    throw new TursoConfigurationError('Turso auth token is required for remote databases')
  }

  return createClient({ url, authToken })
}

function assertServerOnly() {
  if (typeof window !== 'undefined') {
    throw new TursoConfigurationError('Turso client is server-only')
  }
}

export function isTursoConfigured() {
  return Boolean(readDatabaseUrl())
}

export function getTursoClient(): Client {
  assertServerOnly()

  if (client) return client

  client = createConfiguredClient(readDatabaseUrl(), readAuthToken())
  return client
}

export function getPersonalOsBoardClient(): Client {
  assertServerOnly()

  if (personalOsBoardClient) return personalOsBoardClient

  personalOsBoardClient = createConfiguredClient(
    process.env.PERSONAL_OS_BOARD_DATABASE_URL || '',
    process.env.PERSONAL_OS_BOARD_AUTH_TOKEN || undefined,
  )
  return personalOsBoardClient
}

export function getPersonalOsInboxClient(): Client {
  assertServerOnly()

  if (personalOsInboxClient) return personalOsInboxClient

  personalOsInboxClient = createConfiguredClient(
    process.env.PERSONAL_OS_INBOX_DATABASE_URL || '',
    process.env.PERSONAL_OS_INBOX_AUTH_TOKEN || undefined,
  )
  return personalOsInboxClient
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
