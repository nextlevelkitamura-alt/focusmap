"use client"

import { useState, useCallback, useRef, forwardRef, useImperativeHandle } from "react"
import { SidebarCalendar, SidebarCalendarRef } from "@/components/dashboard/sidebar-calendar"
import { CalendarToast, useCalendarToast } from "@/components/calendar/calendar-toast"
import { Task } from "@/types/database"

export interface RightSidebarRef {
    refreshCalendar: () => Promise<void>
}

interface RightSidebarProps {
    onUpdateTask?: (taskId: string, updates: Partial<Task>) => Promise<void>
}

export const RightSidebar = forwardRef<RightSidebarRef, RightSidebarProps>(function RightSidebar({ onUpdateTask }, ref) {
    const [selectedCalendarIds, setSelectedCalendarIds] = useState<string[]>([])
    const { toast, showToast, hideToast } = useCalendarToast()
    const calendarRef = useRef<SidebarCalendarRef>(null)

    // タスクがカレンダーにドロップされた時の処理
    // onUpdateTask 経由で一元的に sync-task を呼び出す（重複防止）
    const handleTaskDrop = useCallback(async (taskId: string, dateTime: Date) => {
        if (!taskId || typeof taskId !== 'string' || taskId.length < 10) {
            showToast('error', '無効なタスクIDです。もう一度お試しください。')
            return
        }

        if (!onUpdateTask) {
            showToast('error', 'タスク更新機能が利用できません。')
            return
        }

        showToast('info', 'スケジュール設定中...')

        try {
            // onUpdateTask 経由でタスクを更新 → useMindMapSync.updateTask 内で sync-task が呼ばれる
            // estimated_time は渡さない（既存値を維持、未設定の場合はupdateTask内でデフォルト60分）
            await onUpdateTask(taskId, {
                scheduled_at: dateTime.toISOString(),
            })

            const timeStr = dateTime.toLocaleString('ja-JP', {
                month: 'numeric',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            })
            showToast('success', `${timeStr}にスケジュール設定しました`)

            // カレンダーイベントを再取得
            await calendarRef.current?.refetch()

        } catch (error) {
            let errorMessage = 'カレンダーへの追加に失敗しました'
            if (error instanceof Error) {
                errorMessage = error.message
            }
            showToast('error', errorMessage)
        }
    }, [showToast, onUpdateTask])

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
                            onUpdateTask={onUpdateTask}
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
