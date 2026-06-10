"use client"

import React, { useMemo, useState, useEffect, useCallback, useRef, useSyncExternalStore, Component, ErrorInfo, ReactNode } from 'react';
import { Task, Project } from "@/types/database";
import { MindMapDisplaySettingsPopover, MindMapDisplaySettings, loadSettings } from "@/components/dashboard/mindmap-display-settings";
import { useMultiTaskCalendarSync } from "@/hooks/useMultiTaskCalendarSync";
import { CustomMindMapView } from "@/components/mindmap/custom-mind-map-view";
import { CodexNodePanel } from "@/components/codex/codex-node-panel";
import { TaskProgressDetailPanel } from "@/components/task-progress/task-progress-detail-panel";
import { TaskProgressKanban } from "@/components/task-progress/task-progress-kanban";
import { useIsNarrowViewport } from "@/hooks/useIsNarrowViewport";
import { useMemoAiTasks } from "@/hooks/useMemoAiTasks";
import { useTaskProgressSnapshot } from "@/hooks/useTaskProgressSnapshot";
import { getCodexTaskUiState, type CodexTaskUiStateName } from "@/lib/codex-run-state";
import {
    CODEX_SOURCE_TASK_ARCHIVE_GRACE_MS,
    requestCodexThreadArchiveFromNode,
    setCodexSourceTaskCompletionFromNode,
} from "@/lib/codex-source-completion";
import { buildLongNodeHeadingPayload } from "@/lib/memo-ai-generation";
import { aiTaskToTaskProgressFallback } from "@/lib/task-progress-fallback";
import { LINKED_TASK_STATUS_EVENT } from "@/lib/calendar-constants";
import type { AiTask } from "@/types/ai-task";
import type { TaskProgressSnapshotTask, TaskProgressStatus } from "@/types/task-progress";

const waitForTaskStateFlush = () => new Promise<void>(resolve => {
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
        resolve();
        return;
    }
    window.requestAnimationFrame(() => resolve());
});

type MindMapCallbacks = {
    saveTaskTitle: (taskId: string, newTitle: string) => Promise<void>;
    addChildTask: (taskId: string) => Promise<void>;
    addSiblingTask: (taskId: string) => Promise<void>;
    deleteTask: (taskId: string) => Promise<void>;
    handleNavigate: (taskId: string, direction: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight') => void;
    promoteTask: (taskId: string) => Promise<void>;
    updateTaskScheduledAt: (taskId: string, dateStr: string | null) => Promise<void>;
    updateTaskPriority: (taskId: string, priority: number | null) => Promise<void>;
    updateTaskEstimatedTime: (taskId: string, minutes: number) => Promise<void>;
    onUpdateTask?: (taskId: string, updates: Partial<Task>) => Promise<void>;
    toggleTaskCollapse: (taskId: string) => void;
    createRootTaskAndFocus: (title: string) => Promise<void>;
    onUpdateProject?: (projectId: string, title: string) => Promise<void>;
    registerSchedule: (taskId: string, params: { scheduledAt: string | null; estimatedMinutes: number; calendarId: string | null }) => Promise<{ googleEventId?: string | null }>;
};

// --- Error Boundary ---
class MindMapErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
    constructor(props: { children: ReactNode }) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError(): { hasError: boolean } {
        return { hasError: true };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('[MindMap Error Boundary]', error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="w-full h-full bg-muted/5 flex items-center justify-center">
                    <div className="text-center text-muted-foreground">
                        <p className="text-sm">マインドマップでエラーが発生しました</p>
                        <button
                            onClick={() => this.setState({ hasError: false })}
                            className="text-xs text-primary underline mt-2"
                        >
                            再試行
                        </button>
                    </div>
                </div>
            );
        }
        return this.props.children;
    }
}

const fileToDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(new Error('Failed to read image file'));
        reader.readAsDataURL(file);
    });


const MINDMAP_CLIPBOARD_PREFIX = 'SHIKUMIKA_MINDMAP_NODE_V1:';
const TASK_PROGRESS_FIXTURE_STATUSES: TaskProgressStatus[] = ['running', 'awaiting_approval', 'completed', 'failed'];
const TASK_PROGRESS_ACTIVITY_HINT_STATUSES = new Set(['pending', 'running', 'awaiting_approval', 'needs_input']);

type MindMapClipboardNode = {
    title: string;
    status: string;
    priority: number | null;
    scheduled_at: string | null;
    estimated_time: number;
    is_habit: boolean;
    habit_frequency: string | null;
    habit_icon: string | null;
    habit_start_date: string | null;
    habit_end_date: string | null;
    memo: string | null;
    memo_images: string[] | null;
    children: MindMapClipboardNode[];
};

type MindMapClipboardPayload = {
    type: 'mindmap-node';
    version: 2;
    copiedAt: string;
    roots: MindMapClipboardNode[];
};

type MindMapClipboardPayloadV1 = {
    type: 'mindmap-node';
    version: 1;
    copiedAt?: string;
    root: MindMapClipboardNode;
};

type MindMapClipboardAnyPayload = MindMapClipboardPayload | MindMapClipboardPayloadV1;

function shouldUseTaskProgressFixture() {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    if (params.has('taskProgressFixture')) return true;
    return window.localStorage.getItem('focusmap:task-progress-fixture') === '1';
}

interface MindMapProps {
    project: Project
    groups: Task[]              // ルートタスク（parent_task_id === null）
    tasks: Task[]
    onCreateGroup?: (title: string) => Promise<Task | null>
    onDeleteGroup?: (groupId: string) => Promise<void>
    onReorderGroup?: (groupId: string, referenceGroupId: string, position: 'above' | 'below') => Promise<void>
    onUpdateProject?: (projectId: string, title: string) => Promise<void>
    onCreateTask?: (groupId: string, title?: string, parentTaskId?: string | null) => Promise<Task | null>
    onUpdateTask?: (taskId: string, updates: Partial<Task>) => Promise<void>
    onDeleteTask?: (taskId: string) => Promise<void>
    onBulkDelete?: (groupIds: string[], taskIds: string[]) => Promise<void>
    onReorderTask?: (taskId: string, referenceTaskId: string, position: 'above' | 'below') => Promise<void>
    onRefreshCalendar?: () => Promise<void>
    onAddOptimisticEvent?: (event: import('@/types/calendar').CalendarEvent) => void
    onRemoveOptimisticEvent?: (eventId: string) => void
    onOpenLinkedMemos?: (taskId: string) => void
}

