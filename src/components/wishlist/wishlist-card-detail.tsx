"use client"

import { useState } from "react"
import { IdealGoalWithItems } from "@/types/database"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Calendar, Loader2, Plus, Check, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"

const CATEGORIES = ['学習', '調査', '目標', 'アイデア', '旅行', '健康', '趣味', 'その他']

interface WishlistCardDetailProps {
  item: IdealGoalWithItems | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpdate: (id: string, updates: Record<string, unknown>) => Promise<void>
  onCalendarAdd: (item: IdealGoalWithItems) => Promise<void>
}

export function WishlistCardDetail({ item, open, onOpenChange, onUpdate, onCalendarAdd }: WishlistCardDetailProps) {
  const [isAddingCalendar, setIsAddingCalendar] = useState(false)
  const [newSubItem, setNewSubItem] = useState('')

  if (!item) return null

  const handleBlurField = async (field: string, value: string | null) => {
    await onUpdate(item.id, { [field]: value })
  }

  const handleDateChange = async (value: string) => {
    await onUpdate(item.id, { scheduled_at: value ? new Date(value).toISOString() : null })
  }

  const handleAddCalendar = async () => {
    if (!item.scheduled_at || !item.duration_minutes) {
      alert('日時と所要時間を入力してからカレンダーに追加してください。')
      return
    }
    setIsAddingCalendar(true)
    try {
      await onCalendarAdd(item)
    } finally {
      setIsAddingCalendar(false)
    }
  }

  const handleAddSubItem = async () => {
    if (!newSubItem.trim()) return
    await fetch(`/api/wishlist/${item.id}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newSubItem.trim() }),
    })
    setNewSubItem('')
    await onUpdate(item.id, {})
  }

  const scheduledAtLocal = item.scheduled_at
    ? new Date(item.scheduled_at).toISOString().slice(0, 16)
    : ''

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-left">詳細</SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-5">
          {/* タイトル */}
          <div className="space-y-1">
            <Label>タイトル</Label>
            <Input
              defaultValue={item.title}
              onBlur={e => handleBlurField('title', e.target.value)}
              className="text-base font-semibold"
            />
          </div>

          {/* カテゴリ */}
          <div className="space-y-1">
            <Label>カテゴリ</Label>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.map(cat => (
                <button
                  key={cat}
                  onClick={() => handleBlurField('category', item.category === cat ? null : cat)}
                  className={cn(
                    "px-3 py-1 rounded-full text-xs border transition-colors",
                    item.category === cat
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted text-muted-foreground border-transparent hover:border-muted-foreground"
                  )}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* メモ */}
          <div className="space-y-1">
            <Label>メモ</Label>
            <textarea
              defaultValue={item.description ?? ''}
              onBlur={(e: React.FocusEvent<HTMLTextAreaElement>) => handleBlurField('description', e.target.value || null)}
              rows={3}
              placeholder="詳細・メモを入力..."
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
            />
          </div>

          {/* 日時 */}
          <div className="space-y-1">
            <Label>予定日時</Label>
            <Input
              type="datetime-local"
              defaultValue={scheduledAtLocal}
              onChange={e => handleDateChange(e.target.value)}
            />
          </div>

          {/* 所要時間 */}
          <div className="space-y-1">
            <Label>所要時間（分）</Label>
            <Input
              type="number"
              defaultValue={item.duration_minutes ?? ''}
              onBlur={e => onUpdate(item.id, { duration_minutes: e.target.value ? Number(e.target.value) : null })}
              placeholder="例: 60"
              min={1}
            />
          </div>

          {/* カレンダー登録 */}
          <Button
            onClick={handleAddCalendar}
            disabled={isAddingCalendar || !item.scheduled_at || !item.duration_minutes}
            variant={item.google_event_id ? "outline" : "default"}
            className="w-full"
          >
            {isAddingCalendar
              ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              : <Calendar className="w-4 h-4 mr-2" />}
            {item.google_event_id ? '📅 カレンダー登録済み' : 'カレンダーに追加'}
          </Button>

          {/* サブアイテム（やりたいこと） */}
          <div className="space-y-2">
            <Label>ミクロのやりたいこと</Label>
            <ul className="space-y-1">
              {(item.ideal_items ?? []).map(sub => (
                <li key={sub.id} className="flex items-center gap-2 text-sm">
                  <span className={cn(
                    "w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center",
                    sub.is_done ? "bg-primary border-primary" : "border-muted-foreground/40"
                  )}>
                    {sub.is_done && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                  </span>
                  <span className={cn("flex-1", sub.is_done && "line-through text-muted-foreground")}>
                    {sub.title}
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <Input
                value={newSubItem}
                onChange={e => setNewSubItem(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddSubItem()}
                placeholder="やりたいことを追加..."
                className="flex-1"
              />
              <Button size="icon" variant="outline" onClick={handleAddSubItem} className="min-w-[44px]">
                <Plus className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
