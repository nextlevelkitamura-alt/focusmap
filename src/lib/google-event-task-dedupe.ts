type GoogleEventTaskLike = {
  id: string
  google_event_id?: string | null
  source?: string | null
  status?: string | null
  deleted_at?: string | null
  updated_at?: string | null
  created_at?: string | null
}

function isGoogleLinkedTask(task: GoogleEventTaskLike): boolean {
  return !!task.google_event_id
}

function sourceRank(source?: string | null): number {
  if (!source) return 0
  return source === 'google_event' ? 1 : 2
}

function statusRank(status?: string | null): number {
  if (status === 'done') return 3
  if (status && status !== 'todo') return 2
  if (status === 'todo') return 1
  return 0
}

function dateValue(value?: string | null): number {
  if (!value) return 0
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? 0 : time
}

export function isPreferredGoogleEventTask<T extends GoogleEventTaskLike>(candidate: T, current: T): boolean {
  const candidateSourceRank = sourceRank(candidate.source)
  const currentSourceRank = sourceRank(current.source)
  if (candidateSourceRank !== currentSourceRank) return candidateSourceRank > currentSourceRank

  const candidateRank = statusRank(candidate.status)
  const currentRank = statusRank(current.status)
  if (candidateRank !== currentRank) return candidateRank > currentRank

  const candidateUpdated = dateValue(candidate.updated_at) || dateValue(candidate.created_at)
  const currentUpdated = dateValue(current.updated_at) || dateValue(current.created_at)
  if (candidateUpdated !== currentUpdated) return candidateUpdated > currentUpdated

  return candidate.id > current.id
}

export function pickPreferredGoogleEventTask<T extends GoogleEventTaskLike>(tasks: T[]): T | null {
  let preferred: T | null = null
  for (const task of tasks) {
    if (!preferred || isPreferredGoogleEventTask(task, preferred)) {
      preferred = task
    }
  }
  return preferred
}

export function dedupeGoogleEventTasks<T extends GoogleEventTaskLike>(tasks: T[]): T[] {
  const preferredByGoogleEventId = new Map<string, T>()

  for (const task of tasks) {
    if (task.deleted_at || !isGoogleLinkedTask(task) || !task.google_event_id) continue
    const current = preferredByGoogleEventId.get(task.google_event_id)
    if (!current || isPreferredGoogleEventTask(task, current)) {
      preferredByGoogleEventId.set(task.google_event_id, task)
    }
  }

  if (preferredByGoogleEventId.size === 0) return tasks

  const preferredIds = new Set([...preferredByGoogleEventId.values()].map(task => task.id))
  return tasks.filter(task => {
    if (task.deleted_at || !isGoogleLinkedTask(task) || !task.google_event_id) return true
    return preferredIds.has(task.id)
  })
}
