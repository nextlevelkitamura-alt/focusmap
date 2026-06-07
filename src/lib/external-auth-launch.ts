'use client'

declare global {
  interface Window {
    focusmapDesktop?: {
      openExternal?: (url: string) => Promise<unknown>
      getWebAuthOrigin?: () => Promise<string>
      getAutomationStatus?: () => Promise<FocusmapDesktopAutomationStatus>
      connectAutomation?: () => Promise<FocusmapDesktopAutomationActionResult>
      disconnectAutomation?: () => Promise<FocusmapDesktopAutomationActionResult>
      saveAuthSession?: (session: FocusmapDesktopAuthSession) => Promise<{ ok: boolean; error?: string }>
      loadAuthSession?: () => Promise<{
        ok: boolean
        error?: string
        session?: FocusmapDesktopAuthSession | null
      }>
      clearAuthSession?: () => Promise<{ ok: boolean; error?: string }>
      consumeAuthSession?: (nonce: string, origin?: string) => Promise<{
        ok: boolean
        status: number
        payload?: {
          error?: string
          access_token?: string
          refresh_token?: string
          user_id?: string
          status?: string
        } | null
      }>
    }
    ReactNativeWebView?: {
      postMessage: (message: string) => void
    }
  }
}

export type FocusmapDesktopAuthSession = {
  access_token: string
  refresh_token: string
  expires_at?: number | null
  user_id?: string | null
}

export type FocusmapDesktopAutomationServiceStatus = {
  ready?: boolean
  managed?: boolean
  configured?: boolean
  available?: boolean
  scriptAvailable?: boolean
  origin?: string
  port?: number
  configPath?: string
  cliPath?: string
  scriptPath?: string
}

export type FocusmapDesktopAutomationStatus = {
  ok: boolean
  available: boolean
  connected: boolean
  timestamp: string
  app: FocusmapDesktopAutomationServiceStatus
  agent: FocusmapDesktopAutomationServiceStatus
  codex: FocusmapDesktopAutomationServiceStatus
  paths?: {
    repoRoot?: string
    logPath?: string
  }
}

export type FocusmapDesktopAutomationActionResult = {
  ok: boolean
  message: string
  status?: FocusmapDesktopAutomationStatus
  results?: Record<string, { ok: boolean; message: string }>
}

function currentSearchParams() {
  if (typeof window === 'undefined') return new URLSearchParams()
  return new URLSearchParams(window.location.search)
}

export function isFocusmapIosAppShell() {
  if (typeof window === 'undefined') return false
  const params = currentSearchParams()
  return (
    params.get('source') === 'ios-app' ||
    params.get('standalone') === '1' ||
    window.navigator.userAgent.includes('FocusmapIOS')
  )
}

export function isFocusmapDesktopShell() {
  if (typeof window === 'undefined') return false
  const params = currentSearchParams()
  return (
    params.get('desktop') === '1' ||
    params.get('source') === 'mac' ||
    Boolean(window.focusmapDesktop?.openExternal)
  )
}

export async function openExternalAuthUrl(url: string) {
  if (typeof window === 'undefined') return

  if (window.focusmapDesktop?.openExternal) {
    await window.focusmapDesktop.openExternal(url)
    return
  }

  if (window.ReactNativeWebView?.postMessage) {
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'focusmap:openExternal',
      url,
    }))
    return
  }

  window.location.href = url
}

export function startCalendarOAuth(next = '/dashboard') {
  if (typeof window === 'undefined') return

  const url = new URL('/api/calendar/connect', window.location.origin)
  url.searchParams.set('next', next)

  if (isFocusmapIosAppShell()) {
    url.searchParams.set('app_oauth', 'ios')
  }

  window.location.href = url.toString()
}
