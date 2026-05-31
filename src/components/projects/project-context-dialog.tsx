"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2, Mic, Sparkles, Square } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { VoiceWaveform } from "@/components/ui/voice-waveform"
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder"
import { cn } from "@/lib/utils"
import type { Project } from "@/types/database"

type VoiceTarget = "heading" | "details"

interface ProjectContextDialogProps {
  open: boolean
  project: Project | null
  onClose: () => void
}

type ProjectContextPayload = {
  heading: string
  details: string
}

export function ProjectContextDialog({
  open,
  project,
  onClose,
}: ProjectContextDialogProps) {
  const [heading, setHeading] = useState("")
  const [details, setDetails] = useState("")
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const activeVoiceTargetRef = useRef<VoiceTarget>("details")

  const handleTranscribed = useCallback((text: string) => {
    const target = activeVoiceTargetRef.current
    if (target === "heading") {
      setHeading(text.trim())
      return
    }
    setDetails(prev => [prev.trim(), text.trim()].filter(Boolean).join("\n"))
  }, [])

  const {
    isRecording,
    isTranscribing,
    error: voiceError,
    analyserRef,
    startRecording,
    stopRecording,
  } = useVoiceRecorder(handleTranscribed)

  useEffect(() => {
    if (!open || !project) return

    let cancelled = false
    setLoading(true)
    setError(null)
    setMessage(null)
    setHeading("")
    setDetails("")

    fetch(`/api/projects/${project.id}/context`)
      .then(async res => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.error || "文脈の読み込みに失敗しました")
        return data as ProjectContextPayload
      })
      .then(data => {
        if (cancelled) return
        setHeading(data.heading ?? "")
        setDetails(data.details ?? "")
      })
      .catch(err => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : "文脈の読み込みに失敗しました")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [open, project])

  useEffect(() => {
    if (!voiceError) return
    setError(voiceError)
  }, [voiceError])

  const toggleVoice = useCallback(async (target: VoiceTarget) => {
    activeVoiceTargetRef.current = target
    setError(null)
    setMessage(null)
    if (isRecording) {
      stopRecording()
      return
    }
    await startRecording()
  }, [isRecording, startRecording, stopRecording])

  const handleGenerateHeading = useCallback(async () => {
    if (!details.trim() || generating) return
    setGenerating(true)
    setError(null)
    setMessage(null)
    try {
      const res = await fetch("/api/ai/generate-memo-heading", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          detail: details,
          currentHeading: heading,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || "見出し生成に失敗しました")
      setHeading(String(data.heading ?? "").trim())
      setMessage("見出しを生成しました")
    } catch (err) {
      setError(err instanceof Error ? err.message : "見出し生成に失敗しました")
    } finally {
      setGenerating(false)
    }
  }, [details, generating, heading])

  const handleSave = useCallback(async () => {
    if (!project || saving) return
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const res = await fetch(`/api/projects/${project.id}/context`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          heading: heading.trim(),
          details: details.trim(),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "保存に失敗しました")
      setMessage("保存しました")
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました")
    } finally {
      setSaving(false)
    }
  }, [details, heading, onClose, project, saving])

  const recordingTarget = activeVoiceTargetRef.current
  const voiceBusy = isRecording || isTranscribing

  return (
    <Dialog open={open} onOpenChange={v => !v && !saving && onClose()}>
      <DialogContent className="flex max-h-[88dvh] w-[calc(100vw-1rem)] max-w-2xl flex-col overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-5 py-4 sm:px-6">
          <DialogTitle className="text-base sm:text-lg">プロジェクトの文脈を設定</DialogTitle>
          <p className="text-sm leading-6 text-muted-foreground">
            これはどんなプロジェクトですか？ 今は空でも大丈夫です。
          </p>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
          {loading ? (
            <div className="flex min-h-[260px] items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              読み込み中...
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex min-h-9 items-center justify-between gap-3">
                  <label htmlFor="project-context-heading" className="text-sm font-medium text-muted-foreground">
                    見出し
                  </label>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    onClick={() => void toggleVoice("heading")}
                    aria-label="見出しを音声入力"
                    title="見出しを音声入力"
                    className={cn(isRecording && recordingTarget === "heading" && "border-destructive text-destructive")}
                    disabled={isTranscribing}
                  >
                    {isRecording && recordingTarget === "heading" ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                  </Button>
                </div>
                <input
                  id="project-context-heading"
                  value={heading}
                  onChange={e => setHeading(e.target.value)}
                  placeholder="例：新規事業の立ち上げ"
                  maxLength={100}
                  className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="space-y-2">
                <div className="flex min-h-9 items-center justify-between gap-3">
                  <label htmlFor="project-context-details" className="text-sm font-medium text-muted-foreground">
                    詳細
                  </label>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="outline"
                      onClick={() => void toggleVoice("details")}
                      aria-label="詳細を音声入力"
                      title="詳細を音声入力"
                      className={cn(isRecording && recordingTarget === "details" && "border-destructive text-destructive")}
                      disabled={isTranscribing}
                    >
                      {isRecording && recordingTarget === "details" ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1.5 px-2.5 text-xs"
                      onClick={handleGenerateHeading}
                      disabled={generating || !details.trim()}
                    >
                      {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                      AIで見出し生成
                    </Button>
                  </div>
                </div>
                <textarea
                  id="project-context-details"
                  value={details}
                  onChange={e => setDetails(e.target.value)}
                  placeholder="背景、目的、制約、関係者、判断基準などを話す/書く"
                  className="min-h-[180px] w-full resize-y rounded-md border border-input bg-background p-3 text-sm leading-6 outline-none focus:ring-1 focus:ring-primary sm:min-h-[210px]"
                />
              </div>

              {voiceBusy && (
                <div className="flex min-h-9 flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  {isRecording && (
                    <>
                      <span className="font-medium text-destructive">録音中</span>
                      <VoiceWaveform analyserRef={analyserRef} height={20} barCount={20} />
                    </>
                  )}
                  {isTranscribing && (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>文字起こし中...</span>
                    </>
                  )}
                </div>
              )}

              {(error || message) && (
                <p className={cn("text-sm", error ? "text-destructive" : "text-muted-foreground")}>
                  {error || message}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="grid gap-2 border-t px-5 py-4 sm:grid-cols-[1fr_auto] sm:px-6">
          <Button type="button" onClick={handleSave} disabled={saving || loading}>
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            保存して開始
          </Button>
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            後で設定する
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
