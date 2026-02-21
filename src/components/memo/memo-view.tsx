"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import {
  StickyNote, Send, Loader2,
  Sparkles, Mic, Square, Calendar, Map, Trash2,
  FolderOpen, ChevronRight, ChevronDown, Check, X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder"
import { VoiceWaveform } from "@/components/ui/voice-waveform"
import type { Note, NoteAiAnalysis } from "@/types/note"
import type { Project, Space } from "@/types/database"
import { useCalendars } from "@/hooks/useCalendars"

// インライン提案の状態
interface InlineProposal {
  noteId: string
  analysis: NoteAiAnalysis
  step: 'initial' | 'select_project' | 'select_node' | 'calendar_form' | 'executing' | 'done'
  selectedProjectId?: string
  projectTasks?: { id: string; title: string }[]
  result?: string
  // カレンダー追加用
  calendarTitle?: string
  calendarDate?: string      // YYYY-MM-DD
  calendarTime?: string      // HH:MM
  calendarDuration?: number  // 分
  calendarId?: string        // Google Calendar ID
}

interface MemoViewProps {
  className?: string
  projects?: Project[]
  spaces?: Space[]
  selectedSpaceId?: string | null
  onSelectSpace?: (id: string | null) => void
}

const statusColorMap: Record<string, string> = {
  active: "bg-green-500",
  concept: "bg-blue-500",
  on_hold: "bg-blue-500",
  completed: "bg-gray-500",
  archived: "bg-gray-500",
}

