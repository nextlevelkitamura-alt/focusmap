"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { User, LogOut, Trash2, AlertTriangle } from "lucide-react"

interface AccountSettingsProps {
  userEmail: string | undefined
}

export function AccountSettings({ userEmail }: AccountSettingsProps) {
  const router = useRouter()
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const handleLogout = async () => {
    if (!confirm('ログアウトしますか？')) return

    setIsLoggingOut(true)
    try {
      const res = await fetch('/api/auth/logout', { method: 'POST' })
      if (res.ok) {
        router.push('/login')
        router.refresh()
      } else {
        throw new Error('Logout failed')
      }
    } catch (error) {
      console.error('Logout error:', error)
      alert('ログアウトに失敗しました')
    } finally {
      setIsLoggingOut(false)
    }
  }

  const handleDeleteAccount = async () => {
    const confirmed = confirm(
      '⚠️ 本当にアカウントを削除しますか？\n\n' +
      'この操作は取り消せません。すべてのデータが削除されます。\n\n' +
      '続行するにはOKをクリックしてください。'
    )
    if (!confirmed) return

    const doubleConfirm = confirm(
      '🔴 最終確認\n\n' +
      'アカウントとすべてのデータが完全に削除されます。\n\n' +
      '本当によろしいですか？'
    )
    if (!doubleConfirm) return

    setIsDeleting(true)
    try {
      const res = await fetch('/api/auth/delete-account', { method: 'POST' })
      if (res.ok) {
        router.push('/login')
        router.refresh()
      } else {
        const data = await res.json()
        throw new Error(data.error || 'Delete failed')
      }
    } catch (error) {
      console.error('Delete account error:', error)
      alert('アカウント削除に失敗しました')
      setIsDeleting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <User className="h-5 w-5" />
          アカウント
        </CardTitle>
        <CardDescription>
          アカウントの管理
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* メールアドレス表示 */}
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <p className="text-xs text-muted-foreground">メールアドレス</p>
            <p className="text-sm font-medium">{userEmail || '---'}</p>
          </div>
        </div>

        {/* ログアウト */}
        <Button
          variant="outline"
          className="w-full"
          onClick={handleLogout}
          disabled={isLoggingOut}
        >
          <LogOut className="h-4 w-4 mr-2" />
          {isLoggingOut ? 'ログアウト中...' : 'ログアウト'}
        </Button>

        {/* アカウント削除 */}
        <div className="pt-2 border-t">
          <Button
            variant="ghost"
            className="w-full text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={handleDeleteAccount}
            disabled={isDeleting}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            {isDeleting ? '削除中...' : 'アカウント削除'}
          </Button>
          <p className="text-[10px] text-muted-foreground text-center mt-1">
            この操作は取り消せません
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
