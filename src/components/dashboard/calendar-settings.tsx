"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Calendar, Check, AlertTriangle, RefreshCw, Link2, Unlink, Download, Mail, CheckCircle2 } from "lucide-react"
import { format } from "date-fns"
import { ja } from "date-fns/locale"
import { cn } from "@/lib/utils"
import { useCalendars } from "@/hooks/useCalendars"
import { startCalendarOAuth } from "@/lib/external-auth-launch"

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

interface CalendarSettingsProps {
  compact?: boolean
}

const IMPORT_PERIOD_OPTIONS = [
  { value: '7', label: '1週間' },
  { value: '30', label: '1ヶ月' },
  { value: '90', label: '3ヶ月' },
]

// LocalStorage keys（auto_import_enabled / period_days はUI設定のみのため localStorage 継続。
// 取り込みカレンダー選択はDB側 `selected` カラムに一本化したので localStorage は廃止）
const STORAGE_KEY_AUTO_IMPORT = 'shikumika_auto_import_enabled'
const STORAGE_KEY_IMPORT_PERIOD = 'shikumika_import_period_days'

function GoogleCalendarIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path fill="#fff" d="M8 9.5h32a3 3 0 0 1 3 3V40a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V12.5a3 3 0 0 1 3-3Z" />
      <path fill="#1a73e8" d="M8 5h32a3 3 0 0 1 3 3v9H5V8a3 3 0 0 1 3-3Z" />
      <path fill="#ea4335" d="M5 17h10V43H8a3 3 0 0 1-3-3V17Z" />
      <path fill="#fbbc04" d="M33 17h10v23a3 3 0 0 1-3 3h-7V17Z" />
      <path fill="#34a853" d="M15 35h18v8H15z" />
      <path fill="#1a73e8" d="M15 17h18v18H15z" opacity=".08" />
      <text x="24" y="31" textAnchor="middle" fontSize="14" fontWeight="700" fill="#3c4043" fontFamily="Arial, sans-serif">
        31
      </text>
    </svg>
  )
}

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

  // カレンダー選択はDB側 `selected` を正規ストアにし、useCalendars を信頼の源にする。
  // 旧localStorage管理は実際の予定取得に何の影響もない死コードだったため廃止。
  const {
    calendars,
    isLoading: calendarsLoading,
    fetchCalendars,
    toggleCalendar,
    toggleAll,
  } = useCalendars()

  useEffect(() => {
    fetchStatus()
    loadLocalSettings()
  }, [])

  const loadLocalSettings = () => {
    // Load from localStorage
    const savedAutoImport = localStorage.getItem(STORAGE_KEY_AUTO_IMPORT)
    const savedPeriod = localStorage.getItem(STORAGE_KEY_IMPORT_PERIOD)

    if (savedAutoImport !== null) {
      setAutoImportEnabled(savedAutoImport === 'true')
    }
    if (savedPeriod) {
      setImportPeriod(savedPeriod)
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

  // useCalendars が自前で /api/calendars をfetchするので、ここでの個別fetchは不要

  const handleConnect = () => {
    startCalendarOAuth()
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
      await Promise.all([fetchStatus(), fetchCalendars(true)])
    } catch (error) {
      console.error('Calendar refresh error:', error)
    } finally {
      setIsSyncing(false)
    }
  }

  const selectedCalendarCount = calendars.filter(calendar => calendar.selected).length

  const handleAutoImportToggle = (enabled: boolean) => {
    setAutoImportEnabled(enabled)
    localStorage.setItem(STORAGE_KEY_AUTO_IMPORT, String(enabled))
  }

  const handlePeriodChange = (period: string) => {
    setImportPeriod(period)
    localStorage.setItem(STORAGE_KEY_IMPORT_PERIOD, period)
  }

  // カレンダーチェック切替は useCalendars.toggleCalendar(id, selected) を直接呼ぶ
  // （DB `selected` カラムに反映 → useCalendarEvents が selected のみ fetch）

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
      <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-[#202020] dark:shadow-none">
        <div className="flex min-h-28 items-center justify-center gap-2 text-sm text-zinc-400">
          <RefreshCw className="h-4 w-4 animate-spin" />
          読み込み中...
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-white/10 dark:bg-[#202020] dark:shadow-none">
        <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
          <div className="flex min-h-[220px] flex-col justify-between gap-6">
            <div className="flex items-start gap-4">
              <GoogleCalendarIcon className="h-14 w-14 shrink-0 rounded-xl shadow-sm" />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">Google Calendar</h2>
                  <span className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
                    status.isConnected && !status.tokenExpired
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-200"
                      : status.tokenExpired
                        ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-200"
                        : "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-400"
                  )}>
                    {status.isConnected && !status.tokenExpired ? <CheckCircle2 className="h-3 w-3" /> : <Unlink className="h-3 w-3" />}
                    {!status.isConnected && '未連携'}
                    {status.isConnected && !status.tokenExpired && '連携中'}
                    {status.isConnected && status.tokenExpired && '再連携が必要'}
                  </span>
                </div>
                <p className="mt-3 max-w-xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                  予定をTodayに表示し、選択したカレンダーのイベントをタスクとして取り込めます。
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {status.isConnected && !status.tokenExpired && (
                <Button
                  onClick={handleManualSync}
                  size="sm"
                  variant="outline"
                  disabled={isSyncing}
                  className="border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-100 dark:hover:bg-white/[0.08]"
                >
                  <RefreshCw className={cn("h-4 w-4", isSyncing && "animate-spin")} />
                  更新
                </Button>
              )}
              {!status.isConnected ? (
                <Button onClick={handleConnect} size="sm" className="bg-blue-500 text-white hover:bg-blue-400">
                  <Link2 className="h-4 w-4" />
                  Googleカレンダーと連携
                </Button>
              ) : status.tokenExpired ? (
                <Button onClick={handleConnect} size="sm" className="bg-amber-500 text-zinc-950 hover:bg-amber-400">
                  <RefreshCw className="h-4 w-4" />
                  Googleで再連携
                </Button>
              ) : null}
            </div>

            {status.lastSyncedAt && (
              <p className="text-xs text-zinc-500">
                最終同期: {format(new Date(status.lastSyncedAt), 'yyyy/MM/dd HH:mm', { locale: ja })}
              </p>
            )}
          </div>

          <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-white/10 dark:bg-[#171717]">
            <p className="text-xs font-medium text-zinc-500">連携アカウント</p>
            {status.isConnected ? (
              <div className="mt-4 flex flex-col gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  {status.linkedAccount?.picture ? (
                    <Image
                      src={status.linkedAccount.picture}
                      alt="Google account avatar"
                      width={48}
                      height={48}
                      className="h-12 w-12 rounded-full border border-zinc-200 object-cover dark:border-white/10"
                      referrerPolicy="no-referrer"
                      unoptimized
                    />
                  ) : (
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white text-sm font-semibold text-zinc-900 dark:border-white/10 dark:bg-white/[0.06] dark:text-zinc-100">
                      {(status.linkedAccount?.name || status.linkedAccount?.email || "G").charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {status.linkedAccount?.name || 'Googleアカウント'}
                    </p>
                    {status.linkedAccount?.email ? (
                      <p className="mt-1 flex min-w-0 items-center gap-1 text-xs text-zinc-500">
                        <Mail className="h-3 w-3 shrink-0" />
                        <span className="truncate">{status.linkedAccount.email}</span>
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-zinc-500">アカウント情報を取得中です</p>
                    )}
                  </div>
                </div>
                <Button
                  onClick={handleDisconnect}
                  size="sm"
                  variant="outline"
                  className="w-full border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-400/25 dark:bg-red-400/10 dark:text-red-200 dark:hover:bg-red-400/15 dark:hover:text-red-100"
                >
                  <Unlink className="h-4 w-4" />
                  Googleカレンダーの連携を解除
                </Button>
              </div>
            ) : (
              <div className="mt-4 rounded-lg border border-dashed border-zinc-200 p-4 dark:border-white/10">
                <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">未連携です</p>
                <p className="mt-2 text-xs leading-5 text-zinc-500">
                  Googleアカウントを接続すると、予定表示とイベント取り込みを使えます。
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      {status.isConnected && status.tokenExpired && (
        <div className="rounded-xl border border-amber-400/25 bg-amber-400/10 p-4">
          <p className="text-sm text-amber-800 dark:text-amber-100">
            Googleカレンダーのアクセストークンが期限切れです。再連携してください。
          </p>
        </div>
      )}

      {status.isConnected && !status.tokenExpired && (
        <section className="grid gap-5 xl:grid-cols-[minmax(300px,0.8fr)_minmax(0,1.2fr)]">
          <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#202020] dark:shadow-none">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-700 dark:bg-blue-400/10 dark:text-blue-200">
                  <Download className="h-4 w-4" />
                </span>
                <div>
                  <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">イベント取り込み</h2>
                  <p className="mt-1 text-xs leading-5 text-zinc-500">Googleカレンダーの予定をタスクとして取り込みます。</p>
                </div>
              </div>
              <Switch
                checked={autoImportEnabled}
                onCheckedChange={handleAutoImportToggle}
                className="data-[state=checked]:bg-blue-500"
              />
            </div>

            <div className={cn("mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-1", !autoImportEnabled && "opacity-50")}>
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-white/10 dark:bg-[#171717]">
                <p className="text-xs text-zinc-500">取り込み期間</p>
                <Select value={importPeriod} onValueChange={handlePeriodChange} disabled={!autoImportEnabled}>
                  <SelectTrigger className="mt-3 h-9 w-full border border-zinc-200 bg-white text-zinc-950 shadow-none focus:ring-blue-400 dark:border-0 dark:bg-white/[0.07] dark:text-zinc-100">
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

              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-white/10 dark:bg-[#171717]">
                <p className="text-xs text-zinc-500">取り込み対象</p>
                <p className="mt-3 text-2xl font-semibold text-zinc-950 dark:text-zinc-100">
                  {calendarsLoading ? '-' : selectedCalendarCount}
                  <span className="ml-1 text-sm font-normal text-zinc-500">/ {calendars.length}件</span>
                </p>
              </div>
            </div>
          </div>

          <div className={cn("rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#202020] dark:shadow-none", !autoImportEnabled && "opacity-60")}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">取り込むカレンダー</h2>
                <p className="mt-1 text-xs leading-5 text-zinc-500">チェックを外したカレンダーの予定はTodayタイムラインに表示されません。</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  disabled={!autoImportEnabled || calendarsLoading || calendars.length === 0}
                  onClick={() => toggleAll(true)}
                  className="border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-200 dark:hover:bg-white/[0.08]"
                >
                  全選択
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  disabled={!autoImportEnabled || calendarsLoading || calendars.length === 0}
                  onClick={() => toggleAll(false)}
                  className="border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-200 dark:hover:bg-white/[0.08]"
                >
                  全解除
                </Button>
              </div>
            </div>

            <div className="mt-4">
              {calendarsLoading ? (
                <div className="flex min-h-24 items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 text-xs text-zinc-500 dark:border-white/10 dark:bg-[#171717]">
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  カレンダー一覧を読み込み中...
                </div>
              ) : calendars.length === 0 ? (
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-xs text-zinc-500 dark:border-white/10 dark:bg-[#171717]">
                  取り込めるカレンダーがまだありません。
                </div>
              ) : (
                <div className="grid gap-2 lg:grid-cols-2">
                  {calendars.map(cal => (
                    <label
                      key={cal.id}
                      className={cn(
                        "flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 transition hover:bg-zinc-100 dark:border-white/10 dark:bg-[#171717] dark:hover:bg-white/[0.05]",
                        !autoImportEnabled && "pointer-events-none"
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={cal.selected}
                        disabled={!autoImportEnabled}
                        onChange={(e) => {
                          toggleCalendar(cal.id, e.target.checked).catch(err => {
                            console.error('Failed to toggle calendar:', err)
                          })
                        }}
                        className="h-4 w-4 rounded border-zinc-300 bg-white accent-blue-500 dark:border-zinc-600 dark:bg-zinc-900"
                      />
                      <div
                        className="h-3 w-3 shrink-0 rounded-full"
                        style={{ backgroundColor: cal.background_color || cal.color || '#039BE5' }}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm text-zinc-800 dark:text-zinc-200">
                        {cal.name}
                      </span>
                      {cal.is_primary && (
                        <span className="shrink-0 rounded-full bg-zinc-200 px-2 py-0.5 text-[10px] text-zinc-600 dark:bg-white/[0.06] dark:text-zinc-400">メイン</span>
                      )}
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
