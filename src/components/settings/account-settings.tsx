"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { LogOut, Mail, Trash2, User } from "lucide-react"
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
import {
  DangerZone,
  SettingRow,
  SettingsSection,
  SettingsStatusChip,
} from "@/components/settings/settings-primitives"
import { clearNativeAuthSession } from "@/lib/external-auth-launch"

interface AccountSettingsProps {
  userEmail: string | undefined
}

export function AccountSettings({ userEmail }: AccountSettingsProps) {
  const router = useRouter()
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [showLogoutDialog, setShowLogoutDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [showFinalDeleteDialog, setShowFinalDeleteDialog] = useState(false)
  const [accountError, setAccountError] = useState<string | null>(null)
  const [dangerError, setDangerError] = useState<string | null>(null)

  const handleLogout = async () => {
    setIsLoggingOut(true)
    setAccountError(null)
    try {
      await window.focusmapDesktop?.clearAuthSession?.().catch(() => undefined)
      clearNativeAuthSession()
      const res = await fetch('/api/auth/logout', { method: 'POST' })
      if (res.ok) {
        router.push('/login')
        router.refresh()
      } else {
        throw new Error('Logout failed')
      }
    } catch (error) {
      console.error('Logout error:', error)
      setAccountError('ログアウトに失敗しました')
    } finally {
      setIsLoggingOut(false)
      setShowLogoutDialog(false)
    }
  }

  const handleDeleteAccount = async () => {
    setIsDeleting(true)
    setDangerError(null)
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
      setDangerError('アカウント削除に失敗しました')
      setIsDeleting(false)
    }
  }

  return (
    <>
      <div className="space-y-5">
        <SettingsSection
          title="Account"
          description="ログイン中のユーザーとセッション"
        >
          <SettingRow
            icon={Mail}
            title={userEmail || 'メールアドレス未取得'}
            description="ログイン中"
            status={<SettingsStatusChip tone="neutral">active</SettingsStatusChip>}
          />
          <SettingRow
            icon={User}
            title="セッション"
            description="この端末のFocusmapセッションからログアウトします。"
            control={
              <Button
                variant="outline"
                className="min-h-10"
                onClick={() => setShowLogoutDialog(true)}
                disabled={isLoggingOut}
              >
                <LogOut className="mr-2 h-4 w-4" />
                {isLoggingOut ? 'ログアウト中...' : 'ログアウト'}
              </Button>
            }
          />
        </SettingsSection>
        {accountError ? (
          <p className="rounded-md border border-white/[0.08] bg-white/[0.045] px-3 py-2 text-[12px] text-zinc-300">
            {accountError}
          </p>
        ) : null}

        <DangerZone
          title="Danger zone"
          description="アカウント削除はすべてのFocusmapデータに影響します。APIキーの無効化とは分けて扱ってください。"
        >
          <Button
            variant="ghost"
            className="min-h-10 w-full justify-center border border-red-400/25 text-red-100 hover:bg-red-500/10 hover:text-red-50"
            onClick={() => setShowDeleteDialog(true)}
            disabled={isDeleting}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            {isDeleting ? '削除中...' : 'アカウント削除を開始'}
          </Button>
          <p className="mt-2 text-center text-[11px] leading-5 text-red-100/60">
            この操作は取り消せません
          </p>
          {dangerError ? (
            <p className="mt-3 rounded-md border border-red-400/25 bg-red-500/10 px-3 py-2 text-[12px] text-red-100">
              {dangerError}
            </p>
          ) : null}
        </DangerZone>
      </div>

      <AlertDialog open={showLogoutDialog} onOpenChange={setShowLogoutDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ログアウトしますか？</AlertDialogTitle>
            <AlertDialogDescription>
              この端末のFocusmapセッションを終了します。保存済みデータとAPIキーは削除されません。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction onClick={handleLogout}>
              ログアウト
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>アカウント削除を開始しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              すべてのデータが削除対象になります。次の画面で最終確認します。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-500"
              onClick={() => {
                setShowDeleteDialog(false)
                setShowFinalDeleteDialog(true)
              }}
            >
              次へ
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showFinalDeleteDialog} onOpenChange={setShowFinalDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>最終確認</AlertDialogTitle>
            <AlertDialogDescription>
              アカウントとすべてのデータを完全に削除します。本当によろしいですか？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteAccount} className="bg-red-600 text-white hover:bg-red-500">
              削除する
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
