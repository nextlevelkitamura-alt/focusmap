"use client"

import { useEffect, useState, type ReactNode } from "react"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Calendar, Check, AlertTriangle, RefreshCw, Link2, Unlink, Download, Mail, CheckCircle2 } from "lucide-react"
import { format } from "date-fns"
import { ja } from "date-fns/locale"
import { cn } from "@/lib/utils"
import { invalidateCalendarsCache, useCalendars } from "@/hooks/useCalendars"
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

const sectionSurfaceClass = "rounded-lg border border-zinc-200 bg-white shadow-sm dark:border-white/10 dark:bg-[#202020] dark:shadow-none"
const rowDividerClass = "border-t border-zinc-200 dark:border-white/10"

function StatusPill({
  children,
  tone = "neutral",
  icon,
}: {
  children: ReactNode
  tone?: "neutral" | "strong" | "warning" | "danger"
  icon?: ReactNode
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        tone === "neutral" && "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-400",
        tone === "strong" && "border-zinc-300 bg-zinc-100 text-zinc-900 dark:border-white/15 dark:bg-white/10 dark:text-zinc-100",
        tone === "warning" && "border-amber-300/70 bg-amber-50 text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100",
        tone === "danger" && "border-red-300/70 bg-red-50 text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-100"
      )}
    >
      {icon}
      {children}
    </span>
  )
}

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
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false)
  const [disconnectError, setDisconnectError] = useState<string | null>(null)

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
    setIsLoading(true)
    setDisconnectError(null)
    try {
      const response = await fetch('/api/calendar/disconnect', {
        method: 'POST'
      })

      if (response.ok) {
        invalidateCalendarsCache()
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
      setDisconnectError('連携解除に失敗しました')
    } finally {
      setIsLoading(false)
      setShowDisconnectDialog(false)
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

  const hasHealthyConnection = status.isConnected && !status.tokenExpired
  const formattedLastSyncedAt = status.lastSyncedAt
    ? format(new Date(status.lastSyncedAt), 'yyyy/MM/dd HH:mm', { locale: ja })
    : null
  const connectionLabel = !status.isConnected
    ? '未接続'
    : status.tokenExpired
      ? '再連携が必要'
      : status.syncStatus === 'error'
        ? '要確認'
        : isSyncing || status.syncStatus === 'syncing'
          ? '同期中'
          : '接続中'
  const connectionTone: "neutral" | "strong" | "warning" = !status.isConnected
    ? 'neutral'
    : status.tokenExpired || status.syncStatus === 'error'
      ? 'warning'
      : 'strong'
  const syncStatusLabel = !status.isConnected
    ? '未接続'
    : status.tokenExpired
      ? 'トークン期限切れ'
      : isSyncing || status.syncStatus === 'syncing'
        ? '同期中'
        : status.syncStatus === 'error'
          ? '同期エラー'
          : '待機中'
  const importControlsDisabled = !hasHealthyConnection || !autoImportEnabled
  const calendarSelectionDisabled = !hasHealthyConnection || !autoImportEnabled

  return (
    <div className="space-y-5">
      <section className={cn(sectionSurfaceClass, "overflow-hidden")}>
        <div className="flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <GoogleCalendarIcon className="h-12 w-12 shrink-0 rounded-lg border border-zinc-200 shadow-sm dark:border-white/10" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold text-zinc-950 dark:text-zinc-50">Google Calendar</h2>
                <StatusPill
                  tone={connectionTone}
                  icon={hasHealthyConnection ? <CheckCircle2 className="h-3 w-3" /> : <Unlink className="h-3 w-3" />}
                >
                  {connectionLabel}
                </StatusPill>
              </div>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                Todayの予定表示、タスク化、AIの予定整理で使うGoogle Calendar接続です。
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 lg:justify-end">
            {hasHealthyConnection && (
              <Button
                onClick={handleManualSync}
                size="sm"
                variant="outline"
                disabled={isSyncing}
                className="min-h-10 border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-100 dark:hover:bg-white/[0.08]"
              >
                <RefreshCw className={cn("h-4 w-4", isSyncing && "animate-spin")} />
                更新
              </Button>
            )}
            {!status.isConnected ? (
              <Button onClick={handleConnect} size="sm" className="min-h-10 bg-zinc-950 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200">
                <Link2 className="h-4 w-4" />
                Googleカレンダーと連携
              </Button>
            ) : status.tokenExpired ? (
              <Button onClick={handleConnect} size="sm" className="min-h-10 bg-zinc-950 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200">
                <RefreshCw className="h-4 w-4" />
                Googleで再連携
              </Button>
            ) : null}
          </div>
        </div>

        <div className={cn(rowDividerClass, "grid gap-0 lg:grid-cols-2")}>
          <div className="p-4 sm:p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Linked account</p>
            {status.isConnected ? (
              <div className="mt-4 flex min-w-0 items-center gap-3">
                {status.linkedAccount?.picture ? (
                  <Image
                    src={status.linkedAccount.picture}
                    alt="Google account avatar"
                    width={44}
                    height={44}
                    className="h-11 w-11 rounded-full border border-zinc-200 object-cover dark:border-white/10"
                    referrerPolicy="no-referrer"
                    unoptimized
                  />
                ) : (
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-zinc-50 text-sm font-semibold text-zinc-900 dark:border-white/10 dark:bg-white/[0.06] dark:text-zinc-100">
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
            ) : (
              <div className="mt-4 rounded-lg border border-dashed border-zinc-200 p-4 text-sm text-zinc-500 dark:border-white/10">
                Googleアカウントを接続すると、予定表示とイベント取り込みを使えます。
              </div>
            )}
          </div>

          <div className={cn("p-4 sm:p-5 lg:border-l", rowDividerClass, "lg:border-t-0")}>
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Connection state</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs text-zinc-500">同期状態</p>
                <p className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">{syncStatusLabel}</p>
              </div>
              <div>
                <p className="text-xs text-zinc-500">最終同期</p>
                <p className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {formattedLastSyncedAt || '未同期'}
                </p>
              </div>
              <div>
                <p className="text-xs text-zinc-500">Google同期</p>
                <p className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {status.isSyncEnabled ? '有効' : '無効'}
                </p>
              </div>
              <div>
                <p className="text-xs text-zinc-500">選択カレンダー</p>
                <p className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {calendarsLoading ? '-' : `${selectedCalendarCount} / ${calendars.length}件`}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {status.isConnected && status.tokenExpired && (
        <div className="flex flex-col gap-3 rounded-lg border border-amber-300/70 bg-amber-50 p-4 dark:border-amber-400/30 dark:bg-amber-400/10 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-100" />
            <div>
              <p className="text-sm font-medium text-amber-900 dark:text-amber-50">再連携が必要です</p>
              <p className="mt-1 text-xs leading-5 text-amber-800/80 dark:text-amber-100/80">
                トークン期限切れ中は予定更新とカレンダー選択を停止します。再連携はトークン更新で、連携解除とは別の操作です。
              </p>
            </div>
          </div>
          <Button onClick={handleConnect} size="sm" className="min-h-10 bg-zinc-950 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200">
            <RefreshCw className="h-4 w-4" />
            再連携
          </Button>
        </div>
      )}

      <section className="grid gap-5 xl:grid-cols-[minmax(300px,0.82fr)_minmax(0,1.18fr)]">
        <div className={cn(sectionSurfaceClass, "overflow-hidden")}>
          <div className="flex items-start justify-between gap-4 p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-200">
                <Download className="h-4 w-4" />
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Import behavior</h2>
                  <StatusPill tone={autoImportEnabled && hasHealthyConnection ? "strong" : "neutral"}>
                    {autoImportEnabled ? '取り込みON' : '取り込みOFF'}
                  </StatusPill>
                </div>
                <p className="mt-1 text-xs leading-5 text-zinc-500">
                  選択したカレンダーの予定をTodayに表示し、必要に応じてタスクとして扱います。
                </p>
              </div>
            </div>
            <Switch
              checked={autoImportEnabled}
              onCheckedChange={handleAutoImportToggle}
              disabled={!hasHealthyConnection}
              className="data-[state=checked]:bg-zinc-950 dark:data-[state=checked]:bg-zinc-100"
            />
          </div>

          <div className={cn(rowDividerClass, "divide-y divide-zinc-200 dark:divide-white/10")}>
            <div className={cn("grid gap-3 p-4 sm:grid-cols-[1fr_auto] sm:items-center sm:p-5", !hasHealthyConnection && "opacity-60")}>
              <div>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">取り込み期間</p>
                <p className="mt-1 text-xs leading-5 text-zinc-500">
                  Focusmapへ読み込むGoogle予定の期間です。
                </p>
              </div>
              <Select value={importPeriod} onValueChange={handlePeriodChange} disabled={importControlsDisabled}>
                <SelectTrigger className="h-10 min-w-[150px] border border-zinc-200 bg-white text-zinc-950 shadow-none focus:ring-zinc-400 dark:border-white/10 dark:bg-white/[0.07] dark:text-zinc-100">
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

            <div className={cn("grid gap-3 p-4 sm:grid-cols-[1fr_auto] sm:items-center sm:p-5", !hasHealthyConnection && "opacity-60")}>
              <div>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">取り込み対象</p>
                <p className="mt-1 text-xs leading-5 text-zinc-500">
                  選択したカレンダーだけをToday表示と取り込み対象にします。
                </p>
              </div>
              <p className="text-right text-2xl font-semibold text-zinc-950 dark:text-zinc-100">
                {calendarsLoading ? '-' : selectedCalendarCount}
                <span className="ml-1 text-sm font-normal text-zinc-500">/ {calendars.length}件</span>
              </p>
            </div>
          </div>
        </div>

        <div className={cn(sectionSurfaceClass, "overflow-hidden")}>
          <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Selected calendars</h2>
                <StatusPill>{calendarsLoading ? '確認中' : `${selectedCalendarCount}件選択中`}</StatusPill>
              </div>
              <p className="mt-1 text-xs leading-5 text-zinc-500">
                チェックを外したカレンダーの予定はTodayタイムラインに表示されません。
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={calendarSelectionDisabled || calendarsLoading || calendars.length === 0}
                onClick={() => toggleAll(true)}
                className="min-h-9 border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-200 dark:hover:bg-white/[0.08]"
              >
                全選択
              </Button>
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={calendarSelectionDisabled || calendarsLoading || calendars.length === 0}
                onClick={() => toggleAll(false)}
                className="min-h-9 border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-200 dark:hover:bg-white/[0.08]"
              >
                全解除
              </Button>
            </div>
          </div>

          <div className={cn(rowDividerClass, "p-4 sm:p-5")}>
            {calendarsLoading ? (
              <div className="flex min-h-24 items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 text-xs text-zinc-500 dark:border-white/10 dark:bg-[#171717]">
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                カレンダー一覧を読み込み中...
              </div>
            ) : calendars.length === 0 ? (
              <div className="rounded-lg border border-dashed border-zinc-200 p-4 text-xs leading-5 text-zinc-500 dark:border-white/10">
                {status.isConnected ? '取り込めるカレンダーがまだありません。' : 'Google Calendar接続後にカレンダーを選択できます。'}
              </div>
            ) : (
              <div className="divide-y divide-zinc-200 overflow-hidden rounded-lg border border-zinc-200 dark:divide-white/10 dark:border-white/10">
                {calendars.map(cal => (
                  <label
                    key={cal.id}
                    className={cn(
                      "flex min-h-12 cursor-pointer items-center gap-3 bg-zinc-50 px-3 py-2 transition hover:bg-zinc-100 dark:bg-[#171717] dark:hover:bg-white/[0.05]",
                      calendarSelectionDisabled && "cursor-default opacity-60"
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={cal.selected}
                      disabled={calendarSelectionDisabled}
                      onChange={(e) => {
                        toggleCalendar(cal.id, e.target.checked).catch(err => {
                          console.error('Failed to toggle calendar:', err)
                        })
                      }}
                      className="h-4 w-4 rounded border-zinc-300 bg-white accent-zinc-950 dark:border-zinc-600 dark:bg-zinc-900 dark:accent-zinc-100"
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
            {!hasHealthyConnection && status.isConnected && (
              <p className="mt-3 text-xs leading-5 text-zinc-500">
                再連携が完了するまで、カレンダー選択の変更は止めています。
              </p>
            )}
          </div>
        </div>
      </section>

      {status.isConnected && (
        <section className={cn(sectionSurfaceClass, "overflow-hidden border-red-200/70 dark:border-red-400/25")}>
          <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
            <div className="flex gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-100">
                <AlertTriangle className="h-4 w-4" />
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Disconnect risk</h2>
                  <StatusPill tone="danger">危険操作</StatusPill>
                </div>
                <p className="mt-1 max-w-2xl text-xs leading-5 text-zinc-500">
                  連携解除は保存済みGoogleトークンを削除し、予定表示・取り込み・AIの予定整理を停止します。Google側の予定は削除されません。
                </p>
              </div>
            </div>
            <Button
              onClick={() => setShowDisconnectDialog(true)}
              size="sm"
              variant="outline"
              className="min-h-10 border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-400/25 dark:bg-red-400/10 dark:text-red-200 dark:hover:bg-red-400/15 dark:hover:text-red-100"
            >
              <Unlink className="h-4 w-4" />
              連携解除
            </Button>
          </div>
          {disconnectError && (
            <p className="border-t border-red-200/70 px-5 py-3 text-xs text-red-700 dark:border-red-400/20 dark:text-red-200">
              {disconnectError}
            </p>
          )}
        </section>
      )}

      <AlertDialog open={showDisconnectDialog} onOpenChange={setShowDisconnectDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Google Calendar連携を解除しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              保存済みGoogleトークンを削除し、予定表示・取り込み・AIの予定整理を停止します。Google Calendar側の予定は削除されません。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleDisconnect()}
              className="bg-red-600 text-white hover:bg-red-500"
            >
              連携解除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
