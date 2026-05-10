"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Calendar, Check, Filter, GripVertical, Loader2, Mic, Plus, Sparkles, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { IdealGoalWithItems } from "@/types/database"
import { cn } from "@/lib/utils"
import { WishlistCard } from "./wishlist-card"
import { WishlistCardDetail } from "./wishlist-card-detail"

type MemoStatus = "unsorted" | "organized" | "time_candidates" | "scheduled" | "completed"
type MemoItem = IdealGoalWithItems

interface MemoSuggestion {
  title: string
  category: string
  tags: string[]
  memo_status: MemoStatus
  description: string
  scheduled_at: string | null
  duration_minutes: number | null
  time_candidates: Array<{ label: string; scheduled_at: string; duration_minutes: number; reason: string }>
  subtask_suggestions: Array<{ title: string; estimated_minutes: number; reason: string }>
}

const DEFAULT_COLUMNS: Array<{ key: MemoStatus; label: string; color: string }> = [
  { key: "unsorted", label: "未整理", color: "bg-zinc-500/10" },
  { key: "organized", label: "整理済み", color: "bg-sky-500/10" },
  { key: "time_candidates", label: "時間候補あり", color: "bg-teal-500/10" },
  { key: "scheduled", label: "予定済み", color: "bg-blue-500/10" },
  { key: "completed", label: "完了", color: "bg-zinc-500/10" },
]

const STATUS_LABEL: Record<MemoStatus | "all", string> = {
  all: "すべて",
  unsorted: "未整理",
  organized: "整理済み",
  time_candidates: "時間候補あり",
  scheduled: "予定済み",
  completed: "完了",
}

function getStatus(item: MemoItem): MemoStatus {
  if (item.is_completed || item.memo_status === "completed") return "completed"
  if (item.google_event_id || item.memo_status === "scheduled") return "scheduled"
  if (item.memo_status === "time_candidates" || item.scheduled_at) return "time_candidates"
  if (item.memo_status === "organized") return "organized"
  return "unsorted"
}

function formatCandidate(candidate: MemoSuggestion["time_candidates"][number]) {
  const date = new Date(candidate.scheduled_at)
  if (Number.isNaN(date.getTime())) return candidate.label
  const day = ["日", "月", "火", "水", "木", "金", "土"][date.getDay()]
  const time = date.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tokyo" })
  return `${date.getMonth() + 1}/${date.getDate()}(${day}) ${time}`
}

