"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { X, Search, Link2Off, Repeat, ListTodo } from "lucide-react"
import { cn } from "@/lib/utils"

interface LinkableItem {
  id: string
  title: string
  project_title?: string
}

interface IdealItemLinkPickerProps {
  currentTaskId: string | null
  currentHabitId: string | null
  onSelect: (link: { taskId?: string | null; habitId?: string | null }) => void
  onClose: () => void
}

type Tab = "habits" | "tasks"

export function IdealItemLinkPicker({
  currentTaskId,
  currentHabitId,
  onSelect,
  onClose,
}: IdealItemLinkPickerProps) {
  const [tab, setTab] = useState<Tab>(currentHabitId ? "habits" : currentTaskId ? "tasks" : "habits")
  const [habits, setHabits] = useState<LinkableItem[]>([])
  const [tasks, setTasks] = useState<LinkableItem[]>([])
  const [search, setSearch] = useState("")
  const [isLoading, setIsLoading] = useState(true)

  const fetchData = useCallback(async () => {
    setIsLoading(true)
    try {
      const [habitsRes, tasksRes] = await Promise.all([
        fetch("/api/v1/habits?limit=100"),
        fetch("/api/tasks?limit=100"),
      ])

      if (habitsRes.ok) {
        const data = await habitsRes.json()
        const list = (data.habits ?? data.data ?? []).map((h: Record<string, unknown>) => ({
          id: h.id as string,
          title: h.title as string,
          project_title: (h.project_title ?? h.project_name ?? "") as string,
        }))
        setHabits(list)
      }

      if (tasksRes.ok) {
        const data = await tasksRes.json()
        const allTasks = (data.tasks ?? data.data ?? []) as Record<string, unknown>[]
        const nonHabits = allTasks.filter(t => !t.is_habit)
        setTasks(
          nonHabits.map(t => ({
            id: t.id as string,
            title: t.title as string,
            project_title: (t.project_title ?? t.project_name ?? "") as string,
          }))
        )
      }
    } catch {
      // silent
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const currentList = tab === "habits" ? habits : tasks
  const filtered = search
    ? currentList.filter(i => i.title.toLowerCase().includes(search.toLowerCase()))
    : currentList

  const currentLinkedId = tab === "habits" ? currentHabitId : currentTaskId
  const hasLink = currentTaskId || currentHabitId

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-background rounded-xl border shadow-lg w-full max-w-sm mx-4 max-h-[70vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <span className="text-sm font-medium">タスク/ハビットにリンク</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* タブ */}
        <div className="flex border-b">
          <button
            className={cn(
              "flex-1 py-2 text-xs font-medium border-b-2 transition-colors flex items-center justify-center gap-1",
              tab === "habits"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
            onClick={() => setTab("habits")}
          >
            <Repeat className="h-3.5 w-3.5" />
            ハビット
          </button>
          <button
            className={cn(
              "flex-1 py-2 text-xs font-medium border-b-2 transition-colors flex items-center justify-center gap-1",
              tab === "tasks"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
            onClick={() => setTab("tasks")}
          >
            <ListTodo className="h-3.5 w-3.5" />
            タスク
          </button>
        </div>

        {/* 検索 */}
        <div className="px-3 py-2 border-b">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              autoFocus
              placeholder="検索..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-8 text-xs pl-8"
            />
          </div>
        </div>

        {/* リスト */}
        <div className="flex-1 overflow-y-auto p-2 min-h-0">
          {isLoading ? (
            <p className="text-xs text-muted-foreground text-center py-4">読み込み中...</p>
          ) : filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">
              {search ? "見つかりませんでした" : tab === "habits" ? "ハビットがありません" : "タスクがありません"}
            </p>
          ) : (
            filtered.map(item => (
              <button
                key={item.id}
                className={cn(
                  "w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-muted/50 transition-colors",
                  currentLinkedId === item.id && "bg-primary/10 border border-primary/30"
                )}
                onClick={() => {
                  if (tab === "habits") {
                    onSelect({ habitId: item.id, taskId: null })
                  } else {
                    onSelect({ taskId: item.id, habitId: null })
                  }
                  onClose()
                }}
              >
                <p className="truncate">{item.title}</p>
                {item.project_title && (
                  <p className="text-[10px] text-muted-foreground truncate">{item.project_title}</p>
                )}
              </button>
            ))
          )}
        </div>

        {/* リンク解除 */}
        {hasLink && (
          <div className="border-t p-3">
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs"
              onClick={() => {
                onSelect({ taskId: null, habitId: null })
                onClose()
              }}
            >
              <Link2Off className="h-3.5 w-3.5 mr-1" />
              リンクを解除
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
