import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { getLocalDevAuthForHost, isLocalDevAuthHost } from './local-dev-auth'

const ORIGINAL_ENV = { ...process.env }

describe('local-dev-auth', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV }
    delete process.env.FOCUSMAP_DEV_AUTH_ALLOW_TUNNEL
    delete process.env.NEXT_PUBLIC_FOCUSMAP_DEV_AUTH_ALLOW_TUNNEL
    delete process.env.FOCUSMAP_DEV_AUTH
    delete process.env.FOCUSMAP_LOCAL_DEV_AUTH
    delete process.env.FOCUSMAP_DEV_USER_ID
    delete process.env.FOCUSMAP_LOCAL_USER_ID
    process.env.NODE_ENV = 'test'
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  test('localhost hosts are always accepted for local dev auth', () => {
    expect(isLocalDevAuthHost('localhost:3001')).toBe(true)
    expect(isLocalDevAuthHost('127.0.0.1:3001')).toBe(true)
    expect(isLocalDevAuthHost('focusmap.localhost')).toBe(true)
  })

  test('trycloudflare hosts are rejected unless explicitly enabled', () => {
    expect(isLocalDevAuthHost('phone-preview.trycloudflare.com')).toBe(false)

    process.env.FOCUSMAP_DEV_AUTH_ALLOW_TUNNEL = '1'

    expect(isLocalDevAuthHost('phone-preview.trycloudflare.com')).toBe(true)
  })

  test('trycloudflare lookalike suffixes are not accepted', () => {
    process.env.FOCUSMAP_DEV_AUTH_ALLOW_TUNNEL = '1'

    expect(isLocalDevAuthHost('phone-preview.trycloudflare.com.evil.example')).toBe(false)
  })

  test('enabled tunnel host can use configured local dev user', () => {
    process.env.FOCUSMAP_DEV_AUTH = '1'
    process.env.FOCUSMAP_DEV_AUTH_ALLOW_TUNNEL = '1'
    process.env.FOCUSMAP_DEV_USER_ID = 'user-local'
    process.env.FOCUSMAP_DEV_USER_EMAIL = 'local@example.com'

    expect(getLocalDevAuthForHost('phone-preview.trycloudflare.com')).toEqual({
      user: {
        id: 'user-local',
        email: 'local@example.com',
      },
    })
  })
})