export function WishlistView() {
  const [items, setItems] = useState<MemoItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedItem, setSelectedItem] = useState<MemoItem | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [intakeText, setIntakeText] = useState("")
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [suggestion, setSuggestion] = useState<MemoSuggestion | null>(null)
  const [suggestionOpen, setSuggestionOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState<MemoStatus | "all">("all")
  const [tagFilter, setTagFilter] = useState<string | "all">("all")
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [columnLabels, setColumnLabels] = useState<Record<MemoStatus, string>>({
    unsorted: "未整理",
    organized: "整理済み",
    time_candidates: "時間候補あり",
    scheduled: "予定済み",
    completed: "完了",
  })

  const fetchItems = useCallback(async () => {
    const res = await fetch("/api/wishlist")
    const { items } = await res.json()
    setItems(items ?? [])
  }, [])

  useEffect(() => {
    fetchItems().finally(() => setIsLoading(false))
  }, [fetchItems])

  const allTags = useMemo(() => {
    const set = new Set<string>()
    for (const item of items) {
      if (item.category) set.add(item.category)
      for (const tag of item.tags ?? []) set.add(tag)
    }
    return [...set].slice(0, 12)
  }, [items])

  const filteredItems = useMemo(() => {
    return items.filter(item => {
      const status = getStatus(item)
      if (statusFilter !== "all" && status !== statusFilter) return false
      if (tagFilter !== "all" && item.category !== tagFilter && !(item.tags ?? []).includes(tagFilter)) return false
      return true
    })
  }, [items, statusFilter, tagFilter])

  const handleUpdate = useCallback(async (id: string, updates: Record<string, unknown>) => {
    if (Object.keys(updates).length > 0) {
      setItems(prev => prev.map(item => item.id === id ? { ...item, ...updates } as MemoItem : item))
      const res = await fetch(`/api/wishlist/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      })
      const { item } = await res.json()
      if (item) {
        setItems(prev => prev.map(existing => existing.id === id ? item : existing))
        setSelectedItem(prev => prev?.id === id ? item : prev)
      }
      return
    }
    await fetchItems()
  }, [fetchItems])

  const handleDelete = useCallback(async (id: string) => {
    setItems(prev => prev.filter(item => item.id !== id))
    if (selectedItem?.id === id) setDetailOpen(false)
    await fetch(`/api/wishlist/${id}`, { method: "DELETE" })
  }, [selectedItem])

  const handleCreate = async () => {
    const res = await fetch("/api/wishlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "新しいメモ",
        description: "",
        category: "アイデア",
        tags: ["アイデア"],
        memo_status: "unsorted",
      }),
    })
    const { item } = await res.json()
    if (item) {
      setItems(prev => [item, ...prev])
      setSelectedItem(item)
      setDetailOpen(true)
    }
  }

  const handleAnalyze = async () => {
    if (!intakeText.trim() || isAnalyzing) return
    setIsAnalyzing(true)
    try {
      const res = await fetch("/api/ai-ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: intakeText }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        alert(data.error || "整理に失敗しました")
        return
      }
      setSuggestion(data.suggestion)
      setSuggestionOpen(true)
    } finally {
      setIsAnalyzing(false)
    }
  }

  const saveSuggestion = async (calendarCandidate?: MemoSuggestion["time_candidates"][number], addToCalendar = false) => {
    if (!suggestion?.title.trim()) return
    const scheduledAt = calendarCandidate?.scheduled_at ?? suggestion.scheduled_at
    const durationMinutes = calendarCandidate?.duration_minutes ?? suggestion.duration_minutes
    const res = await fetch("/api/wishlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...suggestion,
        scheduled_at: scheduledAt,
        duration_minutes: durationMinutes,
        memo_status: scheduledAt ? "time_candidates" : suggestion.memo_status,
        ai_source_payload: { suggestion, intakeText },
      }),
    })
    const { item } = await res.json()
    if (item) {
      setItems(prev => [item, ...prev])
      if (addToCalendar && item.scheduled_at && item.duration_minutes) {
        await handleCalendarAdd(item)
      }
    }
    setSuggestion(null)
    setSuggestionOpen(false)
    setIntakeText("")
  }

  const handleCalendarAdd = async (item: MemoItem) => {
    const res = await fetch(`/api/wishlist/${item.id}/calendar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scheduled_at: item.scheduled_at,
        duration_minutes: item.duration_minutes,
        title: item.title,
        description: item.description,
      }),
    })
    if (!res.ok) {
      const { error } = await res.json()
      alert(`カレンダー登録に失敗しました: ${error}`)
      return
    }
    const { google_event_id } = await res.json()
    await handleUpdate(item.id, { google_event_id, memo_status: "scheduled" })
  }

  const handleDropToColumn = async (status: MemoStatus) => {
    if (!draggingId) return
    const item = items.find(i => i.id === draggingId)
    setDraggingId(null)
    if (!item) return
    if (status === "scheduled" && !item.google_event_id) {
      const ok = window.confirm("予定済みへ移動するにはカレンダー登録が必要です。詳細で登録しますか？")
      if (ok) {
        setSelectedItem(item)
        setDetailOpen(true)
      }
      return
    }
    await handleUpdate(item.id, {
      memo_status: status,
      is_completed: status === "completed",
    })
  }

  const openDetail = (item: MemoItem) => {
    setSelectedItem(item)
    setDetailOpen(true)
  }

  if (isLoading) {
    return <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">読み込み中...</div>
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      <div className="shrink-0 border-b px-4 py-3 md:px-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-base font-semibold">思考メモ</h1>
            <p className="text-xs text-muted-foreground">雑な入力を、メモと時間候補に整理</p>
          </div>
          <Button onClick={handleCreate} size="sm" className="min-h-[44px] gap-1">
            <Plus className="h-4 w-4" /> 追加
          </Button>
        </div>
      </div>

      <div className="shrink-0 space-y-2 border-b px-4 py-3 md:px-6">
        <div className="flex gap-2">
          <textarea
            value={intakeText}
            onChange={e => setIntakeText(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleAnalyze() }}
            placeholder="AIの税制を調べたい。確定申告前に確認したい..."
            rows={1}
            className="min-h-[44px] flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
          />
          <Button onClick={handleAnalyze} disabled={isAnalyzing || !intakeText.trim()} className="min-h-[44px] gap-1">
            {isAnalyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            <span className="hidden sm:inline">整理</span>
            <span className="sm:hidden">生成</span>
          </Button>
          <Button variant="outline" size="icon" className="hidden min-h-[44px] min-w-[44px] sm:inline-flex">
            <Mic className="h-4 w-4" />
          </Button>
        </div>

        <FilterBar
          statusFilter={statusFilter}
          tagFilter={tagFilter}
          tags={allTags}
          onStatusChange={setStatusFilter}
          onTagChange={setTagFilter}
        />
      </div>

      <div className="flex-1 overflow-hidden">
        <div className="hidden h-full gap-3 overflow-x-auto p-4 md:flex">
          {DEFAULT_COLUMNS.map(column => {
            const columnItems = filteredItems.filter(item => getStatus(item) === column.key)
            return (
              <section
                key={column.key}
                onDragOver={e => e.preventDefault()}
                onDrop={() => handleDropToColumn(column.key)}
                className={cn("flex w-72 shrink-0 flex-col rounded-lg border", column.color)}
              >
                <div className="flex items-center gap-2 border-b p-2">
                  <GripVertical className="h-4 w-4 text-muted-foreground" />
                  <Input
                    value={columnLabels[column.key]}
                    onChange={e => setColumnLabels(prev => ({ ...prev, [column.key]: e.target.value }))}
                    className="h-8 border-0 bg-transparent px-1 text-sm font-medium shadow-none focus-visible:ring-0"
                  />
                  <span className="rounded bg-background/70 px-1.5 py-0.5 text-xs text-muted-foreground">{columnItems.length}</span>
                </div>
                <div className="flex-1 space-y-2 overflow-y-auto p-2">
                  {columnItems.map(item => (
                    <WishlistCard
                      key={item.id}
                      item={item}
                      onUpdate={handleUpdate}
                      onDelete={handleDelete}
                      onClick={() => openDetail(item)}
                      draggable
                      onDragStart={() => setDraggingId(item.id)}
                    />
                  ))}
                </div>
              </section>
            )
          })}
        </div>

        <div className="h-full overflow-y-auto p-4 pb-24 md:hidden">
          {filteredItems.length === 0 ? (
            <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
              <p>メモはまだありません</p>
              <Button variant="outline" onClick={handleCreate} className="min-h-[44px]">
                <Plus className="mr-1 h-4 w-4" /> 追加
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredItems.map(item => (
                <WishlistCard
                  key={item.id}
                  item={item}
                  onUpdate={handleUpdate}
                  onDelete={handleDelete}
                  onClick={() => openDetail(item)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <SuggestionSheet
        suggestion={suggestion}
        open={suggestionOpen}
        onOpenChange={setSuggestionOpen}
        onChange={setSuggestion}
        onSave={saveSuggestion}
      />

      <WishlistCardDetail
        item={selectedItem}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onUpdate={handleUpdate}
        onCalendarAdd={handleCalendarAdd}
      />
    </div>
  )
}

function FilterBar({
  statusFilter,
  tagFilter,
  tags,
  onStatusChange,
  onTagChange,
}: {
  statusFilter: MemoStatus | "all"
  tagFilter: string | "all"
  tags: string[]
  onStatusChange: (status: MemoStatus | "all") => void
  onTagChange: (tag: string | "all") => void
}) {
  const statusOptions: Array<MemoStatus | "all"> = ["all", "unsorted", "organized", "time_candidates", "scheduled", "completed"]
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1 overflow-x-auto">
        <Filter className="h-4 w-4 shrink-0 text-muted-foreground" />
        {statusOptions.map(status => (
          <button
            key={status}
            onClick={() => onStatusChange(status)}
            className={cn(
              "min-h-9 shrink-0 rounded-full border px-3 text-xs",
              statusFilter === status ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground",
            )}
          >
            {STATUS_LABEL[status]}
          </button>
        ))}
      </div>
      <div className="flex gap-1 overflow-x-auto">
        <button
          onClick={() => onTagChange("all")}
          className={cn(
            "min-h-9 shrink-0 rounded-full border px-3 text-xs",
            tagFilter === "all" ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground",
          )}
        >
          タグすべて
        </button>
        {tags.map(tag => (
          <button
            key={tag}
            onClick={() => onTagChange(tag)}
            className={cn(
              "min-h-9 shrink-0 rounded-full border px-3 text-xs",
              tagFilter === tag ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground",
            )}
          >
            {tag}
          </button>
        ))}
      </div>
    </div>
  )
}

function SuggestionSheet({
  suggestion,
  open,
  onOpenChange,
  onChange,
  onSave,
}: {
  suggestion: MemoSuggestion | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onChange: (suggestion: MemoSuggestion | null) => void
  onSave: (candidate?: MemoSuggestion["time_candidates"][number], addToCalendar?: boolean) => Promise<void>
}) {
  const [selectedCandidateIndex, setSelectedCandidateIndex] = useState<number | null>(null)
  if (!suggestion) return null

  const update = (updates: Partial<MemoSuggestion>) => onChange({ ...suggestion, ...updates })
  const selectedCandidate = selectedCandidateIndex === null ? undefined : suggestion.time_candidates[selectedCandidateIndex]
  const canCalendar = !!(selectedCandidate?.scheduled_at || suggestion.scheduled_at) && !!suggestion.duration_minutes

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto rounded-t-xl md:left-1/2 md:max-w-2xl md:-translate-x-1/2">
        <SheetHeader>
          <SheetTitle className="text-left">生成結果</SheetTitle>
        </SheetHeader>
        <div className="space-y-4 px-4 pb-6">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">メモの見出し</label>
            <Input
              value={suggestion.title}
              onChange={e => update({ title: e.target.value })}
              placeholder="見出し"
              className="min-h-[44px] text-base font-semibold"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">メモ</label>
            <textarea
              value={suggestion.description}
              onChange={e => update({ description: e.target.value })}
              rows={4}
              className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div className="flex flex-wrap gap-1">
            {[suggestion.category, ...suggestion.tags].filter(Boolean).map(tag => (
              <span key={tag} className="rounded-full border px-2 py-1 text-xs text-muted-foreground">{tag}</span>
            ))}
          </div>
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">所要時間</label>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                className="min-h-[44px] min-w-[44px]"
                onClick={() => update({ duration_minutes: Math.max(15, (suggestion.duration_minutes ?? 60) - 15) })}
              >
                <X className="h-4 w-4 rotate-45" />
              </Button>
              <div className="flex min-h-[44px] min-w-20 items-center justify-center rounded-md border text-sm font-medium">
                {suggestion.duration_minutes ?? 60}分
              </div>
              <Button
                variant="outline"
                size="icon"
                className="min-h-[44px] min-w-[44px]"
                onClick={() => update({ duration_minutes: (suggestion.duration_minutes ?? 60) + 15 })}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input
              type="date"
              className="min-h-[44px]"
              onChange={e => {
                if (!e.target.value) return
                const time = suggestion.scheduled_at ? new Date(suggestion.scheduled_at).toISOString().slice(11, 16) : "09:00"
                update({ scheduled_at: new Date(`${e.target.value}T${time}:00`).toISOString() })
              }}
            />
            <Input
              type="time"
              className="min-h-[44px]"
              onChange={e => {
                const base = suggestion.scheduled_at ? new Date(suggestion.scheduled_at) : new Date()
                const date = base.toISOString().slice(0, 10)
                update({ scheduled_at: new Date(`${date}T${e.target.value}:00`).toISOString() })
              }}
            />
          </div>
          {suggestion.time_candidates.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">時間候補</p>
              <div className="grid gap-2">
                {suggestion.time_candidates.map((candidate, index) => (
                  <button
                    key={`${candidate.scheduled_at}-${index}`}
                    onClick={() => {
                      setSelectedCandidateIndex(index)
                      update({
                        scheduled_at: candidate.scheduled_at,
                        duration_minutes: candidate.duration_minutes,
                        memo_status: "time_candidates",
                      })
                    }}
                    className={cn(
                      "min-h-[44px] rounded-md border px-3 py-2 text-left text-sm",
                      selectedCandidateIndex === index && "border-primary bg-primary/10",
                    )}
                  >
                    <span className="font-medium">{formatCandidate(candidate)}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{candidate.duration_minutes}分</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {suggestion.subtask_suggestions.length > 0 && (
            <details className="rounded-md border p-3">
              <summary className="cursor-pointer text-sm font-medium">サブタスク候補 {suggestion.subtask_suggestions.length}件</summary>
              <div className="mt-2 space-y-2">
                {suggestion.subtask_suggestions.map(sub => (
                  <div key={sub.title} className="text-sm text-muted-foreground">
                    {sub.title} {sub.estimated_minutes ? `/${sub.estimated_minutes}分` : ""}
                  </div>
                ))}
              </div>
            </details>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button disabled={!suggestion.title.trim()} onClick={() => onSave(selectedCandidate, false)} className="min-h-[44px]">
              <Check className="mr-1 h-4 w-4" /> メモに保存
            </Button>
            <Button
              variant="outline"
              disabled={!suggestion.title.trim() || !canCalendar}
              onClick={() => onSave(selectedCandidate, true)}
              className="min-h-[44px]"
            >
              <Calendar className="mr-1 h-4 w-4" /> カレンダーに入れる
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
