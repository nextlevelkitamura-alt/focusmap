"use client"

import { useCallback, useEffect, useState } from "react"
import { IdealGoalWithItems } from "@/types/database"
import { WishlistCard } from "./wishlist-card"
import { WishlistCardDetail } from "./wishlist-card-detail"
import { Button } from "@/components/ui/button"
import { Plus, ChevronDown, ChevronRight, Sparkles, Loader2, Check, X } from "lucide-react"

export function WishlistView() {
  const [items, setItems] = useState<IdealGoalWithItems[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedItem, setSelectedItem] = useState<IdealGoalWithItems | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)

  // AIインテーク
  const [intakeText, setIntakeText] = useState('')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [suggestion, setSuggestion] = useState<{
    title: string; category: string; description: string;
    scheduled_at: string | null; duration_minutes: number | null
  } | null>(null)

  useEffect(() => {
    fetch('/api/wishlist')
      .then(r => r.json())
      .then(({ items }) => setItems(items ?? []))
      .finally(() => setIsLoading(false))
  }, [])

  const handleCreate = async () => {
    const res = await fetch('/api/wishlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '新しいWish' }),
    })
    const { item } = await res.json()
    if (item) {
      setItems(prev => [item, ...prev])
      setSelectedItem(item)
      setDetailOpen(true)
    }
  }

  const handleUpdate = useCallback(async (id: string, updates: Record<string, unknown>) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, ...updates } as IdealGoalWithItems : i))
    if (Object.keys(updates).length > 0) {
      const res = await fetch(`/api/wishlist/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      const { item } = await res.json()
      if (item) {
        setItems(prev => prev.map(i => i.id === id ? item : i))
        setSelectedItem(prev => prev?.id === id ? item : prev)
      }
    }
  }, [])

  const handleDelete = useCallback(async (id: string) => {
    setItems(prev => prev.filter(i => i.id !== id))
    if (selectedItem?.id === id) setDetailOpen(false)
    await fetch(`/api/wishlist/${id}`, { method: 'DELETE' })
  }, [selectedItem])

  const handleCalendarAdd = async (item: IdealGoalWithItems) => {
    const res = await fetch(`/api/wishlist/${item.id}/calendar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scheduled_at: item.scheduled_at,
        duration_minutes: item.duration_minutes,
        title: item.title,
        description: item.description,
      }),
    })
    if (!res.ok) {
      const { error } = await res.json()
      alert('カレンダー登録に失敗しました: ' + error)
      return
    }
    const { google_event_id } = await res.json()
    await handleUpdate(item.id, { google_event_id })
  }

  const handleAnalyze = async () => {
    if (!intakeText.trim()) return
    setIsAnalyzing(true)
    try {
      const res = await fetch('/api/ai-ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: intakeText }),
      })
      const { suggestion: s, error } = await res.json()
      if (error) { alert(error); return }
      setSuggestion(s)
    } finally {
      setIsAnalyzing(false)
    }
  }

  const handleApprove = async () => {
    if (!suggestion) return
    const res = await fetch('/api/wishlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(suggestion),
    })
    const { item } = await res.json()
    if (item) setItems(prev => [item, ...prev])
    setSuggestion(null)
    setIntakeText('')
  }

  const handleCardClick = (item: IdealGoalWithItems) => {
    setSelectedItem(item)
    setDetailOpen(true)
  }

  const activeItems = items.filter(i => !i.is_completed)
  const archivedItems = items.filter(i => i.is_completed)

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        読み込み中...
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* ヘッダー */}
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <h1 className="text-base font-semibold">Wish</h1>
        <Button onClick={handleCreate} size="sm" className="min-h-[44px]">
          <Plus className="w-4 h-4 mr-1" /> 追加
        </Button>
      </div>

      {/* AIインテーク入力 */}
      <div className="px-4 py-3 border-b shrink-0 space-y-2">
        <div className="flex gap-2">
          <textarea
            value={intakeText}
            onChange={e => setIntakeText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleAnalyze() }}
            placeholder="やりたいこと・調べたいこと・学びたいことを自由に書いてください..."
            rows={2}
            className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
          />
          <Button
            onClick={handleAnalyze}
            disabled={isAnalyzing || !intakeText.trim()}
            size="sm"
            className="min-h-[44px] self-end"
          >
            {isAnalyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          </Button>
        </div>

        {/* AI提案カード */}
        {suggestion && (
          <div className="rounded-lg border bg-muted/30 p-3 space-y-1">
            <p className="text-xs text-muted-foreground font-medium">AI提案</p>
            <p className="font-semibold text-sm">{suggestion.title}</p>
            {suggestion.description && <p className="text-xs text-muted-foreground">{suggestion.description}</p>}
            <div className="flex gap-2 pt-1">
              <Button size="sm" onClick={handleApprove} className="min-h-[44px]">
                <Check className="w-3 h-3 mr-1" /> 追加
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSuggestion(null)} className="min-h-[44px]">
                <X className="w-3 h-3 mr-1" /> キャンセル
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* スクロールエリア */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* アクティブカード グリッド */}
        {activeItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground text-sm gap-3">
            <p>やりたいことをここに貯めよう</p>
            <Button variant="outline" onClick={handleCreate} className="min-h-[44px]">
              <Plus className="w-4 h-4 mr-1" /> 最初のWishを追加
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {activeItems.map(item => (
              <WishlistCard
                key={item.id}
                item={item}
                onUpdate={handleUpdate}
                onDelete={handleDelete}
                onClick={() => handleCardClick(item)}
              />
            ))}
          </div>
        )}

        {/* アーカイブ */}
        {archivedItems.length > 0 && (
          <div>
            <button
              onClick={() => setArchiveOpen(v => !v)}
              className="flex items-center gap-1 text-sm text-muted-foreground mb-3 hover:text-foreground transition-colors"
            >
              {archiveOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              完了済み（{archivedItems.length}件）
            </button>
            {archiveOpen && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {archivedItems.map(item => (
                  <WishlistCard
                    key={item.id}
                    item={item}
                    onUpdate={handleUpdate}
                    onDelete={handleDelete}
                    onClick={() => handleCardClick(item)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* カード詳細シート */}
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
