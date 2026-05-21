'use client'

import { useState, useCallback } from 'react'
import { ArrowLeft, Check, Trash2, Pin, PinOff, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FreshnessBadge } from './freshness-badge'
import { ContentHint } from './content-hint'
import type { DocumentData } from './types'

interface ContextDocumentEditorProps {
  document: DocumentData
  onBack: () => void
  onSave: (id: string, updates: { title?: string; content?: string; is_pinned?: boolean }) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onReview: (id: string) => Promise<void>
}

export function ContextDocumentEditor({
  document: doc,
  onBack,
  onSave,
  onDelete,
  onReview,
}: ContextDocumentEditorProps) {
  const [title, setTitle] = useState(doc.title)
  const [content, setContent] = useState(doc.content)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const hasChanges = title !== doc.title || content !== doc.content
  const isSystemDoc = doc.document_type !== 'note'

  const handleSave = useCallback(async () => {
    if (!hasChanges) return
    setSaving(true)
    try {
      await onSave(doc.id, { title: title !== doc.title ? title : undefined, content: content !== doc.content ? content : undefined })
    } finally {
      setSaving(false)
    }
  }, [doc.id, doc.title, doc.content, title, content, hasChanges, onSave])

  const handleDelete = useCallback(async () => {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setDeleting(true)
    try {
      await onDelete(doc.id)
      onBack()
    } finally {
      setDeleting(false)
      setConfirmDelete(false)
    }
  }, [doc.id, confirmDelete, onDelete, onBack])

  const handleTogglePin = useCallback(async () => {
    await onSave(doc.id, { is_pinned: !doc.is_pinned })
  }, [doc.id, doc.is_pinned, onSave])

  return (
    <div className="flex h-full flex-col">
      {/* ヘッダー */}
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
        <button onClick={onBack} className="flex min-h-9 items-center gap-1 rounded-md text-sm text-zinc-500 transition-colors hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
          <ArrowLeft className="h-4 w-4" />
          <span className="hidden md:inline">戻る</span>
        </button>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleTogglePin}
            className="h-8 w-8 text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100"
            title={doc.is_pinned ? 'ピン解除' : 'ピン留め（AIが優先的に読み込み）'}
          >
            {doc.is_pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={handleSave}
            disabled={!hasChanges || saving}
            className="bg-blue-500 text-white hover:bg-blue-400"
          >
            <Check className="mr-1 h-3.5 w-3.5" />
            {saving ? '保存中...' : '保存'}
          </Button>
        </div>
      </div>

      {/* コンテンツ */}
      <div className="flex-1 space-y-4 overflow-y-auto p-4 md:p-5">
        {/* タイトル */}
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full border-none bg-transparent text-lg font-semibold text-zinc-100 outline-none placeholder:text-zinc-600"
          placeholder="タイトル"
          readOnly={isSystemDoc}
        />

        {/* 鮮度バッジ */}
        <FreshnessBadge
          status={doc.freshness_status}
          daysSinceUpdate={doc.days_since_update}
        />

        {/* エディタ */}
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value.slice(0, doc.max_length))}
          className="min-h-[320px] w-full resize-y rounded-xl border border-white/10 bg-[#171717] p-4 text-sm leading-6 text-zinc-100 outline-none placeholder:text-zinc-600 focus:ring-2 focus:ring-blue-400/50"
          placeholder="ここに内容を入力..."
        />
        <div className="text-right text-xs text-zinc-500">
          {content.length} / {doc.max_length}
        </div>

        {/* コンテンツヒント */}
        <ContentHint documentType={doc.document_type} />

        {/* アクションボタン */}
        <div className="flex items-center gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onReview(doc.id)}
            className="border-white/10 bg-white/[0.04] text-xs text-zinc-200 hover:bg-white/[0.08]"
          >
            <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
            最新です
          </Button>
          <div className="flex-1" />
          <Button
            variant={confirmDelete ? 'destructive' : 'ghost'}
            size="sm"
            onClick={handleDelete}
            disabled={deleting}
            className="text-xs"
          >
            <Trash2 className="mr-1 h-3.5 w-3.5" />
            {confirmDelete ? '本当に削除' : '削除'}
          </Button>
        </div>
      </div>
    </div>
  )
}
