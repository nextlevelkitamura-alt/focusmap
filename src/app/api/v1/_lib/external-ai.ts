import type { Json } from '@/types/database'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function compactText(value: unknown, limit: number): string {
  if (typeof value !== 'string') return ''
  return Array.from(value.trim()).slice(0, limit).join('')
}

export function nullableText(value: unknown, limit: number): string | null {
  const text = compactText(value, limit)
  return text || null
}

export function normalizeLimit(value: string | null, fallback = 50, max = 200) {
  const parsed = Number.parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, 1), max)
}

export function normalizeOffset(value: string | null) {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

export function jsonValue(value: unknown): Json {
  return value as Json
}

export function stringField(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

export function booleanField(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'boolean') return value
  }
  return undefined
}

export function numberField(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return undefined
}

export function arrayField(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (Array.isArray(value)) return value
  }
  return []
}

export function idempotencyKey(headers: Headers) {
  return headers.get('X-Focusmap-Idempotency-Key')?.trim() || null
}

export function titleFromBody(title: unknown, body: unknown, fallback = 'Untitled') {
  const explicitTitle = compactText(title, 160)
  if (explicitTitle) return explicitTitle
  const text = compactText(body, 160)
  if (!text) return fallback
  return text.length > 80 ? `${text.slice(0, 80)}...` : text
}

export function changedMeta(changedResources: string[], extra?: Record<string, unknown>) {
  return {
    changed_resources: changedResources,
    idempotent_replay: false,
    ...(extra ?? {}),
  }
}
