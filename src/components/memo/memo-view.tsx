"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import {
  StickyNote, Send, Loader2,
  Sparkles, Mic, Square, Calendar, Map, Trash2,
  FolderOpen, ChevronRight, Check, X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder"
import type { Note, NoteAiAnalysis } from "@/types/note"
import type { Project } from "@/types/database"

// 音声波形ビジュアライザー
function VoiceWaveform({ analyserRef }: { analyserRef: React.RefObject<AnalyserNode | null> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationRef = useRef<number>(0)

  useEffect(() => {
    const canvas = canvasRef.current
    const analyser = analyserRef.current
    if (!canvas || !analyser) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const bufferLength = analyser.frequencyBinCount
    const dataArray = new Uint8Array(bufferLength)
    const barCount = 24
    const barWidth = 3
    const barGap = 2
    const totalWidth = barCount * (barWidth + barGap) - barGap

    canvas.width = totalWidth
    canvas.height = 32

    function draw() {
      animationRef.current = requestAnimationFrame(draw)
      analyser!.getByteFrequencyData(dataArray)

      ctx!.clearRect(0, 0, canvas!.width, canvas!.height)

      for (let i = 0; i < barCount; i++) {
        const index = Math.floor((i / barCount) * bufferLength * 0.6)
        const value = dataArray[index] / 255
        const barHeight = Math.max(3, value * 28)
        const x = i * (barWidth + barGap)
        const y = (32 - barHeight) / 2

        ctx!.fillStyle = `rgba(239, 68, 68, ${0.5 + value * 0.5})`
        ctx!.beginPath()
        ctx!.roundRect(x, y, barWidth, barHeight, 1.5)
        ctx!.fill()
      }
    }

    draw()
    return () => { cancelAnimationFrame(animationRef.current) }
  }, [analyserRef])

  return <canvas ref={canvasRef} className="h-8" style={{ width: 'auto' }} />
}

// インライン提案の状態
interface InlineProposal {
  noteId: string
  analysis: NoteAiAnalysis
  step: 'initial' | 'select_project' | 'select_node' | 'executing' | 'done'
  selectedProjectId?: string
  projectTasks?: { id: string; title: string }[]
  result?: string
}

interface MemoViewProps {
  className?: string
  projects?: Project[]
}

export function MemoView({ className, projects = [] }: MemoViewProps) {
  const [content, setContent] = useState("")
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [notes, setNotes] = useState<Note[]>([])
  const [isLoadingNotes, setIsLoadingNotes] = useState(true)
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null)
  const [editingProjectNoteId, setEditingProjectNoteId] = useState<string | null>(null)

  // インライン提案
  const [proposal, setProposal] = useState<InlineProposal | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)

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

  // メモ削除
  const handleDelete = useCallback(async (noteId: string) => {
    try {
      const res = await fetch(`/api/notes?id=${noteId}`, { method: "DELETE" })
      if (res.ok) {
        setNotes(prev => prev.filter(n => n.id !== noteId))
        if (proposal?.noteId === noteId) setProposal(null)
      }
    } catch (err) {
      console.error("Delete error:", err)
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
      {/* Header + Project Filter */}
      <div className="flex items-center gap-2 px-4 py-3 border-b shrink-0">
        <StickyNote className="w-5 h-5 text-primary shrink-0" />
        <h1 className="text-lg font-semibold shrink-0">メモ</h1>
        {projects.length > 0 && (
          <select
            value={selectedProjectId === "__unassigned__" ? "__unassigned__" : selectedProjectId || ""}
            onChange={(e) => setSelectedProjectId(e.target.value || null)}
            className="ml-2 text-sm px-2 py-1 rounded-md border bg-background text-foreground truncate max-w-[180px]"
          >
            <option value="">全て</option>
            <option value="__unassigned__">未登録</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.title}</option>
            ))}
          </select>
        )}
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
                      <Button size="sm" variant="outline" className="gap-1" disabled>
                        <Calendar className="w-3.5 h-3.5" />
                        カレンダーに追加（準備中）
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

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(note.id)}
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive transition-colors"
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
