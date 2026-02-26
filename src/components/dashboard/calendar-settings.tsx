"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Calendar, Check, AlertTriangle, RefreshCw, Link2, Unlink, Download, Settings2, Mail } from "lucide-react"
import { format } from "date-fns"
import { ja } from "date-fns/locale"
import { cn } from "@/lib/utils"

interface CalendarStatus {
  isConnected: boolean
  isSyncEnabled: boolean
  syncStatus: 'idle' | 'syncing' | 'error'
  lastSyncedAt: string | null
  tokenExpired?: boolean
  linkedAccount?: {
    name: string | null
    email: string
    picture: string | null
  } | null
}

interface CalendarInfo {
  google_calendar_id: string
  name: string
  background_color?: string
}

interface CalendarSettingsProps {
  compact?: boolean
}

const IMPORT_PERIOD_OPTIONS = [
  { value: '7', label: '1週間' },
  { value: '30', label: '1ヶ月' },
  { value: '90', label: '3ヶ月' },
]

// LocalStorage keys
const STORAGE_KEY_AUTO_IMPORT = 'shikumika_auto_import_enabled'
const STORAGE_KEY_IMPORT_PERIOD = 'shikumika_import_period_days'
const STORAGE_KEY_IMPORT_CALENDARS = 'shikumika_import_calendar_ids'