function MindMapContent({ project, groups, tasks, onCreateGroup, onDeleteGroup, onReorderGroup, onUpdateProject, onCreateTask, onUpdateTask, onDeleteTask, onBulkDelete, onReorderTask, onRefreshCalendar, onAddOptimisticEvent, onRemoveOptimisticEvent, onOpenLinkedMemos }: MindMapProps) {
    const projectId = project?.id ?? '';

    // 画面幅 767px 以下でモバイルレイアウト（コンパクト化）
    const isNarrow = useIsNarrowViewport();

    // MindMap Display Settings
    const [displaySettings, setDisplaySettings] = useState<MindMapDisplaySettings>(() => loadSettings());

    // カレンダー同期（マインドマップのタスク全体）+ 楽観的UI更新
    useMultiTaskCalendarSync({
        tasks: [...groups, ...tasks], // ルートタスク + 子タスク
        onRefreshCalendar,
        onUpdateTask,
        onAddOptimisticEvent,
        onRemoveOptimisticEvent,
    });
    const allTasksByIdForCodex = useMemo(() => new Map([...groups, ...tasks].map(task => [task.id, task])), [groups, tasks]);
    const codexSourceTaskIds = useMemo(() => [...groups, ...tasks].map(task => task.id).filter(Boolean), [groups, tasks]);
    const [taskProgressFixtureEnabled] = useState(() => shouldUseTaskProgressFixture());
    const {
        bySourceId: aiTasksBySourceId,
        getBySourceId: getAiTaskBySourceId,
        refreshStatus: refreshAiTaskStatus,
    } = useMemoAiTasks({ sourceTaskIds: codexSourceTaskIds });
    const taskProgressFixtureTasks = useMemo<TaskProgressSnapshotTask[] | undefined>(() => {
        if (!taskProgressFixtureEnabled) return undefined;
        const sourceTasks = [...groups, ...tasks].slice(0, TASK_PROGRESS_FIXTURE_STATUSES.length);
        const now = new Date().toISOString();
        return sourceTasks.map((task, index) => {
            const status = TASK_PROGRESS_FIXTURE_STATUSES[index] ?? 'running';
            return {
                id: `fixture:${task.id}`,
                title: task.title,
                status,
                executor: 'codex_app',
                codex_thread_id: `fixture-thread-${index + 1}`,
                current_step: status === 'running'
                    ? '差分を確認してUIへ反映中'
                    : status === 'awaiting_approval'
                        ? 'ユーザー確認待ち'
                        : null,
                progress_percent: status === 'running' ? 62 : status === 'completed' ? 100 : null,
                summary: status === 'failed'
                    ? '検証でエラーが出ています'
                    : status === 'completed'
                        ? '変更は完了しました'
                        : 'Codex監視snapshotの表示確認',
                updated_at: now,
                source_type: 'mindmap',
                source_id: task.id,
            };
        });
    }, [groups, taskProgressFixtureEnabled, tasks]);
    const taskProgressActivityHintKey = useMemo(() => {
        const activeKeys: string[] = [];
        for (const task of aiTasksBySourceId.values()) {
            if (task.executor !== 'codex' && task.executor !== 'codex_app') continue;
            if (!TASK_PROGRESS_ACTIVITY_HINT_STATUSES.has(task.status)) continue;
            const result = task.result && typeof task.result === 'object' && !Array.isArray(task.result)
                ? task.result as Record<string, unknown>
                : {};
            const lastActivityAt = typeof result.last_activity_at === 'string' ? result.last_activity_at : '';
            activeKeys.push(`${task.id}:${task.status}:${task.started_at ?? ''}:${task.completed_at ?? ''}:${lastActivityAt}`);
        }
        return activeKeys.length > 0 ? activeKeys.sort().join('|') : null;
    }, [aiTasksBySourceId]);
    const [taskProgressPanelTaskId, setTaskProgressPanelTaskId] = useState<string | null>(null);
    const {
        tasks: taskProgressTasks,
        getById: getTaskProgressById,
        pollIntervalMs: taskProgressPollIntervalMs,
        isLoading: isTaskProgressSnapshotLoading,
        error: taskProgressSnapshotError,
        refresh: refreshTaskProgressSnapshot,
    } = useTaskProgressSnapshot({
        detailOpen: !!taskProgressPanelTaskId,
        activityHintKey: taskProgressActivityHintKey,
        fixtureTasks: taskProgressFixtureTasks,
    });
    const [isRefreshingTaskProgressSnapshot, setIsRefreshingTaskProgressSnapshot] = useState(false);
    const handleRefreshTaskProgressSnapshot = useCallback(async () => {
        setIsRefreshingTaskProgressSnapshot(true);
        try {
            await refreshTaskProgressSnapshot();
        } finally {
            setIsRefreshingTaskProgressSnapshot(false);
        }
    }, [refreshTaskProgressSnapshot]);
    const codexArchiveRequestTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
    const codexCompletionSyncInFlightRef = useRef(new Map<string, Promise<void>>());
    const codexCompletionLastSyncRef = useRef(new Map<string, { status: string; syncedAt: number }>());
    const taskStatusByIdRef = useRef(new Map<string, string | null | undefined>());
    useEffect(() => {
        const next = new Map<string, string | null | undefined>();
        for (const task of [...groups, ...tasks]) next.set(task.id, task.status);
        taskStatusByIdRef.current = next;
    }, [groups, tasks]);
    useEffect(() => {
        const timers = codexArchiveRequestTimersRef.current;
        return () => {
            for (const timer of timers.values()) clearTimeout(timer);
            timers.clear();
        };
    }, []);
    const clearCodexArchiveRequestTimer = useCallback((taskId: string) => {
        const timer = codexArchiveRequestTimersRef.current.get(taskId);
        if (!timer) return;
        clearTimeout(timer);
        codexArchiveRequestTimersRef.current.delete(taskId);
    }, []);
    const scheduleCodexArchiveRequest = useCallback((taskId: string, aiTask: AiTask) => {
        clearCodexArchiveRequestTimer(taskId);
        const timer = setTimeout(() => {
            codexArchiveRequestTimersRef.current.delete(taskId);
            if (taskStatusByIdRef.current.get(taskId) !== "done") return;
            void requestCodexThreadArchiveFromNode(aiTask)
                .then((requested) => requested
                    ? Promise.all([refreshAiTaskStatus(), refreshTaskProgressSnapshot()]).then(() => undefined)
                    : undefined)
                .catch((error) => {
                    console.error("[MindMap] Failed to request Codex thread archive from node status:", error);
                });
        }, CODEX_SOURCE_TASK_ARCHIVE_GRACE_MS);
        codexArchiveRequestTimersRef.current.set(taskId, timer);
    }, [clearCodexArchiveRequestTimer, refreshAiTaskStatus, refreshTaskProgressSnapshot]);
    const syncCodexSourceTaskCompletion = useCallback(async (taskId: string, status: string) => {
        if (status !== "done" && status !== "todo") return;

        const aiTask = aiTasksBySourceId.get(taskId);
        if (!aiTask || (aiTask.executor !== "codex" && aiTask.executor !== "codex_app")) return;

        const now = Date.now();
        const lastSync = codexCompletionLastSyncRef.current.get(taskId);
        if (lastSync?.status === status && now - lastSync.syncedAt < 2_000) return;

        const syncKey = `${taskId}:${status}`;
        const inFlight = codexCompletionSyncInFlightRef.current.get(syncKey);
        if (inFlight) {
            await inFlight;
            return;
        }

        clearCodexArchiveRequestTimer(taskId);
        const syncPromise = (async () => {
            try {
                await setCodexSourceTaskCompletionFromNode(aiTask, status === "done");
                codexCompletionLastSyncRef.current.set(taskId, { status, syncedAt: Date.now() });
                if (status === "done") scheduleCodexArchiveRequest(taskId, aiTask);
                await Promise.all([
                    refreshAiTaskStatus(),
                    refreshTaskProgressSnapshot(),
                ]);
            } catch (error) {
                console.error("[MindMap] Failed to update Codex completion from node status:", error);
            } finally {
                codexCompletionSyncInFlightRef.current.delete(syncKey);
            }
        })();
        codexCompletionSyncInFlightRef.current.set(syncKey, syncPromise);
        await syncPromise;
    }, [aiTasksBySourceId, clearCodexArchiveRequestTimer, refreshAiTaskStatus, refreshTaskProgressSnapshot, scheduleCodexArchiveRequest]);
    useEffect(() => {
        const handleLinkedTaskStatus = (event: Event) => {
            const detail = (event as CustomEvent<{ taskId?: unknown; status?: unknown }>).detail;
            const taskId = typeof detail?.taskId === "string" ? detail.taskId : null;
            const status = typeof detail?.status === "string" ? detail.status : null;
            if (!taskId || !status) return;
            void syncCodexSourceTaskCompletion(taskId, status);
        };
        window.addEventListener(LINKED_TASK_STATUS_EVENT, handleLinkedTaskStatus);
        return () => window.removeEventListener(LINKED_TASK_STATUS_EVENT, handleLinkedTaskStatus);
    }, [syncCodexSourceTaskCompletion]);
    const handleUpdateTaskStatus = useCallback(async (taskId: string, status: string) => {
        if (!onUpdateTask) return;
        await onUpdateTask(taskId, { status });
        await syncCodexSourceTaskCompletion(taskId, status);
    }, [onUpdateTask, syncCodexSourceTaskCompletion]);
    const taskProgressFallbackTasks = useMemo(() => {
        if (taskProgressFixtureEnabled) return [];
        const fallbackTasks: TaskProgressSnapshotTask[] = [];
        for (const [sourceId, aiTask] of aiTasksBySourceId.entries()) {
            const sourceTask = allTasksByIdForCodex.get(sourceId);
            if (!sourceTask) continue;
            const fallbackTask = aiTaskToTaskProgressFallback(aiTask, {
                id: sourceId,
                title: sourceTask.title,
            });
            if (fallbackTask) fallbackTasks.push(fallbackTask);
        }
        return fallbackTasks;
    }, [aiTasksBySourceId, allTasksByIdForCodex, taskProgressFixtureEnabled]);
    const taskProgressDisplayTasks = useMemo(() => {
        const merged = new Map<string, TaskProgressSnapshotTask>();
        for (const task of taskProgressFallbackTasks) merged.set(task.id, task);
        for (const task of taskProgressTasks) merged.set(task.id, task);
        return Array.from(merged.values());
    }, [taskProgressFallbackTasks, taskProgressTasks]);
    const appliedCodexCompletionKeysRef = useRef(new Set<string>());
    const codexRunByNodeId = useMemo(() => {
        const result: Record<string, { state: CodexTaskUiStateName; taskId: string; label: string; lastActivityAt?: string | null; updatedAt?: string | null }> = {};
        for (const task of allTasksByIdForCodex.values()) {
            const aiTask = getAiTaskBySourceId(task.id);
            const uiState = getCodexTaskUiState(aiTask);
            if (!aiTask || !uiState) continue;
            const aiResult = aiTask.result && typeof aiTask.result === "object" && !Array.isArray(aiTask.result)
                ? aiTask.result as Record<string, unknown>
                : {};
            const lastActivityAt = typeof aiResult.last_activity_at === "string" ? aiResult.last_activity_at : null;
            result[task.id] = {
                state: uiState.state,
                taskId: aiTask.id,
                label: uiState.label,
                lastActivityAt,
                updatedAt: lastActivityAt ?? aiTask.completed_at ?? aiTask.started_at ?? aiTask.created_at,
            };
        }
        return result;
    }, [allTasksByIdForCodex, getAiTaskBySourceId]);
    const taskProgressByNodeId = useMemo(() => {
        const result: Record<string, TaskProgressSnapshotTask> = {};
        const snapshotByAiTaskId = new Map(taskProgressDisplayTasks.map(task => [task.id, task]));
        for (const progressTask of taskProgressDisplayTasks) {
            if (progressTask.source_type === 'mindmap' && progressTask.source_id && allTasksByIdForCodex.has(progressTask.source_id)) {
                result[progressTask.source_id] = progressTask;
            }
        }
        for (const task of allTasksByIdForCodex.values()) {
            if (result[task.id]) continue;
            const aiTask = getAiTaskBySourceId(task.id);
            const progressTask = aiTask ? snapshotByAiTaskId.get(aiTask.id) : null;
            if (progressTask) result[task.id] = progressTask;
        }
        return result;
    }, [allTasksByIdForCodex, getAiTaskBySourceId, taskProgressDisplayTasks]);
    const taskProgressPanelTask = useMemo(() => {
        if (!taskProgressPanelTaskId) return null;
        return getTaskProgressById(taskProgressPanelTaskId) ?? taskProgressDisplayTasks.find(task => task.id === taskProgressPanelTaskId) ?? null;
    }, [getTaskProgressById, taskProgressDisplayTasks, taskProgressPanelTaskId]);
    const handleOpenTaskProgress = useCallback((task: TaskProgressSnapshotTask) => {
        setTaskProgressPanelTaskId(task.id);
    }, []);
    const codexCompletedNodeUpdates = useMemo(() => {
        const updates: Array<{ taskId: string; key: string }> = [];
        for (const task of allTasksByIdForCodex.values()) {
            if (task.status === "done") continue;
            const aiTask = aiTasksBySourceId.get(task.id);
            if (!aiTask || (aiTask.executor !== "codex" && aiTask.executor !== "codex_app")) continue;
            if (aiTask.status !== "completed") continue;
            const aiResult = aiTask.result && typeof aiTask.result === "object" && !Array.isArray(aiTask.result)
                ? aiTask.result as Record<string, unknown>
                : {};
            if (aiResult.codex_source_task_completion_suppressed === true) continue;
            const reason = typeof aiResult.codex_review_reason === "string" ? aiResult.codex_review_reason : "";
            const completionReason = typeof aiResult.codex_source_task_completion_reason === "string"
                ? aiResult.codex_source_task_completion_reason
                : "";
            const closedFromCodex =
                aiResult.codex_source_task_completed === true &&
                reason !== "thread_deleted" &&
                completionReason !== "thread_deleted";
            if (!closedFromCodex) continue;
            const completedAt = typeof aiTask.completed_at === "string" ? aiTask.completed_at : "";
            updates.push({ taskId: task.id, key: `${task.id}:${aiTask.id}:${completedAt || reason}` });
        }
        return updates;
    }, [aiTasksBySourceId, allTasksByIdForCodex]);
    useEffect(() => {
        if (!onUpdateTask || codexCompletedNodeUpdates.length === 0) return;
        for (const update of codexCompletedNodeUpdates) {
            if (appliedCodexCompletionKeysRef.current.has(update.key)) continue;
            appliedCodexCompletionKeysRef.current.add(update.key);
            void onUpdateTask(update.taskId, { status: "done", stage: "done" });
        }
    }, [codexCompletedNodeUpdates, onUpdateTask]);
    // STATE
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
    const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
    const [clipboardFeedback, setClipboardFeedback] = useState<string | null>(null);
    const [pendingEditNodeId, setPendingEditNodeId] = useState<string | null>(null);
    const collapsedStorageKey = projectId ? `focusmap:collapsed:${projectId}` : '';
    const [collapsedTaskIds, setCollapsedTaskIds] = useState<Set<string>>(() => {
        if (typeof window === 'undefined' || !collapsedStorageKey) return new Set();
        try {
            const raw = window.localStorage.getItem(collapsedStorageKey);
            if (!raw) return new Set();
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return new Set(parsed as string[]);
        } catch (err) {
            console.warn('[MindMap] Failed to restore collapsed state:', err);
        }
        return new Set();
    });

    // localStorage 永続化: collapsedTaskIds 変化時に保存
    useEffect(() => {
        if (typeof window === 'undefined' || !collapsedStorageKey) return;
        try {
            if (collapsedTaskIds.size === 0) {
                window.localStorage.removeItem(collapsedStorageKey);
            } else {
                window.localStorage.setItem(collapsedStorageKey, JSON.stringify(Array.from(collapsedTaskIds)));
            }
        } catch (err) {
            console.warn('[MindMap] Failed to persist collapsed state:', err);
        }
    }, [collapsedTaskIds, collapsedStorageKey]);
    const selectedNodeIdRef = useRef<string | null>(null);
    const clipboardFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const flashClipboardFeedback = useCallback((message: string) => {
        if (clipboardFeedbackTimerRef.current) {
            clearTimeout(clipboardFeedbackTimerRef.current);
            clipboardFeedbackTimerRef.current = null;
        }
        setClipboardFeedback(message);
        clipboardFeedbackTimerRef.current = setTimeout(() => {
            setClipboardFeedback(null);
            clipboardFeedbackTimerRef.current = null;
        }, 1400);
    }, []);

    // Codex ノードパネル（実行/往復/作業場所/プロンプト編集を一元化）の対象ノード
    const [codexPanelTaskId, setCodexPanelTaskId] = useState<string | null>(null);
    const [generatingHeadingNodeIds, setGeneratingHeadingNodeIds] = useState<Set<string>>(new Set());
    const mindMapTaskNodes = useMemo(() => [...groups, ...tasks], [groups, tasks]);

    // ノードの「Codex」ボタン / 状態アイコン → Codex ノードパネルを開く（実行はパネルから）
    const handleRunCodex = useCallback((taskId: string) => {
        setCodexPanelTaskId(taskId);
    }, []);

    // codex_work_dir を per-node に保存
    const persistCodexDir = useCallback(async (taskId: string, dir: string) => {
        try { await onUpdateTask?.(taskId, { codex_work_dir: dir }); } catch { /* 永続化失敗でも続行 */ }
    }, [onUpdateTask]);

    // よく使う候補（履歴の codex_work_dir + プロジェクトの repo_path）
    const codexDirCandidates = useMemo(() => {
        const set = new Set<string>();
        const repo = (project?.repo_path ?? '').trim();
        if (repo) set.add(repo);
        for (const t of mindMapTaskNodes) {
            const d = (t.codex_work_dir ?? '').trim();
            if (d) set.add(d);
        }
        return Array.from(set);
    }, [mindMapTaskNodes, project?.repo_path]);

    // パネルに渡すノード情報
    const codexPanelNode = useMemo(() => {
        if (!codexPanelTaskId) return null;
        const task = mindMapTaskNodes.find(t => t.id === codexPanelTaskId);
        if (!task) return null;
        const aiTask = getAiTaskBySourceId(task.id);
        const aiResult = aiTask?.result && typeof aiTask.result === "object" && !Array.isArray(aiTask.result)
            ? aiTask.result as Record<string, unknown>
            : {};
        const threadId =
            (typeof aiTask?.codex_thread_id === "string" && aiTask.codex_thread_id.trim()) ||
            (typeof aiResult.codex_thread_id === "string" && aiResult.codex_thread_id.trim()) ||
            "";
        const threadUrlFromResult = typeof aiResult.codex_thread_url === "string" ? aiResult.codex_thread_url.trim() : "";
        return {
            taskId: task.id,
            title: task.title,
            memo: (task.memo ?? '').trim(),
            cwd: task.codex_work_dir ?? null,
            status: task.codex_status ?? null,
            codexThreadUrl: threadId ? `codex://threads/${threadId}` : threadUrlFromResult || null,
            scheduledLabel: task.scheduled_at ? task.scheduled_at.slice(0, 10) : null,
            priority: task.priority ?? null,
            estimatedLabel: task.estimated_time ? `${task.estimated_time}分` : null,
            isDone: task.status === 'done',
            hasMemo: !!(task.memo && task.memo.trim()),
        };
    }, [codexPanelTaskId, getAiTaskBySourceId, mindMapTaskNodes]);

    const applySelection = useCallback((ids: Set<string>, primaryId: string | null) => {
        setSelectedNodeIds(ids);
        setSelectedNodeId(primaryId);
        selectedNodeIdRef.current = primaryId;
    }, []);

    // HELPER: Find the editable element (textarea or input) inside a node
    const findEditableElement = useCallback((nodeElement: Element): HTMLTextAreaElement | HTMLInputElement | null => {
        return (nodeElement.querySelector('textarea') ?? nodeElement.querySelector('input')) as HTMLTextAreaElement | HTMLInputElement | null;
    }, []);

    // HELPER: Persistent DOM polling using setInterval
    // Ensures focus is captured even if React renders are delayed
    // CRITICAL: Waits for input element to appear (new nodes need time to enter edit mode)
    // RACE CONDITION FIX: Cancels previous focus operation when new one starts
    const activeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const focusNodeWithPollingV2 = useCallback((targetId: string, maxDuration: number = 800, preferInput: boolean = true) => {
        const startTime = Date.now();
        const pollingInterval = 10;
        const inputWaitThreshold = 500; // 新規ノードの input 出現を待つ時間を延長

        // Cancel any ongoing focus operation
        if (activeTimerRef.current) {
            clearInterval(activeTimerRef.current);
            activeTimerRef.current = null;
        }

        // 既存のフォーカスを即座にクリア（新規ノード追加時に古いノードへの入力を防ぐ）
        if (typeof document !== 'undefined' && preferInput) {
            const currentActive = document.activeElement as HTMLElement | null;
            const isMindMapFocus =
                !!currentActive?.closest?.('[data-testid="custom-mind-map-viewport"]') ||
                currentActive?.tagName === 'INPUT' ||
                currentActive?.tagName === 'TEXTAREA';
            if (currentActive && isMindMapFocus) {
                currentActive.blur();
            }
        }

        const timer = setInterval(() => {
            const elapsed = Date.now() - startTime;
            const currentSelected = selectedNodeIdRef.current;
            if (currentSelected && currentSelected !== targetId) {
                clearInterval(timer);
                activeTimerRef.current = null;
                return;
            }

                const nodeElement = document.querySelector(`[data-id="${targetId}"]`);

            if (nodeElement) {
                const editableEl = findEditableElement(nodeElement);
                const wrapperElement = nodeElement.querySelector('[tabindex="0"]') as HTMLElement;

                // input 要素が出現するまで待機（新規ノードは triggerEdit で input が遅れて表示される）
                if (preferInput && !editableEl && elapsed < inputWaitThreshold) {
                    return;
                }

                const targetElement = preferInput
                    ? (editableEl ?? wrapperElement ?? (nodeElement as HTMLElement))
                    : (wrapperElement ?? (nodeElement as HTMLElement));

                if (targetElement) {
                    targetElement.focus();
                    if (preferInput && editableEl && targetElement === editableEl) {
                        const len = editableEl.value.length;
                        editableEl.setSelectionRange(len, len);
                    }
                    clearInterval(timer);
                    activeTimerRef.current = null;
                    return;
                }
            }

            if (elapsed > maxDuration) {
                clearInterval(timer);
                activeTimerRef.current = null;
            }
        }, pollingInterval);

        activeTimerRef.current = timer;
    }, [findEditableElement]);

    // EFFECT: Clear pendingEditNodeId after a delay
    useEffect(() => {
        if (pendingEditNodeId) {
            const timer = setTimeout(() => {
                setPendingEditNodeId(null);
            }, 1200);
            return () => clearTimeout(timer);
        }
    }, [pendingEditNodeId]);

    useEffect(() => {
        return () => {
            if (clipboardFeedbackTimerRef.current) {
                clearTimeout(clipboardFeedbackTimerRef.current);
            }
        };
    }, []);

    // Helpers
    const getTaskById = useCallback((id: string) => {
        return tasks.find(t => t.id === id) ?? groups.find(g => g.id === id);
    }, [tasks, groups]);
    const hasChildren = useCallback((taskId: string) => tasks.some(t => t.parent_task_id === taskId), [tasks]);
    const isDescendant = useCallback((ancestorId: string, childId: string): boolean => {
        const allTasksMap = new Map([...groups, ...tasks].map(t => [t.id, t]));
        let current = allTasksMap.get(childId);
        const visited = new Set<string>();
        while (current?.parent_task_id) {
            if (current.parent_task_id === ancestorId) return true;
            if (visited.has(current.parent_task_id)) break;
            visited.add(current.parent_task_id);
            current = allTasksMap.get(current.parent_task_id);
        }
        return false;
    }, [groups, tasks]);

    const getIsTypingTarget = useCallback((target: EventTarget | null) => {
        const el = target as HTMLElement | null;
        if (!el) return false;
        if (el.isContentEditable) return true;
        if (el.closest('input, textarea, [contenteditable="true"]')) return true;
        return false;
    }, []);

    const appendImagesToNode = useCallback(async (nodeId: string, imageUrls: string[]) => {
        if (!onUpdateTask || !nodeId || nodeId === 'project-root' || imageUrls.length === 0) return;

        const targetTask = tasks.find(t => t.id === nodeId) ?? groups.find(g => g.id === nodeId);
        if (!targetTask) return;

        const existing = Array.isArray(targetTask.memo_images)
            ? targetTask.memo_images.filter((url): url is string => typeof url === 'string' && !!url.trim())
            : [];
        const merged = Array.from(new Set([...existing, ...imageUrls.filter(Boolean)]));

        try {
            await onUpdateTask(nodeId, { memo_images: merged.length > 0 ? merged : null });
            flashClipboardFeedback(`${imageUrls.length}枚の画像を追加しました`);
        } catch (error) {
            console.error('[MindMap] Failed to paste images:', error);
            flashClipboardFeedback('画像の貼り付けに失敗しました');
        }
    }, [onUpdateTask, tasks, groups, flashClipboardFeedback]);

    const handleGenerateHeadingFromLongNode = useCallback(async (taskId: string) => {
        if (!onUpdateTask) return;
        if (generatingHeadingNodeIds.has(taskId)) return;

        const targetTask = tasks.find(t => t.id === taskId) ?? groups.find(g => g.id === taskId);
        if (!targetTask) return;

        const { detail, pendingHeading } = buildLongNodeHeadingPayload(targetTask.title, targetTask.memo);
        if (!detail) return;

        setGeneratingHeadingNodeIds(prev => {
            const next = new Set(prev);
            next.add(taskId);
            return next;
        });

        let memoSaved = false;
        try {
            await onUpdateTask(taskId, {
                title: pendingHeading,
                memo: detail,
            });
            memoSaved = true;
            flashClipboardFeedback("メモ化しました。見出し生成中です");

            const res = await fetch("/api/ai/generate-memo-heading", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ detail, currentHeading: pendingHeading }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(typeof data.error === "string" ? data.error : "見出し生成に失敗しました");
            }

            const heading = typeof data.heading === "string" ? data.heading.trim() : "";
            if (!heading) throw new Error("見出し生成に失敗しました");

            await onUpdateTask(taskId, {
                title: heading,
                memo: detail,
            });
            flashClipboardFeedback("AI見出しに更新しました");
        } catch (error) {
            console.error("[MindMap] Failed to generate heading from long node:", error);
            const message = error instanceof Error ? error.message : "見出し生成に失敗しました";
            flashClipboardFeedback(memoSaved ? `メモ化済み。${message}` : message);
        } finally {
            setGeneratingHeadingNodeIds(prev => {
                const next = new Set(prev);
                next.delete(taskId);
                return next;
            });
        }
    }, [flashClipboardFeedback, generatingHeadingNodeIds, groups, onUpdateTask, tasks]);

    const handleContainerPasteCapture = useCallback((event: React.ClipboardEvent<HTMLDivElement>) => {
        const clipboard = event.clipboardData;
        if (!clipboard) return;

        const imageFiles = Array.from(clipboard.items ?? [])
            .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
            .map(item => item.getAsFile())
            .filter((file): file is File => file instanceof File);

        if (imageFiles.length === 0) return;

        const targetNodeId = selectedNodeIdRef.current ?? selectedNodeId;
        if (!targetNodeId || targetNodeId === 'project-root') return;

        event.preventDefault();
        event.stopPropagation();

        void (async () => {
            try {
                const encoded = await Promise.all(imageFiles.map(fileToDataUrl));
                const imageUrls = encoded.filter(Boolean);
                if (imageUrls.length === 0) return;
                await appendImagesToNode(targetNodeId, imageUrls);
            } catch (error) {
                console.error('[MindMap] Failed to process pasted images:', error);
                flashClipboardFeedback('画像の読み取りに失敗しました');
            }
        })();
    }, [selectedNodeId, appendImagesToNode, flashClipboardFeedback]);

    const buildClipboardNode = useCallback((rootId: string): MindMapClipboardNode | null => {
        const allById = new Map([...groups, ...tasks].map(task => [task.id, task]));
        const rootTask = allById.get(rootId);
        if (!rootTask) return null;

        const childrenByParent = new Map<string, Task[]>();
        for (const task of tasks) {
            if (!task.parent_task_id) continue;
            const arr = childrenByParent.get(task.parent_task_id) ?? [];
            arr.push(task);
            childrenByParent.set(task.parent_task_id, arr);
        }
        for (const [, childList] of childrenByParent) {
            childList.sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
        }

        const serialize = (task: Task): MindMapClipboardNode => {
            const children = childrenByParent.get(task.id) ?? [];
            return {
                title: task.title ?? 'New Task',
                status: task.status ?? 'todo',
                priority: task.priority ?? null,
                scheduled_at: task.scheduled_at ?? null,
                estimated_time: task.estimated_time ?? 0,
                is_habit: task.is_habit ?? false,
                habit_frequency: task.habit_frequency ?? null,
                habit_icon: task.habit_icon ?? null,
                habit_start_date: task.habit_start_date ?? null,
                habit_end_date: task.habit_end_date ?? null,
                memo: task.memo ?? null,
                memo_images: task.memo_images ?? null,
                children: children.map(serialize),
            };
        };

        return serialize(rootTask);
    }, [groups, tasks]);

    const getCopyRootNodeIds = useCallback((): string[] => {
        const selectedIds = Array.from(selectedNodeIds).filter(id => id !== 'project-root');
        if (selectedIds.length === 0) return [];

        const allById = new Map([...groups, ...tasks].map(task => [task.id, task]));
        const selectedSet = new Set(selectedIds);

        const isTopLevelSelected = (taskId: string): boolean => {
            let current = allById.get(taskId);
            const visited = new Set<string>();
            while (current?.parent_task_id) {
                if (selectedSet.has(current.parent_task_id)) return false;
                if (visited.has(current.parent_task_id)) break;
                visited.add(current.parent_task_id);
                current = allById.get(current.parent_task_id);
            }
            return true;
        };

        const roots = selectedIds.filter(isTopLevelSelected);
        roots.sort((a, b) => {
            const taskA = allById.get(a);
            const taskB = allById.get(b);
            return (taskA?.order_index ?? 0) - (taskB?.order_index ?? 0);
        });

        if (selectedNodeId && selectedNodeId !== 'project-root' && roots.includes(selectedNodeId)) {
            return [selectedNodeId, ...roots.filter(id => id !== selectedNodeId)];
        }
        return roots;
    }, [selectedNodeIds, selectedNodeId, groups, tasks]);

    const normalizeClipboardPayload = useCallback((raw: MindMapClipboardAnyPayload): MindMapClipboardPayload | null => {
        if (!raw || raw.type !== 'mindmap-node') return null;
        if (raw.version === 2 && Array.isArray((raw as MindMapClipboardPayload).roots)) {
            const roots = (raw as MindMapClipboardPayload).roots.filter(Boolean);
            if (roots.length === 0) return null;
            return {
                type: 'mindmap-node',
                version: 2,
                copiedAt: raw.copiedAt || new Date().toISOString(),
                roots,
            };
        }
        if (raw.version === 1 && (raw as MindMapClipboardPayloadV1).root) {
            return {
                type: 'mindmap-node',
                version: 2,
                copiedAt: raw.copiedAt || new Date().toISOString(),
                roots: [(raw as MindMapClipboardPayloadV1).root],
            };
        }
        return null;
    }, []);

    const pasteClipboardTree = useCallback(async (payload: MindMapClipboardPayload) => {
        if (payload.roots.length === 0) return;
        const anchorId = selectedNodeId && selectedNodeId !== 'project-root' ? selectedNodeId : null;

        const applyCopiedFields = async (nodeId: string, sourceNode: MindMapClipboardNode) => {
            if (!onUpdateTask) return;
            await onUpdateTask(nodeId, {
                status: sourceNode.status ?? 'todo',
                priority: sourceNode.priority ?? null,
                scheduled_at: sourceNode.scheduled_at ?? null,
                estimated_time: sourceNode.estimated_time ?? 0,
                is_habit: sourceNode.is_habit ?? false,
                habit_frequency: sourceNode.habit_frequency ?? null,
                habit_icon: sourceNode.habit_icon ?? null,
                habit_start_date: sourceNode.habit_start_date ?? null,
                habit_end_date: sourceNode.habit_end_date ?? null,
                memo: sourceNode.memo ?? null,
                memo_images: sourceNode.memo_images ?? null,
                calendar_id: null,
                google_event_id: null,
                calendar_event_id: null,
            });
        };

        const createNodeRecursive = async (sourceNode: MindMapClipboardNode, parentId: string | null, isRoot: boolean): Promise<string | null> => {
            const title = (sourceNode.title || '').trim() || 'New Task';
            let created: Task | null = null;

            if (isRoot && parentId === null) {
                created = await onCreateGroup?.(title) ?? null;
            } else {
                if (!parentId) return null;
                created = await onCreateTask?.(parentId, title, parentId) ?? null;
            }

            if (!created?.id) return null;
            await applyCopiedFields(created.id, sourceNode);

            for (const childNode of sourceNode.children ?? []) {
                await createNodeRecursive(childNode, created.id, false);
            }
            return created.id;
        };

        const createdRootIds: string[] = [];
        for (const root of payload.roots) {
            const createdRootId = await createNodeRecursive(root, anchorId, anchorId === null);
            if (createdRootId) createdRootIds.push(createdRootId);
        }

        if (createdRootIds.length > 0) {
            const primaryId = createdRootIds[0];
            applySelection(new Set(createdRootIds), primaryId);
            focusNodeWithPollingV2(primaryId, 300, false);
            flashClipboardFeedback(`${createdRootIds.length}件のノードを貼り付けました`);
        }
    }, [selectedNodeId, onCreateGroup, onCreateTask, onUpdateTask, applySelection, focusNodeWithPollingV2, flashClipboardFeedback]);

    const toggleTaskCollapse = useCallback((taskId: string) => {
        setCollapsedTaskIds(prev => {
            const next = new Set(prev);
            if (next.has(taskId)) {
                next.delete(taskId);
            } else {
                next.add(taskId);
            }
            return next;
        });
    }, []);

    const createRootTaskAndFocus = useCallback(async (title: string) => {
        if (!onCreateGroup) return;
        const newTask = await onCreateGroup(title);
        if (newTask?.id) {
            setPendingEditNodeId(newTask.id);
            applySelection(new Set([newTask.id]), newTask.id);
            focusNodeWithPollingV2(newTask.id, 500, true);
        }
    }, [onCreateGroup, applySelection, focusNodeWithPollingV2]);

    const calculateNextFocus = useCallback((taskId: string): string | null => {
        // ルートタスクの場合
        const isRootTask = groups.some(g => g.id === taskId);
        if (isRootTask) {
            const sorted = [...groups].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
            const idx = sorted.findIndex(g => g.id === taskId);
            if (idx === -1) return 'project-root';
            if (idx < sorted.length - 1) return sorted[idx + 1].id;
            if (idx > 0) return sorted[idx - 1].id;
            return 'project-root';
        }

        const task = getTaskById(taskId);
        if (!task) return null;

        // 同じ parent_task_id を持つタスクが兄弟
        const allSiblings = tasks
            .filter(t => t.parent_task_id === task.parent_task_id)
            .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));

        const currentIndex = allSiblings.findIndex(t => t.id === taskId);

        // XMind-style delete focus order: 下→上→親
        if (currentIndex < allSiblings.length - 1) return allSiblings[currentIndex + 1].id;
        if (currentIndex > 0) return allSiblings[currentIndex - 1].id;
        if (task.parent_task_id) return task.parent_task_id;
        return 'project-root';
    }, [groups, tasks, getTaskById]);

    // Add child task（統一版：ルートタスクも子タスクも同じ処理）
    const addChildTask = useCallback(async (parentTaskId: string) => {
        if (!onCreateTask) return;

        // Auto-expand parent when adding a child
        setCollapsedTaskIds(prev => {
            if (!prev.has(parentTaskId)) return prev;
            const next = new Set(prev);
            next.delete(parentTaskId);
            return next;
        });

        const newTask = await onCreateTask(parentTaskId, "", parentTaskId);
        if (newTask) {
            setPendingEditNodeId(newTask.id);
            applySelection(new Set([newTask.id]), newTask.id);
            focusNodeWithPollingV2(newTask.id);
        }
    }, [onCreateTask, focusNodeWithPollingV2, applySelection]);

    // Add sibling task（統一版：ルートタスクなら新しいルートを作成）
    const addSiblingTask = useCallback(async (taskId: string) => {
        // ルートタスクの場合 → 新しいルートタスクを作成
        const isRootTask = groups.some(g => g.id === taskId);
        if (isRootTask) {
            if (!onCreateGroup) return;
            const newTask = await onCreateGroup("");
            if (newTask?.id) {
                setPendingEditNodeId(newTask.id);
                applySelection(new Set([newTask.id]), newTask.id);
                focusNodeWithPollingV2(newTask.id);
                void (async () => {
                    await waitForTaskStateFlush();
                    if (onReorderGroup) {
                        await onReorderGroup(newTask.id, taskId, 'below');
                    } else {
                        await onReorderTask?.(newTask.id, taskId, 'below');
                    }
                })().catch(error => {
                    console.error('[MindMap] Failed to reorder root sibling after create:', error);
                });
            }
            return;
        }

        const task = getTaskById(taskId);
        if (!task || !onCreateTask || !task.parent_task_id) return;

        // Auto-expand parent when adding a sibling under a collapsed parent
        setCollapsedTaskIds(prev => {
            if (!prev.has(task.parent_task_id!)) return prev;
            const next = new Set(prev);
            next.delete(task.parent_task_id!);
            return next;
        });

        const newTask = await onCreateTask(task.parent_task_id, "", task.parent_task_id);
        if (newTask) {
            setPendingEditNodeId(newTask.id);
            applySelection(new Set([newTask.id]), newTask.id);
            focusNodeWithPollingV2(newTask.id);
            void (async () => {
                await waitForTaskStateFlush();
                await onReorderTask?.(newTask.id, taskId, 'below');
            })().catch(error => {
                console.error('[MindMap] Failed to reorder sibling after create:', error);
            });
        }
    }, [groups, getTaskById, onCreateGroup, onCreateTask, onReorderGroup, onReorderTask, focusNodeWithPollingV2, applySelection]);

    // Promote task (Shift+Tab: 子タスクを親の兄弟に昇格、ルート直下ならルートに昇格)
    const promoteTask = useCallback(async (taskId: string) => {
        const task = getTaskById(taskId);
        if (!task || !onUpdateTask) return;

        // 親タスクを取得
        const parentTask = task.parent_task_id ? getTaskById(task.parent_task_id) : null;
        if (!parentTask) {
            // 既にルートタスク → 昇格不要
            return;
        }

        // 祖父（親の親）のIDを取得 = 昇格先の parent_task_id
        const grandparentId = parentTask.parent_task_id;

        if (grandparentId) {
            // parent_task_id を祖父に変更 → 親の兄弟になる
            await onUpdateTask(taskId, { parent_task_id: grandparentId });
        } else {
            // 親がルートタスク → ルートレベルに昇格
            await onUpdateTask(taskId, { parent_task_id: null, project_id: project?.id ?? null });
        }
        focusNodeWithPollingV2(taskId);
    }, [getTaskById, onUpdateTask, focusNodeWithPollingV2, project?.id]);

    // Delete task（フォーカス移動を即座に行い、API呼び出しはバックグラウンドで実行）
    const deleteTask = useCallback(async (taskId: string) => {
        if (!onDeleteTask) return;

        if (hasChildren(taskId)) {
            if (typeof window === 'undefined') return;
            const confirmed = window.confirm('子タスクを含むタスクを削除しますか？\nすべての子タスクも削除されます。');
            if (!confirmed) return;
        }

        const nextFocusId = calculateNextFocus(taskId);
        // 削除をバックグラウンドで実行（await しない → フォーカス移動が即座に行われる）
        onDeleteTask(taskId);
        applySelection(nextFocusId ? new Set([nextFocusId]) : new Set(), nextFocusId);
        if (nextFocusId) {
            if (isNarrow) {
                setPendingEditNodeId(nextFocusId);
            }
            focusNodeWithPollingV2(nextFocusId, 300, false);
        }
    }, [hasChildren, isNarrow, calculateNextFocus, onDeleteTask, applySelection, focusNodeWithPollingV2]);

    // Navigation helpers for arrow keys（ルートタスク対応）
    const navigateToSibling = useCallback((taskId: string, direction: 'up' | 'down'): string | null => {
        // ルートタスクの場合
        const isRootTask = groups.some(g => g.id === taskId);
        if (isRootTask) {
            const sorted = [...groups].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
            const idx = sorted.findIndex(g => g.id === taskId);
            if (idx === -1) return null;
            const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
            return sorted[targetIdx]?.id ?? null;
        }

        const task = getTaskById(taskId);
        if (!task) return null;

        const siblings = tasks
            .filter(t => t.parent_task_id === task.parent_task_id)
            .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));

        const currentIndex = siblings.findIndex(t => t.id === taskId);
        if (currentIndex === -1) return null;

        const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
        return siblings[targetIndex]?.id ?? null;
    }, [groups, tasks, getTaskById]);

    const navigateToParent = useCallback((taskId: string): string | null => {
        const isRootTask = groups.some(g => g.id === taskId);
        if (isRootTask) return 'project-root';

        const task = getTaskById(taskId);
        if (!task) return null;
        return task.parent_task_id ?? 'project-root';
    }, [groups, getTaskById]);

    const navigateToFirstChild = useCallback((taskId: string): string | null => {
        const children = tasks
            .filter(t => t.parent_task_id === taskId)
            .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
        return children[0]?.id ?? null;
    }, [tasks]);

    const handleNavigate = useCallback((taskId: string, direction: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight') => {
        let targetId: string | null = null;

        switch (direction) {
            case 'ArrowUp':
                targetId = navigateToSibling(taskId, 'up');
                break;
            case 'ArrowDown':
                targetId = navigateToSibling(taskId, 'down');
                break;
            case 'ArrowLeft':
                targetId = navigateToParent(taskId);
                break;
            case 'ArrowRight':
                targetId = navigateToFirstChild(taskId);
                break;
        }

        if (targetId) {
            applySelection(new Set([targetId]), targetId);
            focusNodeWithPollingV2(targetId, 200, true);
        }
    }, [navigateToSibling, navigateToParent, navigateToFirstChild, applySelection, focusNodeWithPollingV2]);

    // Save task title
    const saveTaskTitle = useCallback(async (taskId: string, newTitle: string) => {
        if (onUpdateTask && newTitle.trim()) {
            await onUpdateTask(taskId, { title: newTitle.trim() });
        }
    }, [onUpdateTask]);

    // Update scheduled_at
    const updateTaskScheduledAt = useCallback(async (taskId: string, dateStr: string | null) => {
        if (onUpdateTask) {
            await onUpdateTask(taskId, { scheduled_at: dateStr });
        }
    }, [onUpdateTask]);

    const registerSchedule = useCallback(async (taskId: string, params: { scheduledAt: string | null; estimatedMinutes: number; calendarId: string | null }) => {
        if (!params.scheduledAt || !params.estimatedMinutes || !params.calendarId) {
            throw new Error('スケジュール登録には所要時間・日時・カレンダーすべて必要です');
        }
        if (onUpdateTask) {
            await onUpdateTask(taskId, {
                scheduled_at: params.scheduledAt,
                estimated_time: params.estimatedMinutes,
                calendar_id: params.calendarId,
            });
        }
        const res = await fetch('/api/calendar/sync-task', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                taskId,
                scheduled_at: params.scheduledAt,
                estimated_time: params.estimatedMinutes,
                calendar_id: params.calendarId,
            }),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'スケジュール登録に失敗しました');
        }
        const data = await res.json().catch(() => ({}));
        const googleEventId = typeof data.googleEventId === 'string' ? data.googleEventId : null;
        if (googleEventId && onUpdateTask) {
            await onUpdateTask(taskId, { google_event_id: googleEventId });
        }
        return { googleEventId };
    }, [onUpdateTask]);

    const updateTaskPriority = useCallback(async (taskId: string, priority: number | null) => {
        if (onUpdateTask) {
            await onUpdateTask(taskId, { priority });
        }
    }, [onUpdateTask]);

    const updateTaskEstimatedTime = useCallback(async (taskId: string, minutes: number) => {
        if (onUpdateTask) {
            await onUpdateTask(taskId, { estimated_time: minutes });
        }
    }, [onUpdateTask]);

    const callbacks = useMemo<MindMapCallbacks>(() => ({
        saveTaskTitle, addChildTask, addSiblingTask, deleteTask,
        handleNavigate, promoteTask, updateTaskScheduledAt,
        updateTaskPriority, updateTaskEstimatedTime,
        onUpdateTask, toggleTaskCollapse,
        createRootTaskAndFocus, onUpdateProject, registerSchedule,
    }), [
        saveTaskTitle,
        addChildTask,
        addSiblingTask,
        deleteTask,
        handleNavigate,
        promoteTask,
        updateTaskScheduledAt,
        updateTaskPriority,
        updateTaskEstimatedTime,
        onUpdateTask,
        toggleTaskCollapse,
        createRootTaskAndFocus,
        onUpdateProject,
        registerSchedule,
    ]);


    const handleContainerKeyDown = useCallback(async (event: React.KeyboardEvent) => {
        if (getIsTypingTarget(event.target)) return;

        const isModifierPressed = (event.metaKey || event.ctrlKey) && !event.altKey;
        if (isModifierPressed) {
            const key = event.key.toLowerCase();

            if (key === 'c' && !event.shiftKey) {
                const copyRootIds = getCopyRootNodeIds();
                if (copyRootIds.length === 0) return;

                const rootNodes = copyRootIds
                    .map(id => buildClipboardNode(id))
                    .filter((node): node is MindMapClipboardNode => node !== null);

                if (rootNodes.length === 0) {
                    flashClipboardFeedback('コピー対象が見つかりません');
                    return;
                }

                const payload: MindMapClipboardPayload = {
                    type: 'mindmap-node',
                    version: 2,
                    copiedAt: new Date().toISOString(),
                    roots: rootNodes,
                };

                try {
                    event.preventDefault();
                    await navigator.clipboard.writeText(
                        `${MINDMAP_CLIPBOARD_PREFIX}${JSON.stringify(payload)}`
                    );
                    flashClipboardFeedback(`${rootNodes.length}件のノードをコピーしました`);
                } catch (error) {
                    console.error('[MindMap] Failed to copy node:', error);
                    flashClipboardFeedback('コピーに失敗しました');
                }
                return;
            }

            if (key === 'v' && !event.shiftKey) {
                try {
                    const text = await navigator.clipboard.readText();
                    if (!text.startsWith(MINDMAP_CLIPBOARD_PREFIX)) return;

                    event.preventDefault();
                    const payloadRaw = text.slice(MINDMAP_CLIPBOARD_PREFIX.length);
                    const payloadParsed = JSON.parse(payloadRaw) as MindMapClipboardAnyPayload;
                    const normalized = normalizeClipboardPayload(payloadParsed);
                    if (!normalized) {
                        flashClipboardFeedback('貼り付けデータを読み取れません');
                        return;
                    }
                    await pasteClipboardTree(normalized);
                } catch (error) {
                    console.error('[MindMap] Failed to paste node:', error);
                    flashClipboardFeedback('貼り付けに失敗しました');
                }
                return;
            }
        }

        // Bulk delete: drag-selection -> Delete/Backspace removes selected nodes
        if ((event.key === 'Delete' || event.key === 'Backspace') && selectedNodeIds.size > 0) {
            const allTasksById = new Map([...groups, ...tasks].map(t => [t.id, t]));
            const selectedIds = Array.from(selectedNodeIds).filter(id => allTasksById.has(id));

            // 祖先が既に選択されているタスクをスキップ（cascade delete で処理される）
            const selectedSet = new Set(selectedIds);
            const filteredIds = selectedIds.filter(id => {
                let cur = allTasksById.get(id);
                const visited = new Set<string>();
                while (cur?.parent_task_id && !visited.has(cur.parent_task_id)) {
                    if (selectedSet.has(cur.parent_task_id)) return false;
                    visited.add(cur.parent_task_id);
                    cur = allTasksById.get(cur.parent_task_id);
                }
                return true;
            });

            if (filteredIds.length === 0) return;
            event.preventDefault();

            applySelection(new Set(), null);

            // ルートタスクと子タスクを分離してbulkDeleteに渡す
            const rootGroupIds = filteredIds.filter(id => groups.some(g => g.id === id));
            const childTaskIds = filteredIds.filter(id => !groups.some(g => g.id === id));

            if (onBulkDelete) {
                onBulkDelete(rootGroupIds, childTaskIds);
            } else {
                for (const id of rootGroupIds) { onDeleteGroup?.(id); }
                for (const id of childTaskIds) { onDeleteTask?.(id); }
            }
            return;
        }
        // ルートタスクもTaskNodeなのでノード内でキーボードを処理 → コンテナ追加処理不要
    }, [
        selectedNodeIds,
        tasks,
        groups,
        onDeleteTask,
        onDeleteGroup,
        onBulkDelete,
        applySelection,
        getIsTypingTarget,
        getCopyRootNodeIds,
        buildClipboardNode,
        normalizeClipboardPayload,
        pasteClipboardTree,
        flashClipboardFeedback,
    ]);

    const handleCustomSelectNode = useCallback((nodeId: string | null) => {
        applySelection(nodeId ? new Set([nodeId]) : new Set(), nodeId);
    }, [applySelection]);

    const handleCustomSelectNodes = useCallback((nodeIds: string[], primaryNodeId: string | null) => {
        const nextIds = new Set(nodeIds);
        const nextPrimaryId = primaryNodeId && nextIds.has(primaryNodeId) ? primaryNodeId : nodeIds[0] ?? null;
        applySelection(nextIds, nextPrimaryId);
    }, [applySelection]);

    const handleCustomMoveTask = useCallback(async ({
        taskId,
        targetId,
        position,
    }: {
        taskId: string;
        targetId: string;
        position: 'above' | 'below' | 'as-child';
    }) => {
        const draggedTask = getTaskById(taskId);
        if (!draggedTask || taskId === targetId) return;

        if (targetId === 'project-root') {
            const isAlreadyRoot = groups.some(group => group.id === draggedTask.id);
            if (isAlreadyRoot) return;
            await onUpdateTask?.(draggedTask.id, { parent_task_id: null, project_id: project?.id ?? null });
            return;
        }

        if (isDescendant(taskId, targetId)) return;
        const targetTask = getTaskById(targetId);
        if (!targetTask) return;

        const isRootDragged = groups.some(group => group.id === draggedTask.id);
        const isRootTarget = groups.some(group => group.id === targetTask.id);

        if (position === 'as-child') {
            if (draggedTask.parent_task_id === targetTask.id) {
                await onReorderTask?.(draggedTask.id, targetTask.id, 'below');
                return;
            }

            setCollapsedTaskIds(prev => {
                if (!prev.has(targetTask.id)) return prev;
                const next = new Set(prev);
                next.delete(targetTask.id);
                return next;
            });

            const updates: Partial<Task> = { parent_task_id: targetTask.id };
            if (isRootDragged) updates.project_id = null;
            await onUpdateTask?.(draggedTask.id, updates);
            return;
        }

        if (isRootDragged && isRootTarget) {
            await onReorderGroup?.(draggedTask.id, targetTask.id, position);
        } else {
            await onReorderTask?.(draggedTask.id, targetTask.id, position);
        }
    }, [getTaskById, groups, isDescendant, onReorderGroup, onReorderTask, onUpdateTask, project?.id]);

    const handleCustomMoveTasks = useCallback(async ({
        taskIds,
        targetId,
        position,
    }: {
        taskIds: string[];
        targetId: string;
        position: 'above' | 'below' | 'as-child';
    }) => {
        const uniqueTaskIds = Array.from(new Set(taskIds)).filter(id => id !== 'project-root');
        if (uniqueTaskIds.length === 0) return;
        if (uniqueTaskIds.length === 1) {
            await handleCustomMoveTask({ taskId: uniqueTaskIds[0], targetId, position });
            return;
        }
        if (!onUpdateTask) return;
        if (targetId !== 'project-root' && uniqueTaskIds.includes(targetId)) return;

        const allTasksById = new Map([...groups, ...tasks].map(task => [task.id, task]));
        const selectedSet = new Set(uniqueTaskIds.filter(id => allTasksById.has(id)));
        const moveRootIds = uniqueTaskIds.filter(id => {
            if (!selectedSet.has(id)) return false;
            let current = allTasksById.get(id);
            const visited = new Set<string>();
            while (current?.parent_task_id && !visited.has(current.parent_task_id)) {
                if (selectedSet.has(current.parent_task_id)) return false;
                visited.add(current.parent_task_id);
                current = allTasksById.get(current.parent_task_id);
            }
            return true;
        });

        if (moveRootIds.length === 0) return;

        if (targetId !== 'project-root' && moveRootIds.some(id => id === targetId || isDescendant(id, targetId))) {
            return;
        }

        if (targetId === 'project-root') {
            await Promise.all(
                moveRootIds.map(taskId => {
                    const task = allTasksById.get(taskId);
                    if (!task || task.parent_task_id === null) return Promise.resolve();
                    return onUpdateTask(taskId, { parent_task_id: null, project_id: project?.id ?? null });
                })
            );
            return;
        }

        const targetTask = allTasksById.get(targetId);
        if (!targetTask) return;

        if (position === 'as-child') {
            setCollapsedTaskIds(prev => {
                if (!prev.has(targetTask.id)) return prev;
                const next = new Set(prev);
                next.delete(targetTask.id);
                return next;
            });

            await Promise.all(
                moveRootIds.map(taskId => {
                    const task = allTasksById.get(taskId);
                    if (!task || task.parent_task_id === targetTask.id) return Promise.resolve();
                    const updates: Partial<Task> = { parent_task_id: targetTask.id };
                    if (groups.some(group => group.id === taskId)) updates.project_id = null;
                    return onUpdateTask(taskId, updates);
                })
            );
            return;
        }

        const newParentId = targetTask.parent_task_id ?? null;
        await Promise.all(
            moveRootIds.map(taskId => {
                const task = allTasksById.get(taskId);
                if (!task || task.parent_task_id === newParentId) return Promise.resolve();
                const updates: Partial<Task> = { parent_task_id: newParentId };
                if (newParentId === null) {
                    updates.project_id = project?.id ?? null;
                } else if (groups.some(group => group.id === taskId)) {
                    updates.project_id = null;
                }
                return onUpdateTask(taskId, updates);
            })
        );
    }, [groups, handleCustomMoveTask, isDescendant, onUpdateTask, project?.id, tasks]);

    return (
        <div
            className="w-full h-full bg-muted/5 relative outline-none"
            tabIndex={0}
            onKeyDown={handleContainerKeyDown}
            onPasteCapture={handleContainerPasteCapture}
        >
            {/* MindMap Display Settings Button (Top Right) */}
            <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
                <MindMapDisplaySettingsPopover
                    value={displaySettings}
                    onChange={setDisplaySettings}
                />
            </div>

            <div className="flex h-full min-h-0 flex-col">
                <div className="relative min-h-0 flex-1">
                    <CustomMindMapView
                        project={project}
                        groups={groups}
                        tasks={tasks}
                        isMobile={isNarrow}
                        collapsedTaskIds={collapsedTaskIds}
                        selectedNodeId={selectedNodeId}
                        selectedNodeIds={selectedNodeIds}
                        onSelectNode={handleCustomSelectNode}
                        onSelectNodes={handleCustomSelectNodes}
                        onToggleCollapse={toggleTaskCollapse}
                        pendingEditNodeId={pendingEditNodeId}
                        onAddRootNode={() => callbacks.createRootTaskAndFocus("")}
                        onAddChildNode={(taskId) => callbacks.addChildTask(taskId)}
                        onAddSiblingNode={(taskId) => callbacks.addSiblingTask(taskId)}
                        onPromoteNode={(taskId) => callbacks.promoteTask(taskId)}
                        onDeleteNode={(taskId) => callbacks.deleteTask(taskId)}
                        onNavigateNode={(taskId, direction) => callbacks.handleNavigate(taskId, direction)}
                        onSaveTitle={(taskId, title) => callbacks.saveTaskTitle(taskId, title)}
                        onSaveProjectTitle={(title) => project?.id ? callbacks.onUpdateProject?.(project.id, title) : undefined}
                        onUpdateStatus={handleUpdateTaskStatus}
                        onUpdateScheduledAt={(taskId, scheduledAt) => onUpdateTask?.(taskId, { scheduled_at: scheduledAt })}
                        onUpdateSchedule={(taskId, params) => onUpdateTask?.(taskId, {
                            scheduled_at: params.scheduledAt,
                            estimated_time: params.estimatedMinutes,
                            calendar_id: params.calendarId,
                        })}
                        onResizeNode={onUpdateTask ? (taskId, width) => onUpdateTask(taskId, { node_width: width }) : undefined}
                        onGenerateHeadingFromLongNode={handleGenerateHeadingFromLongNode}
                        generatingHeadingNodeIds={generatingHeadingNodeIds}
                        onRunCodex={handleRunCodex}
                        codexRunByNodeId={codexRunByNodeId}
                        taskProgressByNodeId={taskProgressByNodeId}
                        onOpenTaskProgress={handleOpenTaskProgress}
                        onMoveTask={handleCustomMoveTask}
                        onMoveTasks={handleCustomMoveTasks}
                    />
                </div>
                <TaskProgressKanban
                    tasks={taskProgressDisplayTasks}
                    sourceTasksById={allTasksByIdForCodex}
                    isMobile={isNarrow}
                    isLoading={isTaskProgressSnapshotLoading}
                    isRefreshing={isRefreshingTaskProgressSnapshot}
                    error={taskProgressSnapshotError}
                    pollIntervalMs={taskProgressPollIntervalMs}
                    onRefresh={handleRefreshTaskProgressSnapshot}
                    onOpenTask={handleOpenTaskProgress}
                    onToggleSourceTaskComplete={(taskId, done) => { void handleUpdateTaskStatus(taskId, done ? "done" : "todo"); }}
                    onDeleteSourceTask={(taskId) => { void callbacks.deleteTask(taskId); }}
                />
            </div>
            <TaskProgressDetailPanel
                open={!!taskProgressPanelTask}
                task={taskProgressPanelTask}
                isMobile={isNarrow}
                onOpenChange={(open) => {
                    if (!open) setTaskProgressPanelTaskId(null);
                }}
            />
            {codexPanelNode && (
                <CodexNodePanel
                    open
                    node={codexPanelNode}
                    candidates={codexDirCandidates}
                    onClose={() => setCodexPanelTaskId(null)}
                    onPersistDir={persistCodexDir}
                    onSaveHeading={(taskId, heading) => onUpdateTask?.(taskId, { title: heading })}
                    onSaveDraft={(taskId, draft) => onUpdateTask?.(taskId, { title: draft.title, memo: draft.memo })}
                    onSaveTaskDetails={(taskId, updates) => onUpdateTask?.(taskId, updates)}
                    onRegisterSchedule={(taskId, params) => callbacks.registerSchedule(taskId, params)}
                    onOpenMemo={onOpenLinkedMemos}
                    onToggleComplete={(taskId, done) => { void handleUpdateTaskStatus(taskId, done ? 'done' : 'todo'); }}
                    onAddChild={(taskId) => { void callbacks.addChildTask(taskId); }}
                    onDelete={(taskId) => { void callbacks.deleteTask(taskId); }}
                />
            )}

            {clipboardFeedback && (
                <div className="absolute bottom-4 right-4 bg-card/90 backdrop-blur border rounded-lg px-3 py-2 text-xs text-emerald-400 shadow-lg">
                    {clipboardFeedback}
                </div>
            )}
        </div>
    );
}

export function MindMap(props: MindMapProps) {
    const mounted = useSyncExternalStore(
        () => () => { },
        () => true,
        () => false
    );
    if (!mounted) return <div className="w-full h-full bg-muted/5 flex items-center justify-center text-muted-foreground">Loading...</div>;

    return (
        <MindMapErrorBoundary>
            <MindMapContent {...props} />
        </MindMapErrorBoundary>
    );
}