export function MemoView({ className, projects = [], spaces = [], selectedSpaceId = null, onSelectSpace }: MemoViewProps) {
  const [content, setContent] = useState("")
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [isFilterOpen, setIsFilterOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [notes, setNotes] = useState<Note[]>([])
  const [isLoadingNotes, setIsLoadingNotes] = useState(true)
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null)
  const [editingProjectNoteId, setEditingProjectNoteId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  // インライン提案
  const [proposal, setProposal] = useState<InlineProposal | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)

  // カレンダー一覧（カレンダー追加用）
  const { calendars } = useCalendars()

  // 音声入力
  const handleTranscribed = useCallback((text: string) => {
    setContent(prev => prev ? `${prev}\n${text}` : text)
    showToast("success", "音声をテキストに変換しました")
  }, [])

  const { isRecording, isTranscribing, error: voiceError, analyserRef, startRecording, stopRecording } = useVoiceRecorder(handleTranscribed)

  useEffect(() => {
    if (voiceError) showToast("error", voiceError)
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

  const getProjectName = useCallback((projectId: string | null) => {
    if (!projectId) return null
    return projects.find(p => p.id === projectId)?.title || null
  }, [projects])

  // フィルタリング
  const filteredNotes = notes.filter(note => {
    if (!selectedProjectId) return true
    if (selectedProjectId === "__unassigned__") return !note.project_id
    return note.project_id === selectedProjectId
  })

  const saveProjectId = selectedProjectId && selectedProjectId !== "__unassigned__" ? selectedProjectId : null

  // AI分析 → インライン提案生成
  const analyzeAndPropose = useCallback(async (noteId: string, noteContent: string) => {
    setIsAnalyzing(true)
    setProposal(null)
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

      setNotes(prev => prev.map(n =>
        n.id === noteId ? { ...n, ai_analysis: analysis, status: 'processed' as const } : n
      ))

      // インライン提案を表示
      setProposal({
        noteId,
        analysis,
        step: 'initial',
      })
    } catch (error) {
      console.error("Analysis error:", error)
      showToast("error", error instanceof Error ? error.message : "AI分析に失敗しました")
    } finally {
      setIsAnalyzing(false)
    }
  }, [])

  // メモ保存 → 自動AI分析
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
          project_id: saveProjectId,
        }),
      })

      if (!res.ok) throw new Error("Failed to save note")

      const { note } = await res.json()
      setNotes(prev => [note, ...prev])
      setContent("")
      showToast("success", "メモを保存しました")

      // 自動AI分析
      analyzeAndPropose(note.id, note.content)
    } catch (error) {
      console.error("Save error:", error)
      showToast("error", "保存に失敗しました")
    } finally {
      setIsLoading(false)
    }
  }, [content, isRecording, saveProjectId, analyzeAndPropose])

  // プロジェクトのタスク一覧を取得
  const fetchProjectTasks = useCallback(async (projectId: string) => {
    try {
      const res = await fetch("/api/tasks")
      if (!res.ok) return []
      const { tasks } = await res.json()
      return (tasks || [])
        .filter((t: { project_id: string | null; parent_task_id: string | null }) =>
          t.project_id === projectId && !t.parent_task_id
        )
        .slice(0, 10)
        .map((t: { id: string; title: string }) => ({ id: t.id, title: t.title }))
    } catch {
      return []
    }
  }, [])

  // 提案: 「別の場所を選ぶ」
  const handleSelectProject = useCallback(() => {
    if (!proposal) return
    setProposal(prev => prev ? { ...prev, step: 'select_project' } : null)
  }, [proposal])

  // 提案: プロジェクト選択
  const handlePickProject = useCallback(async (projectId: string) => {
    if (!proposal) return
    const tasks = await fetchProjectTasks(projectId)
    setProposal(prev => prev ? {
      ...prev,
      step: 'select_node',
      selectedProjectId: projectId,
      projectTasks: tasks,
    } : null)
  }, [proposal, fetchProjectTasks])

  // マップにタスク追加（実行）
  const handleAddToMap = useCallback(async (projectId?: string, parentTaskId?: string) => {
    if (!proposal) return
    const noteContent = notes.find(n => n.id === proposal.noteId)?.content || ""

    setProposal(prev => prev ? { ...prev, step: 'executing' } : null)

    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: noteContent.slice(0, 100),
          project_id: projectId || proposal.analysis.suggested_project_id || undefined,
          parent_task_id: parentTaskId || proposal.analysis.suggested_node_id || undefined,
        }),
      })

      if (!res.ok) throw new Error("Failed to create task")

      const projName = getProjectName(projectId || proposal.analysis.suggested_project_id || null) || "マップ"
      setProposal(prev => prev ? {
        ...prev,
        step: 'done',
        result: `✅ 「${projName}」に追加しました`,
      } : null)

      // メモを処理済みに
      setNotes(prev => prev.map(n =>
        n.id === proposal.noteId ? { ...n, status: 'archived' as const } : n
      ))

      // 3秒後に提案を閉じる
      setTimeout(() => setProposal(null), 3000)
    } catch (error) {
      console.error("Add to map error:", error)
      setProposal(prev => prev ? {
        ...prev,
        step: 'done',
        result: '❌ 追加に失敗しました',
      } : null)
    }
  }, [proposal, notes, getProjectName])

  // カレンダーフォームを開く
  const handleStartCalendarForm = useCallback(() => {
    if (!proposal) return
    const noteContent = notes.find(n => n.id === proposal.noteId)?.content || ""
    const { dates, times } = proposal.analysis.extracted_entities || { dates: [], times: [] }
    const primaryCal = calendars.find(c => c.is_primary)

    // AI抽出のevent_titleがあればそれを使う、なければメモ内容をフォールバック
    const title = proposal.analysis.event_title || noteContent.slice(0, 100)

    setProposal(prev => prev ? {
      ...prev,
      step: 'calendar_form',
      calendarTitle: title,
      calendarDate: dates[0] || new Date().toISOString().slice(0, 10),
      calendarTime: times[0] || '09:00',
      calendarDuration: 60,
      calendarId: primaryCal?.google_calendar_id || undefined,
    } : null)
  }, [proposal, notes, calendars])

  // カレンダーに追加（実行）
  const handleExecuteCalendarAdd = useCallback(async () => {
    if (!proposal) return

    setProposal(prev => prev ? { ...prev, step: 'executing' } : null)

    try {
      const scheduledAt = `${proposal.calendarDate}T${proposal.calendarTime}:00+09:00`

      const res = await fetch('/api/ai/chat/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: {
            type: 'add_calendar_event',
            params: {
              title: proposal.calendarTitle,
              scheduled_at: scheduledAt,
              estimated_time: proposal.calendarDuration || 60,
              calendar_id: proposal.calendarId || undefined,
            },
          },
        }),
      })

      const data = await res.json()

      setProposal(prev => prev ? {
        ...prev,
        step: 'done',
        result: data.success ? data.message : '❌ カレンダー追加に失敗しました',
      } : null)

      if (data.success) {
        setNotes(prev => prev.map(n =>
          n.id === proposal.noteId ? { ...n, status: 'archived' as const } : n
        ))
        setTimeout(() => setProposal(null), 3000)
      }
    } catch (error) {
      console.error("Add to calendar error:", error)
      setProposal(prev => prev ? {
        ...prev,
        step: 'done',
        result: '❌ カレンダー追加に失敗しました',
      } : null)
    }
  }, [proposal])

  // メモのプロジェクト更新
  const handleUpdateProject = useCallback(async (noteId: string, projectId: string | null) => {
    try {
      const res = await fetch("/api/notes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: noteId, project_id: projectId }),
      })
      if (res.ok) {
        setNotes(prev => prev.map(n =>
          n.id === noteId ? { ...n, project_id: projectId } : n
        ))
      }
    } catch (err) {
      console.error("Update project error:", err)
    }
    setEditingProjectNoteId(null)
  }, [])

  // メモ削除（確認後に実行）
  const handleDelete = useCallback(async (noteId: string) => {
    try {
      const res = await fetch(`/api/notes?id=${noteId}`, { method: "DELETE" })
      if (res.ok) {
        setNotes(prev => prev.filter(n => n.id !== noteId))
        if (proposal?.noteId === noteId) setProposal(null)
        showToast("success", "メモを削除しました")
      }
    } catch (err) {
      console.error("Delete error:", err)
      showToast("error", "削除に失敗しました")
    } finally {
      setConfirmDeleteId(null)
    }
  }, [proposal])

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
      {/* Header + Project Filter (Popover) */}
      <div className="border-b bg-background/95 backdrop-blur-sm sticky top-0 z-10 shrink-0">
        <div className="flex items-center justify-between px-3 py-2.5">
          <Popover open={isFilterOpen} onOpenChange={setIsFilterOpen}>
            <PopoverTrigger asChild>
              <button className="flex items-center gap-2 min-w-0 flex-1">
                <StickyNote className="w-4.5 h-4.5 text-primary shrink-0" />
                <div className="flex flex-col items-start min-w-0">
                  <span className="text-sm font-semibold truncate max-w-[200px]">
                    {selectedProjectId === "__unassigned__"
                      ? "未登録"
                      : selectedProjectId
                        ? projects.find(p => p.id === selectedProjectId)?.title || "全て"
                        : "全て"}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {selectedSpaceId
                      ? spaces.find(s => s.id === selectedSpaceId)?.title
                      : "全体"}
                  </span>
                </div>
                <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
              </button>
            </PopoverTrigger>

            <PopoverContent
              className="w-[280px] p-0"
              align="start"
              side="bottom"
              sideOffset={4}
            >
              <div className="max-h-[60vh] overflow-y-auto">
                {/* スペース切り替えチップ */}
                {onSelectSpace && spaces.length > 0 && (
                  <div className="px-3 pt-2.5 pb-1.5 border-b">
                    <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
                      <button
                        onClick={() => onSelectSpace(null)}
                        className={cn(
                          "shrink-0 text-xs px-2.5 py-1 rounded-full border transition-colors",
                          selectedSpaceId === null
                            ? "bg-primary text-primary-foreground border-primary"
                            : "border-border text-muted-foreground hover:bg-muted"
                        )}
                      >
                        全体
                      </button>
                      {spaces.map(s => (
                        <button
                          key={s.id}
                          onClick={() => onSelectSpace(s.id)}
                          className={cn(
                            "shrink-0 text-xs px-2.5 py-1 rounded-full border transition-colors",
                            selectedSpaceId === s.id
                              ? "bg-primary text-primary-foreground border-primary"
                              : "border-border text-muted-foreground hover:bg-muted"
                          )}
                        >
                          {s.title}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* フィルタ選択 */}
                <div className="py-1">
                  <div className="px-3 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    フィルタ
                  </div>
                  <button
                    onClick={() => {
                      setSelectedProjectId(null)
                      setIsFilterOpen(false)
                    }}
                    className={cn(
                      "flex items-center gap-2 w-full px-3 py-2 text-sm text-left transition-colors",
                      !selectedProjectId
                        ? "bg-primary/10 text-primary"
                        : "hover:bg-muted/50"
                    )}
                  >
                    <span className="truncate">全て</span>
                  </button>
                  <button
                    onClick={() => {
                      setSelectedProjectId("__unassigned__")
                      setIsFilterOpen(false)
                    }}
                    className={cn(
                      "flex items-center gap-2 w-full px-3 py-2 text-sm text-left transition-colors",
                      selectedProjectId === "__unassigned__"
                        ? "bg-primary/10 text-primary"
                        : "hover:bg-muted/50"
                    )}
                  >
                    <span className="truncate">未登録</span>
                  </button>

                  {projects.length > 0 && (
                    <>
                      <div className="mx-3 my-1 border-t" />
                      <div className="px-3 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                        プロジェクト
                      </div>
                      {projects.map(p => (
                        <button
                          key={p.id}
                          onClick={() => {
                            setSelectedProjectId(p.id)
                            setIsFilterOpen(false)
                          }}
                          className={cn(
                            "flex items-center gap-2 w-full px-3 py-2 text-sm text-left transition-colors",
                            p.id === selectedProjectId
                              ? "bg-primary/10 text-primary"
                              : "hover:bg-muted/50"
                          )}
                        >
                          <div className={cn(
                            "w-2 h-2 rounded-full shrink-0",
                            statusColorMap[p.status ?? 'active'] ?? "bg-green-500"
                          )} />
                          <span className="truncate">{p.title}</span>
                        </button>
                      ))}
                    </>
                  )}
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={cn(
            "mx-4 mt-2 px-3 py-2 rounded-md text-sm transition-opacity shrink-0",
            toast.type === "success" ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-600"
          )}
        >
          {toast.message}
        </div>
      )}

      {/* Input Area */}
      <div className="p-4 shrink-0">
        <Card className="p-3">
          <div className="relative">
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="アイディアを入力... (Cmd+Enterで保存)"
              className="min-h-[80px] w-full resize-none border-0 bg-transparent focus:outline-none text-base"
              disabled={isLoading || isTranscribing}
            />

            {isTranscribing && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/80 rounded-md">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  文字起こし中...
                </div>
              </div>
            )}
          </div>

          <div className="mt-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button
                variant={isRecording ? "destructive" : "outline"}
                size="sm"
                onClick={isRecording ? stopRecording : startRecording}
                disabled={isLoading || isTranscribing}
                className="gap-1"
              >
                {isRecording ? (
                  <><Square className="w-3 h-3" />停止</>
                ) : (
                  <><Mic className="w-4 h-4" />音声入力</>
                )}
              </Button>
              {isRecording && (
                <VoiceWaveform analyserRef={analyserRef} barCount={16} height={24} />
              )}
            </div>

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

      {/* AI分析中 */}
      {isAnalyzing && (
        <div className="px-4 pb-2 shrink-0">
          <Card className="p-3 border-primary/20 bg-primary/5">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
              AIが分析中...
            </div>
          </Card>
        </div>
      )}

      {/* インライン提案 */}
      {proposal && !isAnalyzing && (
        <div className="px-4 pb-2 shrink-0">
          <Card className="p-3 border-primary/20 bg-primary/5">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium">AI提案</span>
              <button
                onClick={() => setProposal(null)}
                className="ml-auto text-muted-foreground hover:text-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Step: initial - 初回提案 */}
            {proposal.step === 'initial' && (
              <div className="space-y-2">
                {proposal.analysis.classification === 'map' ? (
                  <>
                    <div className="flex items-center gap-2 text-sm">
                      <Map className="w-4 h-4 text-green-500" />
                      <span>マップに追加</span>
                    </div>
                    {proposal.analysis.suggested_project_name ? (
                      <p className="text-sm text-muted-foreground">
                        「{proposal.analysis.suggested_project_name}
                        {proposal.analysis.suggested_node_title && ` > ${proposal.analysis.suggested_node_title}`}
                        」に追加しますか？
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        どこに追加しますか？
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2 mt-2">
                      {proposal.analysis.suggested_project_name && (
                        <Button size="sm" className="gap-1" onClick={() => handleAddToMap()}>
                          <Check className="w-3.5 h-3.5" />
                          追加する
                        </Button>
                      )}
                      <Button size="sm" variant="outline" className="gap-1" onClick={handleSelectProject}>
                        <ChevronRight className="w-3.5 h-3.5" />
                        {proposal.analysis.suggested_project_name ? '別の場所' : 'プロジェクトを選ぶ'}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setProposal(null)}>
                        スキップ
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-2 text-sm">
                      <Calendar className="w-4 h-4 text-blue-500" />
                      <span>カレンダーに追加</span>
                    </div>
                    {proposal.analysis.extracted_entities?.dates?.[0] ? (
                      <p className="text-sm text-muted-foreground">
                        {proposal.analysis.extracted_entities.dates[0]}
                        {proposal.analysis.extracted_entities.times?.[0] && ` ${proposal.analysis.extracted_entities.times[0]}`}
                        に予定を追加しますか？
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        カレンダーに予定として追加しますか？
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2 mt-2">
                      <Button size="sm" className="gap-1" onClick={handleStartCalendarForm}>
                        <Calendar className="w-3.5 h-3.5" />
                        カレンダーに追加
                      </Button>
                      <Button size="sm" variant="outline" className="gap-1" onClick={handleSelectProject}>
                        <Map className="w-3.5 h-3.5" />
                        マップに追加
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setProposal(null)}>
                        スキップ
                      </Button>
                    </div>
                  </>
                )}

                {proposal.analysis.reasoning && (
                  <p className="text-xs text-muted-foreground italic mt-1">
                    {proposal.analysis.reasoning}
                  </p>
                )}
              </div>
            )}

            {/* Step: select_project - プロジェクト選択 */}
            {proposal.step === 'select_project' && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  どのプロジェクトに追加しますか？
                </p>
                <div className="flex flex-wrap gap-2">
                  {projects.map(p => (
                    <Button
                      key={p.id}
                      size="sm"
                      variant="outline"
                      className="gap-1"
                      onClick={() => handlePickProject(p.id)}
                    >
                      <FolderOpen className="w-3 h-3" />
                      {p.title}
                    </Button>
                  ))}
                  <Button size="sm" variant="ghost" onClick={() => setProposal(prev => prev ? { ...prev, step: 'initial' } : null)}>
                    戻る
                  </Button>
                </div>
              </div>
            )}

            {/* Step: select_node - ノード選択 */}
            {proposal.step === 'select_node' && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  「{getProjectName(proposal.selectedProjectId || null)}」のどこに追加しますか？
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    className="gap-1"
                    onClick={() => handleAddToMap(proposal.selectedProjectId)}
                  >
                    <Check className="w-3.5 h-3.5" />
                    ルートに追加
                  </Button>
                  {(proposal.projectTasks || []).map(t => (
                    <Button
                      key={t.id}
                      size="sm"
                      variant="outline"
                      className="gap-1"
                      onClick={() => handleAddToMap(proposal.selectedProjectId, t.id)}
                    >
                      <ChevronRight className="w-3 h-3" />
                      {t.title}
                    </Button>
                  ))}
                  <Button size="sm" variant="ghost" onClick={() => setProposal(prev => prev ? { ...prev, step: 'select_project' } : null)}>
                    戻る
                  </Button>
                </div>
              </div>
            )}

            {/* Step: calendar_form - カレンダー追加フォーム */}
            {proposal.step === 'calendar_form' && (() => {
              const d = proposal.calendarDate ? new Date(proposal.calendarDate + 'T00:00:00') : null
              const dayLabel = d ? ['日', '月', '火', '水', '木', '金', '土'][d.getDay()] : ''
              const dur = proposal.calendarDuration || 60
              const endTime = proposal.calendarTime ? (() => {
                const [h, m] = proposal.calendarTime!.split(':').map(Number)
                const totalMin = h * 60 + m + dur
                return `${String(Math.floor(totalMin / 60) % 24).padStart(2, '0')}:${String(totalMin % 60).padStart(2, '0')}`
              })() : ''
              const selectedCal = calendars.find(c => c.google_calendar_id === proposal.calendarId)

              return (
              <div className="space-y-2.5">
                {/* プレビュー */}
                <div className="flex items-start gap-2 p-2 rounded-md bg-blue-500/10 border border-blue-500/20">
                  <Calendar className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                  <div className="text-sm">
                    <div className="font-medium">{proposal.calendarTitle || '予定'}</div>
                    <div className="text-xs text-muted-foreground">
                      {d ? `${d.getMonth() + 1}/${d.getDate()}(${dayLabel})` : ''}{' '}
                      {proposal.calendarTime || ''}{endTime ? `〜${endTime}` : ''}
                      {selectedCal ? ` · ${selectedCal.name}` : ''}
                    </div>
                  </div>
                </div>

                {/* タイトル */}
                <input
                  type="text"
                  value={proposal.calendarTitle || ''}
                  onChange={(e) => setProposal(prev => prev ? { ...prev, calendarTitle: e.target.value } : null)}
                  className="w-full h-8 px-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="予定のタイトル"
                />

                {/* 日付・時刻・所要時間 (3列) */}
                <div className="grid grid-cols-3 gap-1.5">
                  <input
                    type="date"
                    value={proposal.calendarDate || ''}
                    onChange={(e) => setProposal(prev => prev ? { ...prev, calendarDate: e.target.value } : null)}
                    className="w-full h-8 px-1.5 rounded-md border border-input bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <input
                    type="time"
                    value={proposal.calendarTime || ''}
                    onChange={(e) => setProposal(prev => prev ? { ...prev, calendarTime: e.target.value } : null)}
                    className="w-full h-8 px-1.5 rounded-md border border-input bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <select
                    value={proposal.calendarDuration || 60}
                    onChange={(e) => setProposal(prev => prev ? { ...prev, calendarDuration: Number(e.target.value) } : null)}
                    className="w-full h-8 px-1 rounded-md border border-input bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value={15}>15分</option>
                    <option value={30}>30分</option>
                    <option value={45}>45分</option>
                    <option value={60}>1時間</option>
                    <option value={90}>1.5時間</option>
                    <option value={120}>2時間</option>
                    <option value={180}>3時間</option>
                    <option value={480}>終日</option>
                  </select>
                </div>

                {/* カレンダー選択 */}
                {calendars.length > 0 && (
                  <select
                    value={proposal.calendarId || ''}
                    onChange={(e) => setProposal(prev => prev ? { ...prev, calendarId: e.target.value } : null)}
                    className="w-full h-8 px-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    {calendars.map(cal => (
                      <option key={cal.id} value={cal.google_calendar_id}>
                        {cal.name}{cal.is_primary ? '（メイン）' : ''}
                      </option>
                    ))}
                  </select>
                )}

                {/* アクションボタン */}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="gap-1 flex-1"
                    onClick={handleExecuteCalendarAdd}
                    disabled={!proposal.calendarTitle?.trim() || !proposal.calendarDate}
                  >
                    <Check className="w-3.5 h-3.5" />
                    追加する
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setProposal(prev => prev ? { ...prev, step: 'initial' } : null)}
                  >
                    戻る
                  </Button>
                </div>
              </div>
              )
            })()}

            {/* Step: executing */}
            {proposal.step === 'executing' && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                追加中...
              </div>
            )}

            {/* Step: done */}
            {proposal.step === 'done' && (
              <p className="text-sm">{proposal.result}</p>
            )}
          </Card>
        </div>
      )}

      {/* Notes List (scrollable) */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-20">
        {isLoadingNotes ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : filteredNotes.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            <StickyNote className="w-12 h-12 mx-auto mb-2 opacity-30" />
            <p className="text-sm">
              {notes.length === 0 ? "まだメモがありません" : "該当するメモがありません"}
            </p>
            <p className="text-xs mt-1">
              {notes.length === 0 ? "テキストまたは音声でメモを入力してみましょう" : "プロジェクトフィルタを変更してみてください"}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredNotes.map((note) => (
              <Card key={note.id} className="p-3 hover:bg-muted/50 transition-colors group">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm whitespace-pre-wrap">{note.content}</p>

                    <div className="flex flex-wrap items-center gap-2 mt-2">
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

                      {editingProjectNoteId === note.id ? (
                        <select
                          value={note.project_id || ""}
                          onChange={(e) => handleUpdateProject(note.id, e.target.value || null)}
                          onBlur={() => setEditingProjectNoteId(null)}
                          autoFocus
                          className="text-xs px-1.5 py-0.5 rounded border bg-background text-foreground"
                        >
                          <option value="">未選択</option>
                          {projects.map(p => (
                            <option key={p.id} value={p.id}>{p.title}</option>
                          ))}
                        </select>
                      ) : (
                        <button
                          onClick={() => setEditingProjectNoteId(note.id)}
                          className="text-xs px-1.5 py-0.5 rounded bg-muted hover:bg-muted/80 text-muted-foreground flex items-center gap-0.5"
                        >
                          <FolderOpen className="w-3 h-3" />
                          {getProjectName(note.project_id) || "プロジェクト未設定"}
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => analyzeAndPropose(note.id, note.content)}
                      disabled={isAnalyzing}
                      className="h-7 w-7 p-0"
                      title="AIで分析"
                    >
                      {isAnalyzing && proposal?.noteId === note.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="w-3.5 h-3.5" />
                      )}
                    </Button>

                    {confirmDeleteId === note.id ? (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDelete(note.id)}
                          className="h-7 px-2 text-xs"
                        >
                          削除
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setConfirmDeleteId(null)}
                          className="h-7 w-7 p-0"
                        >
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirmDeleteId(note.id)}
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive transition-colors"
                        title="削除"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Recording Indicator with Waveform */}
      {isRecording && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50">
          <div className="flex items-center gap-3 px-4 py-2 bg-red-500 text-white rounded-full shadow-lg">
            <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
            <VoiceWaveform analyserRef={analyserRef} />
            <button
              onClick={stopRecording}
              className="text-xs font-medium bg-white/20 hover:bg-white/30 px-2 py-0.5 rounded-full transition-colors"
            >
              停止
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
