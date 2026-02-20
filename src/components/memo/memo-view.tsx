"use client"

import { useState, useCallback, useEffect } from "react"
import {
  StickyNote, Send, ChevronDown, ChevronUp, Loader2,
  Sparkles, Mic, Square, Calendar, Map, Trash2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder"
import type { Note, NoteAiAnalysis } from "@/types/note"

interface MemoViewProps {
  className?: string
}

export function MemoView({ className }: MemoViewProps) {
  const [content, setContent] = useState("")
  const [isExpanded, setIsExpanded] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [notes, setNotes] = useState<Note[]>([])
  const [isLoadingNotes, setIsLoadingNotes] = useState(true)
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null)
  const [activeAnalysis, setActiveAnalysis] = useState<{ noteId: string; analysis: NoteAiAnalysis } | null>(null)

  // 音声入力
  const handleTranscribed = useCallback((text: string) => {
    setContent(prev => prev ? `${prev}\n${text}` : text)
    showToast("success", "音声をテキストに変換しました")
  }, [])

  const { isRecording, isTranscribing, error: voiceError, startRecording, stopRecording } = useVoiceRecorder(handleTranscribed)

  // 音声エラー表示
  useEffect(() => {
    if (voiceError) {
      showToast("error", voiceError)
    }
  }, [voiceError])

  // メモ一覧を初回読み込み
  useEffect(() => {
    async function loadNotes() {
      try {
        const res = await fetch("/api/notes")
        if (res.ok) {
          const { notes: data } = await res.json()
          setNotes(data || [])
        }
      } catch (err) {
        console.error("Failed to load notes:", err)
      } finally {
        setIsLoadingNotes(false)
      }
    }
    loadNotes()
  }, [])

  function showToast(type: "success" | "error", message: string) {
    setToast({ type, message })
    setTimeout(() => setToast(null), 3000)
  }

  // メモ保存
  const handleSave = useCallback(async () => {
    if (!content.trim()) return

    setIsLoading(true)
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: content.trim(),
          input_type: isRecording ? "voice" : "text",
        }),
      })

      if (!res.ok) throw new Error("Failed to save note")

      const { note } = await res.json()
      setNotes(prev => [note, ...prev])
      setContent("")
      showToast("success", "メモを保存しました")
    } catch (error) {
      console.error("Save error:", error)
      showToast("error", "保存に失敗しました")
    } finally {
      setIsLoading(false)
    }
  }, [content, isRecording])

  // AI分析
  const handleAnalyze = useCallback(async (noteId: string, noteContent: string) => {
    setIsAnalyzing(true)
    setActiveAnalysis(null)
    try {
      const res = await fetch("/api/ai/analyze-memo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: noteContent, noteId }),
      })

      if (!res.ok) {
        const { error } = await res.json()
        throw new Error(error || "AI analysis failed")
      }

      const { analysis } = await res.json()
      setActiveAnalysis({ noteId, analysis })

      // ノートの ai_analysis を更新
      setNotes(prev => prev.map(n =>
        n.id === noteId ? { ...n, ai_analysis: analysis, status: 'processed' as const } : n
      ))
    } catch (error) {
      console.error("Analysis error:", error)
      showToast("error", error instanceof Error ? error.message : "AI分析に失敗しました")
    } finally {
      setIsAnalyzing(false)
    }
  }, [])

  // メモ削除
  const handleDelete = useCallback(async (noteId: string) => {
    try {
      const res = await fetch(`/api/notes?id=${noteId}`, { method: "DELETE" })
      if (res.ok) {
        setNotes(prev => prev.filter(n => n.id !== noteId))
        if (activeAnalysis?.noteId === noteId) setActiveAnalysis(null)
      }
    } catch (err) {
      console.error("Delete error:", err)
    }
  }, [activeAnalysis])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        handleSave()
      }
    },
    [handleSave]
  )

  return (
    <div className={cn("flex flex-col h-full bg-background", className)}>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b">
        <StickyNote className="w-5 h-5 text-primary" />
        <h1 className="text-lg font-semibold">メモ</h1>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={cn(
            "mx-4 mt-2 px-3 py-2 rounded-md text-sm transition-opacity",
            toast.type === "success" ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-600"
          )}
        >
          {toast.message}
        </div>
      )}

      {/* Input Area */}
      <div className="p-4">
        <Card className="p-3">
          <div className="relative">
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="アイディアを入力... (Cmd+Enterで保存)"
              className="min-h-[100px] w-full resize-none border-0 bg-transparent focus:outline-none text-base"
              disabled={isLoading || isTranscribing}
            />

            {/* 文字起こし中の表示 */}
            {isTranscribing && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/80 rounded-md">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  文字起こし中...
                </div>
              </div>
            )}
          </div>

          {/* Expand/Collapse Options */}
          <div className="mt-2 pt-2 border-t">
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {isExpanded ? (
                <>
                  <ChevronUp className="w-4 h-4" />
                  閉じる
                </>
              ) : (
                <>
                  <ChevronDown className="w-4 h-4" />
                  オプション
                </>
              )}
            </button>

            {isExpanded && (
              <div className="mt-3 space-y-2">
                <p className="text-xs text-muted-foreground">
                  保存後、メモをAIで分析してカレンダーやマップに追加できます
                </p>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="mt-3 flex items-center justify-between">
            {/* Voice Input Button */}
            <Button
              variant={isRecording ? "destructive" : "outline"}
              size="sm"
              onClick={isRecording ? stopRecording : startRecording}
              disabled={isLoading || isTranscribing}
              className="gap-1"
            >
              {isRecording ? (
                <>
                  <Square className="w-3 h-3" />
                  停止
                </>
              ) : (
                <>
                  <Mic className="w-4 h-4" />
                  音声入力
                </>
              )}
            </Button>

            {/* Save Button */}
            <Button
              onClick={handleSave}
              disabled={!content.trim() || isLoading || isTranscribing}
              size="sm"
              className="gap-1"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              保存
            </Button>
          </div>
        </Card>
      </div>

      {/* AI Analysis Result */}
      {activeAnalysis && (
        <div className="px-4 pb-2">
          <Card className="p-3 border-primary/20 bg-primary/5">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium">AI分析結果</span>
            </div>

            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                {activeAnalysis.analysis.classification === 'calendar' ? (
                  <Calendar className="w-4 h-4 text-blue-500" />
                ) : (
                  <Map className="w-4 h-4 text-green-500" />
                )}
                <span className="font-medium">
                  {activeAnalysis.analysis.classification === 'calendar' ? 'カレンダー予定' : 'マップ（タスク/計画）'}
                </span>
                <span className="text-xs text-muted-foreground">
                  (確度: {Math.round((activeAnalysis.analysis.confidence || 0) * 100)}%)
                </span>
              </div>

              {activeAnalysis.analysis.suggested_project_name && (
                <p className="text-muted-foreground">
                  提案先: {activeAnalysis.analysis.suggested_project_name}
                  {activeAnalysis.analysis.suggested_node_title && ` > ${activeAnalysis.analysis.suggested_node_title}`}
                </p>
              )}

              {activeAnalysis.analysis.reasoning && (
                <p className="text-xs text-muted-foreground italic">
                  {activeAnalysis.analysis.reasoning}
                </p>
              )}

              {activeAnalysis.analysis.extracted_entities && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {activeAnalysis.analysis.extracted_entities.dates?.map((d, i) => (
                    <span key={`d-${i}`} className="px-1.5 py-0.5 bg-blue-500/10 text-blue-600 rounded text-xs">{d}</span>
                  ))}
                  {activeAnalysis.analysis.extracted_entities.times?.map((t, i) => (
                    <span key={`t-${i}`} className="px-1.5 py-0.5 bg-purple-500/10 text-purple-600 rounded text-xs">{t}</span>
                  ))}
                  {activeAnalysis.analysis.extracted_entities.keywords?.map((k, i) => (
                    <span key={`k-${i}`} className="px-1.5 py-0.5 bg-gray-500/10 text-gray-600 rounded text-xs">{k}</span>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* Notes List */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {isLoadingNotes ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : notes.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            <StickyNote className="w-12 h-12 mx-auto mb-2 opacity-30" />
            <p className="text-sm">まだメモがありません</p>
            <p className="text-xs mt-1">テキストまたは音声でメモを入力してみましょう</p>
          </div>
        ) : (
          <div className="space-y-2">
            {notes.map((note) => (
              <Card key={note.id} className="p-3 hover:bg-muted/50 transition-colors group">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm whitespace-pre-wrap">{note.content}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <p className="text-xs text-muted-foreground">
                        {new Date(note.created_at).toLocaleString("ja-JP")}
                      </p>
                      {note.input_type === 'voice' && (
                        <span className="text-xs px-1.5 py-0.5 bg-purple-500/10 text-purple-600 rounded">
                          <Mic className="w-3 h-3 inline mr-0.5" />音声
                        </span>
                      )}
                      {note.ai_analysis && (
                        <span className="text-xs px-1.5 py-0.5 bg-primary/10 text-primary rounded">
                          <Sparkles className="w-3 h-3 inline mr-0.5" />分析済
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {/* AI分析ボタン */}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleAnalyze(note.id, note.content)}
                      disabled={isAnalyzing}
                      className="h-7 w-7 p-0"
                      title="AIで分析"
                    >
                      {isAnalyzing && activeAnalysis === null ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="w-3.5 h-3.5" />
                      )}
                    </Button>

                    {/* 削除ボタン */}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(note.id)}
                      className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-destructive"
                      title="削除"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Recording Indicator */}
      {isRecording && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50">
          <div className="flex items-center gap-2 px-4 py-2 bg-red-500 text-white rounded-full shadow-lg animate-pulse">
            <div className="w-2 h-2 bg-white rounded-full" />
            録音中...
          </div>
        </div>
      )}
    </div>
  )
}
