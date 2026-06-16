import { createClient } from "@/utils/supabase/server"
import type { Database, Json, Task } from "@/types/database"
import { MINDMAP_DRAFT_CHANGED_EVENT } from "@/lib/mindmap-draft-events"

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>
type MindmapDraftRow = Database["public"]["Tables"]["mindmap_drafts"]["Row"]
type MindmapDraftNodeRow = Database["public"]["Tables"]["mindmap_draft_nodes"]["Row"]
type MindmapDraftHistoryRow = Database["public"]["Tables"]["mindmap_draft_history"]["Row"]
type MemoNodeLinkRow = Database["public"]["Tables"]["memo_node_links"]["Row"]
type DraftNodeChangeType = MindmapDraftNodeRow["change_type"]

export { MINDMAP_DRAFT_CHANGED_EVENT }

export type MindmapDraftSummary = {
  newNodes: number
  movedNodes: number
  adjustedNodes: number
}

export type MindmapDraftWithNodes = {
  draft: MindmapDraftRow
  nodes: MindmapDraftNodeRow[]
  summary: MindmapDraftSummary
}

export type SaveMindmapDraftNodeInput = {
  draftNodeId?: string | null
  taskId?: string | null
  parentDraftNodeId?: string | null
  parentTaskId?: string | null
  title: string
  originalTitle?: string | null
  isGroup?: boolean
  orderIndex?: number | null
  changeType?: DraftNodeChangeType
  origin?: "ai" | "user"
  sourceLinks?: Json
  metadata?: Json
}

type MindmapDraftSnapshot = {
  captured_at: string
  tasks: Task[]
  memo_node_links: MemoNodeLinkRow[]
}

type AppliedDraftPayload = {
  added_task_ids: string[]
  changed_task_ids: string[]
  created_tasks: Task[]
  updated_tasks_after: Task[]
  draft_nodes: MindmapDraftNodeRow[]
  source_links: Array<{ task_id: string; source_links: Json }>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function asJson(value: unknown): Json {
  return value as Json
}

function jsonArray(value: Json | unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function numberValue(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback
}

function normalizeTitle(value: string | null | undefined) {
  const title = value?.trim()
  return title ? title.slice(0, 300) : "New Task"
}

function normalizeSummary(value: Json, nodes: MindmapDraftNodeRow[]): MindmapDraftSummary {
  if (isRecord(value)) {
    return {
      newNodes: numberValue(value.newNodes ?? value.new_nodes, 0),
      movedNodes: numberValue(value.movedNodes ?? value.moved_nodes, 0),
      adjustedNodes: numberValue(value.adjustedNodes ?? value.adjusted_nodes, 0),
    }
  }
  return summarizeDraftNodes(nodes)
}

export function summarizeDraftNodes(nodes: MindmapDraftNodeRow[]): MindmapDraftSummary {
  return nodes.reduce<MindmapDraftSummary>((summary, node) => {
    if (node.change_type === "new") summary.newNodes += 1
    if (node.change_type === "moved" || node.change_type === "moved_title_adjusted") summary.movedNodes += 1
    if (node.change_type === "title_adjusted" || node.change_type === "moved_title_adjusted" || node.origin === "user") {
      summary.adjustedNodes += 1
    }
    return summary
  }, { newNodes: 0, movedNodes: 0, adjustedNodes: 0 })
}

export function formatDraftSummary(summary: MindmapDraftSummary) {
  return `新規 ${summary.newNodes} / 移動 ${summary.movedNodes} / 調整 ${summary.adjustedNodes}`
}

async function ensureProject(supabase: SupabaseServerClient, userId: string, projectId: string) {
  const { data, error } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error("project not found")
}

export async function fetchProjectMindmapTasks(
  supabase: SupabaseServerClient,
  userId: string,
  projectId: string,
): Promise<Task[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("order_index", { ascending: true })
  if (error) throw new Error(error.message)

  const rows = (data ?? []) as Task[]
  const byParentId = new Map<string | null, Task[]>()
  for (const task of rows) {
    const parentId = task.parent_task_id ?? null
    const list = byParentId.get(parentId)
    if (list) list.push(task)
    else byParentId.set(parentId, [task])
  }

  const included = new Map<string, Task>()
  const queue = rows
    .filter(task => task.project_id === projectId)
    .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))

  while (queue.length > 0) {
    const task = queue.shift()
    if (!task || included.has(task.id)) continue
    included.set(task.id, task)
    for (const child of byParentId.get(task.id) ?? []) queue.push(child)
  }

  return Array.from(included.values()).sort((a, b) => {
    if ((a.parent_task_id ?? "") !== (b.parent_task_id ?? "")) {
      return String(a.parent_task_id ?? "").localeCompare(String(b.parent_task_id ?? ""))
    }
    return (a.order_index ?? 0) - (b.order_index ?? 0)
  })
}

