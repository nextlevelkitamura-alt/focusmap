import type { NextRequest } from 'next/server'

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on'])
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

export type LocalDevAuthUser = {
  id: string
  email: string
}

export type LocalDevAuthContext = {
  user: LocalDevAuthUser
}

function enabled(value: string | undefined) {
  return TRUE_VALUES.has((value ?? '').toLowerCase())
}

function configuredUserId() {
  return process.env.FOCUSMAP_DEV_USER_ID || process.env.FOCUSMAP_LOCAL_USER_ID || ''
}

function configuredEmail() {
  return process.env.FOCUSMAP_DEV_USER_EMAIL || 'local-dev@focusmap.local'
}

function normalizeHost(host: string | null | undefined) {
  const first = (host ?? '').split(',')[0]?.trim().toLowerCase() ?? ''
  if (!first) return ''
  if (first.startsWith('[')) {
    const end = first.indexOf(']')
    return end > 0 ? first.slice(1, end) : first
  }
  return first.split(':')[0] ?? ''
}

export function isLocalDevAuthEnabled() {
  if (process.env.NODE_ENV === 'production') return false
  if (!enabled(process.env.FOCUSMAP_DEV_AUTH) && !enabled(process.env.FOCUSMAP_LOCAL_DEV_AUTH)) return false
  return Boolean(configuredUserId())
}

export function isLocalDevAuthHost(host: string | null | undefined) {
  const normalized = normalizeHost(host)
  return LOCAL_HOSTS.has(normalized) || normalized.endsWith('.localhost')
}

export function getLocalDevAuthUser() {
  if (!isLocalDevAuthEnabled()) return null
  return {
    id: configuredUserId(),
    email: configuredEmail(),
  }
}

export function getLocalDevAuthForHost(host: string | null | undefined): LocalDevAuthContext | null {
  const user = getLocalDevAuthUser()
  if (!user || !isLocalDevAuthHost(host)) return null

  return { user }
}

export function getLocalDevAuthForRequest(request: NextRequest): LocalDevAuthContext | null {
  return getLocalDevAuthForHost(request.headers.get('host'))
}
