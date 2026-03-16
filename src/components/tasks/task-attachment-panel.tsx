"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { Paperclip, Upload, X, FileText, Image, File, Loader2, ExternalLink } from "lucide-react"
import { cn } from "@/lib/utils"
import type { TaskAttachment } from "@/types/database"

interface TaskAttachmentPanelProps {
  taskId: string
  className?: string
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function getFileIcon(fileType: string) {
  if (fileType.startsWith("image/")) return Image
  if (fileType === "application/pdf") return FileText
  return File
}

function isImageType(fileType: string): boolean {
  return fileType.startsWith("image/")
}

export function TaskAttachmentPanel({ taskId, className }: TaskAttachmentPanelProps) {
  const [attachments, setAttachments] = useState<TaskAttachment[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isUploading, setIsUploading] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadAttachments = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/attachments`)
      if (res.ok) {
        const { attachments: data } = await res.json()
        setAttachments(data || [])
      }
    } catch (err) {
      console.error("Failed to load attachments:", err)
    } finally {
      setIsLoading(false)
    }
  }, [taskId])

  useEffect(() => {
    loadAttachments()
  }, [loadAttachments])

  const uploadFile = useCallback(async (file: File) => {
    setIsUploading(true)
    try {
      const formData = new FormData()
      formData.append("file", file)

      const res = await fetch(`/api/tasks/${taskId}/attachments`, {
        method: "POST",
        body: formData,
      })

      if (!res.ok) {
        const { error } = await res.json()
        throw new Error(error || "アップロードに失敗しました")
      }

      const { attachment } = await res.json()
      setAttachments(prev => [...prev, attachment])
    } catch (err) {
      console.error("Upload error:", err)
      alert(err instanceof Error ? err.message : "アップロードに失敗しました")
    } finally {
      setIsUploading(false)
    }
  }, [taskId])

  const handleFileSelect = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return
    uploadFile(files[0])
  }, [uploadFile])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    handleFileSelect(e.dataTransfer.files)
  }, [handleFileSelect])

  const handleDelete = useCallback(async (attachmentId: string) => {
    setDeletingId(attachmentId)
    try {
      const res = await fetch(`/api/tasks/${taskId}/attachments/${attachmentId}`, {
        method: "DELETE",
      })
      if (res.ok) {
        setAttachments(prev => prev.filter(a => a.id !== attachmentId))
      }
    } catch (err) {
      console.error("Delete error:", err)
    } finally {
      setDeletingId(null)
    }
  }, [taskId])

  if (isLoading) {
    return (
      <div className={cn("flex items-center justify-center py-4", className)}>
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className={cn("space-y-2", className)}>
      {/* ヘッダー */}
      <div className="flex items-center gap-2">
        <Paperclip className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">
          添付ファイル {attachments.length > 0 && `(${attachments.length})`}
        </span>
      </div>

      {/* ドロップゾーン */}
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={cn(
          "border-2 border-dashed rounded-md px-3 py-2.5 cursor-pointer transition-colors text-center",
          isDragOver
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/50 hover:bg-muted/30",
          isUploading && "pointer-events-none opacity-50"
        )}
      >
        {isUploading ? (
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            アップロード中...
          </div>
        ) : (
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Upload className="w-3.5 h-3.5" />
            <span>クリックまたはドラッグでファイルを追加</span>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(e) => handleFileSelect(e.target.files)}
          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.md"
        />
      </div>

      {/* 添付ファイル一覧 */}
      {attachments.length > 0 && (
        <div className="space-y-1.5">
          {attachments.map(attachment => {
            const Icon = getFileIcon(attachment.file_type)
            const isImage = isImageType(attachment.file_type)
            return (
              <div
                key={attachment.id}
                className="flex items-center gap-2 p-2 rounded-md bg-muted/40 group hover:bg-muted/60 transition-colors"
              >
                {/* サムネイル or アイコン */}
                {isImage ? (
                  <button
                    onClick={() => setPreviewUrl(attachment.file_url)}
                    className="w-8 h-8 rounded overflow-hidden shrink-0 bg-muted"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={attachment.file_url}
                      alt={attachment.file_name}
                      className="w-full h-full object-cover"
                    />
                  </button>
                ) : (
                  <div className="w-8 h-8 rounded flex items-center justify-center bg-muted shrink-0">
                    <Icon className="w-4 h-4 text-muted-foreground" />
                  </div>
                )}

                {/* ファイル情報 */}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{attachment.file_name}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {formatFileSize(attachment.file_size)}
                  </p>
                </div>

                {/* アクション */}
                <div className="flex items-center gap-0.5 shrink-0">
                  <a
                    href={attachment.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1 rounded hover:bg-background/80 text-muted-foreground hover:text-foreground transition-colors"
                    title="新しいタブで開く"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                  <button
                    onClick={() => handleDelete(attachment.id)}
                    disabled={deletingId === attachment.id}
                    className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                    title="削除"
                  >
                    {deletingId === attachment.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <X className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* 画像プレビューモーダル */}
      {previewUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setPreviewUrl(null)}
        >
          <div className="relative max-w-3xl max-h-[80vh]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt="プレビュー"
              className="max-w-full max-h-[80vh] object-contain rounded-lg"
              onClick={(e) => e.stopPropagation()}
            />
            <button
              onClick={() => setPreviewUrl(null)}
              className="absolute -top-2 -right-2 w-7 h-7 bg-white rounded-full flex items-center justify-center shadow-lg"
            >
              <X className="w-4 h-4 text-black" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * 添付ファイルの有無を示すバッジ（マインドマップのノード用）
 */
export function AttachmentBadge({ count }: { count: number }) {
  if (count === 0) return null
  return (
    <span className="inline-flex items-center gap-0.5 text-[9px] text-muted-foreground">
      <Paperclip className="w-2.5 h-2.5" />
      {count > 1 && count}
    </span>
  )
}
