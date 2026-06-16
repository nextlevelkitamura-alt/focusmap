const ACTIVE_REFRESH_STATUSES = new Set([
  "pending",
  "running",
  "awaiting_approval",
  "needs_input",
]);

const DEFAULT_RECENT_WINDOW_MS = 10 * 60 * 1000;

type SnapshotLike = {
  status?: string | null;
  source_type?: string | null;
  source_id?: string | null;
  updated_at?: string | null;
};

type TaskLike = {
  id?: string | null;
  deleted_at?: string | null;
};

function timeMs(value: string | null | undefined) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function shouldRefreshForSnapshot(snapshot: SnapshotLike, nowMs: number, recentWindowMs: number) {
  if (snapshot.source_type !== "mindmap") return false;
  if (!snapshot.source_id?.trim()) return false;
  const status = snapshot.status?.trim() ?? "";
  if (!ACTIVE_REFRESH_STATUSES.has(status)) return false;
  if (status === "running") return true;
  const updatedMs = timeMs(snapshot.updated_at);
  return updatedMs > 0 && nowMs - updatedMs <= recentWindowMs;
}

export function missingTaskProgressSourceIds({
  snapshots,
  tasks,
  nowMs = Date.now(),
  recentWindowMs = DEFAULT_RECENT_WINDOW_MS,
}: {
  snapshots: SnapshotLike[];
  tasks: TaskLike[];
  nowMs?: number;
  recentWindowMs?: number;
}) {
  const existingTaskIds = new Set(
    tasks
      .filter(task => task.deleted_at == null)
      .map(task => task.id?.trim())
      .filter((id): id is string => !!id),
  );
  const missing = new Set<string>();
  for (const snapshot of snapshots) {
    if (!shouldRefreshForSnapshot(snapshot, nowMs, recentWindowMs)) continue;
    const sourceId = snapshot.source_id?.trim();
    if (sourceId && !existingTaskIds.has(sourceId)) missing.add(sourceId);
  }
  return Array.from(missing).sort();
}
