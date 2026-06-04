"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Calendar, Check, ChevronDown, Clock, Copy, Download, ImagePlus, Loader2, Minus, Network, Plus, Search, Sparkles, Terminal, Trash2, CheckCircle2, Wifi } from "lucide-react"
import QRCode from "react-qr-code"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { IdealGoalWithItems, Project } from "@/types/database"
import { cn } from "@/lib/utils"
import { DEFAULT_PROJECT_COLOR, colorToRgba, getTagColor, normalizeColor } from "@/lib/color-utils"
import Link from "next/link"
import { Settings as SettingsIcon } from "lucide-react"
import { NoteClaudeRunnerPanel } from "@/components/memo/note-claude-runner"
import { useMemoAiTasks } from "@/hooks/useMemoAiTasks"
import { useIsMobile } from "@/hooks/useIsMobile"

const QUICK_MINUTES = [30, 45, 60, 90]

type StructuredMemoItem = {
  id: string
  source_type: "wishlist" | "note"
  source_id: string
  parent_item_id: string | null
  project_id: string | null
  title: string
  body: string | null
  item_kind: string
  status: string
  confidence: number | null
  order_index: number
  metadata: Record<string, unknown> | null
  memo_node_links?: Array<{
    id: string
    task_id: string | null
    link_type: string
    status: string
  }>
}

type PlacementMode = "root" | "create_child" | "create_sibling" | "link_existing"

type PlacementCandidate = {
  task_id: string
  parent_task_id: string | null
  title: string
  path: string
  is_group: boolean
  score: number
  mode_hint: PlacementMode
  reason: string
}

type PlacementState = {
  candidates: PlacementCandidate[]
  selected: {
    mode: PlacementMode
    task_id: string | null
    project_id: string | null
  }
  isLoading: boolean
}

interface MemoImage {
  id: string
  file_name: string
  file_url: string
  file_type: string
  file_size: number
}

interface WishlistCardDetailProps {
  item: IdealGoalWithItems | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpdate: (id: string, updates: Record<string, unknown>) => Promise<void>
  onCalendarAdd: (item: IdealGoalWithItems) => Promise<void>
  onSaved?: () => void
  isPersisting?: boolean
  tagOptions: string[]
  projects?: Project[]
  tagColors?: Record<string, string>
  onLaunchClaude?: (item: IdealGoalWithItems) => Promise<void>
  onLaunchCodex?: (item: IdealGoalWithItems) => Promise<void>
  onCopyCodexPrompt?: (item: IdealGoalWithItems) => Promise<void>
  /** Codex.app を Mac で起動（codex:// URL 経由）。スマホからも呼べる */
  onLaunchCodexApp?: (item: IdealGoalWithItems) => Promise<void>
  /** GLM対話のツールがメモを更新/新規作成したとき呼ばれる（一覧リフレッシュ用）*/
  onMemoChanged?: () => void
}

function linkify(text: string) {
  const parts = text.split(/(https?:\/\/[^\s)）]+)/g)
  return parts.map((part, index) => {
    if (/^https?:\/\//.test(part)) {
      return (
        <a
          key={`${part}-${index}`}
          href={part}
          target="_blank"
          rel="noreferrer"
          className="text-blue-400 underline underline-offset-2"
        >
          {part}
        </a>
      )
    }
    return <span key={`${part}-${index}`}>{part}</span>
  })
}

function formatDateValue(value: string | null | undefined) {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-")
}

function formatTimeValue(value: string | null | undefined) {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
}

function buildDateOptions(selectedValue: string) {
  const formatter = new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
  })
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const options = Array.from({ length: 21 }, (_, index) => {
    const date = new Date(today)
    date.setDate(today.getDate() + index)
    const value = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ].join("-")
    const prefix = index === 0 ? "今日" : index === 1 ? "明日" : index === 2 ? "明後日" : ""
    return {
      value,
      label: prefix ? `${prefix} ${formatter.format(date)}` : formatter.format(date),
    }
  })
  if (selectedValue && !options.some(option => option.value === selectedValue)) {
    const date = new Date(`${selectedValue}T00:00:00`)
    options.unshift({
      value: selectedValue,
      label: Number.isNaN(date.getTime()) ? selectedValue : formatter.format(date),
    })
  }
  return options
}

function buildTimeOptions(selectedValue: string) {
  const options = Array.from({ length: 96 }, (_, index) => {
    const minutes = index * 15
    const hour = Math.floor(minutes / 60)
    const minute = minutes % 60
    const value = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
    return { value, label: value }
  })
  if (selectedValue && !options.some(option => option.value === selectedValue)) {
    options.unshift({ value: selectedValue, label: selectedValue })
  }
  return options
}

