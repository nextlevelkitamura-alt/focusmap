"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Calendar, Check, ChevronDown, Clock, Download, ImagePlus, Loader2, Minus, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { IdealGoalWithItems, Project } from "@/types/database"
import { cn } from "@/lib/utils"
import { DEFAULT_PROJECT_COLOR, colorToRgba, getTagColor, normalizeColor } from "@/lib/color-utils"

const QUICK_MINUTES = [30, 45, 60, 90]

interface MemoImage {
  id: string
  file_name: string
  file_url: string
  file_type: string
  file_size: number
}

interface WishlistCardDetailProps {
  item: IdealGoalWithItems | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpdate: (id: string, updates: Record<string, unknown>) => Promise<void>
  onCalendarAdd: (item: IdealGoalWithItems) => Promise<void>
  onSaved?: () => void
  tagOptions: string[]
  projects?: Project[]
  tagColors?: Record<string, string>
}

function linkify(text: string) {
  const parts = text.split(/(https?:\/\/[^\s)）]+)/g)
  return parts.map((part, index) => {
    if (/^https?:\/\//.test(part)) {
      return (
        <a
          key={`${part}-${index}`}
          href={part}
          target="_blank"
          rel="noreferrer"
          className="text-blue-400 underline underline-offset-2"
        >
          {part}
        </a>
      )
    }
    return <span key={`${part}-${index}`}>{part}</span>
  })
}

function formatDateValue(value: string | null | undefined) {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-")
}

