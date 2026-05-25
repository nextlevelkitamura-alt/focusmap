"use client"

import { useState, useCallback, useEffect, useMemo, type ReactNode } from "react"
import { Loader2, Trash2, Sparkles, Network } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { MindmapDraft, MindmapDraftNode } from "@/lib/ai/memo-to-mindmap"
import { useUndoRedo } from "@/hooks/useUndoRedo"

type Mode = "quick" | "deep"
type Step = "config" | "generating" | "preview" | "committing"

interface ProjectOption {
  id: string
  title: string
}

interface MemoToMindmapDialogProps {
  open: boolean
  noteIds: string[]
  source?: "notes" | "wishlist"
  projects: ProjectOption[]
  spaces: ProjectOption[]
  defaultSpaceId: string | null
  /** 選択メモが単一プロジェクトに属する場合、そのID（追記先の初期値） */
  defaultProjectId: string | null
  onClose: () => void
  onSuccess: (projectId: string) => void
}

const NEW_PROJECT = "__new__"

export function MemoToMindmapDialog({
  open,
  noteIds,
  source = "notes",
  projects,
  spaces,
  defaultSpaceId,
  defaultProjectId,
  onClose,
  onSuccess,
}: MemoToMindmapDialogProps) {
  const [step, setStep] = useState<Step>("config")
  const [mode, setMode] = useState<Mode>("quick")
  const [nodes, setNodes] = useState<MindmapDraftNode[]>([])
  const [projectTitle, setProjectTitle] = useState("")
  const [error, setError] = useState<string | null>(null)

  const [target, setTarget] = useState<string>(defaultProjectId || NEW_PROJECT)
  const [spaceId, setSpaceId] = useState<string>(defaultSpaceId || spaces[0]?.id || "")
  const { pushAction } = useUndoRedo()
  const firstSpaceId = spaces[0]?.id || ""

  const reset = useCallback(() => {
    setStep("config")
    setMode("quick")
    setNodes([])
    setProjectTitle("")
    setError(null)
    setTarget(defaultProjectId || NEW_PROJECT)
    setSpaceId(defaultSpaceId || firstSpaceId)
  }, [defaultProjectId, defaultSpaceId, firstSpaceId])

  useEffect(() => {
    if (!open) return
    reset()
  }, [open, reset])

  const handleClose = useCallback(() => {
    if (step === "generating" || step === "committing") return
    reset()
    onClose()
  }, [step, reset, onClose])

  // --- 生成 ---
  const handleGenerate = useCallback(async () => {
    setStep("generating")
    setError(null)
    try {
      const res = await fetch("/api/ai/memo-to-mindmap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          noteIds,
          source,
          mode,
          targetProjectId: target !== NEW_PROJECT ? target : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || "生成に失敗しました")
      const draft = data.draft as MindmapDraft
      setNodes(draft.nodes)
      setProjectTitle(draft.projectTitle || "新しいマインドマップ")
      setStep("preview")
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成に失敗しました")
      setStep("config")
    }
  }, [noteIds, source, mode, target])

  // --- ノード編集 ---
  const updateTitle = useCallback((tempId: string, title: string) => {
    setNodes(prev => prev.map(n => (n.tempId === tempId ? { ...n, title } : n)))
  }, [])

  const deleteSubtree = useCallback((tempId: string) => {
    setNodes(prev => {
      const toRemove = new Set<string>([tempId])
      let changed = true
      while (changed) {
        changed = false
        for (const n of prev) {
          if (n.parentTempId && toRemove.has(n.parentTempId) && !toRemove.has(n.tempId)) {
            toRemove.add(n.tempId)
            changed = true
          }
        }
      }
      return prev.filter(n => !toRemove.has(n.tempId))
    })
  }, [])

  // --- ツリー構築 ---
  const childrenMap = useMemo(() => {
    const map = new Map<string, MindmapDraftNode[]>()
    const ids = new Set(nodes.map(n => n.tempId))
    for (const n of nodes) {
      const parent = n.parentTempId && ids.has(n.parentTempId) ? n.parentTempId : "__root__"
      const arr = map.get(parent) || []
      arr.push(n)
      map.set(parent, arr)
    }
    return map
  }, [nodes])

  const renderNode = (node: MindmapDraftNode, depth: number): ReactNode => {
    const children = childrenMap.get(node.tempId) || []
    return (
      <div key={node.tempId}>
        <div
          className="flex items-center gap-1.5 py-1"
          style={{ paddingLeft: `${depth * 16}px` }}
        >
          <span className="text-muted-foreground shrink-0 text-xs">
            {children.length > 0 ? "▸" : "·"}
          </span>
          <input
            value={node.title}
            onChange={e => updateTitle(node.tempId, e.target.value)}
            className="flex-1 min-w-0 h-8 px-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            onClick={() => deleteSubtree(node.tempId)}
            className="shrink-0 h-7 w-7 flex items-center justify-center rounded text-muted-foreground hover:text-destructive transition-colors"
            title="このノードと子を削除"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
        {children.map(c => renderNode(c, depth + 1))}
      </div>
    )
  }

  const rootNodes = childrenMap.get("__root__") || []

  // --- 確定 ---
  const handleCommit = useCallback(async () => {
    if (nodes.length === 0) {
      setError("ノードがありません")
      return
    }
    setStep("committing")
    setError(null)
    try {
      const targetPayload =
        target === NEW_PROJECT
          ? { type: "new", projectTitle: projectTitle.trim(), spaceId }
          : { type: "existing", projectId: target }
      const draftPayload = { projectTitle: projectTitle.trim() || "新しいマインドマップ", nodes }

      const res = await fetch("/api/ai/memo-to-mindmap/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft: draftPayload,
          target: targetPayload,
          source,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || "保存に失敗しました")
      let currentProjectId = String(data.projectId)
      let currentTaskIds = Array.isArray(data.taskIds) ? data.taskIds.filter((id: unknown): id is string => typeof id === "string") : []
      let currentCreatedProject = data.createdProject === true
      pushAction({
        description: "メモをマインドマップに整理",
        undo: async () => {
          if (currentTaskIds.length === 0) return
          const undoRes = await fetch("/api/ai/memo-to-mindmap/undo", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              taskIds: currentTaskIds,
              projectId: currentProjectId,
              deleteProjectIfEmpty: currentCreatedProject,
            }),
          })
          if (!undoRes.ok) {
            const undoData = await undoRes.json().catch(() => ({}))
            throw new Error(undoData?.error || "取り消しに失敗しました")
          }
          onSuccess(currentProjectId)
        },
        redo: async () => {
          const redoRes = await fetch("/api/ai/memo-to-mindmap/commit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ draft: draftPayload, target: targetPayload, source }),
          })
          const redoData = await redoRes.json()
          if (!redoRes.ok) throw new Error(redoData?.error || "やり直しに失敗しました")
          currentProjectId = String(redoData.projectId)
          currentTaskIds = Array.isArray(redoData.taskIds) ? redoData.taskIds.filter((id: unknown): id is string => typeof id === "string") : []
          currentCreatedProject = redoData.createdProject === true
          onSuccess(currentProjectId)
        },
      })
      reset()
      onSuccess(data.projectId)
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました")
      setStep("preview")
    }
  }, [nodes, source, target, projectTitle, spaceId, reset, onSuccess, pushAction])

  const canCreateNew = spaces.length > 0
  const newProjectInvalid = target === NEW_PROJECT && (!canCreateNew || !spaceId || !projectTitle.trim())

  return (
    <Dialog open={open} onOpenChange={v => !v && handleClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Network className="w-4.5 h-4.5 text-primary" />
            メモをマインドマップに整理
          </DialogTitle>
        </DialogHeader>

        {/* config */}
        {step === "config" && (
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              選択した {noteIds.length} 件のメモを、AIがロジックツリーに整理します。
            </p>
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">整理の深さ</span>
              <div className="flex gap-2">
                {(["quick", "deep"] as Mode[]).map(m => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={cn(
                      "flex-1 rounded-lg border px-3 py-2 text-left transition-colors",
                      mode === m
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted",
                    )}
                  >
                    <div className="text-sm font-medium">
                      {m === "quick" ? "クイック" : "じっくり"}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {m === "quick" ? "高速。通常のメモ整理" : "論理再構成が重い時"}
                    </div>
                  </button>
                ))}
              </div>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}

        {/* generating / committing */}
        {(step === "generating" || step === "committing") && (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Loader2 className="w-7 h-7 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              {step === "generating" ? "AIがメモを整理しています…" : "保存しています…"}
            </p>
          </div>
        )}

        {/* preview */}
        {step === "preview" && (
          <div className="flex-1 min-h-0 flex flex-col gap-3 py-1">
            <input
              value={projectTitle}
              onChange={e => setProjectTitle(e.target.value)}
              placeholder="マインドマップのタイトル"
              className="h-9 px-2.5 rounded-md border border-input bg-background text-sm font-medium focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <div className="flex-1 min-h-0 overflow-y-auto rounded-lg border border-dashed bg-muted/30 p-2">
              {rootNodes.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  ノードがありません
                </p>
              ) : (
                rootNodes.map(n => renderNode(n, 0))
              )}
            </div>
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">保存先</span>
              <select
                value={target}
                onChange={e => setTarget(e.target.value)}
                className="w-full h-9 px-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value={NEW_PROJECT} disabled={!canCreateNew}>
                  新規プロジェクトとして作成
                </option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>
                    既存マップに追加: {p.title}
                  </option>
                ))}
              </select>
              {target === NEW_PROJECT && spaces.length > 1 && (
                <select
                  value={spaceId}
                  onChange={e => setSpaceId(e.target.value)}
                  className="w-full h-9 px-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  {spaces.map(s => (
                    <option key={s.id} value={s.id}>スペース: {s.title}</option>
                  ))}
                </select>
              )}
              {target === NEW_PROJECT && !canCreateNew && (
                <p className="text-xs text-destructive">
                  スペースがないため新規作成できません。既存マップを選んでください。
                </p>
              )}
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}

        <DialogFooter>
          {step === "config" && (
            <>
              <Button variant="ghost" onClick={handleClose}>キャンセル</Button>
              <Button onClick={handleGenerate} disabled={noteIds.length === 0}>
                <Sparkles className="w-4 h-4 mr-1" />
                生成
              </Button>
            </>
          )}
          {step === "preview" && (
            <>
              <Button variant="ghost" onClick={() => setStep("config")}>戻る</Button>
              <Button onClick={handleCommit} disabled={newProjectInvalid || nodes.length === 0}>
                確定して反映
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
