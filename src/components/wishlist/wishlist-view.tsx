"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Calendar, Check, ChevronDown, Clock, Filter, Loader2, Mic, Plus, RefreshCw, Settings, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { VoiceWaveform } from "@/components/ui/voice-waveform"
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder"
import { useTagColors } from "@/hooks/useTagColors"
import { broadcastCalendarSync, CALENDAR_EVENT_TIME_UPDATE_EVENT, invalidateCalendarCache } from "@/hooks/useCalendarEvents"
import { IdealGoalWithItems, Project } from "@/types/database"
import { cn } from "@/lib/utils"
import { getTagColor } from "@/lib/color-utils"
import { WishlistCard } from "./wishlist-card"
import { WishlistCardDetail } from "./wishlist-card-detail"
import { useMemoAiTasks } from "@/hooks/useMemoAiTasks"

type MemoStatus = "unsorted" | "organized" | "time_candidates" | "scheduled" | "completed"
type MemoItem = IdealGoalWithItems

interface MemoSuggestion {
  title: string
  project_id?: string | null
  category: string
  tags: string[]
  tag_suggestions?: string[]
  memo_status: MemoStatus
  description: string
  scheduled_at: string | null
  duration_minutes: number | null
  duration_input?: string
  date_input?: string
  time_input?: string
  time_candidates: Array<{ label: string; scheduled_at: string; duration_minutes: number; reason: string }>
  subtask_suggestions: Array<{ title: string; estimated_minutes: number; reason: string }>
}

const ANALYZE_STATUS_MESSAGES = [
  "AIで整理しています...",
  "モデルに送信しました。結果を待っています...",
  "内容を構造化しています...",
  "もう少しで生成結果を表示します...",
]

const DURATION_OPTIONS = [
  { label: "未設定", minutes: null },
  { label: "5分", minutes: 5 },
  { label: "15分", minutes: 15 },
  { label: "30分", minutes: 30 },
  { label: "60分", minutes: 60 },
]

const QUICK_MODEL_OPTIONS = [
  { id: "glm-5.1", label: "GLM", note: "" },
  { id: "gemini-2.5-flash", label: "Gemini", note: "無料枠あり" },
]

const STATUS_LABEL: Record<MemoStatus | "all", string> = {
  all: "すべて",
  unsorted: "未予定",
  organized: "未予定",
  time_candidates: "未予定",
  scheduled: "予定済み",
  completed: "完了",
}

function getStatus(item: MemoItem): MemoStatus {
  if (item.is_completed || item.memo_status === "completed") return "completed"
  if (item.google_event_id || item.scheduled_at || item.memo_status === "scheduled") return "scheduled"
  return "unsorted"
}

function getTimestamp(value: string | null | undefined) {
  if (!value) return 0
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? 0 : time
}

function sortMemoItemsForSection(items: MemoItem[], section: MemoStatus) {
  return [...items].sort((a, b) => {
    if (section === "scheduled") {
      return getTimestamp(a.scheduled_at) - getTimestamp(b.scheduled_at)
        || getTimestamp(b.updated_at) - getTimestamp(a.updated_at)
    }
    if (section === "completed") {
      return getTimestamp(b.updated_at) - getTimestamp(a.updated_at)
        || getTimestamp(b.created_at) - getTimestamp(a.created_at)
    }
    return getTimestamp(b.created_at) - getTimestamp(a.created_at)
      || getTimestamp(b.updated_at) - getTimestamp(a.updated_at)
  })
}

function formatCandidate(candidate: MemoSuggestion["time_candidates"][number]) {
  const date = new Date(candidate.scheduled_at)
  if (Number.isNaN(date.getTime())) return candidate.label
  const day = ["日", "月", "火", "水", "木", "金", "土"][date.getDay()]
  const time = date.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tokyo" })
  return `${date.getMonth() + 1}/${date.getDate()}(${day}) ${time}`
}

function formatTimeInput(value: string | null) {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
}

function formatDateValue(value: string | null) {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-")
}

function buildDateOptions(selectedValue: string) {
  const formatter = new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
  })
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const options = Array.from({ length: 21 }, (_, index) => {
    const date = new Date(today)
    date.setDate(today.getDate() + index)
    const value = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ].join("-")
    const prefix = index === 0 ? "今日" : index === 1 ? "明日" : index === 2 ? "明後日" : ""
    return {
      value,
      label: prefix ? `${prefix} ${formatter.format(date)}` : formatter.format(date),
    }
  })
  if (selectedValue && !options.some(option => option.value === selectedValue)) {
    const date = new Date(`${selectedValue}T00:00:00`)
    options.unshift({
      value: selectedValue,
      label: Number.isNaN(date.getTime()) ? selectedValue : formatter.format(date),
    })
  }
  return options
}