function combineDateTime(dateValue: string, timeValue: string) {
  if (!dateValue) return null
  const [year, month, day] = dateValue.split("-").map(Number)
  const [hour = 9, minute = 0] = (timeValue || "09:00").split(":").map(Number)
  const date = new Date(year, month - 1, day, hour, minute)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

function getActiveMindmapLink(item: StructuredMemoItem) {
  return item.memo_node_links?.find(link => link.link_type === "mindmap_node" && link.status === "active") ?? null
}

function getActionType(item: StructuredMemoItem): "execution" | "research" | "decision" {
  const actionType = item.metadata?.action_type
  if (actionType === "research" || actionType === "decision" || actionType === "execution") return actionType
  if (item.item_kind === "reference" || item.item_kind === "question") return "research"
  if (item.item_kind === "decision") return "decision"
  return "execution"
}

function getActionLabel(actionType: "execution" | "research" | "decision") {
  switch (actionType) {
    case "research": return "リサーチ"
    case "decision": return "判断"
    default: return "実行"
  }
}

function getActionClassName(actionType: "execution" | "research" | "decision") {
  switch (actionType) {
    case "research": return "border-blue-500/35 bg-blue-500/10 text-blue-700 dark:text-blue-300"
    case "decision": return "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300"
    default: return "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
  }
}

function getStatusLabel(status: string) {
  switch (status) {
    case "inbox": return "未整理"
    case "organized": return "分解済み"
    case "task_candidate": return "TODO候補"
    case "task": return "TODO化"
    case "scheduled": return "予定化"
    case "done": return "完了"
    case "dismissed": return "保留"
    default: return status
  }
}

function placementValue(placement: PlacementState | null) {
  return placement?.selected.task_id ? `${placement.selected.mode}:${placement.selected.task_id}` : placement?.selected.mode ?? "root"
}

function placementLabel(placement: PlacementState | null) {
  const selected = placement?.selected
  if (!selected || selected.mode === "root") return "新しい枝にする"
  const candidate = placement?.candidates.find(item => item.task_id === selected.task_id)
  if (selected.mode === "link_existing") return candidate ? `既存に紐付け: ${candidate.path}` : "既存に紐付け"
  if (selected.mode === "create_sibling") return candidate ? `同じ階層に追加: ${candidate.path}` : "同じ階層に追加"
  return candidate ? `子として追加: ${candidate.path}` : "子として追加"
}

function StructuredMemoMindmap({
  items,
  linkingItemId,
  researchingItemId,
  researchPrompts,
  placementByItemId,
  projects,
  onPlacementChange,
  onPlacementProjectChange,
  onLink,
  onResearch,
}: {
  items: StructuredMemoItem[]
  linkingItemId: string | null
  researchingItemId: string | null
  researchPrompts: Record<string, string>
  placementByItemId: Record<string, PlacementState>
  projects: Project[]
  onPlacementChange: (itemId: string, value: string) => void
  onPlacementProjectChange: (itemId: string, projectId: string) => void
  onLink: (item: StructuredMemoItem) => Promise<void>
  onResearch: (item: StructuredMemoItem) => Promise<void>
}) {
  const childrenByParent = useMemo(() => {
    const map = new Map<string | null, StructuredMemoItem[]>()
    for (const structuredItem of items) {
      const key = structuredItem.parent_item_id ?? null
      map.set(key, [...(map.get(key) ?? []), structuredItem])
    }
    return map
  }, [items])
  const roots = childrenByParent.get(null) ?? []

  return (
    <div className="overflow-x-auto rounded-lg border bg-muted/20 p-3">
      <div className="flex min-w-max items-center gap-3">
        <StructuredMemoSourceRoot count={items.length} />
        {roots.length > 0 && (
          <div className="flex items-center gap-2">
            <div className="h-px w-5 shrink-0 bg-border" />
            <div className="relative flex flex-col gap-3 pl-4 before:absolute before:bottom-5 before:left-0 before:top-5 before:w-px before:bg-border">
              {roots.map(root => (
                <div
                  key={root.id}
                  className="relative before:absolute before:left-[-1rem] before:top-1/2 before:h-px before:w-4 before:bg-border"
                >
                  <StructuredMemoMindmapNode
                    item={root}
                    childrenByParent={childrenByParent}
                    depth={0}
                    parentLinked
                    linkingItemId={linkingItemId}
                    researchingItemId={researchingItemId}
                    researchPrompts={researchPrompts}
                    placementByItemId={placementByItemId}
                    projects={projects}
                    onPlacementChange={onPlacementChange}
                    onPlacementProjectChange={onPlacementProjectChange}
                    onLink={onLink}
                    onResearch={onResearch}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function StructuredMemoSourceRoot({ count }: { count: number }) {
  return (
    <div className="flex w-36 shrink-0 flex-col gap-1 rounded-lg border border-primary/35 bg-primary/[0.06] p-2.5 shadow-sm">
      <div className="flex items-center gap-1.5 text-xs font-medium">
        <Network className="h-3.5 w-3.5 text-primary" />
        元メモ
      </div>
      <div className="text-[11px] leading-4 text-muted-foreground">
        分解 {count} 項目
      </div>
    </div>
  )
}

function StructuredMemoMindmapNode({
  item,
  childrenByParent,
  depth,
  parentLinked,
  linkingItemId,
  researchingItemId,
  researchPrompts,
  placementByItemId,
  projects,
  onPlacementChange,
  onPlacementProjectChange,
  onLink,
  onResearch,
}: {
  item: StructuredMemoItem
  childrenByParent: Map<string | null, StructuredMemoItem[]>
  depth: number
  parentLinked: boolean
  linkingItemId: string | null
  researchingItemId: string | null
  researchPrompts: Record<string, string>
  placementByItemId: Record<string, PlacementState>
  projects: Project[]
  onPlacementChange: (itemId: string, value: string) => void
  onPlacementProjectChange: (itemId: string, projectId: string) => void
  onLink: (item: StructuredMemoItem) => Promise<void>
  onResearch: (item: StructuredMemoItem) => Promise<void>
}) {
  const activeLink = getActiveMindmapLink(item)
  const children = childrenByParent.get(item.id) ?? []

  return (
    <div className="flex items-center gap-3">
      <StructuredMemoNodeCard
        item={item}
        depth={depth}
        parentLinked={parentLinked}
        isLinking={linkingItemId === item.id}
        isResearching={researchingItemId === item.id}
        researchPrompt={researchPrompts[item.id] ?? null}
        placement={placementByItemId[item.id] ?? null}
        projects={projects}
        onPlacementChange={onPlacementChange}
        onPlacementProjectChange={onPlacementProjectChange}
        onLink={onLink}
        onResearch={onResearch}
      />
      {children.length > 0 && (
        <div className="flex items-center gap-2">
          <div className="h-px w-5 shrink-0 bg-border" />
          <div className="relative flex flex-col gap-3 pl-4 before:absolute before:bottom-5 before:left-0 before:top-5 before:w-px before:bg-border">
            {children.map(child => (
              <div
                key={child.id}
                className="relative before:absolute before:left-[-1rem] before:top-1/2 before:h-px before:w-4 before:bg-border"
              >
                <StructuredMemoMindmapNode
                  item={child}
                  childrenByParent={childrenByParent}
                  depth={depth + 1}
                  parentLinked={!!activeLink}
                  linkingItemId={linkingItemId}
                  researchingItemId={researchingItemId}
                  researchPrompts={researchPrompts}
                  placementByItemId={placementByItemId}
                  projects={projects}
                  onPlacementChange={onPlacementChange}
                  onPlacementProjectChange={onPlacementProjectChange}
                  onLink={onLink}
                  onResearch={onResearch}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function StructuredMemoNodeCard({
  item,
  depth,
  parentLinked,
  isLinking,
  isResearching,
  researchPrompt,
  placement,
  projects,
  onPlacementChange,
  onPlacementProjectChange,
  onLink,
  onResearch,
}: {
  item: StructuredMemoItem
  depth: number
  parentLinked: boolean
  isLinking: boolean
  isResearching: boolean
  researchPrompt: string | null
  placement: PlacementState | null
  projects: Project[]
  onPlacementChange: (itemId: string, value: string) => void
  onPlacementProjectChange: (itemId: string, projectId: string) => void
  onLink: (item: StructuredMemoItem) => Promise<void>
  onResearch: (item: StructuredMemoItem) => Promise<void>
}) {
  const activeLink = getActiveMindmapLink(item)
  const actionType = getActionType(item)
  const isMobile = useIsMobile()
  const [placementSheetOpen, setPlacementSheetOpen] = useState(false)
  const [placementSearch, setPlacementSearch] = useState("")
  const confidenceLabel = typeof item.confidence === "number"
    ? `${Math.round(item.confidence * 100)}%`
    : null
  const canChoosePlacement = depth === 0
  const canLink = !activeLink && !isLinking && (depth === 0 || parentLinked)
  const linkTitle = depth > 0 && !parentLinked ? "先に親項目をマップへ投入してください" : undefined
  const currentPlacementValue = placementValue(placement)
  const selectedProjectId = placement?.selected.project_id ?? item.project_id ?? null
  const selectedProject = selectedProjectId ? projects.find(project => project.id === selectedProjectId) ?? null : null
  const projectOptions = useMemo(() => {
    const seen = new Set<string>()
    return [
      ...(selectedProject ? [selectedProject] : []),
      ...projects,
    ].filter(project => {
      if (seen.has(project.id)) return false
      seen.add(project.id)
      return true
    }).slice(0, 8)
  }, [projects, selectedProject])
  const filteredCandidates = useMemo(() => {
    const query = placementSearch.trim().normalize("NFKC").toLowerCase()
    const candidates = placement?.candidates ?? []
    if (!query) return candidates
    return candidates.filter(candidate => {
      const haystack = `${candidate.title} ${candidate.path} ${candidate.reason}`.normalize("NFKC").toLowerCase()
      return haystack.includes(query)
    })
  }, [placement?.candidates, placementSearch])
  const placementOptions = [
    { value: "root", label: "新しい枝にする" },
    ...(placement?.candidates ?? []).map(candidate => ({
      value: `create_child:${candidate.task_id}`,
      label: `この下に追加: ${candidate.path}`,
    })),
    ...(placement?.candidates ?? []).map(candidate => ({
      value: `create_sibling:${candidate.task_id}`,
      label: `同じ階層に追加: ${candidate.path}`,
    })),
    ...(placement?.candidates ?? []).map(candidate => ({
      value: `link_existing:${candidate.task_id}`,
      label: `既存に紐付け: ${candidate.path}`,
    })),
  ]
  const handlePlacementSelect = (value: string) => {
    onPlacementChange(item.id, value)
    setPlacementSheetOpen(false)
  }
  const placementActionClassName = (value: string) => cn(
    "inline-flex min-h-8 items-center rounded-md border px-2.5 py-1 text-xs",
    value === currentPlacementValue
      ? "border-primary bg-primary/10 text-primary"
      : "bg-background text-muted-foreground",
  )

  return (
    <div
      className={cn(
        "w-[min(21rem,calc(100vw-3rem))] shrink-0 rounded-lg border bg-background p-2.5 shadow-sm",
        depth === 0 ? "border-primary/30 bg-primary/[0.03]" : "bg-muted/10",
        activeLink && "border-emerald-500/35 bg-emerald-500/[0.04]",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={cn("rounded-full border px-2 py-0.5 text-[10px]", getActionClassName(actionType))}>
              {getActionLabel(actionType)}
            </span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
              {getStatusLabel(item.status)}
            </span>
            {confidenceLabel && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                {confidenceLabel}
              </span>
            )}
            {activeLink && (
              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-300">
                マップ投入済み
              </span>
            )}
          </div>
          <div className={cn("break-words font-medium leading-5", depth === 0 ? "text-sm" : "text-xs")}>
            {item.title}
          </div>
          {item.body && (
            <p className={cn("break-words leading-5 text-muted-foreground", depth === 0 ? "text-xs" : "text-[11px]")}>
              {item.body}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={isResearching}
            onClick={() => void onResearch(item)}
            className="h-8 w-8"
            title="リサーチプロンプトを作成"
            aria-label="リサーチプロンプトを作成"
          >
            {isResearching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          </Button>
          <Button
            type="button"
            variant={activeLink ? "secondary" : "outline"}
            size="sm"
            disabled={!canLink}
            onClick={() => void onLink(item)}
            className="h-8 px-2 text-xs"
            title={linkTitle}
          >
            {isLinking ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : activeLink ? (
              <Check className="mr-1 h-3 w-3" />
            ) : (
              <Plus className="mr-1 h-3 w-3" />
            )}
            {activeLink ? "済" : depth === 0 ? "マップ" : parentLinked ? "投入" : "親先"}
          </Button>
        </div>
      </div>

      {canChoosePlacement && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-[10px] text-muted-foreground">配置</span>
          {isMobile ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!!activeLink || placement?.isLoading}
                onClick={() => setPlacementSheetOpen(true)}
                className="h-8 min-w-0 flex-1 justify-start px-2 text-xs"
              >
                <span className="truncate">{placementLabel(placement)}</span>
              </Button>
              <Sheet open={placementSheetOpen} onOpenChange={setPlacementSheetOpen}>
                <SheetContent side="bottom" className="max-h-[82vh] overflow-y-auto rounded-t-3xl p-0">
                  <SheetHeader className="border-b px-4 py-3">
                    <SheetTitle className="text-left text-base">配置を変更</SheetTitle>
                  </SheetHeader>
                  <div className="space-y-4 p-4">
                    {projectOptions.length > 0 && (
                      <div className="space-y-2">
                        <div className="text-[11px] font-medium text-muted-foreground">プロジェクト</div>
                        <div className="flex gap-2 overflow-x-auto pb-1">
                          {projectOptions.map(project => (
                            <button
                              key={project.id}
                              type="button"
                              onClick={() => onPlacementProjectChange(item.id, project.id)}
                              className={cn(
                                "shrink-0 rounded-full border px-3 py-1.5 text-xs",
                                project.id === selectedProjectId
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "bg-background text-muted-foreground",
                              )}
                            >
                              {project.title}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => handlePlacementSelect("root")}
                      className={cn(
                        "flex w-full items-start gap-2 rounded-lg border px-3 py-3 text-left text-sm",
                        currentPlacementValue === "root" ? "border-primary bg-primary/10" : "bg-background",
                      )}
                    >
                      {currentPlacementValue === "root" ? (
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      ) : (
                        <span className="mt-0.5 h-4 w-4 shrink-0 rounded-full border" />
                      )}
                      <span className="min-w-0 break-words leading-5">新しい枝にする</span>
                    </button>

                    <div className="space-y-2">
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          value={placementSearch}
                          onChange={event => setPlacementSearch(event.target.value)}
                          placeholder="ノードを検索"
                          className="h-10 pl-9 text-sm"
                        />
                      </div>

                      {placement?.isLoading ? (
                        <div className="flex min-h-24 items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground">
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          候補を取得中
                        </div>
                      ) : filteredCandidates.length === 0 ? (
                        <div className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
                          候補ノードはありません
                        </div>
                      ) : filteredCandidates.map(candidate => (
                        <div key={candidate.task_id} className="space-y-2 rounded-lg border bg-background p-3">
                          <div className="min-w-0">
                            <div className="break-words text-sm font-medium">{candidate.title}</div>
                            <div className="mt-1 break-words text-[11px] leading-4 text-muted-foreground">{candidate.path}</div>
                            {candidate.reason && (
                              <div className="mt-1 break-words text-[11px] leading-4 text-muted-foreground">{candidate.reason}</div>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => handlePlacementSelect(`create_child:${candidate.task_id}`)}
                              className={placementActionClassName(`create_child:${candidate.task_id}`)}
                            >
                              この下に追加
                            </button>
                            <button
                              type="button"
                              onClick={() => handlePlacementSelect(`create_sibling:${candidate.task_id}`)}
                              className={placementActionClassName(`create_sibling:${candidate.task_id}`)}
                            >
                              同じ階層
                            </button>
                            <button
                              type="button"
                              onClick={() => handlePlacementSelect(`link_existing:${candidate.task_id}`)}
                              className={placementActionClassName(`link_existing:${candidate.task_id}`)}
                            >
                              既存に紐付け
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                  </div>
                </SheetContent>
              </Sheet>
            </>
          ) : (
            <select
              value={currentPlacementValue}
              onChange={event => onPlacementChange(item.id, event.target.value)}
              disabled={!!activeLink || placement?.isLoading}
              className="h-7 min-w-0 max-w-full flex-1 rounded-md border bg-background px-2 text-[11px] text-muted-foreground outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
            >
              {placementOptions.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          )}
          {placement?.isLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        </div>
      )}

      {researchPrompt && (
        <details className="mt-2 rounded-md border bg-muted/30 p-2">
          <summary className="cursor-pointer text-[10px] font-medium text-muted-foreground">
            リサーチプロンプト
          </summary>
          <div className="mt-1 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => navigator.clipboard?.writeText(researchPrompt).catch(() => {})}
              className="text-[10px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              コピー
            </button>
          </div>
          <pre className="max-h-28 whitespace-pre-wrap break-words text-[11px] leading-5 text-muted-foreground">{researchPrompt}</pre>
        </details>
      )}
    </div>
  )
}

export function WishlistCardDetail({
  item,
  open,
  onOpenChange,
  onUpdate,
  onCalendarAdd,
  onSaved,
  isPersisting = false,
  tagOptions,
  projects = [],
  tagColors = {},
  onLaunchClaude,
  onLaunchCodex,
  onCopyCodexPrompt,
  onLaunchCodexApp,
  onMemoChanged,
}: WishlistCardDetailProps) {
  const [isAddingCalendar, setIsAddingCalendar] = useState(false)
  const [isSavingMemo, setIsSavingMemo] = useState(false)
  const [isLaunchingClaude, setIsLaunchingClaude] = useState(false)
  const [isLaunchingCodex, setIsLaunchingCodex] = useState(false)
  const [isCopyingCodexPrompt, setIsCopyingCodexPrompt] = useState(false)
  const [launchError, setLaunchError] = useState<string | null>(null)
  const [launchStep, setLaunchStep] = useState<null | 'sending' | 'sent' | 'connected' | 'completed'>(null)
  const [launchExecutor, setLaunchExecutor] = useState<'claude' | 'codex' | 'codex_app' | null>(null)
  const [isCodexPanelOpen, setIsCodexPanelOpen] = useState(false)
  const [activeDetailPanel, setActiveDetailPanel] = useState<"tags" | "images" | null>(null)
  const [copiedUrl, setCopiedUrl] = useState(false)
  const [elapsedSecs, setElapsedSecs] = useState(0)
  const sentAtRef = useRef<number | null>(null)
  const { getBySourceId: getMemoAiTask } = useMemoAiTasks()
  const [isUploadingImage, setIsUploadingImage] = useState(false)
  const [deletingImageId, setDeletingImageId] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState("")
  const [draftDescription, setDraftDescription] = useState("")
  const [newSubItem, setNewSubItem] = useState("")
  const [tagText, setTagText] = useState("")
  const [images, setImages] = useState<MemoImage[]>([])
  const [structuredItems, setStructuredItems] = useState<StructuredMemoItem[]>([])
  const [isLoadingStructure, setIsLoadingStructure] = useState(false)
  const [isStructuringMemo, setIsStructuringMemo] = useState(false)
  const [structureError, setStructureError] = useState<string | null>(null)
  const [structureFeedback, setStructureFeedback] = useState("")
  const [linkingItemId, setLinkingItemId] = useState<string | null>(null)
  const [researchingItemId, setResearchingItemId] = useState<string | null>(null)
  const [researchPrompts, setResearchPrompts] = useState<Record<string, string>>({})
  const [placementByItemId, setPlacementByItemId] = useState<Record<string, PlacementState>>({})
  const fileInputRef = useRef<HTMLInputElement>(null)
  const draftSourceIdRef = useRef<string | null>(null)
  const isMobile = useIsMobile()

  const tags = useMemo(() => item?.tags ?? [], [item?.tags])
  const selectedTags = useMemo(() => {
    return Array.from(new Set(
      [item?.category, ...(item?.tags ?? [])]
        .filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0),
    ))
  }, [item?.category, item?.tags])
  const categoryOptions = useMemo(() => {
    const set = new Set<string>(tagOptions)
    if (item?.category) set.add(item.category)
    for (const tag of item?.tags ?? []) set.add(tag)
    return [...set].slice(0, 12)
  }, [item?.category, item?.tags, tagOptions])
  const tagSuggestions = useMemo(() => {
    return categoryOptions.filter(tag => !selectedTags.includes(tag))
  }, [categoryOptions, selectedTags])

  const loadImages = useCallback(async () => {
    if (!item?.id || !open) return
    const res = await fetch(`/api/wishlist/${item.id}/attachments`)
    if (!res.ok) return
    const { attachments } = await res.json()
    setImages((attachments ?? []).filter((attachment: MemoImage) => attachment.file_type?.startsWith("image/")))
  }, [item?.id, open])

  const loadStructuredItems = useCallback(async () => {
    if (!item?.id || !open) return
    setIsLoadingStructure(true)
    setStructureError(null)
    try {
      const res = await fetch(`/api/memo-items?source_type=wishlist&source_id=${encodeURIComponent(item.id)}`, {
        cache: "no-store",
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "構造化項目の取得に失敗しました")
      const items = Array.isArray(data.items) ? data.items as StructuredMemoItem[] : []
      setStructuredItems(items)
      const prompts: Record<string, string> = {}
      for (const structuredItem of items) {
        const prompt = structuredItem.metadata?.research_prompt
        if (typeof prompt === "string") prompts[structuredItem.id] = prompt
      }
      setResearchPrompts(prompts)
      setPlacementByItemId(prev => {
        const next: Record<string, PlacementState> = {}
        for (const structuredItem of items) {
          if (prev[structuredItem.id]) next[structuredItem.id] = prev[structuredItem.id]
        }
        return next
      })
    } catch (err) {
      setStructureError(err instanceof Error ? err.message : "構造化項目の取得に失敗しました")
    } finally {
      setIsLoadingStructure(false)
    }
  }, [item?.id, open])

  const loadPlacementCandidates = useCallback(async (items: StructuredMemoItem[]) => {
    const activeItems = items.filter(structuredItem => !getActiveMindmapLink(structuredItem))
    if (activeItems.length === 0) return

    setPlacementByItemId(prev => {
      const next = { ...prev }
      for (const structuredItem of activeItems) {
        const projectId = structuredItem.project_id ?? item?.project_id ?? null
        if (!next[structuredItem.id]) {
          next[structuredItem.id] = {
            candidates: [],
            selected: { mode: "root", task_id: null, project_id: projectId },
            isLoading: true,
          }
        } else {
          next[structuredItem.id] = { ...next[structuredItem.id], isLoading: true }
        }
      }
      return next
    })

    await Promise.all(activeItems.map(async structuredItem => {
      try {
        const projectId = structuredItem.project_id ?? item?.project_id ?? null
        const url = projectId
          ? `/api/memo-items/${structuredItem.id}/placement-candidates?project_id=${encodeURIComponent(projectId)}`
          : `/api/memo-items/${structuredItem.id}/placement-candidates`
        const res = await fetch(url, { cache: "no-store" })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.error || "配置候補の取得に失敗しました")
        const candidates = Array.isArray(data.candidates) ? data.candidates as PlacementCandidate[] : []
        const recommended = data.recommended && typeof data.recommended === "object"
          ? data.recommended as { mode?: PlacementMode; task_id?: string | null }
          : null
        setPlacementByItemId(prev => ({
          ...prev,
          [structuredItem.id]: {
            candidates,
            selected: {
              mode: recommended?.mode ?? (candidates[0] ? "create_child" : "root"),
              task_id: recommended?.task_id ?? candidates[0]?.task_id ?? null,
              project_id: projectId,
            },
            isLoading: false,
          },
        }))
      } catch {
        setPlacementByItemId(prev => ({
          ...prev,
          [structuredItem.id]: {
            candidates: prev[structuredItem.id]?.candidates ?? [],
            selected: prev[structuredItem.id]?.selected ?? { mode: "root", task_id: null, project_id: structuredItem.project_id ?? item?.project_id ?? null },
            isLoading: false,
          },
        }))
      }
    }))
  }, [item?.project_id])

  const itemId = item?.id ?? null
  const itemTitle = item?.title ?? ""
  const itemDescription = item?.description ?? ""

  useEffect(() => {
    if (!open || !itemId) {
      draftSourceIdRef.current = null
      return
    }
    if (draftSourceIdRef.current === itemId) return

    draftSourceIdRef.current = itemId
    setDraftTitle(itemTitle)
    setDraftDescription(itemDescription)
    setSaveError(null)
    setActiveDetailPanel(null)
    setIsCodexPanelOpen(false)
  }, [itemId, itemTitle, itemDescription, open])

  useEffect(() => {
    loadImages()
  }, [loadImages])

  useEffect(() => {
    loadStructuredItems()
  }, [loadStructuredItems])

  useEffect(() => {
    if (!open || structuredItems.length === 0) return
    loadPlacementCandidates(structuredItems)
  }, [loadPlacementCandidates, open, structuredItems])

  // aiTask の状態変化を launchStep に反映 + 完了時に自動クローズ
  useEffect(() => {
    if (!item) return
    const aiTask = getMemoAiTask(item.id)
    if (!aiTask || launchStep === null) return
    if (aiTask.remote_session_url && launchStep === 'sent') {
      setLaunchStep('connected')
    }
    if ((aiTask.executor === 'codex' || aiTask.executor === 'codex_app') && launchStep === 'sent') {
      const result = aiTask.result && typeof aiTask.result === 'object' && !Array.isArray(aiTask.result)
        ? aiTask.result as Record<string, unknown>
        : {}
      if (aiTask.status === 'running' || result.codex_run_state === 'prompt_waiting') {
        setLaunchStep('connected')
      }
    }
    if (aiTask.status === 'completed' && launchStep !== 'completed') {
      setLaunchStep('completed')
      setTimeout(() => {
        onOpenChange(false)
        setLaunchStep(null)
      }, 2500)
    }
  }, [getMemoAiTask, item, launchStep, onOpenChange])

  // 接続待ち中の経過秒数カウンター
  useEffect(() => {
    if (launchStep !== 'sent') {
      sentAtRef.current = null
      setElapsedSecs(0)
      return
    }
    if (!sentAtRef.current) sentAtRef.current = Date.now()
    const id = setInterval(() => {
      setElapsedSecs(Math.floor((Date.now() - sentAtRef.current!) / 1000))
    }, 1000)
    return () => clearInterval(id)
  }, [launchStep])

  if (!item) return null

  const dateValue = formatDateValue(item.scheduled_at)
  const timeValue = formatTimeValue(item.scheduled_at)
  const dateOptions = buildDateOptions(dateValue)
  const timeOptions = buildTimeOptions(timeValue)
  const showStructureTools = false

  const update = (updates: Record<string, unknown>) => onUpdate(item.id, updates)
  const selectedProject = item.project_id ? projects.find(project => project.id === item.project_id) : null
  const selectedProjectColor = selectedProject ? normalizeColor(selectedProject.color_theme, DEFAULT_PROJECT_COLOR) : DEFAULT_PROJECT_COLOR

  const changeDuration = async (delta: number) => {
    const current = item.duration_minutes ?? 60
    await update({ duration_minutes: Math.max(15, current + delta) })
  }

  const handleScheduleChange = async (nextDateValue: string, nextTimeValue: string) => {
    const scheduledAt = combineDateTime(nextDateValue, nextTimeValue)
    await update({
      scheduled_at: scheduledAt,
      memo_status: scheduledAt ? "time_candidates" : item.memo_status,
    })
  }

  const handleAddCalendar = async () => {
    if (!item.scheduled_at || !item.duration_minutes) {
      alert("日時と所要時間を入力してからカレンダーに追加してください。")
      return
    }
    if (!window.confirm("このメモをGoogleカレンダーに登録しますか？")) return
    setIsAddingCalendar(true)
    try {
      await onCalendarAdd(item)
      await update({ memo_status: "scheduled" })
    } finally {
      setIsAddingCalendar(false)
    }
  }

  const handleSaveMemo = async () => {
    const title = draftTitle.trim()
    if (!title) {
      setSaveError("見出しを入力してください")
      return
    }

    setIsSavingMemo(true)
    setSaveError(null)
    try {
      await update({
        title,
        description: draftDescription.trim() || null,
        memo_status: item.memo_status ?? "unsorted",
      })
      onSaved?.()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "メモの保存に失敗しました")
    } finally {
      setIsSavingMemo(false)
    }
  }

  const handleAddSubItem = async () => {
    if (!newSubItem.trim()) return
    await fetch(`/api/wishlist/${item.id}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newSubItem.trim() }),
    })
    setNewSubItem("")
    await update({})
  }

  const handleStructureMemo = async (mode: "quick" | "deep" = "quick") => {
    const title = draftTitle.trim()
    if (!title) {
      setStructureError("構造化する前にメモの見出しを入力してください")
      return
    }

    setIsStructuringMemo(true)
    setStructureError(null)
    try {
      const description = draftDescription.trim() || null
      if (title !== item.title || description !== (item.description ?? null)) {
        await update({
          title,
          description,
          memo_status: item.memo_status ?? "unsorted",
        })
        onSaved?.()
      }

      const res = await fetch("/api/ai/memo-structure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_type: "wishlist",
          source_id: item.id,
          mode,
          feedback: structureFeedback.trim() || undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "メモの構造化に失敗しました")
      setStructuredItems(Array.isArray(data.items) ? data.items : [])
      setStructureFeedback("")
      onMemoChanged?.()
    } catch (err) {
      setStructureError(err instanceof Error ? err.message : "メモの構造化に失敗しました")
    } finally {
      setIsStructuringMemo(false)
    }
  }

  const handleLinkStructuredItem = async (structuredItem: StructuredMemoItem) => {
    const placementState = placementByItemId[structuredItem.id]
    const placement = placementState?.selected ?? {
      mode: "root" as PlacementMode,
      task_id: null,
      project_id: structuredItem.project_id ?? item.project_id ?? null,
    }
    const targetProjectId = placement.project_id ?? structuredItem.project_id ?? item.project_id

    if (!targetProjectId && placement.mode !== "link_existing") {
      setStructureError("マップに投入するには、先にメモへプロジェクトを設定してください")
      return
    }
    const activeLink = getActiveMindmapLink(structuredItem)
    if (activeLink) {
      setStructureError("この項目はすでにマインドマップへ投入済みです")
      return
    }

    const parent = structuredItem.parent_item_id
      ? structuredItems.find(candidate => candidate.id === structuredItem.parent_item_id)
      : null
    const parentTaskId = parent ? getActiveMindmapLink(parent)?.task_id ?? null : null
    if (structuredItem.parent_item_id && !parentTaskId) {
      setStructureError("子項目をマップへ投入するには、先に親項目を投入してください")
      return
    }
    const placementCandidate = placement.task_id
      ? placementState?.candidates.find(candidate => candidate.task_id === placement.task_id) ?? null
      : null
    const targetTaskId = placement.mode === "link_existing" ? placement.task_id : null
    const targetParentTaskId = placement.mode === "create_child"
      ? placement.task_id
      : placement.mode === "create_sibling"
        ? placementCandidate?.parent_task_id ?? null
        : parentTaskId

    setLinkingItemId(structuredItem.id)
    setStructureError(null)
    try {
      const res = await fetch(`/api/memo-items/${structuredItem.id}/link-task`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: targetProjectId,
          task_id: targetTaskId,
          parent_task_id: targetParentTaskId,
          placement_mode: placement.mode,
          title: structuredItem.title,
          memo: structuredItem.body,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "マップへの投入に失敗しました")
      await loadStructuredItems()
      onMemoChanged?.()
    } catch (err) {
      setStructureError(err instanceof Error ? err.message : "マップへの投入に失敗しました")
    } finally {
      setLinkingItemId(null)
    }
  }

  const handlePlacementChange = (itemId: string, value: string) => {
    const [modeRaw, taskIdRaw] = value.split(":")
    const mode: PlacementMode = modeRaw === "link_existing" || modeRaw === "create_child" || modeRaw === "create_sibling" ? modeRaw : "root"
    setPlacementByItemId(prev => {
      const current = prev[itemId] ?? {
        candidates: [],
        selected: { mode: "root" as PlacementMode, task_id: null, project_id: item?.project_id ?? null },
        isLoading: false,
      }
      return {
        ...prev,
        [itemId]: {
          ...current,
          selected: {
            mode,
            task_id: mode === "root" ? null : taskIdRaw || null,
            project_id: current.selected.project_id,
          },
        },
      }
    })
  }

  const handlePlacementProjectChange = (itemId: string, projectId: string) => {
    setPlacementByItemId(prev => {
      const current = prev[itemId] ?? {
        candidates: [],
        selected: { mode: "root" as PlacementMode, task_id: null, project_id: item?.project_id ?? null },
        isLoading: false,
      }
      return {
        ...prev,
        [itemId]: {
          ...current,
          candidates: [],
          selected: { mode: "root", task_id: null, project_id: projectId },
          isLoading: true,
        },
      }
    })

    void (async () => {
      try {
        const res = await fetch(`/api/memo-items/${itemId}/placement-candidates?project_id=${encodeURIComponent(projectId)}`, { cache: "no-store" })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.error || "配置候補の取得に失敗しました")
        const candidates = Array.isArray(data.candidates) ? data.candidates as PlacementCandidate[] : []
        const recommended = data.recommended && typeof data.recommended === "object"
          ? data.recommended as { mode?: PlacementMode; task_id?: string | null }
          : null
        setPlacementByItemId(prev => ({
          ...prev,
          [itemId]: {
            candidates,
            selected: {
              mode: recommended?.mode ?? (candidates[0] ? "create_child" : "root"),
              task_id: recommended?.task_id ?? candidates[0]?.task_id ?? null,
              project_id: projectId,
            },
            isLoading: false,
          },
        }))
      } catch {
        setPlacementByItemId(prev => ({
          ...prev,
          [itemId]: {
            candidates: [],
            selected: { mode: "root", task_id: null, project_id: projectId },
            isLoading: false,
          },
        }))
      }
    })()
  }

  const handleCreateResearchPrompt = async (structuredItem: StructuredMemoItem) => {
    setResearchingItemId(structuredItem.id)
    setStructureError(null)
    try {
      const res = await fetch(`/api/memo-items/${structuredItem.id}/research-prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "リサーチプロンプトの作成に失敗しました")
      if (typeof data.prompt === "string") {
        setResearchPrompts(prev => ({ ...prev, [structuredItem.id]: data.prompt }))
      }
    } catch (err) {
      setStructureError(err instanceof Error ? err.message : "リサーチプロンプトの作成に失敗しました")
    } finally {
      setResearchingItemId(null)
    }
  }

  const addTagValue = async (value: string) => {
    const tag = value.trim()
    if (!tag || selectedTags.includes(tag)) return
    setTagText("")
    if (!item.category) {
      await update({ category: tag })
    } else {
      await update({ tags: [...tags, tag] })
    }
    setActiveDetailPanel(null)
  }

  const handleAddTag = async () => {
    await addTagValue(tagText)
  }

  const removeTag = async (tag: string) => {
    if (item.category === tag) {
      await update({ category: null })
      return
    }
    await update({ tags: tags.filter(t => t !== tag) })
  }

  const uploadImages = async (files: File[]) => {
    const imageFiles = files.filter(file => file.type.startsWith("image/"))
    if (imageFiles.length === 0) {
      setSaveError("画像ファイルを選択してください")
      return
    }
    setIsUploadingImage(true)
    setSaveError(null)
    try {
      const uploaded: MemoImage[] = []
      for (const file of imageFiles) {
        const formData = new FormData()
        formData.append("file", file)
        const res = await fetch(`/api/wishlist/${item.id}/attachments`, {
          method: "POST",
          body: formData,
        })
        const data = await res.json()
        if (!res.ok || data.error) {
          throw new Error(data.error || "画像の保存に失敗しました")
        }
        if (data.attachment) uploaded.push(data.attachment as MemoImage)
      }
      if (uploaded.length > 0) {
        setImages(prev => [...prev, ...uploaded])
        setActiveDetailPanel(null)
      }
      if (fileInputRef.current) fileInputRef.current.value = ""
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "画像の保存に失敗しました")
    } finally {
      setIsUploadingImage(false)
    }
  }

  const handleImageDelete = async (imageId: string) => {
    setDeletingImageId(imageId)
    try {
      const res = await fetch(`/api/wishlist/${item.id}/attachments/${imageId}`, { method: "DELETE" })
      if (!res.ok) throw new Error("画像の削除に失敗しました")
      setImages(prev => prev.filter(image => image.id !== imageId))
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "画像の削除に失敗しました")
    } finally {
      setDeletingImageId(null)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={cn(
          isMobile
            ? [
                "h-[88dvh] max-h-[88dvh] gap-0 overflow-hidden rounded-t-2xl border-neutral-800 bg-neutral-950 px-0 pb-0 text-neutral-50",
                "shadow-[0_-18px_48px_rgba(0,0,0,0.55)]",
                "[&>button]:right-3 [&>button]:top-3 [&>button]:flex [&>button]:h-11 [&>button]:w-11 [&>button]:items-center [&>button]:justify-center",
                "[&>button]:rounded-full [&>button]:text-neutral-400 [&>button]:opacity-100 [&>button:hover]:bg-white/10 [&>button:hover]:text-neutral-100 [&>button_svg]:h-5 [&>button_svg]:w-5",
              ]
            : "w-full gap-2 overflow-y-auto px-3 sm:max-w-[min(1280px,calc(100vw-32px))] sm:px-6"
        )}
      >
        {isMobile && (
          <div className="flex justify-center pb-0.5 pt-1.5">
            <div className="h-1 w-10 rounded-full bg-white/20" />
          </div>
        )}

        <SheetHeader className={cn(isMobile ? "px-4 pb-2 pt-0" : "px-0 pb-2 pt-4")}>
          <SheetTitle className={cn("text-left", isMobile && "pr-12 text-base text-neutral-50")}>メモを編集</SheetTitle>
        </SheetHeader>

        <div className={cn(
          isMobile
            ? "min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]"
            : "grid gap-4 pb-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(22rem,0.85fr)] xl:items-start"
        )}>
          <div className={cn("min-w-0", isMobile ? "space-y-3" : "space-y-4")}>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(6.25rem,0.44fr)] gap-2">
            <label className="min-w-0 space-y-1">
              <span className="text-xs font-medium text-muted-foreground">見出し</span>
              <Input
                value={draftTitle}
                onChange={e => setDraftTitle(e.target.value)}
                className="h-10 min-w-0 text-sm font-semibold"
              />
            </label>

            <label className="min-w-0 space-y-1">
              <span className="text-xs font-medium text-muted-foreground">プロジェクト</span>
              <div className="relative">
                <select
                  value={item.project_id ?? ""}
                  onChange={e => update({ project_id: e.target.value || null })}
                  className="h-10 w-full appearance-none truncate rounded-md border bg-background px-2 pr-7 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                  style={selectedProject ? {
                    borderColor: colorToRgba(selectedProjectColor, 0.55),
                    boxShadow: `inset 4px 0 0 ${selectedProjectColor}`,
                  } : undefined}
                >
                  <option value="">未設定</option>
                  {projects.map(project => (
                    <option key={project.id} value={project.id}>
                      {project.title}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              </div>
              </label>
            </div>

            <div className="space-y-2 rounded-lg border bg-background/40 p-3">
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">日付</span>
                  <div className="relative flex min-h-[44px] items-center rounded-md border bg-background px-2">
                    <Calendar className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                    <select
                      value={dateValue}
                      onChange={e => handleScheduleChange(e.target.value, timeValue || "09:00")}
                      className="h-10 min-w-0 flex-1 appearance-none bg-transparent pr-6 text-sm outline-none"
                      aria-label="日付"
                    >
                      <option value="">未設定</option>
                      {dateOptions.map(option => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2 h-4 w-4 text-muted-foreground" />
                  </div>
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">時刻</span>
                  <div className="relative flex min-h-[44px] items-center rounded-md border bg-background px-2">
                    <Clock className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                    <select
                      value={timeValue}
                      onChange={e => handleScheduleChange(dateValue, e.target.value)}
                      disabled={!dateValue}
                      className="h-10 min-w-0 flex-1 appearance-none bg-transparent pr-6 text-sm outline-none disabled:text-muted-foreground"
                      aria-label="時刻"
                    >
                      <option value="">未設定</option>
                      {timeOptions.map(option => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2 h-4 w-4 text-muted-foreground" />
                  </div>
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="icon" onClick={() => changeDuration(-15)} className="min-h-[44px] min-w-[44px]">
                  <Minus className="h-4 w-4" />
                </Button>
                <div className="flex min-h-[44px] min-w-20 items-center justify-center rounded-md border bg-background text-sm font-medium">
                  {item.duration_minutes ?? 60}分
                </div>
                <Button variant="outline" size="icon" onClick={() => changeDuration(15)} className="min-h-[44px] min-w-[44px]">
                  <Plus className="h-4 w-4" />
                </Button>
                <div className="grid min-w-0 flex-1 basis-full grid-cols-4 gap-1 sm:basis-auto">
                  {QUICK_MINUTES.map(minutes => (
                    <button
                      key={minutes}
                      type="button"
                      onClick={() => update({ duration_minutes: minutes })}
                      className={cn(
                        "min-h-9 rounded-md border px-2 text-xs transition-colors",
                        item.duration_minutes === minutes ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {minutes}分
                    </button>
                  ))}
                </div>
              </div>
              <Button
                onClick={handleAddCalendar}
                disabled={isAddingCalendar || !item.scheduled_at || !item.duration_minutes}
                variant={item.google_event_id ? "outline" : "default"}
                className="w-full min-h-[44px]"
              >
                {isAddingCalendar ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Calendar className="mr-2 h-4 w-4" />}
                {item.google_event_id ? "カレンダー登録済み" : "カレンダーに入れる"}
              </Button>
            </div>

            <div className="space-y-1">
              <Label>メモ</Label>
              <textarea
                value={draftDescription}
                onChange={e => setDraftDescription(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    handleSaveMemo()
                  }
                }}
                rows={6}
                placeholder="本文にGoogle DocsなどのURLを貼ると、そのままリンクとして開けます。"
                className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              {draftDescription && (
                <div className="rounded-md bg-muted/40 p-2 text-xs leading-5 text-muted-foreground">
                  {linkify(draftDescription)}
                </div>
              )}
            </div>

            <div className="space-y-2 rounded-lg border bg-background/40 p-3">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setActiveDetailPanel(panel => panel === "tags" ? null : "tags")}
                  className={cn(
                    "flex min-h-[48px] items-center justify-between rounded-md border px-3 text-left text-sm transition-colors",
                    activeDetailPanel === "tags" ? "border-primary bg-primary/10 text-foreground" : "bg-background text-muted-foreground hover:text-foreground",
                  )}
                >
                  <span className="font-medium">タグ</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{selectedTags.length}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveDetailPanel(panel => panel === "images" ? null : "images")}
                  className={cn(
                    "flex min-h-[48px] items-center justify-between rounded-md border px-3 text-left text-sm transition-colors",
                    activeDetailPanel === "images" ? "border-primary bg-primary/10 text-foreground" : "bg-background text-muted-foreground hover:text-foreground",
                  )}
                >
                  <span className="font-medium">画像</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{images.length}</span>
                </button>
              </div>

              {activeDetailPanel === "tags" && (
                <div className="space-y-3 rounded-md border bg-background p-3">
                  <div className="flex gap-2">
                    <Input
                      value={tagText}
                      onChange={e => setTagText(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter") {
                          e.preventDefault()
                          void handleAddTag()
                        }
                      }}
                      placeholder="タグを追加"
                      className="h-11"
                    />
                    <Button variant="outline" onClick={() => void handleAddTag()} className="h-11 shrink-0">追加</Button>
                  </div>
                  {tagSuggestions.length > 0 && (
                    <div className="grid grid-cols-2 gap-2">
                      {tagSuggestions.map(tag => {
                        const color = getTagColor(tag, tagColors)
                        return (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => void addTagValue(tag)}
                            className="min-h-[44px] rounded-md border px-3 text-left text-sm font-medium"
                            style={{
                              borderColor: colorToRgba(color, 0.45),
                              backgroundColor: colorToRgba(color, 0.1),
                              color,
                            }}
                          >
                            {tag}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {activeDetailPanel === "images" && (
                <div className="rounded-md border bg-background p-3">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploadingImage}
                    className="flex min-h-[64px] w-full items-center justify-center gap-2 rounded-md border border-dashed text-sm text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground disabled:opacity-60"
                  >
                    {isUploadingImage ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                    画像を追加
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={e => {
                      const files = Array.from(e.target.files ?? [])
                      if (files.length > 0) void uploadImages(files)
                    }}
                  />
                </div>
              )}

              {selectedTags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {selectedTags.map(tag => {
                    const color = getTagColor(tag, tagColors)
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => void removeTag(tag)}
                        className="min-h-[40px] rounded-full border px-3 text-sm font-medium hover:opacity-80"
                        style={{
                          borderColor: colorToRgba(color, 0.55),
                          backgroundColor: colorToRgba(color, 0.12),
                          color,
                        }}
                      >
                        {tag} ×
                      </button>
                    )
                  })}
                </div>
              )}

              {images.length > 0 && (
                <div className="-mr-3 flex items-start gap-2 overflow-x-auto pb-1 pr-3">
                  {images.map(image => (
                    <div key={image.id} className="w-24 shrink-0 overflow-hidden rounded-md border bg-muted/20">
                      <a
                        href={image.file_url}
                        download={image.file_name}
                        target="_blank"
                        rel="noreferrer"
                        onDoubleClick={e => e.currentTarget.click()}
                        title="PCはダブルクリックで保存、スマホは長押しまたは保存ボタン"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={image.file_url} alt={image.file_name} className="h-20 w-24 object-cover" />
                      </a>
                      <div className="flex items-center justify-end gap-0.5 px-1 py-0.5">
                        <a
                          href={image.file_url}
                          download={image.file_name}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded p-1 text-muted-foreground hover:text-foreground"
                          title="保存"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </a>
                        <button
                          type="button"
                          onClick={() => handleImageDelete(image.id)}
                          disabled={deletingImageId === image.id}
                          className="rounded p-1 text-muted-foreground hover:text-destructive disabled:opacity-60"
                          title="削除"
                        >
                          {deletingImageId === image.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

          {saveError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {saveError}
            </div>
          )}

          <Button
            onClick={handleSaveMemo}
            disabled={isPersisting || isSavingMemo || !draftTitle.trim()}
            className="w-full min-h-[44px]"
          >
            {isPersisting || isSavingMemo ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
            {isPersisting ? "メモを作成中..." : "メモを保存"}
          </Button>

            </div>

            <div className={cn("min-w-0", isMobile ? "mt-3 space-y-3" : "space-y-4 xl:sticky xl:top-0")}>
            {showStructureTools && (
            <div className="space-y-3 rounded-lg border bg-background/40 p-3">
            <div className="flex items-center justify-between gap-2">
              <Label className="flex items-center gap-1.5">
                <Network className="h-4 w-4" />
                構造化
              </Label>
              {isLoadingStructure && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>

            <div className="space-y-2">
              <textarea
                value={structureFeedback}
                onChange={e => setStructureFeedback(e.target.value)}
                rows={2}
                placeholder="違和感があればここに書いて再構造化"
                className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-ring"
              />
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleStructureMemo("quick")}
                  disabled={isStructuringMemo}
                  className="min-h-[40px]"
                >
                  {isStructuringMemo ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                  すぐ分解
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleStructureMemo("deep")}
                  disabled={isStructuringMemo}
                  className="min-h-[40px]"
                >
                  AIで壁打ち
                </Button>
              </div>
            </div>

            {structureError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {structureError}
              </div>
            )}

            <div className="space-y-2">
              {structuredItems.length === 0 ? (
                <div className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
                  構造化項目はまだありません
                </div>
              ) : (
                <StructuredMemoMindmap
                  items={structuredItems}
                  linkingItemId={linkingItemId}
                  researchingItemId={researchingItemId}
                  researchPrompts={researchPrompts}
                  placementByItemId={placementByItemId}
                  projects={projects}
                  onPlacementChange={handlePlacementChange}
                  onPlacementProjectChange={handlePlacementProjectChange}
                  onLink={handleLinkStructuredItem}
                  onResearch={handleCreateResearchPrompt}
                />
              )}
            </div>
            </div>
            )}

            {(onLaunchClaude || onLaunchCodex || onCopyCodexPrompt) && (() => {
            const aiTask = getMemoAiTask(item.id)
            const project = item.project_id ? projects.find(p => p.id === item.project_id) : null
            const repoConfigured = !!project?.repo_path
            const taskExecutor = aiTask?.executor ?? null
            const taskResult = aiTask?.result && typeof aiTask.result === 'object' && !Array.isArray(aiTask.result)
              ? aiTask.result as Record<string, unknown>
              : {}
            const codexPromptWaiting = (taskExecutor === "codex" || taskExecutor === "codex_app") && taskResult.codex_run_state === "prompt_waiting"
            const active = aiTask && ["pending", "running", "awaiting_approval", "needs_input"].includes(aiTask.status)
            const needsRepoConfig = !item.project_id || !repoConfigured
            const claudeDisabled = needsRepoConfig || !!active
              const codexDisabled = !draftTitle.trim() || needsRepoConfig || (!!active && !codexPromptWaiting)
              const needsConfig = (!!onLaunchClaude || !!onLaunchCodex) && needsRepoConfig
              const showCodexDetails = isCodexPanelOpen || !!active || launchStep !== null || !!launchError || needsConfig
              return (
                <div className="space-y-3 rounded-lg border bg-background/40 p-3">
                  {/* Codex 起動（codex に一本化。claude/codex_app は親から prop 未提供で非表示） */}
                  <div className="grid grid-cols-1 gap-2">
                    {onLaunchClaude && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={claudeDisabled || isLaunchingClaude}
                        onClick={async () => {
                          setIsCodexPanelOpen(true)
                          setLaunchError(null)
                          setLaunchStep('sending')
                        setLaunchExecutor('claude')
                        setIsLaunchingClaude(true)
                        try {
                          await onLaunchClaude(item)
                          setLaunchStep('sent')
                        } catch (e) {
                          setLaunchError(e instanceof Error ? e.message : "起動に失敗")
                          setLaunchStep(null)
                          setLaunchExecutor(null)
                        } finally {
                          setIsLaunchingClaude(false)
                        }
                      }}
                      className="min-h-[60px] flex-col gap-0.5 border-amber-500/50 hover:bg-amber-500/10 text-amber-700 dark:text-amber-300 dark:hover:bg-amber-500/20 disabled:opacity-40 disabled:border-muted disabled:text-muted-foreground"
                      >
                        {isLaunchingClaude ? <Loader2 className="h-4 w-4 animate-spin" /> : <span className="text-base font-semibold">▲ Claude</span>}
                      </Button>
                    )}
                    {onLaunchCodex && (
                    <Button
                      type="button"
                      variant="outline"
                        disabled={codexDisabled || isLaunchingCodex}
                        onClick={async () => {
                          setIsCodexPanelOpen(true)
                          setLaunchError(null)
                          setLaunchStep('sending')
                        setLaunchExecutor('codex')
                        setIsLaunchingCodex(true)
                        try {
                          await onLaunchCodex(item)
                          setLaunchStep('sent')
                        } catch (e) {
                          setLaunchError(e instanceof Error ? e.message : "起動失敗")
                          setLaunchStep(null)
                          setLaunchExecutor(null)
                        } finally {
                          setIsLaunchingCodex(false)
                        }
                        }}
                        className="min-h-[48px] gap-2 border-emerald-500/50 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300 dark:hover:bg-emerald-500/20 disabled:opacity-40 disabled:border-muted disabled:text-muted-foreground"
                      >
                        {isLaunchingCodex ? <Loader2 className="h-4 w-4 animate-spin" /> : <Terminal className="h-4 w-4" />}
                        <span className="font-semibold">Codexにプロンプトを送る</span>
                      </Button>
                    )}
                  </div>

                  {showCodexDetails && (
                    <>
                      <Label className="flex items-center gap-1.5">
                        <Terminal className="h-4 w-4" />
                        実行状況
                      </Label>
                      <p className={cn(
                        "text-xs leading-5",
                        needsConfig && !active ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground"
                      )}>
                        {active
                          ? codexPromptWaiting
                            ? "Codexはプロンプト待ちです。必要なら下から再コピーできます"
                            : `${taskExecutor === "codex" || taskExecutor === "codex_app" ? "Codex" : "Claude"} 実行中です（下に進行状況）`
                          : needsConfig
                            ? "プロジェクトまたはリポジトリパスが未設定です"
                            : "メモ本文をCodex.appへ送って実行します"}
                      </p>
                      {needsConfig && (
                        <Link
                          href="/dashboard/settings/projects#project-repos"
                          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-xs hover:bg-muted"
                        >
                          <SettingsIcon className="h-3.5 w-3.5" />
                          {!item.project_id ? "メモにプロジェクトを設定" : "リポジトリパスを設定する"}
                        </Link>
                      )}
                    </>
                  )}

                  {showCodexDetails && onCopyCodexPrompt && (active || launchStep !== null) && (
                    <Button
                    type="button"
                    variant="secondary"
                    disabled={!draftTitle.trim() || isCopyingCodexPrompt}
                      onClick={async () => {
                        setIsCodexPanelOpen(true)
                        setLaunchError(null)
                      setIsCopyingCodexPrompt(true)
                      try {
                        await onCopyCodexPrompt(item)
                        setLaunchStep('sent')
                        setLaunchExecutor('codex')
                      } catch (e) {
                        setLaunchError(e instanceof Error ? e.message : "コピー失敗")
                      } finally {
                        setIsCopyingCodexPrompt(false)
                      }
                    }}
                    className="min-h-[44px] w-full justify-center gap-2 text-xs"
                  >
                    {isCopyingCodexPrompt ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}
                    プロンプト/画像を再コピー
                  </Button>
                )}

                {/* サブオプション: codex:// URL スキームで Codex.app に prefill だけ（送信は手動）*/}
                  {showCodexDetails && onLaunchCodexApp && (
                    <button
                    type="button"
                    disabled={!draftTitle.trim() || isLaunchingCodex}
                      onClick={async () => {
                        setIsCodexPanelOpen(true)
                        setLaunchError(null)
                      setLaunchStep('sending')
                      setLaunchExecutor('codex_app')
                      setIsLaunchingCodex(true)
                      try {
                        await onLaunchCodexApp(item)
                        setLaunchStep('sent')
                      } catch (e) {
                        setLaunchError(e instanceof Error ? e.message : "起動失敗")
                        setLaunchStep(null)
                        setLaunchExecutor(null)
                      } finally {
                        setIsLaunchingCodex(false)
                      }
                    }}
                    className="w-full text-[11px] text-muted-foreground hover:text-foreground py-1.5 underline disabled:opacity-50"
                  >
                    ◎ Codex.app に prefill だけする（送信は手動・自分で内容を確認したい時）
                  </button>
                )}

                  {showCodexDetails && launchError && (
                    <div className="rounded bg-red-500/5 border border-red-200 px-2 py-1.5 text-[11px] text-red-700 dark:text-red-300">
                    {launchError}
                  </div>
                )}

                {/* ステップログ */}
                  {showCodexDetails && launchStep !== null && (() => {
                  const sessionUrl = aiTask?.remote_session_url ?? null
                  const isCodex = launchExecutor === 'codex' || launchExecutor === 'codex_app'
                  const executorLabel = launchExecutor === 'claude' ? 'Claude Code' : 'Codex'
                  const copyStepText = launchExecutor === 'codex_app'
                    ? (launchStep === 'sending' ? 'プロンプトを準備しています...' : 'プロンプトをコピーしました')
                    : launchExecutor === 'codex'
                      ? (launchStep === 'sending' ? 'Codex実行を準備しています...' : 'Codex実行をキューに追加しました')
                      : (launchStep === 'sending' ? `${executorLabel}に送信しています...` : `${executorLabel}に送信しました`)
                  return (
                    <div className="rounded-lg border bg-muted/20 p-3 space-y-2 text-[12px]">
                      {/* Step 1: コピー/送信 */}
                      <div className="flex items-center gap-2">
                        {launchStep === 'sending'
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500 shrink-0" />
                          : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />}
                        <span className={launchStep === 'sending' ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}>
                          {copyStepText}
                        </span>
                      </div>
                      {/* Step 2: 接続/起動 */}
                      {launchStep !== 'sending' && (
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2">
                            {launchStep === 'sent'
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500 shrink-0" />
                              : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />}
                            <span className={launchStep === 'sent' ? 'text-blue-600 dark:text-blue-400' : 'text-muted-foreground'}>
                              {launchStep === 'sent'
                                ? `${launchExecutor === 'codex_app' ? 'プロンプト待ち' : isCodex ? 'Codex起動待ち' : '接続しています'}...${elapsedSecs > 0 ? ` (${elapsedSecs}秒)` : ''}`
                                : (launchExecutor === 'codex_app' ? 'プロンプト待ち' : isCodex ? 'Codex起動済み' : '接続しました')}
                            </span>
                          </div>
                          {launchStep === 'sent' && (
                            <div className="pl-5 space-y-1 text-[11px] text-muted-foreground">
                              <p>{launchExecutor === 'codex_app' ? 'Codex側で内容を確認して送信してください' : isCodex ? 'Mac runnerがCodex.appへ送信します' : '通常15〜45秒かかります'}</p>
                              {(() => {
                                const status = aiTask?.status
                                if (status === 'running') return <p className="text-blue-500 dark:text-blue-400 font-medium">▶ {executorLabel} が実行中です{isCodex ? '' : ' — URLを取得中...'}</p>
                                if (status === 'pending') return <p>Mac でエージェントの起動を待っています...</p>
                                return null
                              })()}
                            </div>
                          )}
                        </div>
                      )}
                      {/* Claude: QRコード + URL */}
                      {!isCodex && (launchStep === 'connected' || launchStep === 'completed') && sessionUrl && (
                        <div className="flex flex-col sm:flex-row gap-3 pt-1">
                          <div className="shrink-0 rounded-md border bg-white p-2 self-start">
                            <QRCode value={sessionUrl} size={80} />
                          </div>
                          <div className="flex-1 min-w-0 space-y-2">
                            <p className="text-muted-foreground">QRを読み取るかボタンで開く:</p>
                            <a
                              href={sessionUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-[11px] font-medium text-primary-foreground hover:bg-primary/90"
                            >
                              <Wifi className="h-3.5 w-3.5" />
                              このデバイスで開く
                            </a>
                            <button
                              type="button"
                              onClick={async () => {
                                await navigator.clipboard.writeText(sessionUrl).catch(() => {})
                                setCopiedUrl(true)
                                setTimeout(() => setCopiedUrl(false), 1500)
                              }}
                              className="ml-2 inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1.5 text-[11px] hover:bg-muted"
                            >
                              {copiedUrl ? 'コピー済' : 'URLコピー'}
                            </button>
                          </div>
                        </div>
                      )}
                      {/* Codex: 起動完了メッセージ */}
                      {isCodex && (launchStep === 'connected' || launchStep === 'completed') && (
                        <div className="pl-1 text-[11px] text-muted-foreground space-y-0.5">
                          {launchExecutor === 'codex_app'
                            ? <p>✓ Codex.app が開きました。Mac で Enter を押すと実行開始します。</p>
                            : <p>✓ プロンプトはコピー済みです。Codex側で送信すると、下のパネルに状態が同期されます。</p>
                          }
                        </div>
                      )}
                      {/* 完了 */}
                      {launchStep === 'completed' && (
                        <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-medium">
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                          完了しました — メモ一覧に戻ります
                        </div>
                      )}
                    </div>
                  )
                })()}

                  {showCodexDetails && (
                    <NoteClaudeRunnerPanel
                      latestTask={aiTask}
                      isProjectAssigned={!!item.project_id || aiTask?.executor === 'codex' || aiTask?.executor === 'codex_app'}
                      isRepoConfigured={repoConfigured}
                    />
                  )}
              </div>
            )
          })()}

            <div className="space-y-2">
            <Label>サブタスク候補</Label>
            <ul className="space-y-1">
              {(item.ideal_items ?? []).map(sub => (
                <li key={sub.id} className="flex items-center gap-2 rounded-md border px-2 py-2 text-sm">
                  <span className={cn(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                    sub.is_done ? "border-primary bg-primary" : "border-muted-foreground/40",
                  )}>
                    {sub.is_done && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                  </span>
                  <span className={cn("flex-1", sub.is_done && "line-through text-muted-foreground")}>{sub.title}</span>
                  {sub.session_minutes > 0 && <span className="text-xs text-muted-foreground">{sub.session_minutes}分</span>}
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <Input
                value={newSubItem}
                onChange={e => setNewSubItem(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleAddSubItem()}
                placeholder="サブタスク候補を追加"
              />
              <Button size="icon" variant="outline" onClick={handleAddSubItem} className="min-w-[44px]">
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>
          </div>
        </div>
      </SheetContent>

      </Sheet>
  )
}
