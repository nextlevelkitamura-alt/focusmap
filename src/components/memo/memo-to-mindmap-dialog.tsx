"use client"

import { useState, useCallback, useEffect, useMemo, type ReactNode } from "react"
import { AlertTriangle, Link2, Loader2, Trash2, Sparkles, Network } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  buildDraftChildMap,
  MAX_CONVERSATION_LOG_CHARS,
  MAX_HELD_CONVERSATION_ITEMS,
  getDraftDepthViolations,
  isSourceBackedDraftNode,
  MAX_MINDMAP_DRAFT_DEPTH,
  type ExistingNodeRenameSuggestion,
  type MindmapDraft,
  type MindmapDraftNode,
  type MindmapDraftTriageItem,
} from "@/lib/ai/memo-to-mindmap"
import { useUndoRedo } from "@/hooks/useUndoRedo"

type Mode = "quick" | "deep"
type Step = "config" | "generating" | "preview" | "committing"
type InputMode = "memos" | "conversation"

interface ProjectOption {
  id: string
  title: string
}

interface ExistingTaskOption {
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
  /**
   * 各メモの現在の所属プロジェクト ID マップ (任意)
   * 渡されていれば、最頻プロジェクトを保存先の初期値として自動選択する
   */
  noteProjects?: Record<string, string | null>
  onClose: () => void
  onSuccess: (projectId: string) => void
  allowTextImport?: boolean
}

const NEW_PROJECT = "__new__"

const KIND_LABEL: Record<MindmapDraftTriageItem["kind"], string> = {
  policy: "方針",
  decision: "決定",
  question: "論点",
  task: "タスク",
}

function ensureKindPrefix(item: Pick<MindmapDraftTriageItem, "kind" | "title">) {
  const title = item.title.trim()
  if (/^(方針|決定|論点|タスク)[:：]\s*/.test(title)) return title
  return `${KIND_LABEL[item.kind] ?? "タスク"}: ${title}`
}

function nextTempId(nodes: MindmapDraftNode[]) {
  const ids = new Set(nodes.map(node => node.tempId))
  let index = nodes.length + 1
  while (ids.has(`n${index}`)) index += 1
  return `n${index}`
}

function buildConversationLogTitle(text: string) {
  const firstLine = text
    .split(/\n+/)
    .map(line => line.replace(/^(user|assistant|ai|gpt|chatgpt|claude)[:：]\s*/i, "").trim())
    .find(Boolean)
  return `会話ログ: ${(firstLine || "貼り付けメモ").slice(0, 36)}`
}

