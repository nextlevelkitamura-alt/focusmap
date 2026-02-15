"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Calendar, Check, AlertTriangle, RefreshCw, Link2, Unlink } from "lucide-react"

interface CalendarStatus {
  isConnected: boolean
  isSyncEnabled: boolean
  syncStatus: 'idle' | 'syncing' | 'error'
  lastSyncedAt: string | null
  tokenExpired?: boolean
}

interface CalendarSettingsProps {
  compact?: boolean
}

export function CalendarSettings({ compact = false }: CalendarSettingsProps) {
  const [status, setStatus] = useState<CalendarStatus>({
    isConnected: false,
    isSyncEnabled: false,
    syncStatus: 'idle',
    lastSyncedAt: null
  })
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    fetchStatus()
  }, [])

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
          lastSyncedAt: null
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
            <Button onClick={handleDisconnect} size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive">
              <Unlink className="h-4 w-4 mr-2" />
              連携解除
            </Button>
          )}
        </div>

        {/* 最終同期時刻 */}
        {status.lastSyncedAt && (
          <p className="text-xs text-muted-foreground px-1">
            最終同期: {new Date(status.lastSyncedAt).toLocaleString('ja-JP', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit'
            })}
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
      </CardContent>
    </Card>
  )
}