function formatTimeValue(value: string | null | undefined) {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
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

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

export function WishlistCardDetail({
  item,
  open,
  onOpenChange,
  onUpdate,
  onCalendarAdd,
  onSaved,
  tagOptions,
  projects = [],
  tagColors = {},
}: WishlistCardDetailProps) {
  const [isAddingCalendar, setIsAddingCalendar] = useState(false)
  const [isSavingMemo, setIsSavingMemo] = useState(false)
  const [isUploadingImage, setIsUploadingImage] = useState(false)
  const [deletingImageId, setDeletingImageId] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState("")
  const [draftDescription, setDraftDescription] = useState("")
  const [newSubItem, setNewSubItem] = useState("")
  const [tagText, setTagText] = useState("")
  const [images, setImages] = useState<MemoImage[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const tags = useMemo(() => item?.tags ?? [], [item?.tags])
  const categoryOptions = useMemo(() => {
    const set = new Set<string>(tagOptions)
    if (item?.category) set.add(item.category)
    for (const tag of item?.tags ?? []) set.add(tag)
    return [...set].slice(0, 12)
  }, [item?.category, item?.tags, tagOptions])

  const loadImages = useCallback(async () => {
    if (!item?.id || !open) return
    const res = await fetch(`/api/wishlist/${item.id}/attachments`)
    if (!res.ok) return
    const { attachments } = await res.json()
    setImages((attachments ?? []).filter((attachment: MemoImage) => attachment.file_type?.startsWith("image/")))
  }, [item?.id, open])

  useEffect(() => {
    if (!item || !open) return
    setDraftTitle(item.title)
    setDraftDescription(item.description ?? "")
    setSaveError(null)
  }, [item, open])

  useEffect(() => {
    loadImages()
  }, [loadImages])

  if (!item) return null

  const dateValue = formatDateValue(item.scheduled_at)
  const timeValue = formatTimeValue(item.scheduled_at)
  const dateOptions = buildDateOptions(dateValue)
  const timeOptions = buildTimeOptions(timeValue)

  const update = (updates: Record<string, unknown>) => onUpdate(item.id, updates)
  const selectedProject = item.project_id ? projects.find(project => project.id === item.project_id) : null
  const selectedProjectColor = selectedProject ? normalizeColor(selectedProject.color_theme, DEFAULT_PROJECT_COLOR) : DEFAULT_PROJECT_COLOR

  const changeDuration = async (delta: number) => {
    const current = item.duration_minutes ?? 60
    await update({ duration_minutes: Math.max(15, current + delta) })
  }

  const handleScheduleChange = async (nextDateValue: string, nextTimeValue: string) => {
    const scheduledAt = combineDateTime(nextDateValue, nextTimeValue)
    await update({
      scheduled_at: scheduledAt,
      memo_status: scheduledAt ? "time_candidates" : item.memo_status,
    })
  }

  const handleAddCalendar = async () => {
    if (!item.scheduled_at || !item.duration_minutes) {
      alert("日時と所要時間を入力してからカレンダーに追加してください。")
      return
    }
    if (!window.confirm("このメモをGoogleカレンダーに登録しますか？")) return
    setIsAddingCalendar(true)
    try {
      await onCalendarAdd(item)
      await update({ memo_status: "scheduled" })
    } finally {
      setIsAddingCalendar(false)
    }
  }

  const handleSaveMemo = async () => {
    const title = draftTitle.trim()
    if (!title) {
      setSaveError("見出しを入力してください")
      return
    }

    setIsSavingMemo(true)
    setSaveError(null)
    try {
      await update({
        title,
        description: draftDescription.trim() || null,
        memo_status: item.memo_status ?? "unsorted",
      })
      onSaved?.()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "メモの保存に失敗しました")
    } finally {
      setIsSavingMemo(false)
    }
  }

  const handleAddSubItem = async () => {
    if (!newSubItem.trim()) return
    await fetch(`/api/wishlist/${item.id}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newSubItem.trim() }),
    })
    setNewSubItem("")
    await update({})
  }

  const handleAddTag = async () => {
    const tag = tagText.trim()
    if (!tag || tags.includes(tag)) return
    setTagText("")
    await update({ tags: [...tags, tag] })
  }

  const removeTag = async (tag: string) => {
    await update({ tags: tags.filter(t => t !== tag) })
  }

  const uploadImage = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setSaveError("画像ファイルを選択してください")
      return
    }
    setIsUploadingImage(true)
    setSaveError(null)
    try {
      const formData = new FormData()
      formData.append("file", file)
      const res = await fetch(`/api/wishlist/${item.id}/attachments`, {
        method: "POST",
        body: formData,
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        throw new Error(data.error || "画像の保存に失敗しました")
      }
      setImages(prev => [...prev, data.attachment])
      if (fileInputRef.current) fileInputRef.current.value = ""
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "画像の保存に失敗しました")
    } finally {
      setIsUploadingImage(false)
    }
  }

  const handleImageDelete = async (imageId: string) => {
    setDeletingImageId(imageId)
    try {
      const res = await fetch(`/api/wishlist/${item.id}/attachments/${imageId}`, { method: "DELETE" })
      if (!res.ok) throw new Error("画像の削除に失敗しました")
      setImages(prev => prev.filter(image => image.id !== imageId))
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "画像の削除に失敗しました")
    } finally {
      setDeletingImageId(null)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="text-left">メモを編集</SheetTitle>
        </SheetHeader>

        <div className="space-y-5 px-4 pb-6">
          <div className="space-y-1">
            <Label>メモの見出し</Label>
            <Input
              value={draftTitle}
              onChange={e => setDraftTitle(e.target.value)}
              className="text-base font-semibold"
            />
          </div>

          <div className="space-y-2">
            <Label>プロジェクト</Label>
            <div className="relative">
              <select
                value={item.project_id ?? ""}
                onChange={e => update({ project_id: e.target.value || null })}
                className="min-h-[44px] w-full appearance-none rounded-md border bg-background px-3 pr-10 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                style={selectedProject ? {
                  borderColor: colorToRgba(selectedProjectColor, 0.55),
                  boxShadow: `inset 4px 0 0 ${selectedProjectColor}`,
                } : undefined}
              >
                <option value="">プロジェクト未設定</option>
                {projects.map(project => (
                  <option key={project.id} value={project.id}>
                    {project.title}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            </div>
          </div>

          <div className="space-y-2">
            <Label>タグ</Label>
            <div className="flex flex-wrap gap-1.5">
              {categoryOptions.map(cat => (
                <button
                  key={cat}
                  onClick={() => update({ category: item.category === cat ? null : cat })}
                  className="min-h-9 rounded-full border px-3 text-xs transition-colors"
                  style={{
                    borderColor: getTagColor(cat, tagColors),
                    backgroundColor: item.category === cat ? getTagColor(cat, tagColors) : colorToRgba(getTagColor(cat, tagColors), 0.12),
                    color: item.category === cat ? "#fff" : getTagColor(cat, tagColors),
                  }}
                >
                  {cat}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {tags.map(tag => (
                <button
                  key={tag}
                  onClick={() => removeTag(tag)}
                  className="rounded-full border px-2 py-1 text-xs hover:opacity-80"
                  style={{
                    borderColor: colorToRgba(getTagColor(tag, tagColors), 0.55),
                    backgroundColor: colorToRgba(getTagColor(tag, tagColors), 0.08),
                    color: getTagColor(tag, tagColors),
                  }}
                >
                  {tag} ×
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                value={tagText}
                onChange={e => setTagText(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleAddTag()}
                placeholder="タグを追加"
              />
              <Button variant="outline" onClick={handleAddTag}>追加</Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label>画像</Label>
            <div className="flex flex-wrap items-start gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploadingImage}
                className="flex h-24 w-28 items-center justify-center rounded-md border border-dashed text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground disabled:opacity-60"
              >
                {isUploadingImage ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={e => {
                  const file = e.target.files?.[0]
                  if (file) uploadImage(file)
                }}
              />
              {images.map(image => (
                <div key={image.id} className="w-28 overflow-hidden rounded-md border bg-muted/20">
                  <a
                    href={image.file_url}
                    download={image.file_name}
                    target="_blank"
                    rel="noreferrer"
                    onDoubleClick={e => e.currentTarget.click()}
                    title="PCはダブルクリックで保存、スマホは長押しまたは保存ボタン"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={image.file_url} alt={image.file_name} className="h-24 w-28 object-cover" />
                  </a>
                  <div className="flex items-center justify-between gap-1 px-1.5 py-1">
                    <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">{formatFileSize(image.file_size)}</span>
                    <a
                      href={image.file_url}
                      download={image.file_name}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded p-1 text-muted-foreground hover:text-foreground"
                      title="保存"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </a>
                    <button
                      type="button"
                      onClick={() => handleImageDelete(image.id)}
                      disabled={deletingImageId === image.id}
                      className="rounded p-1 text-muted-foreground hover:text-destructive disabled:opacity-60"
                      title="削除"
                    >
                      {deletingImageId === image.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <Label>メモ</Label>
            <textarea
              value={draftDescription}
              onChange={e => setDraftDescription(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  handleSaveMemo()
                }
              }}
              rows={6}
              placeholder="本文にGoogle DocsなどのURLを貼ると、そのままリンクとして開けます。"
              className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            {draftDescription && (
              <div className="rounded-md bg-muted/40 p-2 text-xs leading-5 text-muted-foreground">
                {linkify(draftDescription)}
              </div>
            )}
          </div>

          {saveError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {saveError}
            </div>
          )}

          <Button
            onClick={handleSaveMemo}
            disabled={isSavingMemo || !draftTitle.trim()}
            className="w-full min-h-[44px]"
          >
            {isSavingMemo ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
            メモを保存
          </Button>

          <div className="space-y-3">
            <Label>時間</Label>
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1.5">
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
              <label className="space-y-1.5">
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
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" onClick={() => changeDuration(-15)} className="min-h-[44px] min-w-[44px]">
                <Minus className="h-4 w-4" />
              </Button>
              <div className="flex min-h-[44px] min-w-20 items-center justify-center rounded-md border text-sm font-medium">
                {item.duration_minutes ?? 60}分
              </div>
              <Button variant="outline" size="icon" onClick={() => changeDuration(15)} className="min-h-[44px] min-w-[44px]">
                <Plus className="h-4 w-4" />
              </Button>
              <div className="flex flex-wrap gap-1">
                {QUICK_MINUTES.map(minutes => (
                  <button
                    key={minutes}
                    onClick={() => update({ duration_minutes: minutes })}
                    className="min-h-9 rounded-md border px-2 text-xs text-muted-foreground hover:text-foreground"
                  >
                    {minutes}分
                  </button>
                ))}
              </div>
            </div>
          </div>

          <Button
            onClick={handleAddCalendar}
            disabled={isAddingCalendar || !item.scheduled_at || !item.duration_minutes}
            variant={item.google_event_id ? "outline" : "default"}
            className="w-full min-h-[44px]"
          >
            {isAddingCalendar ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Calendar className="mr-2 h-4 w-4" />}
            {item.google_event_id ? "カレンダー登録済み" : "カレンダーに入れる"}
          </Button>

          <div className="space-y-2">
            <Label>サブタスク候補</Label>
            <ul className="space-y-1">
              {(item.ideal_items ?? []).map(sub => (
                <li key={sub.id} className="flex items-center gap-2 rounded-md border px-2 py-2 text-sm">
                  <span className={cn(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                    sub.is_done ? "border-primary bg-primary" : "border-muted-foreground/40",
                  )}>
                    {sub.is_done && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                  </span>
                  <span className={cn("flex-1", sub.is_done && "line-through text-muted-foreground")}>{sub.title}</span>
                  {sub.session_minutes > 0 && <span className="text-xs text-muted-foreground">{sub.session_minutes}分</span>}
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <Input
                value={newSubItem}
                onChange={e => setNewSubItem(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleAddSubItem()}
                placeholder="サブタスク候補を追加"
              />
              <Button size="icon" variant="outline" onClick={handleAddSubItem} className="min-w-[44px]">
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