export function MemoToMindmapDialog({
  open,
  noteIds,
  source = "notes",
  projects,
  spaces,
  defaultSpaceId,
  defaultProjectId,
  noteProjects,
  onClose,
  onSuccess,
  allowTextImport = false,
}: MemoToMindmapDialogProps) {
  const [step, setStep] = useState<Step>("config")
  const [mode, setMode] = useState<Mode>("quick")
  const [inputMode, setInputMode] = useState<InputMode>(allowTextImport && noteIds.length === 0 ? "conversation" : "memos")
  const [conversationLog, setConversationLog] = useState("")
  const [createdConversationMemoId, setCreatedConversationMemoId] = useState<string | null>(null)
  const [nodes, setNodes] = useState<MindmapDraftNode[]>([])
  const [heldItems, setHeldItems] = useState<MindmapDraftTriageItem[]>([])
  const [excludedItems, setExcludedItems] = useState<MindmapDraftTriageItem[]>([])
  const [existingTasks, setExistingTasks] = useState<ExistingTaskOption[]>([])
  const [renameSuggestions, setRenameSuggestions] = useState<ExistingNodeRenameSuggestion[]>([])
  const [selectedRenameTaskIds, setSelectedRenameTaskIds] = useState<Set<string>>(new Set())
  const [projectTitle, setProjectTitle] = useState("")
  const [error, setError] = useState<string | null>(null)

  // 選択されたメモが「最も多く所属する」プロジェクトを計算
  const mostFrequentProjectId = useMemo(() => {
    if (!noteProjects || noteIds.length === 0) return null
    const counts = new Map<string, number>()
    for (const id of noteIds) {
      const pid = noteProjects[id]
      if (!pid) continue
      counts.set(pid, (counts.get(pid) ?? 0) + 1)
    }
    let bestId: string | null = null
    let bestCount = 0
    for (const [pid, count] of counts) {
      if (count > bestCount) {
        bestId = pid
        bestCount = count
      }
    }
    // 候補が現在の projects に存在する場合のみ採用
    if (bestId && projects.some(p => p.id === bestId)) return bestId
    return null
  }, [noteIds, noteProjects, projects])

  // 初期 target: 明示的 defaultProjectId > 最頻 > 新規作成
  const initialTarget = defaultProjectId || mostFrequentProjectId || NEW_PROJECT

  const [target, setTarget] = useState<string>(initialTarget)
  const [spaceId, setSpaceId] = useState<string>(defaultSpaceId || spaces[0]?.id || "")
  const { pushAction } = useUndoRedo()
  const firstSpaceId = spaces[0]?.id || ""

  const reset = useCallback(() => {
    setStep("config")
    setMode("quick")
    setInputMode(allowTextImport && noteIds.length === 0 ? "conversation" : "memos")
    setConversationLog("")
    setCreatedConversationMemoId(null)
    setNodes([])
    setHeldItems([])
    setExcludedItems([])
    setExistingTasks([])
    setRenameSuggestions([])
    setSelectedRenameTaskIds(new Set())
    setProjectTitle("")
    setError(null)
    setTarget(defaultProjectId || mostFrequentProjectId || NEW_PROJECT)
    setSpaceId(defaultSpaceId || firstSpaceId)
  }, [allowTextImport, noteIds.length, defaultProjectId, mostFrequentProjectId, defaultSpaceId, firstSpaceId])

  useEffect(() => {
    if (!open) return
    reset()
  }, [open, reset])

  useEffect(() => {
    if (inputMode === "conversation") setMode("deep")
  }, [inputMode])

  const handleClose = useCallback(() => {
    if (step === "generating" || step === "committing") return
    reset()
    onClose()
  }, [step, reset, onClose])

  const createConversationMemo = useCallback(async () => {
    const text = conversationLog.trim()
    if (!text) throw new Error("会話ログを貼り付けてください")
    if (text.length > MAX_CONVERSATION_LOG_CHARS) {
      throw new Error(`会話ログは${MAX_CONVERSATION_LOG_CHARS}文字までです`)
    }
    if (createdConversationMemoId) return createdConversationMemoId

    const res = await fetch("/api/wishlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: buildConversationLogTitle(text),
        description: text,
        project_id: target !== NEW_PROJECT ? target : defaultProjectId,
        status: "memo",
        memo_status: "unsorted",
        ai_source_payload: {
          input_type: "conversation_log",
          original_length: text.length,
          imported_at: new Date().toISOString(),
        },
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data?.error || "会話ログの保存に失敗しました")
    const id = data?.item?.id
    if (typeof id !== "string") throw new Error("保存した会話ログのIDを取得できませんでした")
    setCreatedConversationMemoId(id)
    return id
  }, [conversationLog, createdConversationMemoId, target, defaultProjectId])

  // --- 生成 ---
  const handleGenerate = useCallback(async () => {
    setStep("generating")
    setError(null)
    try {
      const currentNoteIds = inputMode === "conversation"
        ? [await createConversationMemo()]
        : noteIds
      if (currentNoteIds.length === 0) {
        throw new Error("整理するメモがありません")
      }

      const res = await fetch("/api/ai/memo-to-mindmap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          noteIds: currentNoteIds,
          source: inputMode === "conversation" ? "wishlist" : source,
          mode: inputMode === "conversation" ? "deep" : mode,
          inputKind: inputMode === "conversation" ? "conversation_log" : "memo",
          targetProjectId: target !== NEW_PROJECT ? target : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || "生成に失敗しました")
      const draft = data.draft as MindmapDraft
      const nextExistingTasks: ExistingTaskOption[] = Array.isArray(data.existingTasks)
        ? data.existingTasks.filter((task: unknown): task is ExistingTaskOption => {
          if (!task || typeof task !== "object") return false
          const record = task as Record<string, unknown>
          return typeof record.id === "string" && typeof record.title === "string"
        })
        : []
      const nextExistingTaskTitleById = new Map(nextExistingTasks.map(task => [task.id, task.title]))
      setNodes(draft.nodes.map(node => ({
        ...node,
        title: inputMode === "conversation" && !/^(方針|決定|論点|タスク)[:：]\s*/.test(node.title)
          ? `タスク: ${node.title}`
          : node.title,
        sourceNoteIds: inputMode === "conversation" && node.sourceNoteIds.length === 0
          ? currentNoteIds
          : node.sourceNoteIds,
        attachToExistingTaskId: node.attachToExistingTaskId ?? null,
      })))
      setHeldItems(Array.isArray(draft.holdItems) ? draft.holdItems : [])
      setExcludedItems(Array.isArray(draft.excludedItems) ? draft.excludedItems : [])
      setExistingTasks(nextExistingTasks)
      setRenameSuggestions(Array.isArray(draft.existingNodeRenameSuggestions)
        ? draft.existingNodeRenameSuggestions
          .filter(suggestion => nextExistingTaskTitleById.has(suggestion.taskId))
          .map(suggestion => ({
            ...suggestion,
            currentTitle: nextExistingTaskTitleById.get(suggestion.taskId) || suggestion.currentTitle,
          }))
        : [])
      setSelectedRenameTaskIds(new Set())
      setProjectTitle(draft.projectTitle || "新しいマインドマップ")
      setStep("preview")
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成に失敗しました")
      setStep("config")
    }
  }, [inputMode, createConversationMemo, noteIds, source, mode, target])

  const existingTaskTitleById = useMemo(() => {
    return new Map(existingTasks.map(task => [task.id, task.title]))
  }, [existingTasks])

  const selectedRenameSuggestions = useMemo(() => {
    return renameSuggestions.filter(suggestion => selectedRenameTaskIds.has(suggestion.taskId))
  }, [renameSuggestions, selectedRenameTaskIds])

  const toggleRenameSuggestion = useCallback((taskId: string) => {
    setSelectedRenameTaskIds(prev => {
      const next = new Set(prev)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }, [])

  const handlePreviewTargetChange = useCallback((nextTarget: string) => {
    setTarget(nextTarget)
    setNodes(prev => prev.map(node => ({ ...node, attachToExistingTaskId: null })))
    setExistingTasks([])
    setRenameSuggestions([])
    setSelectedRenameTaskIds(new Set())
  }, [])

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
  const childIdMap = useMemo(() => buildDraftChildMap(nodes), [nodes])

  const renderNodeEditor = (node: MindmapDraftNode): ReactNode => {
    const children = childrenMap.get(node.tempId) || []
    const isSourceBacked = isSourceBackedDraftNode(node, childIdMap)
    const attachedTitle = target !== NEW_PROJECT && node.parentTempId === null && node.attachToExistingTaskId
      ? existingTaskTitleById.get(node.attachToExistingTaskId) ?? null
      : null
    return (
      <div key={node.tempId} className="flex items-center gap-3">
        <div className="relative w-40 shrink-0 rounded-lg border bg-background p-1.5 shadow-sm sm:w-48">
          <input
            value={node.title}
            onChange={e => updateTitle(node.tempId, e.target.value)}
            className="h-8 w-full rounded-md border border-input bg-background px-2 pr-8 text-xs font-medium outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            onClick={() => deleteSubtree(node.tempId)}
            className="absolute right-2 top-2.5 flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-destructive"
            title="このノードと子を削除"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          {isSourceBacked && (
            <div className="mt-1 truncate text-[10px] text-muted-foreground">
              メモ {node.sourceNoteIds.length}
            </div>
          )}
          {attachedTitle && (
            <div className="mt-1 flex min-w-0 items-center gap-1 rounded border border-sky-500/30 bg-sky-500/10 px-1.5 py-1 text-[10px] text-sky-700 dark:text-sky-300">
              <Link2 className="h-3 w-3 shrink-0" />
              <span className="truncate">{attachedTitle}</span>
            </div>
          )}
        </div>
        {children.length > 0 && (
          <div className="flex items-center gap-2">
            <div className="h-px w-5 shrink-0 bg-border" />
            <div className="flex flex-col gap-2">
              {children.map(child => renderNodeEditor(child))}
            </div>
          </div>
        )}
      </div>
    )
  }

  const adoptTriageItem = useCallback((item: MindmapDraftTriageItem, from: "held" | "excluded") => {
    setNodes(prev => [
      ...prev,
      {
        tempId: nextTempId(prev),
        title: ensureKindPrefix(item),
        parentTempId: null,
        sourceNoteIds: item.sourceNoteIds.length > 0
          ? item.sourceNoteIds
          : createdConversationMemoId
            ? [createdConversationMemoId]
            : [],
        attachToExistingTaskId: null,
      },
    ])
    if (from === "held") {
      setHeldItems(prev => prev.filter(candidate => candidate.clientId !== item.clientId))
    } else {
      setExcludedItems(prev => prev.filter(candidate => candidate.clientId !== item.clientId))
    }
  }, [createdConversationMemoId])

  const excludeHeldItem = useCallback((item: MindmapDraftTriageItem) => {
    setHeldItems(prev => prev.filter(candidate => candidate.clientId !== item.clientId))
    setExcludedItems(prev => [
      ...prev,
      {
        ...item,
        reason: item.reason || "ユーザーが除外に変更",
      },
    ])
  }, [])

  const excludeAllHeldItems = useCallback(() => {
    setExcludedItems(prev => [...prev, ...heldItems])
    setHeldItems([])
  }, [heldItems])

  const renderTriageItem = (item: MindmapDraftTriageItem, from: "held" | "excluded") => (
    <div key={`${from}-${item.clientId}`} className="rounded-md border bg-background/70 p-2">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-1.5">
            <span className="rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {KIND_LABEL[item.kind]}
            </span>
            <span className="truncate text-xs font-medium">{item.title}</span>
          </div>
          {item.reason && (
            <p className="text-[11px] leading-relaxed text-muted-foreground">{item.reason}</p>
          )}
        </div>
        <div className="flex shrink-0 gap-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 px-2 text-[11px]"
            onClick={() => adoptTriageItem(item, from)}
          >
            採用
          </Button>
          {from === "held" && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[11px] text-muted-foreground"
              onClick={() => excludeHeldItem(item)}
            >
              除外
            </Button>
          )}
        </div>
      </div>
    </div>
  )

  const rootNodes = childrenMap.get("__root__") || []
  const depthViolations = useMemo(() => getDraftDepthViolations(nodes), [nodes])

  // --- 確定 ---
  const handleCommit = useCallback(async () => {
    if (nodes.length === 0) {
      setError("ノードがありません")
      return
    }
    if (depthViolations.length > 0) {
      setError(`追加ノードは最大${MAX_MINDMAP_DRAFT_DEPTH}層までです。深すぎるノードを削除するか再生成してください`)
      return
    }
    setStep("committing")
    setError(null)
    try {
      const targetPayload =
        target === NEW_PROJECT
          ? { type: "new", projectTitle: projectTitle.trim(), spaceId }
          : { type: "existing", projectId: target }
      const draftPayload = {
        projectTitle: projectTitle.trim() || "新しいマインドマップ",
        nodes,
        existingNodeRenameSuggestions: renameSuggestions,
      }

      const res = await fetch("/api/ai/memo-to-mindmap/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft: draftPayload,
          target: targetPayload,
          source: inputMode === "conversation" ? "wishlist" : source,
          appliedRenameSuggestions: selectedRenameSuggestions,
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
              restoreTaskTitles: selectedRenameSuggestions.map(suggestion => ({
                taskId: suggestion.taskId,
                title: suggestion.currentTitle,
              })),
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
            body: JSON.stringify({
              draft: draftPayload,
              target: targetPayload,
              source: inputMode === "conversation" ? "wishlist" : source,
              appliedRenameSuggestions: selectedRenameSuggestions,
            }),
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
  }, [nodes, depthViolations.length, inputMode, source, target, projectTitle, spaceId, renameSuggestions, selectedRenameSuggestions, reset, onSuccess, pushAction])

  const canCreateNew = spaces.length > 0
  const newProjectInvalid = target === NEW_PROJECT && (!canCreateNew || !spaceId || !projectTitle.trim())
  const trimmedConversationLog = conversationLog.trim()
  const conversationTooLong = trimmedConversationLog.length > MAX_CONVERSATION_LOG_CHARS
  const canGenerate = inputMode === "conversation"
    ? trimmedConversationLog.length > 0 && !conversationTooLong
    : noteIds.length > 0
  const sourceCountLabel = inputMode === "conversation"
    ? "貼り付けた会話ログ"
    : `${noteIds.length} 件のメモ`

  return (
    <Dialog open={open} onOpenChange={v => !v && handleClose()}>
      <DialogContent className="flex max-h-[85vh] w-[calc(100vw-1rem)] max-w-3xl flex-col">
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
              {inputMode === "conversation"
                ? "GPT等との会話ログを貼り付けると、AIが取捨選択してマップ候補に整理します。"
                : `選択した ${noteIds.length} 件のメモを、AIがロジックツリーに整理します。`}
            </p>

            {allowTextImport && (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setInputMode("memos")}
                  disabled={noteIds.length === 0}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                    inputMode === "memos"
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-muted",
                    noteIds.length === 0 && "cursor-not-allowed opacity-50",
                  )}
                >
                  <div className="font-medium">未整理メモ</div>
                  <div className="text-[11px] text-muted-foreground">{noteIds.length}件を整理</div>
                </button>
                <button
                  type="button"
                  onClick={() => setInputMode("conversation")}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                    inputMode === "conversation"
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-muted",
                  )}
                >
                  <div className="font-medium">会話ログ</div>
                  <div className="text-[11px] text-muted-foreground">貼り付けて整理</div>
                </button>
              </div>
            )}

            {inputMode === "conversation" && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-muted-foreground">会話ログ</span>
                  <span className={cn(
                    "text-[11px]",
                    conversationTooLong ? "text-destructive" : "text-muted-foreground",
                  )}>
                    {trimmedConversationLog.length} / {MAX_CONVERSATION_LOG_CHARS}
                  </span>
                </div>
                <textarea
                  value={conversationLog}
                  onChange={e => {
                    setConversationLog(e.target.value)
                    setCreatedConversationMemoId(null)
                  }}
                  rows={8}
                  placeholder="ChatGPT等との会話ログを貼り付け..."
                  className={cn(
                    "w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring",
                    conversationTooLong && "border-destructive focus:ring-destructive/40",
                  )}
                />
                <p className="text-[11px] leading-relaxed text-muted-foreground/80">
                  原文はメモとして保存し、採用候補だけをマップへ反映します。保留は最大{MAX_HELD_CONVERSATION_ITEMS}件に絞ります。
                </p>
              </div>
            )}

            {/* 保存先プロジェクト選択 (config 段階で必ず決める) */}
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">保存先プロジェクト</span>
              <select
                value={target}
                onChange={e => setTarget(e.target.value)}
                className="w-full h-9 px-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value={NEW_PROJECT} disabled={!canCreateNew}>
                  ＋ 新規プロジェクトとして作成
                </option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.id === mostFrequentProjectId ? "⭐ " : ""}既存マップに追加: {p.title}
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
              {mostFrequentProjectId && target === mostFrequentProjectId && (
                <p className="rounded-md border border-primary/30 bg-primary/[0.04] px-2 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
                  ⭐ 選択したメモの多くが「
                  {projects.find(p => p.id === mostFrequentProjectId)?.title}
                  」に紐付いているため、自動選択しました
                </p>
              )}
              <p className="text-[11px] text-muted-foreground/80">
                ※ 確定すると、{sourceCountLabel}がこのプロジェクトに紐付け直されます。
              </p>
            </div>

            {inputMode !== "conversation" && (
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
            )}
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
            {inputMode === "conversation" && (heldItems.length > 0 || excludedItems.length > 0) && (
              <div className="grid gap-2 sm:grid-cols-2">
                {heldItems.length > 0 && (
                  <div className="rounded-lg border border-sky-500/40 bg-sky-500/10 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-sky-800 dark:text-sky-200">
                        保留候補 {heldItems.length}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-[11px]"
                        onClick={excludeAllHeldItems}
                      >
                        全部除外
                      </Button>
                    </div>
                    <div className="mt-2 space-y-2">
                      {heldItems.map(item => renderTriageItem(item, "held"))}
                    </div>
                  </div>
                )}
                {excludedItems.length > 0 && (
                  <details className="rounded-lg border bg-muted/30 p-3" open={heldItems.length === 0}>
                    <summary className="cursor-pointer text-sm font-semibold text-muted-foreground">
                      除外候補 {excludedItems.length}
                    </summary>
                    <div className="mt-2 space-y-2">
                      {excludedItems.map(item => renderTriageItem(item, "excluded"))}
                    </div>
                  </details>
                )}
              </div>
            )}
            {renameSuggestions.length > 0 && (
              <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-200">
                  <AlertTriangle className="h-4 w-4" />
                  既存ノード名の変更案
                </div>
                <div className="mt-2 space-y-2">
                  {renameSuggestions.map(suggestion => {
                    const selected = selectedRenameTaskIds.has(suggestion.taskId)
                    return (
                      <div key={suggestion.taskId} className="rounded-md border border-amber-500/30 bg-background/70 p-2">
                        <div className="space-y-1 text-xs">
                          <div className="text-muted-foreground">現在: {suggestion.currentTitle}</div>
                          <div className="font-medium">変更案: {suggestion.suggestedTitle}</div>
                          <div className="leading-relaxed text-muted-foreground">{suggestion.reason}</div>
                        </div>
                        <div className="mt-2 flex justify-end">
                          <Button
                            type="button"
                            variant={selected ? "default" : "outline"}
                            size="sm"
                            className="h-8 text-xs"
                            onClick={() => toggleRenameSuggestion(suggestion.taskId)}
                          >
                            {selected ? "この名前変更を適用する" : "適用しない"}
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
            <div className="min-h-[280px] flex-1 overflow-auto rounded-lg border border-dashed bg-muted/30 p-3">
              {rootNodes.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  ノードがありません
                </p>
              ) : (
                <div className="flex min-w-max flex-col gap-3">
                  {rootNodes.map(node => renderNodeEditor(node))}
                </div>
              )}
            </div>
            {depthViolations.length > 0 && (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
                追加ノードは最大{MAX_MINDMAP_DRAFT_DEPTH}層までです。深すぎるノードが{depthViolations.length}件あります。
              </p>
            )}
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">保存先プロジェクト</span>
              <select
                value={target}
                onChange={e => handlePreviewTargetChange(e.target.value)}
                className="w-full h-9 px-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value={NEW_PROJECT} disabled={!canCreateNew}>
                  ＋ 新規プロジェクトとして作成
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
              <p className="rounded-md border border-primary/30 bg-primary/[0.04] px-2 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
                確定すると、{sourceCountLabel}は
                {target === NEW_PROJECT
                  ? '新しく作成されるプロジェクト'
                  : `既存プロジェクト「${projects.find(p => p.id === target)?.title ?? '...'}」`}
                {' '}に紐付けられ、メモ側の所属も上書きされます。
              </p>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}

        <DialogFooter>
          {step === "config" && (
            <>
              <Button variant="ghost" onClick={handleClose}>キャンセル</Button>
              <Button onClick={handleGenerate} disabled={!canGenerate}>
                <Sparkles className="w-4 h-4 mr-1" />
                生成
              </Button>
            </>
          )}
          {step === "preview" && (
            <>
              <Button variant="ghost" onClick={() => setStep("config")}>戻る</Button>
              <Button onClick={handleCommit} disabled={newProjectInvalid || nodes.length === 0 || depthViolations.length > 0}>
                確定して反映
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