function buildTimeOptions(selectedValue: string) {
  const options = Array.from({ length: 96 }, (_, index) => {
    const minutes = index * 15
    const hour = Math.floor(minutes / 60)
    const minute = minutes % 60
    const value = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
    return { value, label: value }
  })
  if (selectedValue && !options.some(option => option.value === selectedValue)) {
    options.unshift({ value: selectedValue, label: selectedValue })
  }
  return options
}

function combineDateTime(dateValue: string, timeValue: string) {
  if (!dateValue) return null
  const [year, month, day] = dateValue.split("-").map(Number)
  const [hour = 9, minute = 0] = (timeValue || "09:00").split(":").map(Number)
  const date = new Date(year, month - 1, day, hour, minute)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

export function WishlistView({
  projects = [],
  selectedProjectId = null,
}: {
  projects?: Project[]
  selectedProjectId?: string | null
}) {
  const [items, setItems] = useState<MemoItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedItem, setSelectedItem] = useState<MemoItem | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [intakeText, setIntakeText] = useState("")
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analyzeStartedAt, setAnalyzeStartedAt] = useState<number | null>(null)
  const [analyzeElapsedSeconds, setAnalyzeElapsedSeconds] = useState(0)
  const [intakeError, setIntakeError] = useState<string | null>(null)
  const [selectedAiModel, setSelectedAiModel] = useState("glm-5.1")
  const [suggestion, setSuggestion] = useState<MemoSuggestion | null>(null)
  const [suggestionOpen, setSuggestionOpen] = useState(false)
  const [isSavingSuggestion, setIsSavingSuggestion] = useState(false)
  const [statusFilter, setStatusFilter] = useState<MemoStatus | "all">("all")
  const [tagFilter, setTagFilter] = useState<string | "all">("all")
  const [filterOpen, setFilterOpen] = useState(false)
  const itemSaveQueues = useRef(new Map<string, Promise<void>>())
  const itemUpdateVersions = useRef(new Map<string, number>())
  const { tags: managedTags, tagColors, refreshTags } = useTagColors()
  const { getBySourceId: getMemoAiTask } = useMemoAiTasks()

  // メモから Claude Code を起動
  // フロー: ①GLM/Kimiでメモを実行可能な指示文に整理 → ②ai_tasksへINSERT → ③task-runnerがclaude起動
  const launchClaudeForMemo = useCallback(async (item: MemoItem) => {
    const project = item.project_id ? projects.find(p => p.id === item.project_id) : null
    const repoPath = project?.repo_path
    if (!repoPath) {
      throw new Error("プロジェクトにリポジトリパスが未設定です。設定→プロジェクトから登録してください")
    }

    // ① GLM/Kimi（OpenCode Go経由）でメモを整理
    const fallbackPrompt = item.description?.trim()
      ? `${item.title}\n\n${item.description}`
      : item.title
    let prompt = fallbackPrompt
    try {
      const refineRes = await fetch("/api/ai/refine-claude-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: item.title,
          description: item.description ?? "",
          repo_path: repoPath,
          model: selectedAiModel,
        }),
      })
      if (refineRes.ok) {
        const data = await refineRes.json() as { refined_prompt?: string }
        if (data.refined_prompt && data.refined_prompt.length > 0) {
          prompt = data.refined_prompt
        }
      }
      // refine 失敗時は fallback（素のメモ）でそのまま起動。ブロックしない
    } catch {
      // ネットワークエラー等もスルー
    }

    // ② ai_tasks に INSERT
    const res = await fetch("/api/ai-tasks/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        cwd: repoPath,
        approval_type: "auto",
        source_ideal_goal_id: item.id,
        scheduled_at: new Date().toISOString(),
      }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err?.error || `起動失敗 (${res.status})`)
    }
  }, [projects, selectedAiModel])
  const handleTranscribed = useCallback((text: string) => {
    setIntakeText(prev => prev.trim() ? `${prev.trim()}\n${text}` : text)
  }, [])
  const {
    isRecording,
    isTranscribing,
    error: voiceError,
    permissionState,
    analyserRef,
    startRecording,
    stopRecording,
  } = useVoiceRecorder(handleTranscribed)

  useEffect(() => {
    if (!isAnalyzing || !analyzeStartedAt) {
      setAnalyzeElapsedSeconds(0)
      return
    }
    const interval = window.setInterval(() => {
      setAnalyzeElapsedSeconds(Math.floor((Date.now() - analyzeStartedAt) / 1000))
    }, 1000)
    return () => window.clearInterval(interval)
  }, [analyzeStartedAt, isAnalyzing])

  const fetchItems = useCallback(async () => {
    const res = await fetch("/api/wishlist")
    const { items } = await res.json()
    setItems(items ?? [])
  }, [])

  useEffect(() => {
    fetchItems().finally(() => setIsLoading(false))
  }, [fetchItems])

  useEffect(() => {
    if (typeof window === "undefined") return

    const handler = (event: Event) => {
      const { eventId, startTime, endTime } = (event as CustomEvent<{
        eventId: string
        startTime: string
        endTime: string
      }>).detail
      if (!eventId || !startTime || !endTime) return

      const durationMinutes = Math.max(
        1,
        Math.round((new Date(endTime).getTime() - new Date(startTime).getTime()) / 60000),
      )
      const applyCalendarTime = (item: MemoItem): MemoItem =>
        item.google_event_id === eventId
          ? {
              ...item,
              scheduled_at: startTime,
              duration_minutes: durationMinutes,
              memo_status: "scheduled",
              updated_at: new Date().toISOString(),
            }
          : item

      setItems(prev => prev.map(applyCalendarTime))
      setSelectedItem(prev => prev ? applyCalendarTime(prev) : prev)
    }

    window.addEventListener(CALENDAR_EVENT_TIME_UPDATE_EVENT, handler)
    return () => window.removeEventListener(CALENDAR_EVENT_TIME_UPDATE_EVENT, handler)
  }, [])

  useEffect(() => {
    async function loadAiModel() {
      try {
        const res = await fetch("/api/ai/context")
        const data = await res.json()
        const savedModel = typeof data.preferences?.ai_ingest_model === "string"
          ? data.preferences.ai_ingest_model
          : "glm-5.1"
        setSelectedAiModel(savedModel === "gemini-3.0-flash" ? "gemini-2.5-flash" : savedModel)
      } catch {
        setSelectedAiModel("glm-5.1")
      }
    }
    loadAiModel()
  }, [])

  const allTags = useMemo(() => {
    const set = new Set<string>(managedTags.map(tag => tag.name))
    for (const item of items) {
      if (item.category) set.add(item.category)
      for (const tag of item.tags ?? []) set.add(tag)
    }
    return [...set].slice(0, 12)
  }, [items, managedTags])

  const projectById = useMemo(() => new Map(projects.map(project => [project.id, project])), [projects])

  const filteredItems = useMemo(() => {
    return items.filter(item => {
      const status = getStatus(item)
      if (statusFilter !== "all" && status !== statusFilter) return false
      if (tagFilter !== "all" && item.category !== tagFilter && !(item.tags ?? []).includes(tagFilter)) return false
      return true
    })
  }, [items, statusFilter, tagFilter])

  const selectedModelOption = QUICK_MODEL_OPTIONS.find(option => option.id === selectedAiModel) || QUICK_MODEL_OPTIONS[0]

  const scheduledItems = useMemo(() => {
    return sortMemoItemsForSection(filteredItems.filter(item => getStatus(item) === "scheduled"), "scheduled")
  }, [filteredItems])

  const unscheduledItems = useMemo(() => {
    return sortMemoItemsForSection(filteredItems.filter(item => getStatus(item) === "unsorted"), "unsorted")
  }, [filteredItems])

  const completedItems = useMemo(() => {
    return sortMemoItemsForSection(filteredItems.filter(item => getStatus(item) === "completed"), "completed")
  }, [filteredItems])

  const enqueueItemSave = useCallback((id: string, operation: () => Promise<void>) => {
    const previous = itemSaveQueues.current.get(id) ?? Promise.resolve()
    const save = previous.catch(() => undefined).then(operation)
    const tracked = save.finally(() => {
      if (itemSaveQueues.current.get(id) === tracked) {
        itemSaveQueues.current.delete(id)
      }
    })
    itemSaveQueues.current.set(id, tracked)
    return tracked
  }, [])

  const handleUpdate = useCallback(async (id: string, updates: Record<string, unknown>) => {
    if (Object.keys(updates).length > 0) {
      const updateVersion = (itemUpdateVersions.current.get(id) ?? 0) + 1
      itemUpdateVersions.current.set(id, updateVersion)
      const isLatestUpdate = () => itemUpdateVersions.current.get(id) === updateVersion
      const previousItems = items
      const previousSelectedItem = selectedItem
      const optimisticUpdate = (item: MemoItem): MemoItem => ({
        ...item,
        ...updates,
        updated_at: new Date().toISOString(),
      })
      setItems(prev => prev.map(existing => existing.id === id ? optimisticUpdate(existing) : existing))
      setSelectedItem(prev => prev?.id === id ? optimisticUpdate(prev) : prev)
      setIntakeError(null)
      await enqueueItemSave(id, async () => {
        try {
          const res = await fetch(`/api/wishlist/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(updates),
          })
          const data = await res.json()
          if (!res.ok || data.error) {
            throw new Error(data.error || "メモの更新に失敗しました")
          }
          if (!data.item) {
            throw new Error("更新結果を取得できませんでした")
          }
          if (!isLatestUpdate()) return
          const item = data.item as MemoItem
          setItems(prev => prev.map(existing => existing.id === id ? item : existing))
          setSelectedItem(prev => prev?.id === id ? item : prev)
          if ("category" in updates || "tags" in updates) {
            await refreshTags()
          }
        } catch (err) {
          if (isLatestUpdate()) {
            setItems(previousItems)
            setSelectedItem(previousSelectedItem)
            setIntakeError(err instanceof Error ? err.message : "メモの更新に失敗しました")
          }
          throw err
        }
      })
      return
    }
    await fetchItems()
  }, [enqueueItemSave, fetchItems, items, refreshTags, selectedItem])

  const handleDelete = useCallback(async (id: string) => {
    setItems(prev => prev.filter(item => item.id !== id))
    if (selectedItem?.id === id) setDetailOpen(false)
    await fetch(`/api/wishlist/${id}`, { method: "DELETE" })
  }, [selectedItem])

  const handleCreate = async () => {
    setIntakeError(null)
    try {
      const res = await fetch("/api/wishlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "新しいメモ",
          project_id: selectedProjectId,
          description: "",
          category: "アイデア",
          tags: ["アイデア"],
          memo_status: "unsorted",
        }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        throw new Error(data.error || "メモの作成に失敗しました")
      }
      if (!data.item) {
        throw new Error("作成結果を取得できませんでした")
      }
      const item = data.item as MemoItem
      setItems(prev => [item, ...prev])
      setSelectedItem(item)
      setStatusFilter("all")
      setTagFilter("all")
      await refreshTags()
      setDetailOpen(true)
    } catch (err) {
      setIntakeError(err instanceof Error ? err.message : "メモの作成に失敗しました")
    }
  }

  const handleAnalyze = async () => {
    if (!intakeText.trim() || isAnalyzing) return
    setIntakeError(null)
    setIsAnalyzing(true)
    setAnalyzeStartedAt(Date.now())
    try {
      const res = await fetch("/api/ai-ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: intakeText, model: selectedAiModel }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        setIntakeError(data.error || "整理に失敗しました")
        return
      }
      const suggestedCategory = typeof data.suggestion?.category === "string" && allTags.includes(data.suggestion.category)
        ? data.suggestion.category
        : ""
      setSuggestion({
        ...data.suggestion,
        project_id: selectedProjectId,
        category: suggestedCategory,
        tags: [],
        tag_suggestions: allTags,
      })
      setSuggestionOpen(true)
    } finally {
      setIsAnalyzing(false)
      setAnalyzeStartedAt(null)
    }
  }

  const handleQuickModelChange = async (modelId: string) => {
    setSelectedAiModel(modelId)
    await fetch("/api/ai/context", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preferences: { ai_ingest_model: modelId } }),
    }).catch(() => null)
  }

  const handleVoiceToggle = async () => {
    if (isTranscribing) return
    if (isRecording) {
      stopRecording()
      return
    }
    await startRecording()
  }

  const handleOpenMicrophoneSettings = async () => {
    await fetch("/api/system/microphone-settings", { method: "POST" }).catch(() => null)
  }

  const saveSuggestion = async (calendarCandidate?: MemoSuggestion["time_candidates"][number], addToCalendar = false) => {
    if (!suggestion?.title.trim() || isSavingSuggestion) return
    setIntakeError(null)
    setIsSavingSuggestion(true)
    const scheduledAt = calendarCandidate?.scheduled_at ?? suggestion.scheduled_at
    const durationMinutes = calendarCandidate?.duration_minutes ?? suggestion.duration_minutes
    try {
      const res = await fetch("/api/wishlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: suggestion.title,
          project_id: suggestion.project_id ?? selectedProjectId,
          category: suggestion.category,
          tags: suggestion.tags,
          description: suggestion.description,
          time_candidates: suggestion.time_candidates,
          subtask_suggestions: suggestion.subtask_suggestions,
          scheduled_at: scheduledAt,
          duration_minutes: durationMinutes,
          memo_status: scheduledAt ? "time_candidates" : "unsorted",
          ai_source_payload: { suggestion, intakeText },
        }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        throw new Error(data.error || "メモの保存に失敗しました")
      }
      if (!data.item) {
        throw new Error("保存結果を取得できませんでした")
      }
      const item = data.item as MemoItem
      setItems(prev => [item, ...prev])
      setStatusFilter("all")
      setTagFilter("all")
      await refreshTags()
      if (addToCalendar && item.scheduled_at && item.duration_minutes) {
        await handleCalendarAdd(item)
      }
      setSuggestion(null)
      setSuggestionOpen(false)
      setIntakeText("")
    } catch (err) {
      setIntakeError(err instanceof Error ? err.message : "メモの保存に失敗しました")
    } finally {
      setIsSavingSuggestion(false)
    }
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
    const { google_event_id, item: updatedItem } = await res.json()
    if (updatedItem) {
      setItems(prev => prev.map(existing => existing.id === item.id ? updatedItem : existing))
      setSelectedItem(prev => prev?.id === item.id ? updatedItem : prev)
    } else {
      await handleUpdate(item.id, { google_event_id, memo_status: "scheduled" })
    }
    invalidateCalendarCache()
    broadcastCalendarSync()
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
      <div className="shrink-0 space-y-2 border-b px-4 py-3 md:px-6">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-semibold leading-tight">メモ</h1>
            <p className="truncate text-xs text-muted-foreground">雑な入力を整理</p>
          </div>
          <Button
            type="button"
            variant={isRecording ? "destructive" : "outline"}
            size="icon"
            onClick={handleVoiceToggle}
            disabled={isTranscribing}
            aria-label={isRecording ? "録音を停止" : "音声入力を開始"}
            className="min-h-[44px] min-w-[44px] shrink-0"
          >
            {isTranscribing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
          </Button>
          <label className="relative min-h-[44px] w-[112px] shrink-0 rounded-md border bg-muted/20">
            <span className="sr-only">AIモデル</span>
            <select
              value={selectedAiModel}
              onChange={e => handleQuickModelChange(e.target.value)}
              disabled={isAnalyzing}
              className="h-[44px] w-full appearance-none rounded-md bg-transparent pl-8 pr-7 text-sm font-medium outline-none disabled:opacity-50"
            >
              {QUICK_MODEL_OPTIONS.map(option => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
            <Sparkles className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          </label>
          <Button onClick={handleCreate} size="sm" className="min-h-[44px] shrink-0 gap-1 px-3">
            <Plus className="h-4 w-4" /> 追加
          </Button>
        </div>

        <div className="flex gap-2">
          <textarea
            value={intakeText}
            onChange={e => setIntakeText(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleAnalyze() }}
            placeholder={`マイクまたはテキストで入力。${selectedModelOption.label}で整理`}
            rows={1}
            className="min-h-[44px] flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
          />
          <Button onClick={handleAnalyze} disabled={isAnalyzing || !intakeText.trim()} className="min-h-[44px] shrink-0 gap-1 px-3">
            {isAnalyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            <span>{isAnalyzing ? "整理中" : "生成"}</span>
          </Button>
          <Button
            type="button"
            variant={filterOpen ? "default" : "outline"}
            size="icon"
            onClick={() => setFilterOpen(open => !open)}
            aria-label={filterOpen ? "フィルターを閉じる" : "フィルターを開く"}
            className="min-h-[44px] min-w-[44px] shrink-0"
          >
            <Filter className="h-4 w-4" />
          </Button>
        </div>
        {isAnalyzing && (
          <div className="flex min-h-10 flex-wrap items-center gap-3 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span className="font-medium text-foreground">
              {ANALYZE_STATUS_MESSAGES[Math.min(Math.floor(analyzeElapsedSeconds / 4), ANALYZE_STATUS_MESSAGES.length - 1)]}
            </span>
            <span>{analyzeElapsedSeconds}秒経過</span>
          </div>
        )}
        {intakeError && !isAnalyzing && (
          <div className="flex min-h-10 items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <span>{intakeError}</span>
            <button
              type="button"
              onClick={() => setIntakeError(null)}
              className="shrink-0 rounded px-2 py-1 hover:bg-destructive/10"
            >
              閉じる
            </button>
          </div>
        )}
        {(isRecording || isTranscribing || voiceError) && (
          <div className="flex min-h-9 flex-wrap items-center gap-3 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            {isRecording && (
              <>
                <span className="font-medium text-destructive">録音中</span>
                <VoiceWaveform analyserRef={analyserRef} height={24} barCount={28} />
                <span>もう一度マイクを押すと文字起こしします</span>
              </>
            )}
            {isTranscribing && (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>文字起こし中...</span>
              </>
            )}
            {voiceError && <span className="min-w-0 flex-1 text-destructive">{voiceError}</span>}
            {permissionState === "prompt" && !voiceError && (
              <span>許可ダイアログが出たらマイクを許可してください</span>
            )}
            {permissionState === "denied" && (
              <div className="flex shrink-0 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleOpenMicrophoneSettings}
                  className="h-8 gap-1 text-xs"
                >
                  <Settings className="h-3.5 w-3.5" /> 設定を開く
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => window.location.reload()}
                  className="h-8 gap-1 text-xs"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> 再読み込み
                </Button>
              </div>
            )}
          </div>
        )}
        <div className={cn(!filterOpen && "hidden")}>
          <FilterBar
            statusFilter={statusFilter}
            tagFilter={tagFilter}
            tags={allTags}
            tagColors={tagColors}
            onStatusChange={setStatusFilter}
            onTagChange={setTagFilter}
          />
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto px-4 py-4 pb-24 md:px-6">
          {filteredItems.length === 0 ? (
            <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
              <p>メモはまだありません</p>
              <Button variant="outline" onClick={handleCreate} className="min-h-[44px]">
                <Plus className="mr-1 h-4 w-4" /> 追加
              </Button>
            </div>
          ) : (
            <div className="mx-auto grid max-w-7xl gap-4 lg:grid-cols-4">
              <MemoSection
                title="未予定"
                count={unscheduledItems.length}
                items={unscheduledItems}
                emptyText="未予定のメモはありません"
                onUpdate={handleUpdate}
                onDelete={handleDelete}
                onOpen={openDetail}
                projectById={projectById}
                tagColors={tagColors}
                getAiTask={getMemoAiTask}
                onLaunchClaude={launchClaudeForMemo}
                className="lg:col-span-2"
                listClassName="sm:grid-cols-2"
              />
              <MemoSection
                title="予定済み"
                count={scheduledItems.length}
                items={scheduledItems}
                emptyText="予定済みのメモはありません"
                onUpdate={handleUpdate}
                onDelete={handleDelete}
                onOpen={openDetail}
                projectById={projectById}
                tagColors={tagColors}
                getAiTask={getMemoAiTask}
                onLaunchClaude={launchClaudeForMemo}
              />
              <MemoSection
                title="完了"
                count={completedItems.length}
                items={completedItems}
                emptyText="完了したメモはありません"
                onUpdate={handleUpdate}
                onDelete={handleDelete}
                onOpen={openDetail}
                projectById={projectById}
                tagColors={tagColors}
                getAiTask={getMemoAiTask}
                onLaunchClaude={launchClaudeForMemo}
              />
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
        registeredTags={allTags}
        tagColors={tagColors}
        projects={projects}
        isSaving={isSavingSuggestion}
      />

      <WishlistCardDetail
        item={selectedItem}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onUpdate={handleUpdate}
        onCalendarAdd={handleCalendarAdd}
        onSaved={() => setDetailOpen(false)}
        tagOptions={allTags}
        projects={projects}
        tagColors={tagColors}
        onLaunchClaude={launchClaudeForMemo}
      />
    </div>
  )
}

function MemoSection({
  title,
  count,
  items,
  emptyText,
  onUpdate,
  onDelete,
  onOpen,
  projectById,
  tagColors,
  className,
  listClassName,
  getAiTask,
  onLaunchClaude,
}: {
  title: string
  count: number
  items: MemoItem[]
  emptyText: string
  onUpdate: (id: string, updates: Record<string, unknown>) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onOpen: (item: MemoItem) => void
  projectById: Map<string, Project>
  tagColors: Record<string, string>
  className?: string
  listClassName?: string
  getAiTask: (sourceId: string) => import("@/types/ai-task").AiTask | null
  onLaunchClaude: (item: MemoItem) => Promise<void>
}) {
  return (
    <section className={cn("min-w-0", className)}>
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-medium">{title}</h2>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{count}</span>
      </div>
      {items.length === 0 ? (
        <div className="flex min-h-24 items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground">
          {emptyText}
        </div>
      ) : (
        <div className={cn("grid gap-3", listClassName)}>
          {items.map(item => (
            <WishlistCard
              key={item.id}
              item={item}
              onUpdate={onUpdate}
              onDelete={onDelete}
              onClick={() => onOpen(item)}
              project={item.project_id ? projectById.get(item.project_id) ?? null : null}
              tagColors={tagColors}
              aiTask={getAiTask(item.id)}
              onLaunchClaude={() => onLaunchClaude(item)}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function FilterBar({
  statusFilter,
  tagFilter,
  tags,
  tagColors,
  onStatusChange,
  onTagChange,
}: {
  statusFilter: MemoStatus | "all"
  tagFilter: string | "all"
  tags: string[]
  tagColors: Record<string, string>
  onStatusChange: (status: MemoStatus | "all") => void
  onTagChange: (tag: string | "all") => void
}) {
  const statusOptions: Array<MemoStatus | "all"> = ["all", "unsorted", "scheduled", "completed"]
  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-1">
      <Filter className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="flex shrink-0 items-center gap-1 border-r pr-2">
        {statusOptions.map(status => (
          <button
            key={status}
            onClick={() => onStatusChange(status)}
            className={cn(
              "min-h-8 shrink-0 rounded-full border px-2.5 text-[11px]",
              statusFilter === status ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground",
            )}
          >
            {STATUS_LABEL[status]}
          </button>
        ))}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          onClick={() => onTagChange("all")}
          className={cn(
            "min-h-8 shrink-0 rounded-full border px-2.5 text-[11px]",
            tagFilter === "all" ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground",
          )}
        >
          タグすべて
        </button>
        {tags.map(tag => {
          const color = getTagColor(tag, tagColors)
          return (
            <button
              key={tag}
              onClick={() => onTagChange(tag)}
              className="min-h-8 shrink-0 rounded-full border px-2.5 text-[11px]"
              style={{
                borderColor: color,
                backgroundColor: tagFilter === tag ? color : `${color}22`,
                color: tagFilter === tag ? "#fff" : color,
              }}
            >
              {tag}
            </button>
          )
        })}
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
  registeredTags,
  tagColors,
  projects,
  isSaving,
}: {
  suggestion: MemoSuggestion | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onChange: (suggestion: MemoSuggestion | null) => void
  onSave: (candidate?: MemoSuggestion["time_candidates"][number], addToCalendar?: boolean) => Promise<void>
  registeredTags: string[]
  tagColors: Record<string, string>
  projects: Project[]
  isSaving: boolean
}) {
  const [selectedCandidateIndex, setSelectedCandidateIndex] = useState<number | null>(null)
  const [newTagText, setNewTagText] = useState("")

  if (!suggestion) return null

  const update = (updates: Partial<MemoSuggestion>) => onChange({ ...suggestion, ...updates })
  const selectedCandidate = selectedCandidateIndex === null ? undefined : suggestion.time_candidates[selectedCandidateIndex]
  const canCalendar = !!(selectedCandidate?.scheduled_at || suggestion.scheduled_at) && !!suggestion.duration_minutes
  const selectedTags = Array.from(new Set([suggestion.category, ...suggestion.tags].filter(Boolean)))
  const registeredTagOptions = registeredTags.filter(tag => !selectedTags.includes(tag)).slice(0, 8)
  const durationText = suggestion.duration_input ?? (suggestion.duration_minutes ? String(suggestion.duration_minutes) : "")
  const dateValue = suggestion.date_input ?? formatDateValue(suggestion.scheduled_at)
  const timeValue = suggestion.time_input ?? formatTimeInput(suggestion.scheduled_at)
  const dateOptions = buildDateOptions(dateValue)
  const timeOptions = buildTimeOptions(timeValue)

  const setTags = (tags: string[]) => {
    const nextTags = Array.from(new Set(tags.map(tag => tag.trim()).filter(Boolean))).slice(0, 6)
    update({
      category: nextTags[0] ?? "",
      tags: nextTags.slice(1),
    })
  }

  const addTag = (tag: string) => {
    const trimmed = tag.trim()
    if (!trimmed || selectedTags.includes(trimmed)) return
    setTags([...selectedTags, trimmed])
  }

  const removeTag = (tag: string) => {
    setTags(selectedTags.filter(selectedTag => selectedTag !== tag))
  }

  const handleAddNewTag = () => {
    addTag(newTagText)
    setNewTagText("")
  }

  const handleScheduleChange = (nextDateValue: string, nextTimeValue: string) => {
    update({
      date_input: nextDateValue,
      time_input: nextTimeValue,
      scheduled_at: combineDateTime(nextDateValue, nextTimeValue),
      memo_status: nextDateValue ? "time_candidates" : suggestion.memo_status,
    })
  }

  const handleDurationTextChange = (value: string) => {
    const normalized = value.replace(/[^\d]/g, "")
    if (!normalized) {
      update({ duration_input: "", duration_minutes: null })
      return
    }
    const minutes = Number(normalized)
    if (!Number.isFinite(minutes) || minutes <= 0) {
      update({ duration_input: normalized, duration_minutes: null })
      return
    }
    update({ duration_input: normalized, duration_minutes: Math.min(minutes, 720) })
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto rounded-t-2xl border-border/70 bg-background/95 shadow-2xl backdrop-blur md:left-1/2 md:max-w-2xl md:-translate-x-1/2">
        <SheetHeader>
          <SheetTitle className="text-left">生成結果</SheetTitle>
        </SheetHeader>
        <div className="space-y-4 px-4 pb-6">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">メモの見出し</label>
            <Input
              value={suggestion.title}
              onChange={e => update({ title: e.target.value })}
              placeholder="見出し"
              className="min-h-[50px] rounded-xl border-border/80 bg-muted/20 px-4 text-base font-semibold shadow-none"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">プロジェクト</label>
            <div className="relative">
              <select
                value={suggestion.project_id ?? ""}
                onChange={e => update({ project_id: e.target.value || null })}
                className="min-h-[48px] w-full appearance-none rounded-xl border border-border/80 bg-muted/20 px-4 pr-10 text-sm outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-primary/20"
                aria-label="プロジェクト"
              >
                <option value="">プロジェクト未設定</option>
                {projects.map(project => (
                  <option key={project.id} value={project.id}>{project.title}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">メモ</label>
            <textarea
              value={suggestion.description}
              onChange={e => update({ description: e.target.value })}
              rows={4}
              className="w-full resize-none rounded-xl border border-border/80 bg-muted/20 px-4 py-3 text-sm leading-6 outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">タグ</label>
            <div className="flex flex-wrap gap-1.5">
              {selectedTags.map(tag => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => removeTag(tag)}
                  className="min-h-9 rounded-full border px-3 text-xs transition-colors"
                  style={{
                    borderColor: getTagColor(tag, tagColors),
                    backgroundColor: `${getTagColor(tag, tagColors)}22`,
                    color: getTagColor(tag, tagColors),
                  }}
                >
                  {tag} ×
                </button>
              ))}
            </div>
            <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
              <div className="relative">
                <select
                  value=""
                  onChange={e => {
                    addTag(e.target.value)
                    e.target.value = ""
                  }}
                  className="min-h-[48px] w-full appearance-none rounded-xl border border-border/80 bg-muted/20 px-4 pr-10 text-sm outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-primary/20"
                  aria-label="登録タグを選択"
                >
                  <option value="">登録タグから選択</option>
                  {registeredTagOptions.map(tag => (
                    <option key={tag} value={tag}>
                      {tag}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              </div>
              <Input
                value={newTagText}
                onChange={e => setNewTagText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") handleAddNewTag()
                }}
                placeholder="新しいタグ"
                className="min-h-[48px] rounded-xl bg-muted/20"
              />
              <Button type="button" variant="outline" onClick={handleAddNewTag} className="min-h-[48px] rounded-xl px-4">
                <Plus className="mr-1 h-4 w-4" />
                追加
              </Button>
            </div>
            {registeredTagOptions.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {registeredTagOptions.map(tag => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => addTag(tag)}
                    className="min-h-9 rounded-full border px-3 text-xs transition-colors"
                    style={{
                      borderColor: `${getTagColor(tag, tagColors)}88`,
                      backgroundColor: `${getTagColor(tag, tagColors)}14`,
                      color: getTagColor(tag, tagColors),
                    }}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">所要時間</label>
            <div className="flex flex-wrap gap-1.5">
              {DURATION_OPTIONS.map(option => (
                <button
                  key={option.label}
                  type="button"
                  onClick={() => {
                    update({
                      duration_input: option.minutes ? String(option.minutes) : "",
                      duration_minutes: option.minutes,
                    })
                  }}
                  className={cn(
                    "min-h-9 rounded-full border px-3 text-xs transition-colors",
                    suggestion.duration_minutes === option.minutes || (!suggestion.duration_minutes && option.minutes === null)
                      ? "border-primary bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="flex min-h-[52px] items-center rounded-xl border border-border/80 bg-muted/20 transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-primary/20">
                <Input
                  type="text"
                  inputMode="numeric"
                  value={durationText}
                  onChange={e => handleDurationTextChange(e.target.value)}
                  placeholder="未設定"
                  className="h-12 border-0 bg-transparent px-4 text-center text-base font-semibold shadow-none focus-visible:ring-0"
                  aria-label="所要時間"
                />
                <span className="pr-3 text-sm text-muted-foreground">分</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-2">
              <span className="text-xs text-muted-foreground">日付</span>
              <div className="relative flex min-h-[52px] items-center rounded-xl border border-border/80 bg-muted/20 px-3 transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-primary/20">
                <Calendar className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                <select
                  value={dateValue}
                  onChange={e => handleScheduleChange(e.target.value, timeValue || "09:00")}
                  className="h-12 min-w-0 flex-1 appearance-none bg-transparent pr-7 text-sm font-medium outline-none"
                  aria-label="日付"
                >
                  <option value="">未設定</option>
                  {dateOptions.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 h-4 w-4 text-muted-foreground" />
              </div>
            </label>
            <label className="space-y-2">
              <span className="text-xs text-muted-foreground">時刻</span>
              <div className="relative flex min-h-[52px] items-center rounded-xl border border-border/80 bg-muted/20 px-3 transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-primary/20">
                <Clock className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                <select
                  value={timeValue}
                  onChange={e => handleScheduleChange(dateValue, e.target.value)}
                  disabled={!dateValue}
                  className="h-12 min-w-0 flex-1 appearance-none bg-transparent pr-7 text-sm font-medium outline-none disabled:text-muted-foreground"
                  aria-label="時刻"
                >
                  <option value="">未設定</option>
                  {timeOptions.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 h-4 w-4 text-muted-foreground" />
              </div>
            </label>
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
                        date_input: formatDateValue(candidate.scheduled_at),
                        time_input: formatTimeInput(candidate.scheduled_at),
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
            <Button disabled={isSaving || !suggestion.title.trim()} onClick={() => onSave(selectedCandidate, false)} className="min-h-[44px]">
              {isSaving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Check className="mr-1 h-4 w-4" />}
              {isSaving ? "保存中..." : "メモに保存"}
            </Button>
            <Button
              variant="outline"
              disabled={isSaving || !suggestion.title.trim() || !canCalendar}
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