export function CalendarSettings({ compact = false }: CalendarSettingsProps) {
  const [status, setStatus] = useState<CalendarStatus>({
    isConnected: false,
    isSyncEnabled: false,
    syncStatus: 'idle',
    lastSyncedAt: null
  })
  const [isLoading, setIsLoading] = useState(true)
  const [isSyncing, setIsSyncing] = useState(false)

  // New settings (localStorage for now)
  const [autoImportEnabled, setAutoImportEnabled] = useState(true)
  const [importPeriod, setImportPeriod] = useState('30')
  const [calendars, setCalendars] = useState<CalendarInfo[]>([])
  const [selectedCalendarIds, setSelectedCalendarIds] = useState<Set<string>>(new Set())
  const [showCalendarSelect, setShowCalendarSelect] = useState(false)

  useEffect(() => {
    fetchStatus()
    loadLocalSettings()
  }, [])

  const loadLocalSettings = () => {
    // Load from localStorage
    const savedAutoImport = localStorage.getItem(STORAGE_KEY_AUTO_IMPORT)
    const savedPeriod = localStorage.getItem(STORAGE_KEY_IMPORT_PERIOD)
    const savedCalendars = localStorage.getItem(STORAGE_KEY_IMPORT_CALENDARS)

    if (savedAutoImport !== null) {
      setAutoImportEnabled(savedAutoImport === 'true')
    }
    if (savedPeriod) {
      setImportPeriod(savedPeriod)
    }
    if (savedCalendars) {
      try {
        setSelectedCalendarIds(new Set(JSON.parse(savedCalendars)))
      } catch {}
    }
  }

  const fetchStatus = async () => {
    try {
      const response = await fetch('/api/calendar/status')
      if (response.ok) {
        const data = await response.json()
        setStatus(data)
      }
    } catch (error) {
      console.error('Failed to fetch calendar status:', error)
    } finally {
      setIsLoading(false)
    }
  }

  // Fetch calendars when connected
  useEffect(() => {
    if (status.isConnected) {
      fetch('/api/calendars')
        .then(res => res.json())
        .then(data => {
          if (data.calendars) {
            setCalendars(data.calendars)
          }
        })
        .catch(console.error)
    }
  }, [status.isConnected])

  const handleConnect = () => {
    window.location.href = '/api/calendar/connect'
  }

  const handleDisconnect = async () => {
    if (!confirm('Googleカレンダーとの連携を解除しますか？\n保存されているトークンが削除されます。')) {
      return
    }

    setIsLoading(true)
    try {
      const response = await fetch('/api/calendar/disconnect', {
        method: 'POST'
      })

      if (response.ok) {
        setStatus({
          isConnected: false,
          isSyncEnabled: false,
          syncStatus: 'idle',
          lastSyncedAt: null,
          linkedAccount: null,
        })
      } else {
        throw new Error('Failed to disconnect')
      }
    } catch (error) {
      console.error('Failed to disconnect calendar:', error)
      alert('連携解除に失敗しました')
    } finally {
      setIsLoading(false)
    }
  }

  const handleManualSync = async () => {
    setIsSyncing(true)
    try {
      // Trigger calendar event refetch
      const response = await fetch('/api/calendar/sync', { method: 'POST' })
      if (response.ok) {
        await response.json()
        setStatus(prev => ({ ...prev, lastSyncedAt: new Date().toISOString() }))
      }
    } catch (error) {
      console.error('Manual sync error:', error)
    } finally {
      setIsSyncing(false)
    }
  }

  const handleAutoImportToggle = (enabled: boolean) => {
    setAutoImportEnabled(enabled)
    localStorage.setItem(STORAGE_KEY_AUTO_IMPORT, String(enabled))
  }

  const handlePeriodChange = (period: string) => {
    setImportPeriod(period)
    localStorage.setItem(STORAGE_KEY_IMPORT_PERIOD, period)
  }

  const handleCalendarToggle = (calendarId: string) => {
    setSelectedCalendarIds(prev => {
      const next = new Set(prev)
      if (next.has(calendarId)) {
        next.delete(calendarId)
      } else {
        next.add(calendarId)
      }
      localStorage.setItem(STORAGE_KEY_IMPORT_CALENDARS, JSON.stringify([...next]))
      return next
    })
  }

  // Compact mode (for header)
  if (compact) {
    if (isLoading) {
      return <RefreshCw className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
    }

    if (!status.isConnected) {
      return (
        <Button
          onClick={handleConnect}
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
        >
          <Calendar className="w-3.5 h-3.5 mr-1" />
          連携
        </Button>
      )
    }

    if (status.tokenExpired) {
      return (
        <Button
          onClick={handleConnect}
          size="sm"
          variant="ghost"
          className="h-7 text-xs text-amber-500"
        >
          <AlertTriangle className="w-3.5 h-3.5 mr-1" />
          再連携
        </Button>
      )
    }

    return (
      <div className="flex items-center gap-1">
        <div className="flex items-center gap-1 px-2 py-0.5 bg-green-500/10 rounded text-[10px] text-green-600">
          <Check className="w-3 h-3" />
          <span>連携済み</span>
        </div>
      </div>
    )
  }

  // Full mode (for settings page)
  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <RefreshCw className="w-4 h-4 animate-spin" />
            読み込み中...
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="h-5 w-5" />
          カレンダー連携
        </CardTitle>
        <CardDescription>
          Googleカレンダーとの連携設定を管理できます
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 接続状態 */}
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div className="flex items-center gap-3">
            {status.isConnected && !status.tokenExpired ? (
              <Check className="h-5 w-5 text-green-500" />
            ) : status.isConnected && status.tokenExpired ? (
              <AlertTriangle className="h-5 w-5 text-amber-500" />
            ) : (
              <Unlink className="h-5 w-5 text-muted-foreground" />
            )}
            <div>
              <p className="text-sm font-medium">Google カレンダー</p>
              <p className="text-xs text-muted-foreground">
                {!status.isConnected && '未連携'}
                {status.isConnected && !status.tokenExpired && '連携中'}
                {status.isConnected && status.tokenExpired && 'トークンが期限切れです。再連携してください'}
              </p>
            </div>
          </div>

          {/* アクションボタン */}
          <div className="flex items-center gap-2">
            {status.isConnected && !status.tokenExpired && (
              <Button
                onClick={handleManualSync}
                size="sm"
                variant="outline"
                disabled={isSyncing}
              >
                <RefreshCw className={cn("h-4 w-4", isSyncing && "animate-spin")} />
              </Button>
            )}
            {!status.isConnected ? (
              <Button onClick={handleConnect} size="sm">
                <Link2 className="h-4 w-4 mr-2" />
                連携する
              </Button>
            ) : status.tokenExpired ? (
              <Button onClick={handleConnect} size="sm" variant="outline" className="text-amber-600 border-amber-300 hover:bg-amber-50">
                <RefreshCw className="h-4 w-4 mr-2" />
                再連携
              </Button>
            ) : (
              <Button
                onClick={handleDisconnect}
                size="sm"
                variant="outline"
                className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <Unlink className="h-4 w-4 mr-2" />
                連携解除
              </Button>
            )}
          </div>
        </div>

        {status.isConnected && (
          <div className="rounded-lg border bg-muted/20 p-3">
            <p className="text-xs font-medium text-muted-foreground mb-2">連携アカウント</p>
            <div className="flex items-center gap-3">
              {status.linkedAccount?.picture ? (
                <Image
                  src={status.linkedAccount.picture}
                  alt="Google account avatar"
                  width={40}
                  height={40}
                  className="h-10 w-10 rounded-full border object-cover"
                  referrerPolicy="no-referrer"
                  unoptimized
                />
              ) : (
                <div className="h-10 w-10 rounded-full border bg-background flex items-center justify-center text-sm font-semibold">
                  {(status.linkedAccount?.name || status.linkedAccount?.email || "G").charAt(0).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">
                  {status.linkedAccount?.name || 'Googleアカウント'}
                </p>
                {status.linkedAccount?.email ? (
                  <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
                    <Mail className="h-3 w-3 shrink-0" />
                    <span>{status.linkedAccount.email}</span>
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    アカウント情報を取得中です
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 最終同期時刻 */}
        {status.lastSyncedAt && (
          <p className="text-xs text-muted-foreground px-1">
            最終同期: {format(new Date(status.lastSyncedAt), 'yyyy/MM/dd HH:mm', { locale: ja })}
          </p>
        )}

        {/* トークン期限切れ時の警告 */}
        {status.isConnected && status.tokenExpired && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3">
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Googleカレンダーのアクセストークンが期限切れになりました。
              「再連携」ボタンからGoogleアカウントに再ログインしてください。
            </p>
          </div>
        )}

        {/* 自動取り込み設定（連携中のみ表示） */}
        {status.isConnected && !status.tokenExpired && (
          <div className="pt-4 border-t space-y-4">
            <div className="flex items-center gap-2">
              <Download className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium">自動取り込み</span>
            </div>

            {/* ON/OFF */}
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <p className="text-sm">イベントをタスクとして取り込む</p>
                <p className="text-xs text-muted-foreground">
                  カレンダーの予定を自動的にタスク化します
                </p>
              </div>
              <Switch
                checked={autoImportEnabled}
                onCheckedChange={handleAutoImportToggle}
              />
            </div>

            {/* 取り込み期間 */}
            {autoImportEnabled && (
              <div className="flex items-center justify-between">
                <span className="text-sm">取り込み期間</span>
                <Select value={importPeriod} onValueChange={handlePeriodChange}>
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {IMPORT_PERIOD_OPTIONS.map(option => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* カレンダー選択 */}
            {autoImportEnabled && calendars.length > 0 && (
              <div className="space-y-2">
                <button
                  onClick={() => setShowCalendarSelect(!showCalendarSelect)}
                  className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
                >
                  <Settings2 className="w-4 h-4" />
                  取り込むカレンダーを選択
                  <span className="text-xs">
                    ({selectedCalendarIds.size === 0 ? 'すべて' : `${selectedCalendarIds.size}件`})
                  </span>
                </button>

                {showCalendarSelect && (
                  <div className="rounded-lg border p-3 space-y-2 bg-muted/30">
                    {calendars.map(cal => (
                      <label
                        key={cal.google_calendar_id}
                        className="flex items-center gap-2 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedCalendarIds.size === 0 || selectedCalendarIds.has(cal.google_calendar_id)}
                          onChange={() => handleCalendarToggle(cal.google_calendar_id)}
                          className="rounded border-gray-300"
                        />
                        <div
                          className="w-3 h-3 rounded"
                          style={{ backgroundColor: cal.background_color || '#039BE5' }}
                        />
                        <span className="text-sm truncate">{cal.name}</span>
                      </label>
                    ))}
                    <p className="text-[10px] text-muted-foreground pt-1">
                      ※ 選択なし = すべてのカレンダーを取り込み
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// Export helpers for use in today-view
export function getAutoImportSettings() {
  if (typeof window === 'undefined') {
    return { enabled: true, periodDays: 30, calendarIds: [] }
  }
  const enabled = localStorage.getItem(STORAGE_KEY_AUTO_IMPORT) !== 'false'
  const periodDays = parseInt(localStorage.getItem(STORAGE_KEY_IMPORT_PERIOD) || '30', 10)
  const calendarIdsJson = localStorage.getItem(STORAGE_KEY_IMPORT_CALENDARS)
  const calendarIds = calendarIdsJson ? JSON.parse(calendarIdsJson) : []
  return { enabled, periodDays, calendarIds }
}
