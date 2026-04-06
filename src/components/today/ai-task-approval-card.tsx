'use client'

import { useState, useCallback } from 'react'
import {
  CheckCircle2, XCircle, MessageSquare, Send, Loader2, ChevronDown, ChevronUp,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AiTask } from '@/types/ai-task'

interface AiTaskApprovalCardProps {
  task: AiTask
  onApprove: (taskId: string) => Promise<unknown>
  onReject: (taskId: string, reason?: string) => Promise<unknown>
  onRequestRevision: (parentTaskId: string, instruction: string) => Promise<unknown>
}

export function AiTaskApprovalCard({
  task,
  onApprove,
  onReject,
  onRequestRevision,
}: AiTaskApprovalCardProps) {
  const [isProcessing, setIsProcessing] = useState(false)
  const [showRevision, setShowRevision] = useState(false)
  const [revisionText, setRevisionText] = useState('')
  const [showResult, setShowResult] = useState(false)

  const handleApprove = useCallback(async () => {
    setIsProcessing(true)
    try {
      await onApprove(task.id)
    } finally {
      setIsProcessing(false)
    }
  }, [task.id, onApprove])

  const handleReject = useCallback(async () => {
    setIsProcessing(true)
    try {
      await onReject(task.id)
    } finally {
      setIsProcessing(false)
    }
  }, [task.id, onReject])

  const handleRevision = useCallback(async () => {
    const text = revisionText.trim()
    if (!text) return
    setIsProcessing(true)
    try {
      await onRequestRevision(task.id, text)
      setRevisionText('')
      setShowRevision(false)
    } finally {
      setIsProcessing(false)
    }
  }, [task.id, revisionText, onRequestRevision])

  const resultText = task.result
    ? typeof task.result === 'object' && 'message' in task.result
      ? String(task.result.message)
      : JSON.stringify(task.result, null, 2)
    : null

  return (
    <div className="rounded-xl border-2 border-amber-300 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-950/20 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3">
        <div className="flex items-start gap-2">
          <div className="w-2 h-2 rounded-full bg-amber-400 mt-1.5 shrink-0 animate-pulse" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">確認が必要です</p>
            <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{task.prompt}</p>
          </div>
        </div>
      </div>

      {/* Result preview */}
      {resultText && (
        <div className="px-4 pb-2">
          <button
            onClick={() => setShowResult(prev => !prev)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors min-h-[44px] px-1"
          >
            {showResult ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            実行結果を表示
          </button>
          {showResult && (
            <pre className="mt-1.5 text-xs bg-background/80 rounded-lg p-3 overflow-x-auto max-h-48 overflow-y-auto border border-border/40">
              {resultText}
            </pre>
          )}
        </div>
      )}

      {/* Revision input */}
      {showRevision && (
        <div className="px-4 pb-2">
          <div className="flex items-end gap-2">
            <div className="flex-1 rounded-lg border border-amber-200 dark:border-amber-800 bg-background px-3 py-2">
              <textarea
                value={revisionText}
                onChange={(e) => setRevisionText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    handleRevision()
                  }
                }}
                placeholder="修正指示を入力..."
                rows={2}
                className="w-full bg-transparent text-sm outline-none resize-none placeholder:text-muted-foreground/40"
                disabled={isProcessing}
              />
            </div>
            <button
              onClick={handleRevision}
              disabled={isProcessing || !revisionText.trim()}
              className="p-2.5 rounded-lg bg-amber-500 text-white min-h-[44px] min-w-[44px] flex items-center justify-center disabled:opacity-50"
            >
              {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center border-t border-amber-200 dark:border-amber-800">
        <button
          onClick={handleApprove}
          disabled={isProcessing}
          className="flex-1 flex items-center justify-center gap-1.5 py-3 text-sm font-medium text-green-700 dark:text-green-400 active:bg-green-50 dark:active:bg-green-950/30 transition-colors min-h-[44px] disabled:opacity-50"
        >
          {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
          承認
        </button>
        <div className="w-px h-6 bg-amber-200 dark:bg-amber-800" />
        <button
          onClick={() => setShowRevision(prev => !prev)}
          disabled={isProcessing}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 py-3 text-sm font-medium transition-colors min-h-[44px] disabled:opacity-50",
            showRevision
              ? "text-amber-700 dark:text-amber-400 bg-amber-100/50 dark:bg-amber-900/20"
              : "text-amber-700 dark:text-amber-400 active:bg-amber-50 dark:active:bg-amber-950/30"
          )}
        >
          <MessageSquare className="w-4 h-4" />
          修正指示
        </button>
        <div className="w-px h-6 bg-amber-200 dark:bg-amber-800" />
        <button
          onClick={handleReject}
          disabled={isProcessing}
          className="flex-1 flex items-center justify-center gap-1.5 py-3 text-sm font-medium text-red-600 dark:text-red-400 active:bg-red-50 dark:active:bg-red-950/30 transition-colors min-h-[44px] disabled:opacity-50"
        >
          <XCircle className="w-4 h-4" />
          却下
        </button>
      </div>
    </div>
  )
}
