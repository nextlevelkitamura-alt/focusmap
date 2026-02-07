"use client"

import { useState, useCallback } from "react"
import { SidebarCalendar } from "@/components/dashboard/sidebar-calendar"
import { CalendarToast, useCalendarToast } from "@/components/calendar/calendar-toast"

export function RightSidebar() {
    const [selectedCalendarIds, setSelectedCalendarIds] = useState<string[]>([])
    const { toast, showToast, hideToast } = useCalendarToast()

    // タスクがカレンダーにドロップされた時の処理
    const handleTaskDrop = useCallback(async (taskId: string, dateTime: Date) => {
        // taskIdの検証
        if (!taskId || typeof taskId !== 'string' || taskId.length < 10) {
            showToast('error', '無効なタスクIDです。もう一度お試しください。')
            return
        }

        showToast('info', 'スケジュール設定中...')

        try {
            const response = await fetch('/api/calendar/sync-task', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    taskId,
                    scheduledAt: dateTime.toISOString()
                })
            })

            const errorData = await response.json().catch(() => ({ error: '不明なエラー' }))

            if (!response.ok) {
                const errorMessages: Record<number, string> = {
                    400: errorData.error || 'カレンダー同期が無効です。設定で有効にしてください。',
                    401: '認証が必要です。ページを更新してください。',
                    404: 'タスクが見つかりません。削除された可能性があります。',
                    500: 'サーバーエラーです。後でもう一度お試しください。'
                }
                throw new Error(errorMessages[response.status] || errorData.error || 'カレンダーへの追加に失敗しました')
            }

            const timeStr = dateTime.toLocaleString('ja-JP', {
                month: 'numeric',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            })
            showToast('success', `${timeStr}にスケジュール設定しました`)

        } catch (error) {
            let errorMessage = 'カレンダーへの追加に失敗しました'
            if (error instanceof Error) {
                if (error.message.includes('sync is not enabled')) {
                    errorMessage = 'カレンダー同期が無効です。設定で有効にしてください。'
                } else if (error.message.includes('network') || error.message.includes('fetch')) {
                    errorMessage = 'ネットワークエラーです。接続を確認してください。'
                } else {
                    errorMessage = error.message
                }
            }
            showToast('error', errorMessage)
        }
    }, [showToast])

    return (
        <>
            <div className="h-full flex flex-col bg-card border-l relative">
                {/* Google Calendar Section */}
                <div className="flex flex-col h-full">
                    <div className="flex-1 bg-background relative overflow-hidden">
                        <SidebarCalendar
                            onTaskDrop={handleTaskDrop}
                            onSelectionChange={setSelectedCalendarIds}
                        />
                    </div>
                </div>
            </div>

            {/* Toast Notification */}
            {toast && (
                <CalendarToast
                    type={toast.type}
                    message={toast.message}
                    onClose={hideToast}
                />
            )}
        </>
    )
}
