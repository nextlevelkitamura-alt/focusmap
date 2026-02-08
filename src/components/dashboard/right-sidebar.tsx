"use client"

import { useState, useCallback, useRef, forwardRef, useImperativeHandle } from "react"
import { SidebarCalendar, SidebarCalendarRef } from "@/components/dashboard/sidebar-calendar"
import { CalendarToast, useCalendarToast } from "@/components/calendar/calendar-toast"

export interface RightSidebarRef {
    refreshCalendar: () => Promise<void>
}

export const RightSidebar = forwardRef<RightSidebarRef>(function RightSidebar(_, ref) {
    const [selectedCalendarIds, setSelectedCalendarIds] = useState<string[]>([])
    const { toast, showToast, hideToast } = useCalendarToast()
    const calendarRef = useRef<SidebarCalendarRef>(null)

    // タスクがカレンダーにドロップされた時の処理
    const handleTaskDrop = useCallback(async (taskId: string, dateTime: Date) => {
        // taskIdの検証
        if (!taskId || typeof taskId !== 'string' || taskId.length < 10) {
            showToast('error', '無効なタスクIDです。もう一度お試しください。')
            return
        }

        showToast('info', 'スケジュール設定中...')

        try {
            // まずタスクの情報を取得して、既存のgoogle_event_idがあるか確認
            const taskResponse = await fetch(`/api/tasks/${taskId}`)
            if (!taskResponse.ok) {
                throw new Error('タスクの取得に失敗しました')
            }
            const taskData = await taskResponse.json()
            const task = taskData.task

            // 既存のgoogle_event_idがある場合はPATCH（更新）、ない場合はPOST（新規作成）
            const method = task.google_event_id ? 'PATCH' : 'POST'
            const response = await fetch('/api/calendar/sync-task', {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    taskId,
                    scheduled_at: dateTime.toISOString(),
                    estimated_time: task.estimated_time || 60, // デフォルト60分
                    calendar_id: task.calendar_id || selectedCalendarIds[0] || 'primary'
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
            const action = task.google_event_id ? '更新' : '設定'
            showToast('success', `${timeStr}にスケジュール${action}しました`)

            // カレンダーイベントを再取得
            await calendarRef.current?.refetch()

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
    }, [showToast, selectedCalendarIds])

    // 親コンポーネントから refreshCalendar を呼び出せるようにする
    useImperativeHandle(ref, () => ({
        refreshCalendar: async () => {
            await calendarRef.current?.refetch()
        }
    }), [])

    return (
        <>
            <div className="h-full flex flex-col bg-background/50 backdrop-blur-sm border-l border-border/30 relative">
                {/* Google Calendar Section */}
                <div className="flex flex-col h-full">
                    <div className="flex-1 bg-background/50 relative overflow-hidden">
                        <SidebarCalendar
                            ref={calendarRef}
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
})
