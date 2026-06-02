export type MindmapLinkPayload = Record<string, unknown> & {
  task_id?: unknown
  linked_at?: unknown
}

export type MemoColumnState = {
  is_completed?: boolean | null
  is_today?: boolean | null
  memo_status?: string | null
  scheduled_at?: string | null
  google_event_id?: string | null
}

export function readPayloadRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function readMindmapLinks(payload: unknown): MindmapLinkPayload[] {
  const links = readPayloadRecord(payload).mindmap_links
  if (!Array.isArray(links)) return []
  return links.filter((link): link is MindmapLinkPayload =>
    !!link && typeof link === "object" && !Array.isArray(link),
  )
}

export function getMindmapTaskIdsFromPayload(payload: unknown): string[] {
  return Array.from(new Set(
    readMindmapLinks(payload)
      .map(link => link.task_id)
      .filter((taskId): taskId is string => typeof taskId === "string" && taskId.length > 0),
  ))
}

export function hasManualMappedColumn(payload: unknown): boolean {
  return readPayloadRecord(payload).manual_column === "mapped"
}

export function removeManualMappedColumn(payload: unknown): Record<string, unknown> {
  const next = { ...readPayloadRecord(payload) }
  if (next.manual_column === "mapped") {
    delete next.manual_column
    delete next.manual_column_assigned_at
  }
  return next
}

export function removeMindmapLinksForTaskIds(payload: unknown, taskIds: Set<string>) {
  const current = readPayloadRecord(payload)
  const links = readMindmapLinks(current)
  const remainingLinks = links.filter(link =>
    typeof link.task_id !== "string" || !taskIds.has(link.task_id),
  )
  const removedLinks = links.filter(link =>
    typeof link.task_id === "string" && taskIds.has(link.task_id),
  )
  return {
    payload: {
      ...current,
      mindmap_links: remainingLinks,
    },
    removedLinks,
    remainingLinks,
  }
}

export function keepOnlyExistingMindmapLinks(payload: unknown, existingTaskIds: Set<string>) {
  const current = readPayloadRecord(payload)
  const links = readMindmapLinks(current)
  const remainingLinks = links.filter(link =>
    typeof link.task_id === "string" && existingTaskIds.has(link.task_id),
  )
  const removedLinks = links.filter(link =>
    typeof link.task_id !== "string" || !existingTaskIds.has(link.task_id),
  )
  return {
    payload: {
      ...current,
      mindmap_links: remainingLinks,
    },
    removedLinks,
    remainingLinks,
  }
}

export function shouldPreserveMemoColumn(item: MemoColumnState): boolean {
  return Boolean(
    item.is_completed ||
    item.memo_status === "completed" ||
    item.is_today ||
    item.google_event_id ||
    item.scheduled_at ||
    item.memo_status === "scheduled",
  )
}