async function fetchProjectMemoLinks(
  supabase: SupabaseServerClient,
  userId: string,
  projectId: string,
): Promise<MemoNodeLinkRow[]> {
  const { data, error } = await supabase
    .from("memo_node_links")
    .select("*")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .eq("link_type", "mindmap_node")
    .eq("status", "active")
  if (error) throw new Error(error.message)
  return (data ?? []) as MemoNodeLinkRow[]
}

async function loadDraftNodes(
  supabase: SupabaseServerClient,
  draftId: string,
  userId: string,
): Promise<MindmapDraftNodeRow[]> {
  const { data, error } = await supabase
    .from("mindmap_draft_nodes")
    .select("*")
    .eq("draft_id", draftId)
    .eq("user_id", userId)
    .order("order_index", { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as MindmapDraftNodeRow[]
}

export async function fetchActiveMindmapDraft(
  supabase: SupabaseServerClient,
  userId: string,
  projectId: string,
): Promise<MindmapDraftWithNodes | null> {
  const { data: draft, error } = await supabase
    .from("mindmap_drafts")
    .select("*")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!draft) return null
  const nodes = await loadDraftNodes(supabase, draft.id, userId)
  return {
    draft: draft as MindmapDraftRow,
    nodes,
    summary: normalizeSummary((draft as MindmapDraftRow).summary, nodes),
  }
}

function normalizeDraftNodeInput(
  input: SaveMindmapDraftNodeInput,
  userId: string,
  projectId: string,
  draftId: string,
  taskById: Map<string, Task>,
): Database["public"]["Tables"]["mindmap_draft_nodes"]["Insert"] {
  const task = input.taskId ? taskById.get(input.taskId) ?? null : null
  const origin = input.origin ?? "ai"
  const changeType = input.changeType ?? (input.taskId ? "moved" : "new")
  const draftNodeId = input.draftNodeId || input.taskId || crypto.randomUUID()
  const originalTitle = input.originalTitle ?? task?.title ?? null
  const title = input.taskId && origin === "ai" && changeType !== "title_adjusted" && changeType !== "moved_title_adjusted"
    ? normalizeTitle(task?.title)
    : normalizeTitle(input.title)

  return {
    draft_id: draftId,
    user_id: userId,
    project_id: projectId,
    draft_node_id: draftNodeId,
    task_id: input.taskId ?? null,
    parent_draft_node_id: input.parentDraftNodeId ?? input.parentTaskId ?? null,
    parent_task_id: input.parentTaskId ?? null,
    title,
    original_title: originalTitle,
    is_group: input.isGroup ?? task?.is_group ?? false,
    order_index: numberValue(input.orderIndex, task?.order_index ?? 0),
    change_type: changeType,
    origin,
    source_links: input.sourceLinks ?? [],
    metadata: input.metadata ?? {},
  }
}

async function updateDraftSummary(supabase: SupabaseServerClient, userId: string, draftId: string) {
  const nodes = await loadDraftNodes(supabase, draftId, userId)
  const summary = summarizeDraftNodes(nodes)
  const { error } = await supabase
    .from("mindmap_drafts")
    .update({ summary: asJson(summary) })
    .eq("id", draftId)
    .eq("user_id", userId)
  if (error) throw new Error(error.message)
  return summary
}

export async function replaceActiveMindmapDraft({
  supabase,
  userId,
  projectId,
  chatSessionId = null,
  scope = {},
  summary,
  nodes,
  createdBy = "ai",
}: {
  supabase: SupabaseServerClient
  userId: string
  projectId: string
  chatSessionId?: string | null
  scope?: Json
  summary?: Json
  nodes: SaveMindmapDraftNodeInput[]
  createdBy?: "ai" | "user"
}): Promise<MindmapDraftWithNodes> {
  await ensureProject(supabase, userId, projectId)
  const baseTasks = await fetchProjectMindmapTasks(supabase, userId, projectId)
  const taskById = new Map(baseTasks.map(task => [task.id, task]))

  const { error: discardError } = await supabase
    .from("mindmap_drafts")
    .update({ status: "discarded" })
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .eq("status", "active")
  if (discardError) throw new Error(discardError.message)

  const { data: draft, error: draftError } = await supabase
    .from("mindmap_drafts")
    .insert({
      user_id: userId,
      project_id: projectId,
      chat_session_id: chatSessionId,
      status: "active",
      scope,
      summary: summary ?? {},
      base_snapshot: asJson(baseTasks),
      created_by: createdBy,
    })
    .select("*")
    .single()
  if (draftError) throw new Error(draftError.message)

  const draftRow = draft as MindmapDraftRow
  const payload = nodes.map(node => normalizeDraftNodeInput(node, userId, projectId, draftRow.id, taskById))
  if (payload.length > 0) {
    const { error: nodesError } = await supabase
      .from("mindmap_draft_nodes")
      .insert(payload)
    if (nodesError) throw new Error(nodesError.message)
  }

  const draftNodes = await loadDraftNodes(supabase, draftRow.id, userId)
  const draftSummary = summary ? normalizeSummary(summary, draftNodes) : summarizeDraftNodes(draftNodes)
  const { error: summaryError } = await supabase
    .from("mindmap_drafts")
    .update({ summary: asJson(draftSummary) })
    .eq("id", draftRow.id)
    .eq("user_id", userId)
  if (summaryError) throw new Error(summaryError.message)

  return {
    draft: { ...draftRow, summary: asJson(draftSummary) },
    nodes: draftNodes,
    summary: draftSummary,
  }
}

export async function upsertMindmapDraftNode({
  supabase,
  userId,
  draftId,
  input,
}: {
  supabase: SupabaseServerClient
  userId: string
  draftId: string
  input: SaveMindmapDraftNodeInput
}): Promise<MindmapDraftWithNodes> {
  const { data: draft, error: draftError } = await supabase
    .from("mindmap_drafts")
    .select("*")
    .eq("id", draftId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle()
  if (draftError) throw new Error(draftError.message)
  if (!draft) throw new Error("active draft not found")

  const draftRow = draft as MindmapDraftRow
  const baseTasks = await fetchProjectMindmapTasks(supabase, userId, draftRow.project_id)
  const taskById = new Map(baseTasks.map(task => [task.id, task]))
  const payload = normalizeDraftNodeInput(input, userId, draftRow.project_id, draftRow.id, taskById)
  const { error } = await supabase
    .from("mindmap_draft_nodes")
    .upsert(payload, { onConflict: "draft_id,draft_node_id" })
  if (error) throw new Error(error.message)

  const summary = await updateDraftSummary(supabase, userId, draftRow.id)
  const nodes = await loadDraftNodes(supabase, draftRow.id, userId)
  return {
    draft: { ...draftRow, summary: asJson(summary) },
    nodes,
    summary,
  }
}

function resolveParentTaskId(
  node: MindmapDraftNodeRow,
  nodeByDraftId: Map<string, MindmapDraftNodeRow>,
  insertedNewTaskIds: Set<string>,
) {
  if (!node.parent_draft_node_id) return null
  const parent = nodeByDraftId.get(node.parent_draft_node_id)
  if (!parent) return node.parent_task_id ?? null
  if (parent.task_id) return parent.task_id
  if (insertedNewTaskIds.has(parent.draft_node_id)) return parent.draft_node_id
  return undefined
}

function sourceLinksForNode(node: MindmapDraftNodeRow) {
  return jsonArray(node.source_links)
    .filter(isRecord)
    .map(link => ({
      memoItemId: stringValue(link.memoItemId ?? link.memo_item_id),
      sourceType: stringValue(link.sourceType ?? link.source_type),
      sourceId: stringValue(link.sourceId ?? link.source_id),
      metadata: isRecord(link.metadata) ? link.metadata : {},
    }))
}

async function applySourceLinks(
  supabase: SupabaseServerClient,
  userId: string,
  projectId: string,
  taskId: string,
  node: MindmapDraftNodeRow,
) {
  for (const link of sourceLinksForNode(node)) {
    if (!link.memoItemId || !link.sourceId) continue
    if (link.sourceType !== "wishlist" && link.sourceType !== "note") continue

    const { data: existing } = await supabase
      .from("memo_node_links")
      .select("id")
      .eq("user_id", userId)
      .eq("memo_item_id", link.memoItemId)
      .eq("link_type", "mindmap_node")
      .eq("status", "active")
      .maybeSingle()

    if (existing?.id) {
      const { error } = await supabase
        .from("memo_node_links")
        .update({
          task_id: taskId,
          project_id: projectId,
          source_type: link.sourceType,
          source_id: link.sourceId,
          metadata: link.metadata,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
        .eq("user_id", userId)
      if (error) throw new Error(error.message)
      continue
    }

    const { error } = await supabase
      .from("memo_node_links")
      .insert({
        user_id: userId,
        memo_item_id: link.memoItemId,
        source_type: link.sourceType,
        source_id: link.sourceId,
        task_id: taskId,
        project_id: projectId,
        link_type: "mindmap_node",
        status: "active",
        metadata: link.metadata,
      })
    if (error) throw new Error(error.message)
  }
}

async function applyDraftNodeRows(
  supabase: SupabaseServerClient,
  userId: string,
  projectId: string,
  nodes: MindmapDraftNodeRow[],
): Promise<AppliedDraftPayload> {
  const beforeTasks = await fetchProjectMindmapTasks(supabase, userId, projectId)
  const beforeById = new Map(beforeTasks.map(task => [task.id, task]))
  const nodeByDraftId = new Map(nodes.map(node => [node.draft_node_id, node]))
  const insertedNewTaskIds = new Set<string>()
  const createdTasks: Task[] = []
  const updatedTasksAfter: Task[] = []
  const changedTaskIds = new Set<string>()
  const sourceLinkPayload: AppliedDraftPayload["source_links"] = []

  let pendingNewNodes = nodes.filter(node => !node.task_id)
  while (pendingNewNodes.length > 0) {
    const nextPending: MindmapDraftNodeRow[] = []
    let progressed = false

    for (const node of pendingNewNodes) {
      const parentTaskId = resolveParentTaskId(node, nodeByDraftId, insertedNewTaskIds)
      if (parentTaskId === undefined) {
        nextPending.push(node)
        continue
      }

      const insertPayload = {
        id: node.draft_node_id,
        user_id: userId,
        project_id: projectId,
        parent_task_id: parentTaskId,
        is_group: node.is_group,
        title: normalizeTitle(node.title),
        status: "todo",
        stage: "plan",
        priority: null,
        order_index: node.order_index,
        actual_time_minutes: 0,
        estimated_time: 0,
        calendar_id: null,
        google_event_id: null,
        calendar_event_id: null,
        total_elapsed_seconds: 0,
        is_timer_running: false,
        is_habit: false,
        memo: null,
        memo_images: null,
        source: "manual",
        deleted_at: null,
        node_width: null,
        mindmap_collapsed: false,
      }
      const { data, error } = await supabase
        .from("tasks")
        .insert(insertPayload)
        .select("*")
        .single()
      if (error) throw new Error(error.message)
      insertedNewTaskIds.add(node.draft_node_id)
      createdTasks.push(data as Task)
      sourceLinkPayload.push({ task_id: node.draft_node_id, source_links: node.source_links })
      await applySourceLinks(supabase, userId, projectId, node.draft_node_id, node)
      progressed = true
    }

    if (!progressed) {
      pendingNewNodes = nextPending.map(node => ({ ...node, parent_draft_node_id: null, parent_task_id: null }))
    } else {
      pendingNewNodes = nextPending
    }
  }

  for (const node of nodes.filter(candidate => !!candidate.task_id)) {
    const taskId = node.task_id
    if (!taskId) continue
    const before = beforeById.get(taskId)
    if (!before) continue

    const updates: Partial<Task> = {}
    const parentTaskId = resolveParentTaskId(node, nodeByDraftId, insertedNewTaskIds)
    if (parentTaskId !== undefined && parentTaskId !== (before.parent_task_id ?? null)) {
      updates.parent_task_id = parentTaskId
    }
    if (node.order_index !== before.order_index) {
      updates.order_index = node.order_index
    }
    const shouldSaveTitle = node.origin === "user" &&
      normalizeTitle(node.title) !== normalizeTitle(node.original_title ?? before.title)
    if (shouldSaveTitle) {
      updates.title = normalizeTitle(node.title)
    }

    if (Object.keys(updates).length > 0) {
      const { data, error } = await supabase
        .from("tasks")
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq("id", taskId)
        .eq("user_id", userId)
        .select("*")
        .single()
      if (error) throw new Error(error.message)
      updatedTasksAfter.push(data as Task)
      changedTaskIds.add(taskId)
    }

    if (jsonArray(node.source_links).length > 0) {
      sourceLinkPayload.push({ task_id: taskId, source_links: node.source_links })
      await applySourceLinks(supabase, userId, projectId, taskId, node)
    }
  }

  return {
    added_task_ids: createdTasks.map(task => task.id),
    changed_task_ids: Array.from(changedTaskIds),
    created_tasks: createdTasks,
    updated_tasks_after: updatedTasksAfter,
    draft_nodes: nodes,
    source_links: sourceLinkPayload,
  }
}

function buildSnapshot(tasks: Task[], memoLinks: MemoNodeLinkRow[]): MindmapDraftSnapshot {
  return {
    captured_at: new Date().toISOString(),
    tasks,
    memo_node_links: memoLinks,
  }
}

function parseSnapshot(value: Json): MindmapDraftSnapshot {
  if (!isRecord(value)) return buildSnapshot([], [])
  return {
    captured_at: stringValue(value.captured_at) ?? new Date().toISOString(),
    tasks: Array.isArray(value.tasks) ? value.tasks as Task[] : [],
    memo_node_links: Array.isArray(value.memo_node_links) ? value.memo_node_links as MemoNodeLinkRow[] : [],
  }
}

function parseAppliedPayload(value: Json): AppliedDraftPayload {
  if (!isRecord(value)) {
    return {
      added_task_ids: [],
      changed_task_ids: [],
      created_tasks: [],
      updated_tasks_after: [],
      draft_nodes: [],
      source_links: [],
    }
  }
  return {
    added_task_ids: jsonArray(value.added_task_ids).filter((id): id is string => typeof id === "string"),
    changed_task_ids: jsonArray(value.changed_task_ids).filter((id): id is string => typeof id === "string"),
    created_tasks: Array.isArray(value.created_tasks) ? value.created_tasks as Task[] : [],
    updated_tasks_after: Array.isArray(value.updated_tasks_after) ? value.updated_tasks_after as Task[] : [],
    draft_nodes: Array.isArray(value.draft_nodes) ? value.draft_nodes as MindmapDraftNodeRow[] : [],
    source_links: Array.isArray(value.source_links)
      ? value.source_links as AppliedDraftPayload["source_links"]
      : [],
  }
}

async function appendChatMessageIfPossible(
  supabase: SupabaseServerClient,
  userId: string,
  chatSessionId: string | null,
  text: string,
  metadata?: Record<string, unknown>,
) {
  if (!chatSessionId) return
  const { data: session } = await supabase
    .from("agent_chat_sessions")
    .select("messages")
    .eq("id", chatSessionId)
    .eq("user_id", userId)
    .maybeSingle()
  const currentMessages = Array.isArray(session?.messages) ? session.messages : []
  const nextMessage = {
    id: crypto.randomUUID(),
    role: "assistant",
    parts: [{ type: "text", text }],
    metadata,
  }
  await supabase
    .from("agent_chat_sessions")
    .update({ messages: asJson([...currentMessages, nextMessage]) })
    .eq("id", chatSessionId)
    .eq("user_id", userId)
}

export async function applyMindmapDraft({
  supabase,
  userId,
  draftId,
}: {
  supabase: SupabaseServerClient
  userId: string
  draftId: string
}) {
  const { data: draft, error: draftError } = await supabase
    .from("mindmap_drafts")
    .select("*")
    .eq("id", draftId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle()
  if (draftError) throw new Error(draftError.message)
  if (!draft) throw new Error("active draft not found")

  const draftRow = draft as MindmapDraftRow
  const nodes = await loadDraftNodes(supabase, draftRow.id, userId)
  const beforeTasks = await fetchProjectMindmapTasks(supabase, userId, draftRow.project_id)
  const beforeLinks = await fetchProjectMemoLinks(supabase, userId, draftRow.project_id)
  const beforeSnapshot = buildSnapshot(beforeTasks, beforeLinks)
  const appliedPayload = await applyDraftNodeRows(supabase, userId, draftRow.project_id, nodes)
  const afterTasks = await fetchProjectMindmapTasks(supabase, userId, draftRow.project_id)
  const afterLinks = await fetchProjectMemoLinks(supabase, userId, draftRow.project_id)
  const afterSnapshot = buildSnapshot(afterTasks, afterLinks)
  const summary = normalizeSummary(draftRow.summary, nodes)

  const { data: history, error: historyError } = await supabase
    .from("mindmap_draft_history")
    .insert({
      user_id: userId,
      project_id: draftRow.project_id,
      draft_id: draftRow.id,
      chat_session_id: draftRow.chat_session_id,
      status: "applied",
      summary: asJson(summary),
      before_snapshot: asJson(beforeSnapshot),
      after_snapshot: asJson(afterSnapshot),
      applied_payload: asJson(appliedPayload),
    })
    .select("*")
    .single()
  if (historyError) throw new Error(historyError.message)

  const { error: draftUpdateError } = await supabase
    .from("mindmap_drafts")
    .update({ status: "applied" })
    .eq("id", draftRow.id)
    .eq("user_id", userId)
  if (draftUpdateError) throw new Error(draftUpdateError.message)

  const message = `保存が完了しました。新規${summary.newNodes}件、移動${summary.movedNodes}件、調整${summary.adjustedNodes}件を反映しました。`
  await appendChatMessageIfPossible(supabase, userId, draftRow.chat_session_id, message, {
    focusmapMindmapDraftApply: {
      historyId: (history as MindmapDraftHistoryRow).id,
      canUndo: true,
      summary,
    },
  })

  return {
    history: history as MindmapDraftHistoryRow,
    summary,
    message,
  }
}

async function loadHistory(
  supabase: SupabaseServerClient,
  userId: string,
  historyId: string,
): Promise<MindmapDraftHistoryRow> {
  const { data, error } = await supabase
    .from("mindmap_draft_history")
    .select("*")
    .eq("id", historyId)
    .eq("user_id", userId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error("history not found")
  const history = data as MindmapDraftHistoryRow
  if (Date.parse(history.expires_at) < Date.now()) {
    throw new Error("undo history expired")
  }
  return history
}

async function restoreMemoLinks(
  supabase: SupabaseServerClient,
  userId: string,
  beforeLinks: MemoNodeLinkRow[],
  payload: AppliedDraftPayload,
) {
  const memoItemIds = Array.from(new Set([
    ...beforeLinks.map(link => link.memo_item_id),
    ...payload.draft_nodes.flatMap(node => sourceLinksForNode(node).map(link => link.memoItemId).filter((id): id is string => !!id)),
  ]))
  if (memoItemIds.length > 0) {
    const { error: archiveError } = await supabase
      .from("memo_node_links")
      .update({ status: "archived", updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("link_type", "mindmap_node")
      .eq("status", "active")
      .in("memo_item_id", memoItemIds)
    if (archiveError) throw new Error(archiveError.message)
  }
  if (beforeLinks.length > 0) {
    const { error } = await supabase
      .from("memo_node_links")
      .upsert(beforeLinks)
    if (error) throw new Error(error.message)
  }
}

export async function undoMindmapDraftHistory({
  supabase,
  userId,
  historyId,
}: {
  supabase: SupabaseServerClient
  userId: string
  historyId: string
}) {
  const history = await loadHistory(supabase, userId, historyId)
  const before = parseSnapshot(history.before_snapshot)
  const payload = parseAppliedPayload(history.applied_payload)

  if (payload.added_task_ids.length > 0) {
    const { error } = await supabase
      .from("tasks")
      .delete()
      .eq("user_id", userId)
      .in("id", payload.added_task_ids)
    if (error) throw new Error(error.message)
  }

  if (before.tasks.length > 0) {
    const { error } = await supabase
      .from("tasks")
      .upsert(before.tasks)
    if (error) throw new Error(error.message)
  }
  await restoreMemoLinks(supabase, userId, before.memo_node_links, payload)

  const undoneAt = new Date().toISOString()
  const { error: updateError } = await supabase
    .from("mindmap_draft_history")
    .update({ status: "undone", undone_at: undoneAt })
    .eq("id", history.id)
    .eq("user_id", userId)
  if (updateError) throw new Error(updateError.message)

  await appendChatMessageIfPossible(
    supabase,
    userId,
    history.chat_session_id,
    "元に戻しました。AI案の反映前のマインドマップに戻しました。",
  )

  return {
    history: { ...history, status: "undone" as const, undone_at: undoneAt },
    message: "元に戻しました。AI案の反映前のマインドマップに戻しました。",
  }
}

export async function redoMindmapDraftHistory({
  supabase,
  userId,
  historyId,
}: {
  supabase: SupabaseServerClient
  userId: string
  historyId: string
}) {
  const history = await loadHistory(supabase, userId, historyId)
  const payload = parseAppliedPayload(history.applied_payload)

  if (payload.created_tasks.length > 0) {
    const { error } = await supabase
      .from("tasks")
      .upsert(payload.created_tasks)
    if (error) throw new Error(error.message)
  }
  if (payload.updated_tasks_after.length > 0) {
    const { error } = await supabase
      .from("tasks")
      .upsert(payload.updated_tasks_after)
    if (error) throw new Error(error.message)
  }
  for (const node of payload.draft_nodes) {
    const taskId = node.task_id ?? node.draft_node_id
    if (jsonArray(node.source_links).length > 0) {
      await applySourceLinks(supabase, userId, history.project_id, taskId, node)
    }
  }

  const redoneAt = new Date().toISOString()
  const { error: updateError } = await supabase
    .from("mindmap_draft_history")
    .update({ status: "redone", redone_at: redoneAt })
    .eq("id", history.id)
    .eq("user_id", userId)
  if (updateError) throw new Error(updateError.message)

  return {
    history: { ...history, status: "redone" as const, redone_at: redoneAt },
    message: "やり直しました。AI案の反映を再適用しました。",
  }
}
