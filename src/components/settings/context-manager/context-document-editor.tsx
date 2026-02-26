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
    <div className="flex flex-col h-full">
      {/* ヘッダー */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b">
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-4 h-4" />
          <span className="hidden md:inline">戻る</span>
        </button>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleTogglePin}
            className="h-8 w-8"
            title={doc.is_pinned ? 'ピン解除' : 'ピン留め（AIが優先的に読み込み）'}
          >
            {doc.is_pinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={handleSave}
            disabled={!hasChanges || saving}
          >
            <Check className="w-3.5 h-3.5 mr-1" />
            {saving ? '保存中...' : '保存'}
          </Button>
        </div>
      </div>

      {/* コンテンツ */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* タイトル */}
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full text-lg font-semibold bg-transparent border-none outline-none placeholder:text-muted-foreground/50"
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
          className="w-full min-h-[200px] text-sm bg-muted/30 border rounded-lg p-3 resize-y outline-none focus:ring-2 focus:ring-ring/50 placeholder:text-muted-foreground/50"
          placeholder="ここに内容を入力..."
        />
        <div className="text-xs text-muted-foreground text-right">
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
            className="text-xs"
          >
            <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
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
            <Trash2 className="w-3.5 h-3.5 mr-1" />
            {confirmDelete ? '本当に削除' : '削除'}
          </Button>
        </div>
      </div>
    </div>
  )
}
