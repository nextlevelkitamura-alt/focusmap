"use client";

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Bot, Check, ChevronDown, ChevronRight, GitBranch, Loader2, MoreVertical, Sparkles } from "lucide-react";
import type { Project, Task } from "@/types/database";
import { cn } from "@/lib/utils";
import { buildMindMapModel, type MindMapModelNode } from "@/lib/mindmap-model";
import { useKeyboardHeight } from "@/hooks/useKeyboardHeight";
import { useCodexRunnerStatus } from "@/hooks/useCodexRunnerStatus";
import { KeyboardAccessoryBar } from "@/components/mobile/keyboard-accessory-bar";
import {
    NODE_MIN_WIDTH,
    NODE_MIN_WIDTH_MOBILE,
    NODE_RESIZE_MAX_WIDTH,
} from "@/lib/mindmap-geometry";
import {
    getMindMapViewportBounds,
    getPinchViewportTransform,
    getViewportTransformAtPoint,
} from "@/lib/mindmap-viewport";
import type { CodexTaskUiStateName } from "@/lib/codex-run-state";
import {
    getCodexMonitorUiStatus,
    codexMonitorToneClass,
    codexMonitorUiLabel,
} from "@/lib/task-progress-ui";
import type { TaskProgressSnapshotTask } from "@/types/task-progress";
import {
    MINDMAP_NODE_DRAG_EVENT,
    type MindMapNodeCalendarDragEventDetail,
    type MindMapNodeCalendarDragPayload,
} from "@/lib/calendar-constants";
import {
    hasCodexChatImportDragPayload,
    readCodexChatImportDragPayload,
} from "@/lib/codex-chat-import-dnd";

type CustomMindMapViewProps = {
    project: Project;
    groups: Task[];
    tasks: Task[];
    isMobile?: boolean;
    mobilePlacementMode?: boolean;
    collapsedTaskIds: Set<string>;
    selectedNodeId: string | null;
    selectedNodeIds: Set<string>;
    onSelectNode: (nodeId: string | null) => void;
    onSelectNodes: (nodeIds: string[], primaryNodeId: string | null) => void;
    onToggleCollapse: (taskId: string) => void;
    pendingEditNodeId?: string | null;
    onAddRootNode?: () => void | Promise<void>;
    onAddChildNode?: (taskId: string) => void | Promise<void>;
    onAddSiblingNode?: (taskId: string) => void | Promise<void>;
    onPromoteNode?: (taskId: string) => void | Promise<void>;
    onDeleteNode?: (taskId: string) => void | Promise<void>;
    onNavigateNode?: (taskId: string, direction: CustomNavigationDirection) => void;
    onSaveTitle?: (taskId: string, title: string) => void | Promise<void>;
    onSaveProjectTitle?: (title: string) => void | Promise<void>;
    onUpdateStatus?: (taskId: string, status: string) => void | Promise<void>;
    onUpdateScheduledAt?: (taskId: string, scheduledAt: string | null) => void | Promise<void>;
    onUpdateSchedule?: (taskId: string, params: { scheduledAt: string; estimatedMinutes: number; calendarId: string }) => void | Promise<void>;
    onResizeNode?: (taskId: string, width: number) => void | Promise<void>;
    onGenerateHeadingFromLongNode?: (taskId: string) => void | Promise<void>;
    generatingHeadingNodeIds?: Set<string>;
    onRunCodex?: (taskId: string) => void | Promise<void>;
    codexRunByNodeId?: Record<string, CodexNodeState>;
    codexThreadImportEnabled?: boolean;
    codexThreadImportAvailable?: boolean;
    codexThreadImportPending?: boolean;
    codexThreadImportRepoPath?: string | null;
    onToggleCodexThreadImport?: () => void | Promise<void>;
    taskProgressByNodeId?: Record<string, TaskProgressSnapshotTask>;
    onOpenTaskProgress?: (task: TaskProgressSnapshotTask) => void;
    onMoveTask?: (params: {
        taskId: string;
        targetId: string;
        position: CustomDropPosition;
    }) => void | Promise<void>;
    onMoveTasks?: (params: {
        taskIds: string[];
        targetId: string;
        position: CustomDropPosition;
    }) => void | Promise<void>;
    onDuplicateTasks?: (params: {
        taskIds: string[];
        targetId: string;
        position: CustomDropPosition;
    }) => void | Promise<void>;
    importedChatDragTitle?: string | null;
    onDropImportedChatNode?: (params: {
        taskId: string;
        targetId: string;
        position: CustomDropPosition;
    }) => void | Promise<void>;
};

type CodexNodeState = {
    state: CodexTaskUiStateName;
    taskId: string;
    label: string;
    lastActivityAt?: string | null;
    updatedAt?: string | null;
};

const PADDING = 72;
const DRAG_START_THRESHOLD = 6;
const DROP_TARGET_MAX_DISTANCE = 190;
const WHEEL_PAN_SENSITIVITY = 1;
const WHEEL_ZOOM_SENSITIVITY = 0.0035;
const TOUCH_PINCH_SENSITIVITY = 1;
const DESKTOP_GESTURE_SENSITIVITY = 1.35;
const MOBILE_DRAG_AUTOPAN_EDGE_PX = 72;
const MOBILE_DRAG_AUTOPAN_MAX_PX_PER_FRAME = 12;
const MOBILE_KEYBOARD_NODE_MARGIN = 12;
const MOBILE_KEYBOARD_ACCESSORY_CLEARANCE = 68;
const MOBILE_NODE_FOCUS_DURATION_MS = 120;
const MOBILE_FLOATING_TASK_MIN_WIDTH = 120;
const MOBILE_FLOATING_PROJECT_MIN_WIDTH = 104;
const MOBILE_FLOATING_TASK_MIN_HEIGHT = 34;
const MOBILE_FLOATING_PROJECT_MIN_HEIGHT = 36;
type CustomDropPosition = "above" | "below" | "as-child";
type CustomNavigationDirection = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

type CustomDropTarget = {
    nodeId: string;
    position: CustomDropPosition;
};

type ExternalImportDropPreview = {
    preview: Rect;
    badge: Point;
    path: string;
};

type DragState = {
    primaryNodeId: string;
    nodeIds: string[];
    nodeStarts: Record<string, { x: number; y: number }>;
    startPointerX: number;
    startPointerY: number;
    primaryStartX: number;
    primaryStartY: number;
    deltaX: number;
    deltaY: number;
    lastClientX: number;
    lastClientY: number;
    dragging: boolean;
    target: CustomDropTarget | null;
};

type SelectionBoxState = {
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
    additive: boolean;
};

type PanState = {
    startClientX: number;
    startClientY: number;
    startPanX: number;
    startPanY: number;
};

type Point = {
    x: number;
    y: number;
};

type Rect = Point & {
    width: number;
    height: number;
};

type PinchGestureState = {
    source: "touch" | "gesture";
    initialDistance: number;
    initialZoom: number;
    initialStagePoint: Point;
};

type CustomTaskEditController = {
    handoffEditing: (focusTextInput: () => void) => Promise<void>;
    finishEditing: (options?: { refocus?: boolean }) => Promise<void>;
};

type CustomEditRequestOptions = {
    selectAll?: boolean;
};

function taskProgressStatusLabel(status: TaskProgressSnapshotTask["status"]) {
    return codexMonitorUiLabel(status);
}

function codexStateToTaskProgressStatus(state: CodexTaskUiStateName): TaskProgressSnapshotTask["status"] {
    if (state === "prompt_waiting") return "pending";
    if (state === "running") return "running";
    if (state === "connection_failed") return "failed";
    if (state === "completed") return "completed";
    return "awaiting_approval";
}

function parseStatusTimestamp(value: string | null | undefined) {
    if (!value) return 0;
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : 0;
}

function buildCodexBadge(
    codexState: CodexNodeState | null | undefined,
    taskProgress: TaskProgressSnapshotTask | null | undefined,
) {
    const codexBadge = codexState
        ? {
            label: codexState.label,
            status: codexStateToTaskProgressStatus(codexState.state),
            title: `Codex ${codexState.label}`,
        }
        : null;
    const progressBadge = taskProgress
        ? {
            label: taskProgressStatusLabel(taskProgress.status),
            status: taskProgress.status,
            title: `Codex ${taskProgressStatusLabel(taskProgress.status)}`,
        }
        : null;

    if (!codexBadge) return progressBadge;
    if (!progressBadge || !taskProgress) return codexBadge;

    const codexMs = parseStatusTimestamp(codexState?.updatedAt ?? codexState?.lastActivityAt);
    const progressMs = parseStatusTimestamp(taskProgress.updated_at);
    return codexMs >= progressMs ? codexBadge : progressBadge;
}

function canShowHeadingActionForCodexState(
    codexState: CodexNodeState | null | undefined,
    taskProgress: TaskProgressSnapshotTask | null | undefined,
) {
    const codexIsUnsent = !codexState || codexState.state === "prompt_waiting";
    const progressIsUnsent = !taskProgress || taskProgress.status === "pending";
    return codexIsUnsent && progressIsUnsent;
}

function importDropLabel(position: CustomDropPosition | null | undefined) {
    if (position === "above") return "上に並べる";
    if (position === "below") return "下に並べる";
    return "子ノードにする";
}

type WebKitGestureEvent = Event & {
    scale: number;
    clientX?: number;
    clientY?: number;
};

const DEFAULT_NODE_CALENDAR_DURATION_MINUTES = 30;
const MIN_NODE_CALENDAR_DURATION_MINUTES = 15;

function dispatchMindMapNodeCalendarDrag(detail: MindMapNodeCalendarDragEventDetail) {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent<MindMapNodeCalendarDragEventDetail>(MINDMAP_NODE_DRAG_EVENT, { detail }));
}

const getTouchDistance = (touches: TouchList) => {
    const first = touches[0];
    const second = touches[1];
    return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
};

const getTouchMidpoint = (touches: TouchList, viewport: HTMLDivElement): Point => {
    const rect = viewport.getBoundingClientRect();
    const first = touches[0];
    const second = touches[1];
    return {
        x: (first.clientX + second.clientX) / 2 - rect.left,
        y: (first.clientY + second.clientY) / 2 - rect.top,
    };
};

const easeOutCubic = (progress: number) => 1 - Math.pow(1 - progress, 3);

const prefersReducedMotion = () =>
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const isInteractiveMapTarget = (target: EventTarget | null) =>
    target instanceof HTMLElement && Boolean(target.closest("button,input,textarea,select,a,[contenteditable='true']"));

const isMindMapNodeTarget = (target: EventTarget | null) =>
    target instanceof HTMLElement && Boolean(target.closest("[data-id]"));

const clearMindMapTextSelection = () => {
    if (typeof window === "undefined") return;
    const selection = window.getSelection?.();
    if (!selection || selection.rangeCount === 0) return;
    selection.removeAllRanges();
};

type PersistedMindmapTitleDraft = {
    taskId: string;
    title: string;
    draftedAt: string;
};

const MINDMAP_TITLE_DRAFT_STORAGE_PREFIX = "focusmap:mindmap-title-draft:";

const getMindmapTitleDraftStorageKey = (taskId: string) => `${MINDMAP_TITLE_DRAFT_STORAGE_PREFIX}${taskId}`;

function readPersistedMindmapTitleDraft(taskId: string): PersistedMindmapTitleDraft | null {
    if (typeof window === "undefined") return null;
    try {
        const raw = window.localStorage.getItem(getMindmapTitleDraftStorageKey(taskId));
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<PersistedMindmapTitleDraft>;
        if (parsed.taskId !== taskId || typeof parsed.title !== "string") return null;
        return {
            taskId,
            title: parsed.title,
            draftedAt: typeof parsed.draftedAt === "string" ? parsed.draftedAt : new Date().toISOString(),
        };
    } catch {
        return null;
    }
}

function writePersistedMindmapTitleDraft(taskId: string, title: string) {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(getMindmapTitleDraftStorageKey(taskId), JSON.stringify({
            taskId,
            title,
            draftedAt: new Date().toISOString(),
        } satisfies PersistedMindmapTitleDraft));
    } catch {
        // The in-memory preview still protects the current edit if storage is unavailable.
    }
}

function clearPersistedMindmapTitleDraft(taskId: string) {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.removeItem(getMindmapTitleDraftStorageKey(taskId));
    } catch {
        // Ignore storage cleanup failures.
    }
}

const trackDetachedSave = (saveAction: void | Promise<void> | undefined, label: string) => {
    if (!saveAction) return;
    void Promise.resolve(saveAction).catch(error => {
        console.error(label, error);
    });
};

function CodexRunningOrbit({ width, height }: { width: number; height: number }) {
    const orbitInset = 5;
    const strokePadding = 2;
    const orbitWidth = Math.max(1, Math.round(width + orbitInset * 2));
    const orbitHeight = Math.max(1, Math.round(height + orbitInset * 2));
    const rectWidth = Math.max(1, orbitWidth - strokePadding * 2);
    const rectHeight = Math.max(1, orbitHeight - strokePadding * 2);
    const radius = Math.min(10, rectWidth / 2, rectHeight / 2);

    return (
        <div
            className="codex-node-running-orbit"
            title="Codex 実行中"
            aria-label="Codex 実行中"
        >
            <svg
                className="codex-node-running-orbit__svg"
                viewBox={`0 0 ${orbitWidth} ${orbitHeight}`}
                aria-hidden="true"
                focusable="false"
                preserveAspectRatio="none"
            >
                <rect
                    className="codex-node-running-orbit__rail"
                    x={strokePadding}
                    y={strokePadding}
                    width={rectWidth}
                    height={rectHeight}
                    rx={radius}
                    pathLength={100}
                />
                <rect
                    className="codex-node-running-orbit__runner"
                    x={strokePadding}
                    y={strokePadding}
                    width={rectWidth}
                    height={rectHeight}
                    rx={radius}
                    pathLength={100}
                />
            </svg>
        </div>
    );
}

function CustomBranchPath({
    source,
    target,
    offsetX,
    offsetY,
    branchX: preferredBranchX,
}: {
    source: MindMapModelNode;
    target: MindMapModelNode;
    offsetX: number;
    offsetY: number;
    branchX?: number;
}) {
    const sourceX = Math.round(source.x + offsetX + source.width);
    const sourceY = Math.round(source.y + offsetY + source.height / 2);
    const targetX = Math.round(target.x + offsetX);
    const targetY = Math.round(target.y + offsetY + target.height / 2);
    const gap = targetX - sourceX;
    const branchX = preferredBranchX == null
        ? (gap > 24
            ? Math.round(sourceX + gap / 2)
            : Math.round(sourceX + Math.max(8, gap / 2)))
        : Math.round(preferredBranchX);
    const path = `M ${sourceX} ${sourceY} L ${branchX} ${sourceY} L ${branchX} ${targetY} L ${targetX} ${targetY}`;

    return <path d={path} stroke="currentColor" strokeWidth="1.5" fill="none" strokeOpacity="0.62" strokeLinejoin="round" />;
}

function CustomTaskNode({
    node,
    selected,
    primarySelected,
    selectedCount,
    dragging,
    dragReady,
    dropPosition,
    importDropActive,
    triggerEdit,
    initialEditValue,
    floatingEditing,
    onSelectNode,
    onStartDrag,
    onToggleCollapse,
    onAddChild,
    onAddSibling,
    onPromote,
    onDelete,
    onNavigate,
    onSaveTitle,
    onUpdateStatus,
    onResize,
    onGenerateHeadingFromLongNode,
    isGeneratingHeading,
    resizeScale,
    isMobile,
    onRunCodex,
    codexState,
    taskProgress,
    onOpenTaskProgress,
    onEditingChange,
    onRegisterEditController,
    onRequestEdit,
    onPreviewTitleChange,
    onDropImportedChatNode,
    externalImportResetKey,
    mobilePlacementMode,
}: {
    node: MindMapModelNode;
    selected: boolean;
    primarySelected: boolean;
    selectedCount: number;
    dragging?: boolean;
    dragReady?: boolean;
    dropPosition?: CustomDropPosition | null;
    importDropActive?: boolean;
    triggerEdit?: boolean;
    initialEditValue?: string;
    floatingEditing?: boolean;
    onSelectNode: (nodeId: string, options?: { additive: boolean }) => boolean | void;
    onStartDrag: (node: MindMapModelNode, event: React.PointerEvent<HTMLDivElement>) => void;
    onToggleCollapse: (taskId: string) => void;
    onAddChild?: (taskId: string) => void | Promise<void>;
    onAddSibling?: (taskId: string) => void | Promise<void>;
    onPromote?: (taskId: string) => void | Promise<void>;
    onDelete?: (taskId: string) => void | Promise<void>;
    onNavigate?: (taskId: string, direction: CustomNavigationDirection) => void;
    onSaveTitle?: (taskId: string, title: string) => void | Promise<void>;
    onUpdateStatus?: (taskId: string, status: string) => void | Promise<void>;
    onResize?: (taskId: string, width: number, commit: boolean) => void;
    onGenerateHeadingFromLongNode?: (taskId: string) => void | Promise<void>;
    isGeneratingHeading?: boolean;
    resizeScale: number;
    isMobile: boolean;
    onRunCodex?: (taskId: string) => void | Promise<void>;
    codexState?: CodexNodeState | null;
    taskProgress?: TaskProgressSnapshotTask | null;
    onOpenTaskProgress?: (task: TaskProgressSnapshotTask) => void;
    onEditingChange?: (taskId: string, isEditing: boolean) => void;
    onRegisterEditController?: (taskId: string, controller: CustomTaskEditController | null) => void;
    onRequestEdit?: (nodeId: string, initialValue?: string, options?: CustomEditRequestOptions) => boolean;
    onPreviewTitleChange?: (taskId: string, title: string | null) => void;
    onDropImportedChatNode?: (params: { taskId: string; targetId: string; position: CustomDropPosition }) => void | Promise<void>;
    externalImportResetKey: number;
    mobilePlacementMode?: boolean;
}) {
    const wrapperRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const isFinishingEditRef = useRef(false);
    const handledTriggerEditRef = useRef<string | null>(null);
    const lastCommittedTitleRef = useRef(initialEditValue ?? node.title);
    const selectAllOnFocusRef = useRef(true);
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(initialEditValue ?? node.title);
    const [externalDropActive, setExternalDropActive] = useState(false);
    const isMemoNode = node.source === "memo" || node.source === "wishlist" || node.hasMemo || node.hasMemoImages;
    const baseNodeCodexBadge = buildCodexBadge(codexState, taskProgress);
    const nodeCodexBadge = node.isDone && baseNodeCodexBadge
        ? {
            ...baseNodeCodexBadge,
            label: "完了済み",
            status: "completed" as const,
            title: "Codex 完了済み",
        }
        : baseNodeCodexBadge;
    const opensCodexChatDetail = Boolean(
        (taskProgress && getCodexMonitorUiStatus(taskProgress.status) !== "unsent") ||
        (codexState && codexState.state !== "prompt_waiting")
    );
    const canGenerateHeadingForCodexState = canShowHeadingActionForCodexState(codexState, taskProgress);

    useEffect(() => {
        setExternalDropActive(false);
    }, [externalImportResetKey]);
    const showLongNodeHeadingAction =
        !isEditing &&
        !floatingEditing &&
        !dragging &&
        !!onGenerateHeadingFromLongNode &&
        canGenerateHeadingForCodexState &&
        (node.titleLineCount >= 3 || isGeneratingHeading);

    useEffect(() => {
        if (!isEditing) setEditValue(initialEditValue ?? node.title);
    }, [initialEditValue, isEditing, node.title]);

    useEffect(() => {
        lastCommittedTitleRef.current = initialEditValue ?? node.title;
    }, [initialEditValue, node.title]);

    useEffect(() => {
        if (!triggerEdit) {
            if (handledTriggerEditRef.current === node.id) handledTriggerEditRef.current = null;
            return;
        }
        if (handledTriggerEditRef.current === node.id) return;
        handledTriggerEditRef.current = node.id;
        if (isMobile && onRequestEdit?.(node.id, initialEditValue ?? "")) return;
        selectAllOnFocusRef.current = true;
        setIsEditing(true);
        setEditValue(initialEditValue ?? "");
    }, [initialEditValue, isMobile, node.id, onRequestEdit, triggerEdit]);

    useLayoutEffect(() => {
        if (!primarySelected || isEditing) return;
        if (isFinishingEditRef.current) return;
        wrapperRef.current?.focus();
    }, [isEditing, primarySelected]);

    useLayoutEffect(() => {
        if (!isEditing) return;
        const input = inputRef.current;
        if (!input) return;
        input.focus({ preventScroll: true });
        const length = input.value.length;
        if (selectAllOnFocusRef.current) {
            input.setSelectionRange(0, length);
        } else {
            input.setSelectionRange(length, length);
        }
        selectAllOnFocusRef.current = true;
    }, [isEditing]);

    useLayoutEffect(() => {
        const input = inputRef.current;
        if (!input) return;
        input.style.height = "auto";
        input.style.height = `${input.scrollHeight}px`;
    }, [editValue, isEditing]);

    const commitCurrentTitle = useCallback((options: { sync?: boolean; closeEditor?: boolean } = {}) => {
        const nextTitle = editValue.trim() || "Task";
        const shouldSave = nextTitle !== lastCommittedTitleRef.current;
        const commitState = () => {
            lastCommittedTitleRef.current = nextTitle;
            setEditValue(nextTitle);
            onPreviewTitleChange?.(node.id, nextTitle);
            if (options.closeEditor) setIsEditing(false);
        };

        if (options.sync) flushSync(commitState);
        else commitState();

        return { nextTitle, shouldSave };
    }, [editValue, node.id, onPreviewTitleChange]);

    const saveCommittedTitle = useCallback((nextTitle: string, shouldSave: boolean) => {
        if (!shouldSave) return undefined;
        return onSaveTitle?.(node.id, nextTitle);
    }, [node.id, onSaveTitle]);

    const saveValueDetached = useCallback((options: { closeEditor?: boolean } = {}) => {
        const { nextTitle, shouldSave } = commitCurrentTitle({ sync: true, closeEditor: options.closeEditor });
        try {
            trackDetachedSave(
                saveCommittedTitle(nextTitle, shouldSave),
                "[CustomMindMap] Failed to save task title:",
            );
        } catch (error) {
            console.error("[CustomMindMap] Failed to save task title:", error);
        }
        return nextTitle;
    }, [commitCurrentTitle, saveCommittedTitle]);

    const finishEditing = useCallback(async (options: { refocus?: boolean } = {}) => {
        if (isFinishingEditRef.current) return;
        isFinishingEditRef.current = true;
        try {
            saveValueDetached({ closeEditor: true });
            if (options.refocus !== false) {
                wrapperRef.current?.focus({ preventScroll: true });
                requestAnimationFrame(() => wrapperRef.current?.focus({ preventScroll: true }));
            }
        } finally {
            setTimeout(() => {
                isFinishingEditRef.current = false;
            }, 0);
        }
    }, [saveValueDetached]);

    const handoffEditing = useCallback(async (focusTextInput: () => void) => {
        if (isFinishingEditRef.current) return;
        isFinishingEditRef.current = true;
        focusTextInput();
        try {
            saveValueDetached({ closeEditor: true });
        } finally {
            setTimeout(() => {
                isFinishingEditRef.current = false;
            }, 0);
        }
    }, [saveValueDetached]);

    const cancelEditing = useCallback(() => {
        isFinishingEditRef.current = true;
        setEditValue(initialEditValue ?? node.title);
        onPreviewTitleChange?.(node.id, null);
        setIsEditing(false);
        requestAnimationFrame(() => wrapperRef.current?.focus());
        setTimeout(() => {
            isFinishingEditRef.current = false;
        }, 0);
    }, [initialEditValue, node.id, node.title, onPreviewTitleChange]);

    const beginEditing = useCallback((value?: string) => {
        const shouldSelectAll = value == null;
        if (isMobile && onRequestEdit?.(node.id, value ?? (initialEditValue ?? node.title), { selectAll: shouldSelectAll })) return;
        selectAllOnFocusRef.current = shouldSelectAll;
        setEditValue(value ?? (initialEditValue ?? node.title));
        setIsEditing(true);
    }, [initialEditValue, isMobile, node.id, node.title, onRequestEdit]);

    const handleOpenNodeDetail = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        event.stopPropagation();
        onSelectNode(node.id, { additive: false });
        void Promise.resolve(onRunCodex?.(node.id)).catch(error => {
            console.error("[CustomMindMap] Failed to open node detail:", error);
        });
    }, [node.id, onRunCodex, onSelectNode]);

    const handleGenerateHeadingFromLongNode = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        event.stopPropagation();
        void Promise.resolve(onGenerateHeadingFromLongNode?.(node.id)).catch(error => {
            console.error("[CustomMindMap] Failed to generate heading from long node:", error);
        });
    }, [node.id, onGenerateHeadingFromLongNode]);

    useEffect(() => {
        onEditingChange?.(node.id, isEditing);
        return () => {
            if (isEditing) onEditingChange?.(node.id, false);
        };
    }, [isEditing, node.id, onEditingChange]);

    useEffect(() => {
        if (!isEditing) {
            onRegisterEditController?.(node.id, null);
            return;
        }

        onRegisterEditController?.(node.id, { handoffEditing, finishEditing });
        return () => onRegisterEditController?.(node.id, null);
    }, [finishEditing, handoffEditing, isEditing, node.id, onRegisterEditController]);

    const handleNodeKeyDown = useCallback(async (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (isEditing) return;
        if (event.metaKey || event.ctrlKey || event.altKey) return;

        if (event.key === "Tab") {
            event.preventDefault();
            event.stopPropagation();
            if (event.shiftKey) {
                await onPromote?.(node.id);
            } else {
                wrapperRef.current?.blur();
                await onAddChild?.(node.id);
            }
            return;
        }

        if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            event.stopPropagation();
            wrapperRef.current?.blur();
            await onAddSibling?.(node.id);
            return;
        }

        if ((event.key === "Delete" || event.key === "Backspace") && selectedCount <= 1) {
            event.preventDefault();
            event.stopPropagation();
            await onDelete?.(node.id);
            return;
        }

        if (event.key === "F2" || event.key === " ") {
            event.preventDefault();
            event.stopPropagation();
            beginEditing();
            return;
        }

        if (event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            event.stopPropagation();
            onNavigate?.(node.id, event.key);
            return;
        }

        if (event.key.length === 1) {
            event.preventDefault();
            event.stopPropagation();
            beginEditing(event.key);
        }
    }, [beginEditing, isEditing, node.id, onAddChild, onAddSibling, onDelete, onNavigate, onPromote, selectedCount]);

    const handleInputKeyDown = useCallback(async (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        event.stopPropagation();

        if (event.key === "Enter" && !event.nativeEvent.isComposing && !event.shiftKey) {
            event.preventDefault();
            await finishEditing();
            return;
        }

        if (event.key === "Tab") {
            event.preventDefault();
            await finishEditing({ refocus: false });
            if (event.shiftKey) {
                await onPromote?.(node.id);
            } else {
                inputRef.current?.blur();
                await onAddChild?.(node.id);
            }
            return;
        }

        if (event.key === "Escape") {
            event.preventDefault();
            cancelEditing();
        }
    }, [cancelEditing, finishEditing, node.id, onAddChild, onPromote]);

    const handleInputBlur = useCallback(() => {
        if (!isEditing) return;
        if (isFinishingEditRef.current) return;
        void finishEditing();
    }, [finishEditing, isEditing]);

    const handleResizePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        if (!onResize || isEditing || event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();

        const target = event.currentTarget;
        target.setPointerCapture?.(event.pointerId);
        const startX = event.clientX;
        const startWidth = node.width;
        const minWidth = isMobile ? NODE_MIN_WIDTH_MOBILE : NODE_MIN_WIDTH;
        const scale = Math.max(0.1, resizeScale);

        const getNextWidth = (clientX: number) => {
            const delta = (clientX - startX) / scale;
            return Math.round(Math.max(minWidth, Math.min(NODE_RESIZE_MAX_WIDTH, startWidth + delta)));
        };

        const handleMove = (moveEvent: PointerEvent) => {
            onResize(node.id, getNextWidth(moveEvent.clientX), false);
        };

        const cleanup = (upEvent: PointerEvent) => {
            onResize(node.id, getNextWidth(upEvent.clientX), true);
            target.releasePointerCapture?.(event.pointerId);
            target.removeEventListener("pointermove", handleMove);
            target.removeEventListener("pointerup", cleanup);
            target.removeEventListener("pointercancel", cleanup);
        };

        target.addEventListener("pointermove", handleMove);
        target.addEventListener("pointerup", cleanup);
        target.addEventListener("pointercancel", cleanup);
    }, [isEditing, isMobile, node.id, node.width, onResize, resizeScale]);

    const handleExternalDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
        if (!hasCodexChatImportDragPayload(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        setExternalDropActive(true);
    }, []);

    const handleExternalDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
        const nextTarget = event.relatedTarget;
        if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
        setExternalDropActive(false);
    }, []);

    const handleExternalDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
        if (!hasCodexChatImportDragPayload(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
        setExternalDropActive(false);
        const payload = readCodexChatImportDragPayload(event.dataTransfer);
        if (!payload) return;
        void Promise.resolve(onDropImportedChatNode?.({
            taskId: payload.taskId,
            targetId: node.id,
            position: "as-child",
        })).catch(error => {
            console.error("[CustomMindMap] Failed to drop imported Codex chat:", error);
        });
    }, [node.id, onDropImportedChatNode]);

    return (
        <div
            ref={wrapperRef}
            data-id={node.id}
            tabIndex={0}
            className={cn(
                "absolute z-10 rounded-lg border bg-background px-1.5 py-1 text-[13px] text-foreground shadow-sm transition-colors dark:bg-[#171513] dark:text-neutral-200/95",
                "group flex select-none flex-col gap-0 outline-none",
                showLongNodeHeadingAction && "pb-2.5",
                floatingEditing && "opacity-0",
                selected && "ring-2 ring-white ring-offset-2 ring-offset-background",
                node.isHabit || node.parentIsHabit ? "border-blue-400" : "border-border",
                isMemoNode && !(node.isHabit || node.parentIsHabit) && "border-amber-400 bg-amber-50 dark:bg-amber-950/20",
                node.isDone && "border-muted-foreground/25 bg-background text-muted-foreground grayscale",
                codexState?.state === "prompt_waiting" && "border-sky-400/70 shadow-[0_0_14px_rgba(14,165,233,0.22)]",
                codexState?.state === "running" && "border-emerald-400/45 shadow-[0_0_12px_rgba(16,185,129,0.16)]",
                codexState?.state === "completed" && "border-emerald-400/55 shadow-[0_0_12px_rgba(16,185,129,0.14)]",
                codexState?.state === "connection_failed" && "border-red-400/80 shadow-[0_0_16px_rgba(248,113,113,0.22)]",
                taskProgress?.status === "running" && "border-emerald-400/50 shadow-[0_0_12px_rgba(16,185,129,0.16)]",
                (taskProgress?.status === "awaiting_approval" || taskProgress?.status === "needs_input" || taskProgress?.status === "completed") && "border-amber-400/80 shadow-[0_0_16px_rgba(245,158,11,0.22)]",
                taskProgress?.status === "failed" && "border-red-400/80 shadow-[0_0_16px_rgba(248,113,113,0.22)]",
                selected && node.isDone && "ring-muted-foreground/40",
                dragReady && !dragging && "z-30 border-sky-400 bg-sky-500/20 shadow-xl ring-2 ring-sky-400 ring-offset-2 ring-offset-background",
                dragging && "z-30 cursor-grabbing opacity-90 shadow-xl ring-2 ring-sky-400 ring-offset-2 ring-offset-background",
                !dragging && "cursor-grab",
                externalDropActive && "z-40 border-sky-400 bg-sky-500/15 ring-2 ring-sky-400 ring-offset-2 ring-offset-background",
                importDropActive && !dragging && "z-40 border-amber-400 bg-amber-500/15 ring-2 ring-amber-400 ring-offset-2 ring-offset-background shadow-[0_0_22px_rgba(245,158,11,0.45)]",
                dropPosition === "as-child" && !dragging && "ring-2 ring-sky-400 ring-offset-2 ring-offset-background border-sky-400 bg-sky-500/15 shadow-[0_0_18px_rgba(56,189,248,0.65)]"
            )}
            style={{ left: node.x, top: node.y, width: node.width, height: node.height, minHeight: node.height }}
            onPointerDown={(event) => {
                const target = event.target;
                if (target instanceof HTMLElement && target.closest("button,input,textarea,select,a")) return;
                onStartDrag(node, event);
            }}
            onClick={(event) => {
                event.stopPropagation();
                const shouldContinue = onSelectNode(node.id, { additive: event.shiftKey || event.metaKey || event.ctrlKey });
                if (shouldContinue === false) return;
                if (isMobile && !isEditing && !mobilePlacementMode) beginEditing();
            }}
            onDoubleClick={(event) => {
                event.stopPropagation();
                beginEditing();
            }}
            onKeyDown={handleNodeKeyDown}
            onDragOver={handleExternalDragOver}
            onDragLeave={handleExternalDragLeave}
            onDrop={handleExternalDrop}
        >
            {(externalDropActive || importDropActive) && (
                <div className={cn(
                    "pointer-events-none absolute -top-7 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1.5 rounded-full border bg-background/95 px-2 py-1 text-[11px] font-semibold shadow-lg dark:bg-[#111111]/95",
                    importDropActive
                        ? "border-amber-300/50 text-amber-600 dark:text-amber-300"
                        : "border-sky-300/40 text-sky-600 dark:text-sky-300"
                )}>
                    <Bot className="h-3 w-3" />
                    {importDropActive ? importDropLabel(dropPosition) : "ここに入れる"}
                </div>
            )}
            {dropPosition === "above" && !dragging && (
                <div className={cn(
                    "absolute -top-1.5 left-0 right-0 h-1 rounded-full shadow-[0_0_10px_rgba(56,189,248,0.9)]",
                    importDropActive ? "bg-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.9)]" : "bg-sky-400"
                )} />
            )}
            {dropPosition === "below" && !dragging && (
                <div className={cn(
                    "absolute -bottom-1.5 left-0 right-0 h-1 rounded-full shadow-[0_0_10px_rgba(56,189,248,0.9)]",
                    importDropActive ? "bg-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.9)]" : "bg-sky-400"
                )} />
            )}
            {isMemoNode && (
                <div className={cn("absolute -left-0.5 top-1 bottom-1 w-1 rounded-full", node.isDone ? "bg-muted-foreground/35" : "bg-amber-400")} />
            )}
            {codexState?.state === "running" && (
                <CodexRunningOrbit width={node.width} height={node.height} />
            )}
            {taskProgress?.status === "running" && codexState?.state !== "running" && (
                <CodexRunningOrbit width={node.width} height={node.height} />
            )}
            {nodeCodexBadge && taskProgress ? (
                <button
                    type="button"
                    className={cn(
                        "absolute -right-2 -top-2 z-10 max-w-[112px] rounded-full border px-1.5 py-0.5 text-[9px] font-semibold leading-none shadow-sm transition-colors",
                        "whitespace-nowrap hover:brightness-105 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
                        codexMonitorToneClass(nodeCodexBadge.status),
                        isMobile && "max-w-[96px]"
                    )}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onOpenTaskProgress?.(taskProgress);
                    }}
                    title={nodeCodexBadge.title}
                    aria-label={`Codex状態: ${nodeCodexBadge.label} を開く`}
                >
                    <span className="truncate">{nodeCodexBadge.label}</span>
                </button>
            ) : nodeCodexBadge ? (
                <div
                    className={cn(
                        "absolute -right-2 -top-2 z-10 max-w-[112px] rounded-full border px-1.5 py-0.5 text-[9px] font-semibold leading-none shadow-sm",
                        "whitespace-nowrap",
                        codexMonitorToneClass(nodeCodexBadge.status),
                        isMobile && "max-w-[96px]"
                    )}
                    title={nodeCodexBadge.title}
                    aria-label={`Codex状態: ${nodeCodexBadge.label}`}
                >
                    <span className="truncate">{nodeCodexBadge.label}</span>
                </div>
            ) : null}
            {showLongNodeHeadingAction && (
                <button
                    type="button"
                    className={cn(
                        "absolute z-30 inline-flex items-center justify-center rounded-full text-sky-100 transition-colors",
                        "focus:outline-none focus:ring-2 focus:ring-sky-300 focus:ring-offset-1 focus:ring-offset-background disabled:pointer-events-none disabled:opacity-70",
                        isMobile
                            ? "-bottom-4 -right-4 h-[52px] w-[52px] bg-transparent p-0"
                            : "-bottom-3 -right-3 h-7 w-7 border border-sky-400/50 bg-sky-500/20 shadow-lg shadow-sky-950/20 backdrop-blur hover:bg-sky-500/25"
                    )}
                    disabled={isGeneratingHeading}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={handleGenerateHeadingFromLongNode}
                    title="長いノードをメモ化して見出し生成"
                    aria-label="長いノードをメモ化して見出し生成"
                >
                    <span
                        className={cn(
                            "inline-flex items-center justify-center rounded-full",
                            isMobile
                                ? "h-8 w-8 border border-sky-400/50 bg-sky-500/20 shadow-md shadow-sky-950/20 backdrop-blur"
                                : "h-full w-full"
                        )}
                    >
                        {isGeneratingHeading ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                            <Sparkles className="h-3.5 w-3.5" />
                        )}
                    </span>
                </button>
            )}
            <div className="flex min-h-0 flex-1 items-center gap-1">
                <button
                    type="button"
                    role="checkbox"
                    aria-checked={node.isDone}
                    aria-label={node.isDone ? "完了を取消" : "完了にする"}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded active:bg-muted"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                        event.stopPropagation();
                        void onUpdateStatus?.(node.id, node.isDone ? "todo" : "done");
                    }}
                    title={node.isDone ? "完了を取消" : "完了にする"}
                >
                    <span className={cn(
                        "w-3.5 h-3.5 rounded-[3px] border flex items-center justify-center transition-colors",
                        node.isDone
                            ? "bg-muted border-muted-foreground/40 text-muted-foreground"
                            : "border-muted-foreground/50 hover:border-foreground bg-background"
                    )}>
                        {node.isDone && <Check className="w-2 h-2" strokeWidth={3.5} />}
                    </span>
                </button>

                {isEditing ? (
                    <textarea
                        ref={inputRef}
                        rows={1}
                        value={editValue}
                        className={cn(
                            "min-w-0 flex-1 resize-none overflow-hidden bg-transparent px-0.5 font-bold leading-tight outline-none select-text",
                            "whitespace-pre-wrap break-words [overflow-wrap:anywhere]",
                            node.isDone && "line-through text-muted-foreground"
                        )}
                        onChange={(event) => {
                            const nextValue = event.currentTarget.value;
                            setEditValue(nextValue);
                            onPreviewTitleChange?.(node.id, nextValue);
                            event.currentTarget.style.height = "auto";
                            event.currentTarget.style.height = `${event.currentTarget.scrollHeight}px`;
                        }}
                        onBlur={handleInputBlur}
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={handleInputKeyDown}
                    />
                ) : (
                    <div className={cn(
                        "max-h-full min-w-0 flex-1 select-none overflow-y-auto whitespace-pre-wrap break-words px-0.5 font-bold leading-tight [overflow-wrap:anywhere]",
                        showLongNodeHeadingAction && !isGeneratingHeading && "pr-5",
                        isGeneratingHeading && "pr-7 text-sky-50",
                        node.isDone && "line-through text-muted-foreground",
                        floatingEditing && "opacity-0"
                    )}>
                        {node.title}
                    </div>
                )}

                <div className="flex shrink-0 items-center gap-0.5 leading-none">
                    {node.hasChildren && (
                        <button
                            type="button"
                            className={cn(
                                "flex h-5 min-w-5 items-center justify-center gap-0.5 rounded-md px-1 text-[10px] font-semibold transition-colors",
                                node.isDone
                                    ? "text-muted-foreground/50"
                                    : node.collapsed
                                    ? "text-primary hover:bg-primary/15"
                                    : "text-muted-foreground/70 hover:bg-muted/50 hover:text-foreground"
                            )}
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                                event.stopPropagation();
                                onToggleCollapse(node.id);
                            }}
                            title={node.collapsed ? `${node.childCount}件の子を展開` : "折りたたむ"}
                        >
                            <span>{node.childCount}</span>
                            {node.collapsed ? <ChevronRight className="h-3 w-3" strokeWidth={3} /> : <ChevronDown className="h-3 w-3" strokeWidth={3} />}
                        </button>
                    )}
                    <button
                        type="button"
                        className={cn(
                            "flex shrink-0 items-center justify-center rounded text-muted-foreground/50 transition-colors",
                            isMobile
                                ? "h-6 w-6 active:bg-muted/60 active:text-foreground"
                                : "h-5 w-5 hover:bg-muted/30 hover:text-muted-foreground"
                        )}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={handleOpenNodeDetail}
                        title={opensCodexChatDetail ? "Codexチャット履歴" : "ノード詳細"}
                        aria-label={opensCodexChatDetail ? "Codexチャット履歴を開く" : "ノード詳細を開く"}
                    >
                        <MoreVertical className="h-3.5 w-3.5" />
                    </button>
                </div>
            </div>

            {onResize && (
                <div
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="ノード幅を変更"
                    title="ノード幅を変更"
                    className={cn(
                        "absolute top-0 bottom-0 z-20 flex w-3 cursor-col-resize select-none items-center justify-center",
                        "opacity-0 transition-opacity group-hover:opacity-100",
                        selected && "opacity-100"
                    )}
                    style={{ right: -6 }}
                    onPointerDown={handleResizePointerDown}
                >
                    <div className="h-8 w-0.5 rounded-full bg-muted-foreground/35 transition-colors group-hover:bg-primary/60" />
                </div>
            )}
        </div>
    );
}

function CustomProjectNode({
    node,
    selected,
    primarySelected,
    dropPosition,
    importDropActive,
    triggerEdit,
    floatingEditing,
    isMobile,
    onSelectNode,
    onAddChild,
    onSaveTitle,
    onEditingChange,
    onRegisterEditController,
    onRequestEdit,
    onDropImportedChatNode,
    externalImportResetKey,
    mobilePlacementMode,
}: {
    node: MindMapModelNode;
    selected: boolean;
    primarySelected: boolean;
    dropPosition?: CustomDropPosition | null;
    importDropActive?: boolean;
    triggerEdit?: boolean;
    floatingEditing?: boolean;
    isMobile: boolean;
    onSelectNode: (nodeId: string) => void;
    onAddChild?: () => void | Promise<void>;
    onSaveTitle?: (title: string) => void | Promise<void>;
    onEditingChange?: (nodeId: string, isEditing: boolean) => void;
    onRegisterEditController?: (nodeId: string, controller: CustomTaskEditController | null) => void;
    onRequestEdit?: (nodeId: string, initialValue?: string, options?: CustomEditRequestOptions) => boolean;
    onDropImportedChatNode?: (params: { taskId: string; targetId: string; position: CustomDropPosition }) => void | Promise<void>;
    externalImportResetKey: number;
    mobilePlacementMode?: boolean;
}) {
    const wrapperRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const isFinishingEditRef = useRef(false);
    const handledTriggerEditRef = useRef<string | null>(null);
    const lastCommittedTitleRef = useRef(node.title);
    const selectAllOnFocusRef = useRef(true);
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(node.title);
    const [externalDropActive, setExternalDropActive] = useState(false);

    useEffect(() => {
        setExternalDropActive(false);
    }, [externalImportResetKey]);

    useLayoutEffect(() => {
        if (!primarySelected || isEditing) return;
        if (isFinishingEditRef.current) return;
        wrapperRef.current?.focus();
    }, [isEditing, primarySelected]);

    useEffect(() => {
        if (!isEditing) setEditValue(node.title);
    }, [isEditing, node.title]);

    useEffect(() => {
        lastCommittedTitleRef.current = node.title;
    }, [node.title]);

    useEffect(() => {
        if (!triggerEdit) {
            if (handledTriggerEditRef.current === node.id) handledTriggerEditRef.current = null;
            return;
        }
        if (handledTriggerEditRef.current === node.id) return;
        handledTriggerEditRef.current = node.id;
        if (isMobile && onRequestEdit?.(node.id, node.title)) return;
        selectAllOnFocusRef.current = true;
        setEditValue(node.title);
        setIsEditing(true);
    }, [isMobile, node.id, node.title, onRequestEdit, triggerEdit]);

    useLayoutEffect(() => {
        if (!isEditing) return;
        const input = inputRef.current;
        if (!input) return;
        input.focus({ preventScroll: true });
        const length = input.value.length;
        if (selectAllOnFocusRef.current) {
            input.setSelectionRange(0, length);
        } else {
            input.setSelectionRange(length, length);
        }
        selectAllOnFocusRef.current = true;
    }, [isEditing]);

    useLayoutEffect(() => {
        const input = inputRef.current;
        if (!input) return;
        input.style.height = "auto";
        input.style.height = `${input.scrollHeight}px`;
    }, [editValue, isEditing]);

    const commitCurrentTitle = useCallback((options: { sync?: boolean; closeEditor?: boolean } = {}) => {
        const nextTitle = editValue.trim() || "Project";
        const shouldSave = nextTitle !== node.title && nextTitle !== lastCommittedTitleRef.current;
        const commitState = () => {
            lastCommittedTitleRef.current = nextTitle;
            setEditValue(nextTitle);
            if (options.closeEditor) setIsEditing(false);
        };

        if (options.sync) flushSync(commitState);
        else commitState();

        return { nextTitle, shouldSave };
    }, [editValue, node.title]);

    const saveCommittedTitle = useCallback((nextTitle: string, shouldSave: boolean) => {
        if (!shouldSave) return undefined;
        return onSaveTitle?.(nextTitle);
    }, [onSaveTitle]);

    const saveValueDetached = useCallback((options: { closeEditor?: boolean } = {}) => {
        const { nextTitle, shouldSave } = commitCurrentTitle({ sync: true, closeEditor: options.closeEditor });
        try {
            trackDetachedSave(
                saveCommittedTitle(nextTitle, shouldSave),
                "[CustomMindMap] Failed to save project title:",
            );
        } catch (error) {
            console.error("[CustomMindMap] Failed to save project title:", error);
        }
        return nextTitle;
    }, [commitCurrentTitle, saveCommittedTitle]);

    const finishEditing = useCallback(async (options: { refocus?: boolean } = {}) => {
        if (isFinishingEditRef.current) return;
        isFinishingEditRef.current = true;
        try {
            saveValueDetached({ closeEditor: true });
            if (options.refocus !== false) {
                wrapperRef.current?.focus({ preventScroll: true });
                requestAnimationFrame(() => wrapperRef.current?.focus({ preventScroll: true }));
            }
        } finally {
            setTimeout(() => {
                isFinishingEditRef.current = false;
            }, 0);
        }
    }, [saveValueDetached]);

    const handoffEditing = useCallback(async (focusTextInput: () => void) => {
        if (isFinishingEditRef.current) return;
        isFinishingEditRef.current = true;
        focusTextInput();
        try {
            saveValueDetached({ closeEditor: true });
        } finally {
            setTimeout(() => {
                isFinishingEditRef.current = false;
            }, 0);
        }
    }, [saveValueDetached]);

    const cancelEditing = useCallback(() => {
        isFinishingEditRef.current = true;
        setEditValue(node.title);
        setIsEditing(false);
        requestAnimationFrame(() => wrapperRef.current?.focus());
        setTimeout(() => {
            isFinishingEditRef.current = false;
        }, 0);
    }, [node.title]);

    const beginEditing = useCallback((value?: string) => {
        const shouldSelectAll = value == null;
        if (isMobile && onRequestEdit?.(node.id, value ?? node.title, { selectAll: shouldSelectAll })) return;
        selectAllOnFocusRef.current = shouldSelectAll;
        setEditValue(value ?? node.title);
        setIsEditing(true);
    }, [isMobile, node.id, node.title, onRequestEdit]);

    useEffect(() => {
        onEditingChange?.(node.id, isEditing);
        return () => {
            if (isEditing) onEditingChange?.(node.id, false);
        };
    }, [isEditing, node.id, onEditingChange]);

    useEffect(() => {
        if (!isEditing) {
            onRegisterEditController?.(node.id, null);
            return;
        }

        onRegisterEditController?.(node.id, { handoffEditing, finishEditing });
        return () => onRegisterEditController?.(node.id, null);
    }, [finishEditing, handoffEditing, isEditing, node.id, onRegisterEditController]);

    const handleKeyDown = useCallback(async (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (isEditing) return;
        if (event.metaKey || event.ctrlKey || event.altKey) return;

        if ((event.key === "Tab" && !event.shiftKey) || event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            wrapperRef.current?.blur();
            await onAddChild?.();
            return;
        }

        if (event.key === "F2" || event.key === " " || event.key === "Backspace") {
            event.preventDefault();
            event.stopPropagation();
            beginEditing();
            return;
        }

        if (event.key.length === 1) {
            event.preventDefault();
            event.stopPropagation();
            beginEditing(event.key);
        }
    }, [beginEditing, isEditing, onAddChild]);

    const handleInputKeyDown = useCallback(async (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        event.stopPropagation();

        if (event.key === "Enter" && !event.nativeEvent.isComposing && !event.shiftKey) {
            event.preventDefault();
            await finishEditing();
            return;
        }

        if (event.key === "Tab") {
            event.preventDefault();
            await finishEditing({ refocus: false });
            inputRef.current?.blur();
            if (!event.shiftKey) await onAddChild?.();
            return;
        }

        if (event.key === "Escape") {
            event.preventDefault();
            cancelEditing();
        }
    }, [cancelEditing, finishEditing, onAddChild]);

    const handleInputBlur = useCallback(() => {
        if (!isEditing) return;
        if (isFinishingEditRef.current) return;
        void finishEditing();
    }, [finishEditing, isEditing]);

    const handleExternalDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
        if (!hasCodexChatImportDragPayload(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        setExternalDropActive(true);
    }, []);

    const handleExternalDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
        const nextTarget = event.relatedTarget;
        if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
        setExternalDropActive(false);
    }, []);

    const handleExternalDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
        if (!hasCodexChatImportDragPayload(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
        setExternalDropActive(false);
        const payload = readCodexChatImportDragPayload(event.dataTransfer);
        if (!payload) return;
        void Promise.resolve(onDropImportedChatNode?.({
            taskId: payload.taskId,
            targetId: "project-root",
            position: "as-child",
        })).catch(error => {
            console.error("[CustomMindMap] Failed to drop imported Codex chat:", error);
        });
    }, [onDropImportedChatNode]);

    return (
        <div
            ref={wrapperRef}
            data-id={node.id}
            role={isEditing ? undefined : "button"}
            aria-label={isEditing ? undefined : node.title}
            tabIndex={0}
            className={cn(
                "absolute z-10 flex select-none items-center justify-center rounded-lg bg-primary px-4 py-2 text-center text-sm font-bold text-primary-foreground shadow-sm outline-none",
                floatingEditing && "opacity-0",
                selected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
                externalDropActive && "ring-2 ring-sky-400 ring-offset-2 ring-offset-background shadow-[0_0_18px_rgba(56,189,248,0.65)]",
                importDropActive && "ring-2 ring-amber-400 ring-offset-2 ring-offset-background shadow-[0_0_22px_rgba(245,158,11,0.45)]",
                dropPosition === "as-child" && "ring-2 ring-sky-400 ring-offset-2 ring-offset-background shadow-[0_0_18px_rgba(56,189,248,0.65)]"
            )}
            style={{ left: node.x, top: node.y, width: node.width, height: node.height, minHeight: node.height }}
            onClick={(event) => {
                const target = event.target;
                if (target instanceof HTMLElement && target.closest("input,textarea,select,a")) return;
                event.stopPropagation();
                onSelectNode(node.id);
                if (isMobile && !mobilePlacementMode) beginEditing();
            }}
            onDoubleClick={(event) => {
                event.stopPropagation();
                beginEditing();
            }}
            onKeyDown={handleKeyDown}
            onDragOver={handleExternalDragOver}
            onDragLeave={handleExternalDragLeave}
            onDrop={handleExternalDrop}
        >
            {(externalDropActive || importDropActive) && (
                <div className={cn(
                    "pointer-events-none absolute -top-7 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1.5 rounded-full border bg-background/95 px-2 py-1 text-[11px] font-semibold shadow-lg dark:bg-[#111111]/95",
                    importDropActive
                        ? "border-amber-300/50 text-amber-600 dark:text-amber-300"
                        : "border-sky-300/40 text-sky-600 dark:text-sky-300"
                )}>
                    <Bot className="h-3 w-3" />
                    {importDropActive ? "新しい枝にする" : "ここに入れる"}
                </div>
            )}
            {dropPosition === "as-child" && (
                <div className="pointer-events-none absolute inset-0 rounded-lg bg-sky-400/10" />
            )}
            {isEditing ? (
                <textarea
                    ref={inputRef}
                    rows={1}
                    value={editValue}
                    aria-label="プロジェクト名"
                    className="min-w-0 flex-1 resize-none overflow-hidden bg-transparent text-center font-bold leading-tight text-primary-foreground outline-none placeholder:text-primary-foreground/60 select-text"
                    onChange={(event) => {
                        setEditValue(event.currentTarget.value);
                        event.currentTarget.style.height = "auto";
                        event.currentTarget.style.height = `${event.currentTarget.scrollHeight}px`;
                    }}
                    onBlur={handleInputBlur}
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={handleInputKeyDown}
                />
            ) : (
                <span className={cn("select-none truncate", floatingEditing && "opacity-0")}>{node.title}</span>
            )}
        </div>
    );
}

export function CustomMindMapView({
    project,
    groups,
    tasks,
    isMobile = false,
    mobilePlacementMode = false,
    collapsedTaskIds,
    selectedNodeId,
    selectedNodeIds,
    onSelectNode,
    onSelectNodes,
    onToggleCollapse,
    pendingEditNodeId,
    onAddRootNode,
    onAddChildNode,
    onAddSiblingNode,
    onPromoteNode,
    onDeleteNode,
    onNavigateNode,
    onSaveTitle,
    onSaveProjectTitle,
    onUpdateStatus,
    onResizeNode,
    onGenerateHeadingFromLongNode,
    generatingHeadingNodeIds = new Set(),
    onRunCodex,
    codexRunByNodeId = {},
    codexThreadImportEnabled = false,
    codexThreadImportAvailable = false,
    codexThreadImportPending = false,
    codexThreadImportRepoPath,
    onToggleCodexThreadImport,
    taskProgressByNodeId = {},
    onOpenTaskProgress,
    onMoveTask,
    onMoveTasks,
    onDuplicateTasks,
    importedChatDragTitle,
    onDropImportedChatNode,
}: CustomMindMapViewProps) {
    const [zoom, setZoom] = useState(() => isMobile ? 0.85 : 0.9);
    const [panOffset, setPanOffset] = useState<Point>(() => isMobile ? { x: -20, y: 4 } : { x: 0, y: 0 });
    const [dragState, setDragState] = useState<DragState | null>(null);
    const dragStateRef = useRef<DragState | null>(null);
    const [selectionBox, setSelectionBox] = useState<SelectionBoxState | null>(null);
    const [panState, setPanState] = useState<PanState | null>(null);
    const [spacePressed, setSpacePressed] = useState(false);
    const [nodeWidthOverrides, setNodeWidthOverrides] = useState<Record<string, number>>({});
    const [optimisticStatusByTaskId, setOptimisticStatusByTaskId] = useState<Record<string, string>>({});
    const [titlePreviewByTaskId, setTitlePreviewByTaskId] = useState<Record<string, string>>({});
    const [activeEditingNodeId, setActiveEditingNodeId] = useState<string | null>(null);
    const [floatingEditNodeId, setFloatingEditNodeId] = useState<string | null>(null);
    const [floatingEditValue, setFloatingEditValue] = useState("");
    const [mobileKeyboardAccessoryPinned, setMobileKeyboardAccessoryPinned] = useState(false);
    const [externalImportDragOverMap, setExternalImportDragOverMap] = useState(false);
    const [externalImportDropTarget, setExternalImportDropTarget] = useState<CustomDropTarget | null>(null);
    const [externalImportResetKey, setExternalImportResetKey] = useState(0);
    const externalImportDropTargetRef = useRef<CustomDropTarget | null>(null);
    const { keyboardHeight, isKeyboardOpen, viewportBottom } = useKeyboardHeight();
    const codexRunnerStatus = useCodexRunnerStatus(Boolean(onToggleCodexThreadImport));
    const viewportRef = useRef<HTMLDivElement>(null);
    const stageRef = useRef<HTMLDivElement>(null);
    const keyboardAnchorRef = useRef<HTMLInputElement>(null);
    const floatingTextareaRef = useRef<HTMLTextAreaElement>(null);
    const floatingEditValueRef = useRef("");
    const floatingSelectAllOnFocusRef = useRef(true);
    const ignoreNextFloatingBlurRef = useRef(false);
    const keyboardActionInFlightRef = useRef(false);
    const handledPendingEditNodeIdRef = useRef<string | null>(null);
    const floatingCompositionActiveRef = useRef(false);
    const floatingCompositionResolversRef = useRef(new Set<() => void>());
    const zoomRef = useRef(zoom);
    const panOffsetRef = useRef(panOffset);
    const editControllersRef = useRef(new Map<string, CustomTaskEditController>());
    const pendingViewportTransformRef = useRef<{ zoom: number; pan: Point } | null>(null);
    const viewportRafRef = useRef<number | null>(null);
    const viewportAnimationFrameRef = useRef<number | null>(null);
    const dragAutoPanFrameRef = useRef<number | null>(null);
    const externalImportDragResetTimerRef = useRef<number | null>(null);
    const pinchGestureRef = useRef<PinchGestureState | null>(null);
    const panMovedRef = useRef(false);
    const pendingResizeSavesRef = useRef(new Map<string, number>());
    const suppressPaneClickUntilRef = useRef(0);
    const savedNodeWidthById = useMemo(() => {
        const byId = new Map<string, number | null>();
        for (const task of [...groups, ...tasks]) {
            byId.set(task.id, task.node_width ?? null);
        }
        return byId;
    }, [groups, tasks]);
    useEffect(() => {
        dragStateRef.current = dragState;
    }, [dragState]);
    const allTaskTitleById = useMemo(() => {
        const byId = new Map<string, string>();
        for (const task of [...groups, ...tasks]) {
            byId.set(task.id, task.title ?? "Task");
        }
        return byId;
    }, [groups, tasks]);
    const groupsForModel = useMemo(
        () => groups.map(task => {
            const width = nodeWidthOverrides[task.id];
            const status = optimisticStatusByTaskId[task.id];
            const previewTitle = titlePreviewByTaskId[task.id];
            if (width == null && status == null && previewTitle == null) return task;
            return {
                ...task,
                title: previewTitle ?? task.title,
                node_width: width ?? task.node_width,
                status: status ?? task.status,
            };
        }),
        [groups, nodeWidthOverrides, optimisticStatusByTaskId, titlePreviewByTaskId]
    );
    const tasksForModel = useMemo(
        () => tasks.map(task => {
            const width = nodeWidthOverrides[task.id];
            const status = optimisticStatusByTaskId[task.id];
            const previewTitle = titlePreviewByTaskId[task.id];
            if (width == null && status == null && previewTitle == null) return task;
            return {
                ...task,
                title: previewTitle ?? task.title,
                node_width: width ?? task.node_width,
                status: status ?? task.status,
            };
        }),
        [nodeWidthOverrides, optimisticStatusByTaskId, tasks, titlePreviewByTaskId]
    );
    const model = useMemo(
        () => buildMindMapModel({ project, groups: groupsForModel, tasks: tasksForModel, collapsedTaskIds, isMobile }),
        [project, groupsForModel, tasksForModel, collapsedTaskIds, isMobile]
    );

    const offsetX = PADDING - model.bounds.minX;
    const offsetY = PADDING - model.bounds.minY;
    const stageWidth = Math.max(isMobile ? 760 : 960, model.bounds.width + PADDING * 2);
    const stageHeight = Math.max(isMobile ? 720 : 640, model.bounds.height + PADDING * 2);
    const zoomBounds = useMemo(() => getMindMapViewportBounds(), []);
    const positionedNodes = useMemo(
        () => model.nodes.map(node => ({ ...node, x: node.x + offsetX, y: node.y + offsetY })),
        [model.nodes, offsetX, offsetY]
    );
    const nodeById = useMemo(() => new Map(positionedNodes.map(node => [node.id, node])), [positionedNodes]);
    const branchXByDepth = useMemo(() => {
        const rightByDepth = new Map<number, number>();
        const leftByDepth = new Map<number, number>();
        for (const node of positionedNodes) {
            rightByDepth.set(node.depth, Math.max(rightByDepth.get(node.depth) ?? -Infinity, node.x + node.width));
            leftByDepth.set(node.depth, Math.min(leftByDepth.get(node.depth) ?? Infinity, node.x));
        }

        const branchByDepth = new Map<number, number>();
        for (const [depth, right] of rightByDepth) {
            const nextLeft = leftByDepth.get(depth + 1);
            if (!Number.isFinite(right) || nextLeft == null || !Number.isFinite(nextLeft) || nextLeft <= right) continue;
            branchByDepth.set(depth, right + (nextLeft - right) / 2);
        }
        return branchByDepth;
    }, [positionedNodes]);
    const rawTaskTitleById = useMemo(() => new Map([...groups, ...tasks].map(task => [task.id, task.title ?? ""])), [groups, tasks]);

    const buildNodeCalendarDragPayload = useCallback((nodeId: string): MindMapNodeCalendarDragPayload | null => {
        const node = nodeById.get(nodeId);
        if (!node || node.kind !== "task") return null;
        const durationMinutes = Math.max(
            MIN_NODE_CALENDAR_DURATION_MINUTES,
            node.estimatedDisplayMinutes || node.estimatedTime || DEFAULT_NODE_CALENDAR_DURATION_MINUTES,
        );
        return {
            taskId: node.id,
            title: rawTaskTitleById.get(node.id) ?? node.title,
            durationMinutes,
            calendarId: node.calendarId,
            isDone: node.isDone,
        };
    }, [nodeById, rawTaskTitleById]);

    const publishNodeCalendarDrag = useCallback((
        phase: MindMapNodeCalendarDragEventDetail["phase"],
        state: DragState,
        clientX: number,
        clientY: number,
    ) => {
        if (!state.dragging || state.nodeIds.length !== 1) return;
        const payload = buildNodeCalendarDragPayload(state.primaryNodeId);
        if (!payload) return;
        dispatchMindMapNodeCalendarDrag({ phase, clientX, clientY, payload });
    }, [buildNodeCalendarDragPayload]);

    const handlePreviewTitleChange = useCallback((taskId: string, title: string | null) => {
        setTitlePreviewByTaskId(prev => {
            if (title == null) {
                clearPersistedMindmapTitleDraft(taskId);
                if (!(taskId in prev)) return prev;
                const next = { ...prev };
                delete next[taskId];
                return next;
            }
            writePersistedMindmapTitleDraft(taskId, title);
            return prev[taskId] === title ? prev : { ...prev, [taskId]: title };
        });
    }, []);

    useEffect(() => {
        setTitlePreviewByTaskId(prev => {
            let changed = false;
            const next = { ...prev };
            for (const [taskId, savedTitle] of allTaskTitleById.entries()) {
                if (taskId in next) continue;
                const draft = readPersistedMindmapTitleDraft(taskId);
                if (!draft || draft.title.trim() === savedTitle.trim()) {
                    if (draft) clearPersistedMindmapTitleDraft(taskId);
                    continue;
                }
                next[taskId] = draft.title;
                changed = true;
            }
            return changed ? next : prev;
        });
    }, [allTaskTitleById]);

    useEffect(() => {
        setTitlePreviewByTaskId(prev => {
            let changed = false;
            const next = { ...prev };
            for (const [taskId, previewTitle] of Object.entries(prev)) {
                if (!allTaskTitleById.has(taskId) || allTaskTitleById.get(taskId) === previewTitle) {
                    clearPersistedMindmapTitleDraft(taskId);
                    delete next[taskId];
                    changed = true;
                }
            }
            return changed ? next : prev;
        });
    }, [allTaskTitleById]);

    useEffect(() => {
        const statusByTaskId = new Map([...groups, ...tasks].map(task => [task.id, task.status ?? "todo"]));
        setOptimisticStatusByTaskId(prev => {
            let changed = false;
            const next = { ...prev };
            for (const [taskId, status] of Object.entries(prev)) {
                const savedStatus = statusByTaskId.get(taskId);
                if (savedStatus == null || savedStatus === status) {
                    delete next[taskId];
                    changed = true;
                }
            }
            return changed ? next : prev;
        });
    }, [groups, tasks]);

    const floatingEditNode = floatingEditNodeId ? nodeById.get(floatingEditNodeId) ?? null : null;
    const floatingEditKind = floatingEditNode?.kind ?? null;
    const getFloatingEditorRect = useCallback((node: MindMapModelNode, currentZoom = zoomRef.current, currentPan = panOffsetRef.current): Rect => {
        const scaledWidth = node.width * currentZoom;
        const scaledHeight = node.height * currentZoom;
        const minWidth = node.kind === "project" ? MOBILE_FLOATING_PROJECT_MIN_WIDTH : MOBILE_FLOATING_TASK_MIN_WIDTH;
        const minHeight = node.kind === "project" ? MOBILE_FLOATING_PROJECT_MIN_HEIGHT : MOBILE_FLOATING_TASK_MIN_HEIGHT;
        const width = Math.max(scaledWidth, minWidth);
        const height = Math.max(scaledHeight, minHeight);
        return {
            x: currentPan.x + (node.x + node.width / 2) * currentZoom - width / 2,
            y: currentPan.y + (node.y + node.height / 2) * currentZoom - height / 2,
            width,
            height,
        };
    }, []);
    const floatingEditViewportStyle = floatingEditNode
        ? (() => {
            const rect = getFloatingEditorRect(floatingEditNode, zoom, panOffset);
            return {
                left: Math.round(rect.x),
                top: Math.round(rect.y),
                width: Math.round(rect.width),
                minHeight: Math.round(rect.height),
            };
        })()
        : undefined;
    const selectedTaskIds = useMemo(
        () => positionedNodes
            .filter(node => node.kind === "task" && selectedNodeIds.has(node.id))
            .map(node => node.id),
        [positionedNodes, selectedNodeIds]
    );
    const activeAccessoryNode = useMemo(() => {
        const nodeId = floatingEditNodeId ?? activeEditingNodeId;
        if (!nodeId) return null;
        return nodeById.get(nodeId) ?? null;
    }, [activeEditingNodeId, floatingEditNodeId, nodeById]);
    const codexSummary = useMemo(() => {
        const states = positionedNodes
            .filter(node => node.kind === "task")
            .map(node => codexRunByNodeId[node.id])
            .filter((state): state is CodexNodeState => Boolean(state));
        return {
            running: states.filter(state => state.state === "running").length,
            promptWaiting: states.filter(state => state.state === "prompt_waiting").length,
            awaitingApproval: states.filter(state => state.state === "awaiting_approval").length,
            connectionFailed: states.filter(state => state.state === "connection_failed").length,
        };
    }, [codexRunByNodeId, positionedNodes]);

    useEffect(() => {
        zoomRef.current = zoom;
    }, [zoom]);

    useEffect(() => {
        panOffsetRef.current = panOffset;
    }, [panOffset]);

    useEffect(() => {
        setNodeWidthOverrides(prev => {
            let changed = false;
            const next = { ...prev };
            for (const [taskId, width] of Object.entries(prev)) {
                if (!savedNodeWidthById.has(taskId) || savedNodeWidthById.get(taskId) === width) {
                    delete next[taskId];
                    pendingResizeSavesRef.current.delete(taskId);
                    changed = true;
                }
            }
            return changed ? next : prev;
        });
    }, [savedNodeWidthById]);

    const handleResizeNode = useCallback((taskId: string, width: number, commit: boolean) => {
        setNodeWidthOverrides(prev => (prev[taskId] === width ? prev : { ...prev, [taskId]: width }));
        if (!commit) return;
        pendingResizeSavesRef.current.set(taskId, width);
        void Promise.resolve(onResizeNode?.(taskId, width))
            .catch(error => {
                if (pendingResizeSavesRef.current.get(taskId) !== width) return;
                pendingResizeSavesRef.current.delete(taskId);
                setNodeWidthOverrides(prev => {
                    if (prev[taskId] !== width) return prev;
                    const next = { ...prev };
                    delete next[taskId];
                    return next;
                });
                console.error("[CustomMindMap] Failed to save node width:", error);
            });
    }, [onResizeNode]);

    useEffect(() => {
        const isTypingTarget = (target: EventTarget | null) => {
            if (!(target instanceof HTMLElement)) return false;
            return !!target.closest("input,textarea,select,[contenteditable='true']");
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.code !== "Space" || isTypingTarget(event.target)) return;
            event.preventDefault();
            setSpacePressed(true);
        };
        const handleKeyUp = (event: KeyboardEvent) => {
            if (event.code !== "Space") return;
            setSpacePressed(false);
        };
        const handleBlur = () => setSpacePressed(false);
        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("keyup", handleKeyUp);
        window.addEventListener("blur", handleBlur);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("keyup", handleKeyUp);
            window.removeEventListener("blur", handleBlur);
        };
    }, []);

    const getStagePoint = useCallback((clientX: number, clientY: number) => {
        const rect = viewportRef.current?.getBoundingClientRect();
        if (!rect) return null;
        return {
            x: (clientX - rect.left - panOffsetRef.current.x) / zoomRef.current,
            y: (clientY - rect.top - panOffsetRef.current.y) / zoomRef.current,
        };
    }, []);

    const writeStageTransform = useCallback((nextZoom: number, nextPan: Point) => {
        const stage = stageRef.current;
        if (!stage) return;
        stage.style.transform = `translate3d(${nextPan.x}px, ${nextPan.y}px, 0) scale(${nextZoom})`;
    }, []);

    const cancelViewportAnimation = useCallback(() => {
        if (viewportAnimationFrameRef.current === null) return;
        window.cancelAnimationFrame(viewportAnimationFrameRef.current);
        viewportAnimationFrameRef.current = null;
    }, []);

    const commitViewportTransform = useCallback(() => {
        cancelViewportAnimation();
        if (viewportRafRef.current !== null) {
            window.cancelAnimationFrame(viewportRafRef.current);
            viewportRafRef.current = null;
        }
        const pending = pendingViewportTransformRef.current;
        pendingViewportTransformRef.current = null;
        const nextZoom = pending?.zoom ?? zoomRef.current;
        const nextPan = pending?.pan ?? panOffsetRef.current;
        setZoom(nextZoom);
        setPanOffset(nextPan);
    }, [cancelViewportAnimation]);

    const applyViewportTransform = useCallback((nextZoom: number, nextPan: Point, options: { deferCommit?: boolean } = {}) => {
        cancelViewportAnimation();
        zoomRef.current = nextZoom;
        panOffsetRef.current = nextPan;
        pendingViewportTransformRef.current = { zoom: nextZoom, pan: nextPan };
        writeStageTransform(nextZoom, nextPan);
        if (options.deferCommit) return;
        if (viewportRafRef.current !== null) return;
        viewportRafRef.current = window.requestAnimationFrame(() => {
            viewportRafRef.current = null;
            const pending = pendingViewportTransformRef.current;
            if (!pending) return;
            pendingViewportTransformRef.current = null;
            setZoom(pending.zoom);
            setPanOffset(pending.pan);
        });
    }, [cancelViewportAnimation, writeStageTransform]);

    const animateViewportTransform = useCallback((nextZoom: number, nextPan: Point, durationMs: number) => {
        if (viewportRafRef.current !== null) {
            window.cancelAnimationFrame(viewportRafRef.current);
            viewportRafRef.current = null;
        }
        pendingViewportTransformRef.current = null;

        const startZoom = zoomRef.current;
        const startPan = panOffsetRef.current;
        const deltaX = nextPan.x - startPan.x;
        const deltaY = nextPan.y - startPan.y;
        const deltaZoom = nextZoom - startZoom;

        if (
            durationMs <= 0 ||
            prefersReducedMotion() ||
            (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1 && Math.abs(deltaZoom) < 0.001)
        ) {
            applyViewportTransform(nextZoom, nextPan);
            return;
        }

        cancelViewportAnimation();
        let startTime: number | null = null;

        const step = (now: number) => {
            startTime ??= now;
            const progress = Math.min(1, Math.max(0, (now - startTime) / durationMs));
            const eased = easeOutCubic(progress);
            const currentZoom = startZoom + deltaZoom * eased;
            const currentPan = {
                x: startPan.x + deltaX * eased,
                y: startPan.y + deltaY * eased,
            };

            zoomRef.current = currentZoom;
            panOffsetRef.current = currentPan;
            writeStageTransform(currentZoom, currentPan);

            if (progress < 1) {
                viewportAnimationFrameRef.current = window.requestAnimationFrame(step);
                return;
            }

            viewportAnimationFrameRef.current = null;
            zoomRef.current = nextZoom;
            panOffsetRef.current = nextPan;
            writeStageTransform(nextZoom, nextPan);
            setZoom(nextZoom);
            setPanOffset(nextPan);
        };

        viewportAnimationFrameRef.current = window.requestAnimationFrame(step);
    }, [applyViewportTransform, cancelViewportAnimation, writeStageTransform]);

    const setZoomAtViewportPoint = useCallback((nextZoomRaw: number, origin: Point | null = null) => {
        const rect = viewportRef.current?.getBoundingClientRect();
        const originPoint = origin ?? {
            x: rect ? rect.width / 2 : 0,
            y: rect ? rect.height / 2 : 0,
        };
        const next = getViewportTransformAtPoint({
            currentZoom: zoomRef.current,
            currentPan: panOffsetRef.current,
            nextZoom: nextZoomRaw,
            origin: originPoint,
            bounds: zoomBounds,
        });
        if (next.zoom === zoomRef.current && next.pan.x === panOffsetRef.current.x && next.pan.y === panOffsetRef.current.y) return;
        applyViewportTransform(next.zoom, next.pan);
    }, [applyViewportTransform, zoomBounds]);

    const isDescendantNode = useCallback((candidateId: string, ancestorId: string) => {
        let current = nodeById.get(candidateId);
        const visited = new Set<string>();
        while (current?.parentId && !visited.has(current.parentId)) {
            if (current.parentId === ancestorId) return true;
            visited.add(current.parentId);
            current = nodeById.get(current.parentId);
        }
        return false;
    }, [nodeById]);

    const getDropTarget = useCallback((draggedNodeIds: string[], primaryNodeId: string, x: number, y: number): CustomDropTarget | null => {
        const dragged = nodeById.get(primaryNodeId);
        if (!dragged || dragged.kind !== "task") return null;
        const draggedIds = new Set(draggedNodeIds);

        const draggedCenterX = x + dragged.width / 2;
        const draggedCenterY = y + dragged.height / 2;
        let best: { node: MindMapModelNode; distance: number; position: CustomDropPosition } | null = null;

        for (const candidate of positionedNodes) {
            if (draggedIds.has(candidate.id)) continue;
            if (candidate.kind === "task" && draggedNodeIds.some(nodeId => isDescendantNode(candidate.id, nodeId))) continue;

            const left = candidate.x;
            const top = candidate.y;
            const right = candidate.x + candidate.width;
            const bottom = candidate.y + candidate.height;
            const centerX = candidate.x + candidate.width / 2;
            const clampedX = Math.max(left, Math.min(draggedCenterX, right));
            const clampedY = Math.max(top, Math.min(draggedCenterY, bottom));
            const distance = Math.hypot(clampedX - draggedCenterX, clampedY - draggedCenterY);
            if (distance > DROP_TARGET_MAX_DISTANCE) continue;

            let position: CustomDropPosition;
            if (candidate.kind === "project") {
                position = "as-child";
            } else {
                const relativeY = draggedCenterY - top;
                const relativeX = draggedCenterX - centerX;
                if (relativeX > -candidate.width * 0.1) {
                    if (relativeY < candidate.height * 0.15) {
                        position = "above";
                    } else if (relativeY > candidate.height * 0.85) {
                        position = "below";
                    } else {
                        position = "as-child";
                    }
                } else {
                    position = relativeY < candidate.height * 0.5 ? "above" : "below";
                }
            }

            if (!best || distance < best.distance) {
                best = { node: candidate, distance, position };
            }
        }

        return best ? { nodeId: best.node.id, position: best.position } : null;
    }, [isDescendantNode, nodeById, positionedNodes]);

    const getExternalImportDropTarget = useCallback((clientX: number, clientY: number): CustomDropTarget | null => {
        const point = getStagePoint(clientX, clientY);
        if (!point) return null;

        let best: { node: MindMapModelNode; distance: number; position: CustomDropPosition } | null = null;
        for (const candidate of positionedNodes) {
            if (candidate.kind !== "project" && candidate.kind !== "task") continue;

            const left = candidate.x;
            const top = candidate.y;
            const right = candidate.x + candidate.width;
            const bottom = candidate.y + candidate.height;
            const centerX = candidate.x + candidate.width / 2;
            const clampedX = Math.max(left, Math.min(point.x, right));
            const clampedY = Math.max(top, Math.min(point.y, bottom));
            const distance = Math.hypot(clampedX - point.x, clampedY - point.y);
            if (distance > DROP_TARGET_MAX_DISTANCE) continue;

            let position: CustomDropPosition = "as-child";
            if (candidate.kind === "task") {
                const relativeY = point.y - top;
                const relativeX = point.x - centerX;
                if (relativeX > -candidate.width * 0.1) {
                    if (relativeY < candidate.height * 0.3) {
                        position = "above";
                    } else if (relativeY > candidate.height * 0.7) {
                        position = "below";
                    }
                } else {
                    position = relativeY < candidate.height * 0.5 ? "above" : "below";
                }
            }

            if (!best || distance < best.distance) best = { node: candidate, distance, position };
        }

        return best ? { nodeId: best.node.id, position: best.position } : null;
    }, [getStagePoint, positionedNodes]);

    const handleSelectTaskNode = useCallback((nodeId: string, options?: { additive: boolean }) => {
        if (Date.now() < suppressPaneClickUntilRef.current) return false;

        if (!options?.additive) {
            onSelectNode(nodeId);
            return true;
        }

        const next = new Set(selectedNodeIds);
        if (next.has(nodeId)) {
            next.delete(nodeId);
        } else {
            next.add(nodeId);
        }
        const primaryNodeId = next.has(selectedNodeId ?? "") ? selectedNodeId : nodeId;
        onSelectNodes(Array.from(next), next.size > 0 ? primaryNodeId : null);
        return true;
    }, [onSelectNode, onSelectNodes, selectedNodeId, selectedNodeIds]);

    const syncFloatingTextareaHeight = useCallback((input: HTMLTextAreaElement) => {
        input.style.height = "auto";
        input.style.height = `${input.scrollHeight}px`;
    }, []);

    const updateFloatingEditValue = useCallback((nextValue: string) => {
        floatingEditValueRef.current = nextValue;
        setFloatingEditValue(nextValue);
        const node = floatingEditNodeId ? nodeById.get(floatingEditNodeId) : null;
        if (node?.kind === "task") handlePreviewTitleChange(node.id, nextValue);
        const input = floatingTextareaRef.current;
        if (input) syncFloatingTextareaHeight(input);
    }, [floatingEditNodeId, handlePreviewTitleChange, nodeById, syncFloatingTextareaHeight]);

    const resolveFloatingComposition = useCallback(() => {
        floatingCompositionActiveRef.current = false;
        const resolvers = Array.from(floatingCompositionResolversRef.current);
        floatingCompositionResolversRef.current.clear();
        resolvers.forEach(resolve => resolve());
    }, []);

    const focusFloatingTextarea = useCallback((selectAll: boolean) => {
        const input = floatingTextareaRef.current;
        if (!input) return false;
        input.focus({ preventScroll: true });
        const length = input.value.length;
        if (selectAll) {
            input.setSelectionRange(0, length);
        } else {
            input.setSelectionRange(length, length);
        }
        syncFloatingTextareaHeight(input);
        return true;
    }, [syncFloatingTextareaHeight]);

    const startFloatingEdit = useCallback((nodeId: string, initialValue?: string, options: CustomEditRequestOptions = {}) => {
        if (!isMobile) return false;
        const node = nodeById.get(nodeId);
        if (!node) return false;
        const nextValue = initialValue ?? (node.kind === "project" ? node.title : rawTaskTitleById.get(node.id) ?? node.title);
        floatingEditValueRef.current = nextValue;
        setFloatingEditValue(nextValue);
        if (node.kind === "task") handlePreviewTitleChange(node.id, nextValue);
        floatingSelectAllOnFocusRef.current = options.selectAll ?? true;
        if (keyboardAnchorRef.current) keyboardAnchorRef.current.value = "";
        setMobileKeyboardAccessoryPinned(true);
        setFloatingEditNodeId(node.id);
        setActiveEditingNodeId(node.id);
        if (floatingEditNodeId === node.id && floatingTextareaRef.current) {
            floatingTextareaRef.current.value = nextValue;
            focusFloatingTextarea(floatingSelectAllOnFocusRef.current);
        }
        return true;
    }, [floatingEditNodeId, focusFloatingTextarea, handlePreviewTitleChange, isMobile, nodeById, rawTaskTitleById]);

    useLayoutEffect(() => {
        if (!isMobile) return;
        if (!pendingEditNodeId) {
            handledPendingEditNodeIdRef.current = null;
            return;
        }
        if (floatingEditNodeId === pendingEditNodeId) {
            handledPendingEditNodeIdRef.current = pendingEditNodeId;
            return;
        }
        if (handledPendingEditNodeIdRef.current === pendingEditNodeId) return;
        const node = nodeById.get(pendingEditNodeId);
        if (!node) return;
        const initialValue = node.kind === "project" ? node.title : rawTaskTitleById.get(node.id) ?? "";
        if (startFloatingEdit(node.id, initialValue)) {
            handledPendingEditNodeIdRef.current = node.id;
        }
    }, [floatingEditNodeId, isMobile, nodeById, pendingEditNodeId, rawTaskTitleById, startFloatingEdit]);

    useLayoutEffect(() => {
        const input = floatingTextareaRef.current;
        if (!input || !floatingEditNodeId) return;
        input.value = floatingEditValueRef.current;
        focusFloatingTextarea(floatingSelectAllOnFocusRef.current);
    }, [floatingEditNodeId, focusFloatingTextarea]);

    useLayoutEffect(() => {
        const input = floatingTextareaRef.current;
        if (!input || !floatingEditNodeId) return;
        syncFloatingTextareaHeight(input);
    }, [floatingEditNodeId, floatingEditValue, syncFloatingTextareaHeight]);

    const commitFloatingEdit = useCallback(async (options: { close?: boolean; waitForSave?: boolean } = {}) => {
        if (!floatingEditNodeId) return;
        const node = nodeById.get(floatingEditNodeId);
        if (!node) return;
        const fallbackTitle = node.kind === "project" ? "Project" : "Task";
        const currentValue = floatingTextareaRef.current?.value ?? floatingEditValueRef.current;
        const nextTitle = currentValue.trim() || fallbackTitle;
        let saveAction: void | Promise<void> | undefined = undefined;

        if (node.kind === "project") {
            if (nextTitle !== node.title) saveAction = onSaveProjectTitle?.(nextTitle);
        } else {
            handlePreviewTitleChange(node.id, nextTitle);
            const savedTitle = rawTaskTitleById.get(node.id) ?? node.title;
            if (nextTitle !== savedTitle) saveAction = onSaveTitle?.(node.id, nextTitle);
        }

        if (saveAction && options.waitForSave === false) {
            void Promise.resolve(saveAction).catch(error => {
                console.error("[CustomMindMap] Failed to save floating edit:", error);
            });
        } else if (saveAction) {
            await saveAction;
        }

        floatingEditValueRef.current = nextTitle;
        setFloatingEditValue(nextTitle);
        if (floatingTextareaRef.current) {
            floatingTextareaRef.current.value = nextTitle;
        }
        if (options.close) {
            setFloatingEditNodeId(null);
            setActiveEditingNodeId(prev => prev === node.id ? null : prev);
            setMobileKeyboardAccessoryPinned(false);
        }
    }, [floatingEditNodeId, handlePreviewTitleChange, nodeById, onSaveProjectTitle, onSaveTitle, rawTaskTitleById]);

    const clearFloatingTaskPreview = useCallback(() => {
        const node = floatingEditNodeId ? nodeById.get(floatingEditNodeId) : null;
        if (node?.kind === "task") handlePreviewTitleChange(node.id, null);
    }, [floatingEditNodeId, handlePreviewTitleChange, nodeById]);

    const handleFloatingEditBlur = useCallback((event: React.FocusEvent<HTMLTextAreaElement>) => {
        if (ignoreNextFloatingBlurRef.current) return;
        if (event.relatedTarget === keyboardAnchorRef.current) return;
        void commitFloatingEdit({ close: true });
    }, [commitFloatingEdit]);

    const mirrorKeyboardAnchorValue = useCallback((input: HTMLInputElement) => {
        if (!floatingEditNodeId) {
            input.value = "";
            return;
        }
        updateFloatingEditValue(input.value);
    }, [floatingEditNodeId, updateFloatingEditValue]);

    const handleKeyboardAnchorChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        mirrorKeyboardAnchorValue(event.currentTarget);
    }, [mirrorKeyboardAnchorValue]);

    const handleKeyboardAnchorInput = useCallback((event: React.FormEvent<HTMLInputElement>) => {
        mirrorKeyboardAnchorValue(event.currentTarget);
    }, [mirrorKeyboardAnchorValue]);

    const handleKeyboardAnchorCompositionEnd = useCallback((event: React.CompositionEvent<HTMLInputElement>) => {
        mirrorKeyboardAnchorValue(event.currentTarget);
    }, [mirrorKeyboardAnchorValue]);

    const handleFloatingEditValueChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
        updateFloatingEditValue(event.currentTarget.value);
        event.currentTarget.style.height = "auto";
        event.currentTarget.style.height = `${event.currentTarget.scrollHeight}px`;
    }, [updateFloatingEditValue]);

    const handleFloatingEditCompositionStart = useCallback(() => {
        floatingCompositionActiveRef.current = true;
    }, []);

    const handleFloatingEditCompositionEnd = useCallback((event: React.CompositionEvent<HTMLTextAreaElement>) => {
        updateFloatingEditValue(event.currentTarget.value);
        resolveFloatingComposition();
    }, [resolveFloatingComposition, updateFloatingEditValue]);

    const finishFloatingComposition = useCallback(async () => {
        const input = floatingTextareaRef.current;
        if (!input || !floatingCompositionActiveRef.current) return;

        ignoreNextFloatingBlurRef.current = true;
        const waitForComposition = new Promise<void>(resolve => {
            let settled = false;
            const settle = () => {
                if (settled) return;
                settled = true;
                input.removeEventListener("compositionend", settle);
                input.removeEventListener("input", settle);
                updateFloatingEditValue(input.value);
                resolveFloatingComposition();
                resolve();
            };

            floatingCompositionResolversRef.current.add(settle);
            input.addEventListener("compositionend", settle, { once: true });
            input.addEventListener("input", settle, { once: true });
            window.setTimeout(settle, 160);
        });

        input.blur();
        const anchor = keyboardAnchorRef.current;
        if (anchor) {
            anchor.value = "";
            anchor.focus({ preventScroll: true });
        }

        await waitForComposition;
        requestAnimationFrame(() => {
            ignoreNextFloatingBlurRef.current = false;
        });
    }, [resolveFloatingComposition, updateFloatingEditValue]);

    const handleKeyboardAnchorKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
        event.stopPropagation();
        if (!floatingEditNodeId) return;
        if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void commitFloatingEdit({ close: true });
        }
        if (event.key === "Escape") {
            event.preventDefault();
            clearFloatingTaskPreview();
            setFloatingEditNodeId(null);
            setActiveEditingNodeId(null);
            setMobileKeyboardAccessoryPinned(false);
        }
    }, [clearFloatingTaskPreview, commitFloatingEdit, floatingEditNodeId]);

    const dismissFloatingEdit = useCallback(() => {
        if (floatingEditNodeId) {
            void commitFloatingEdit({ close: true });
            return;
        }
        setActiveEditingNodeId(null);
    }, [commitFloatingEdit, floatingEditNodeId]);

    const finishActiveInlineEdit = useCallback(() => {
        if (!activeEditingNodeId) return false;
        const controller = editControllersRef.current.get(activeEditingNodeId);
        if (!controller) {
            setActiveEditingNodeId(null);
            return false;
        }
        void controller.finishEditing({ refocus: false }).catch(error => {
            console.error("[CustomMindMap] Failed to finish active edit:", error);
        });
        return true;
    }, [activeEditingNodeId]);

    const keepNodeAboveKeyboard = useCallback((node: MindMapModelNode, options: { animate?: boolean } = {}) => {
        const viewport = viewportRef.current;
        if (!viewport) return;
        const rect = viewport.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;

        const currentZoom = zoomRef.current;
        const currentPan = panOffsetRef.current;
        const keyboardTop = viewportBottom > 0 ? Math.min(rect.bottom, viewportBottom) : rect.bottom;
        const visibleTop = MOBILE_KEYBOARD_NODE_MARGIN;
        const keyboardLikelyOpen = isKeyboardOpen || mobileKeyboardAccessoryPinned;
        const visibleBottom = Math.max(
            visibleTop + node.height * currentZoom,
            keyboardTop - rect.top - (keyboardLikelyOpen ? MOBILE_KEYBOARD_ACCESSORY_CLEARANCE : MOBILE_KEYBOARD_NODE_MARGIN)
        );
        const visibleLeft = MOBILE_KEYBOARD_NODE_MARGIN;
        const visibleRight = Math.max(
            visibleLeft + node.width * currentZoom,
            rect.width - MOBILE_KEYBOARD_NODE_MARGIN
        );

        const nodeRect = floatingEditNodeId === node.id
            ? getFloatingEditorRect(node, currentZoom, currentPan)
            : {
                x: currentPan.x + node.x * currentZoom,
                y: currentPan.y + node.y * currentZoom,
                width: node.width * currentZoom,
                height: node.height * currentZoom,
            };
        const nodeLeft = nodeRect.x;
        const nodeRight = nodeRect.x + nodeRect.width;
        const nodeTop = nodeRect.y;
        const nodeBottom = nodeRect.y + nodeRect.height;

        let deltaX = 0;
        let deltaY = 0;
        if (nodeRight > visibleRight) deltaX = visibleRight - nodeRight;
        if (nodeLeft + deltaX < visibleLeft) deltaX = visibleLeft - nodeLeft;
        if (nodeBottom > visibleBottom) deltaY = visibleBottom - nodeBottom;
        if (nodeTop + deltaY < visibleTop) deltaY = visibleTop - nodeTop;

        if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) return;
        const nextPan = {
            x: currentPan.x + deltaX,
            y: currentPan.y + deltaY,
        };
        if (options.animate) {
            animateViewportTransform(currentZoom, nextPan, MOBILE_NODE_FOCUS_DURATION_MS);
        } else {
            applyViewportTransform(currentZoom, nextPan);
        }
    }, [animateViewportTransform, applyViewportTransform, floatingEditNodeId, getFloatingEditorRect, isKeyboardOpen, mobileKeyboardAccessoryPinned, viewportBottom]);

    useEffect(() => {
        if (!isMobile || (!isKeyboardOpen && !mobileKeyboardAccessoryPinned)) return;
        const nodeId = floatingEditNodeId ?? selectedNodeId;
        if (!nodeId) return;
        const frameIds: number[] = [];
        const timeoutIds: number[] = [];
        const trackNode = () => {
            const node = nodeById.get(nodeId);
            if (node) keepNodeAboveKeyboard(node, { animate: pendingEditNodeId === nodeId && floatingEditNodeId !== nodeId });
        };
        const trackOnFrame = () => {
            frameIds.push(requestAnimationFrame(trackNode));
        };

        trackOnFrame();
        timeoutIds.push(window.setTimeout(trackOnFrame, 80));
        timeoutIds.push(window.setTimeout(trackOnFrame, 220));

        return () => {
            frameIds.forEach(frameId => cancelAnimationFrame(frameId));
            timeoutIds.forEach(timeoutId => window.clearTimeout(timeoutId));
        };
    }, [floatingEditNodeId, isKeyboardOpen, isMobile, keepNodeAboveKeyboard, mobileKeyboardAccessoryPinned, nodeById, pendingEditNodeId, selectedNodeId, viewportBottom, zoom]);

    const getDragStateForClientPoint = useCallback((
        prev: DragState,
        clientX: number,
        clientY: number,
        options: { forceDragging?: boolean } = {},
    ): DragState | null => {
        const point = getStagePoint(clientX, clientY);
        if (!point) return null;
        const deltaX = point.x - prev.startPointerX;
        const deltaY = point.y - prev.startPointerY;
        const x = prev.primaryStartX + deltaX;
        const y = prev.primaryStartY + deltaY;
        const distance = Math.hypot(deltaX, deltaY);
        const dragging = Boolean(options.forceDragging) || prev.dragging || distance >= DRAG_START_THRESHOLD;

        return {
            ...prev,
            deltaX,
            deltaY,
            lastClientX: clientX,
            lastClientY: clientY,
            dragging,
            target: dragging ? getDropTarget(prev.nodeIds, prev.primaryNodeId, x, y) : null,
        };
    }, [getDropTarget, getStagePoint]);

    const beginDragFromClientPoint = useCallback((node: MindMapModelNode, clientX: number, clientY: number) => {
        if (node.kind !== "task") return;
        const point = getStagePoint(clientX, clientY);
        if (!point) return;

        const dragNodeIds = selectedTaskIds.includes(node.id) && selectedTaskIds.length > 1
            ? selectedTaskIds
            : [node.id];
        const nodeStarts = dragNodeIds.reduce<Record<string, { x: number; y: number }>>((acc, nodeId) => {
            const draggedNode = nodeById.get(nodeId);
            if (draggedNode?.kind === "task") {
                acc[nodeId] = { x: draggedNode.x, y: draggedNode.y };
            }
            return acc;
        }, {});

        if (!selectedNodeIds.has(node.id) || selectedTaskIds.length <= 1) {
            onSelectNode(node.id);
        }

        const nextDragState = {
            primaryNodeId: node.id,
            nodeIds: Object.keys(nodeStarts),
            nodeStarts,
            startPointerX: point.x,
            startPointerY: point.y,
            primaryStartX: node.x,
            primaryStartY: node.y,
            deltaX: 0,
            deltaY: 0,
            lastClientX: clientX,
            lastClientY: clientY,
            dragging: false,
            target: null,
        };
        dragStateRef.current = nextDragState;
        setDragState(nextDragState);
    }, [getStagePoint, nodeById, onSelectNode, selectedNodeIds, selectedTaskIds]);

    const handleStartDrag = useCallback((node: MindMapModelNode, event: React.PointerEvent<HTMLDivElement>) => {
        if (node.kind !== "task" || event.button !== 0) return;
        if (event.shiftKey || event.metaKey || event.ctrlKey) {
            event.stopPropagation();
            return;
        }

        clearMindMapTextSelection();

        if (isMobile && event.pointerType === "touch") {
            event.stopPropagation();
            event.currentTarget.setPointerCapture?.(event.pointerId);
            setPanState(null);
            setSelectionBox(null);
            beginDragFromClientPoint(node, event.clientX, event.clientY);
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        beginDragFromClientPoint(node, event.clientX, event.clientY);
    }, [beginDragFromClientPoint, isMobile]);

    const startRangeSelection = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        if (isMobile && event.pointerType === "touch") return;
        if (spacePressed) return;
        const isNodeTarget = isMindMapNodeTarget(event.target);
        if (isInteractiveMapTarget(event.target) || isNodeTarget) return;
        if (floatingEditNodeId) dismissFloatingEdit();
        finishActiveInlineEdit();
        const point = getStagePoint(event.clientX, event.clientY);
        if (!point) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        setSelectionBox({
            startX: point.x,
            startY: point.y,
            currentX: point.x,
            currentY: point.y,
            additive: event.shiftKey || event.metaKey || event.ctrlKey,
        });
    }, [dismissFloatingEdit, finishActiveInlineEdit, floatingEditNodeId, getStagePoint, isMobile, spacePressed]);

    const handleViewportPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        if (pinchGestureRef.current) return;
        const isTouchPan = isMobile && event.pointerType === "touch";
        const isPanButton = event.button === 1 || event.button === 2 || (event.button === 0 && spacePressed) || isTouchPan;
        if (!isPanButton) {
            startRangeSelection(event);
            return;
        }
        if (isInteractiveMapTarget(event.target)) return;
        const isNodeTarget = isMindMapNodeTarget(event.target);
        if (isNodeTarget && floatingEditNodeId) return;
        if (floatingEditNodeId) {
            dismissFloatingEdit();
            onSelectNode(null);
        }
        if (!isNodeTarget) finishActiveInlineEdit();
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        setSelectionBox(null);
        dragStateRef.current = null;
        setDragState(null);
        setPanState({
            startClientX: event.clientX,
            startClientY: event.clientY,
            startPanX: panOffsetRef.current.x,
            startPanY: panOffsetRef.current.y,
        });
        panMovedRef.current = false;
    }, [dismissFloatingEdit, finishActiveInlineEdit, floatingEditNodeId, isMobile, onSelectNode, spacePressed, startRangeSelection]);

    const handleWheel = useCallback((event: WheelEvent) => {
        event.preventDefault();
        const rect = viewportRef.current?.getBoundingClientRect();
        if (!rect) return;

        if (!event.ctrlKey && !event.metaKey) {
            const deltaModeScale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? Math.max(rect.width, rect.height) : 1;
            const nextPan = {
                x: panOffsetRef.current.x - event.deltaX * deltaModeScale * WHEEL_PAN_SENSITIVITY,
                y: panOffsetRef.current.y - event.deltaY * deltaModeScale * WHEEL_PAN_SENSITIVITY,
            };
            applyViewportTransform(zoomRef.current, nextPan);
            return;
        }

        const nextZoom = zoomRef.current * Math.exp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY);
        setZoomAtViewportPoint(nextZoom, {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
        });
    }, [applyViewportTransform, setZoomAtViewportPoint]);

    useEffect(() => {
        const viewport = viewportRef.current;
        if (!viewport) return;

        const startPinch = (event: TouchEvent) => {
            if (event.touches.length !== 2) return;
            event.preventDefault();
            const midpoint = getTouchMidpoint(event.touches, viewport);
            const currentZoom = zoomRef.current;
            const currentPan = panOffsetRef.current;
            pinchGestureRef.current = {
                source: "touch",
                initialDistance: getTouchDistance(event.touches),
                initialZoom: currentZoom,
                initialStagePoint: {
                    x: (midpoint.x - currentPan.x) / currentZoom,
                    y: (midpoint.y - currentPan.y) / currentZoom,
                },
            };
            setPanState(null);
            setSelectionBox(null);
            dragStateRef.current = null;
            setDragState(null);
        };

        const movePinch = (event: TouchEvent) => {
            if (event.touches.length !== 2) return;
            event.preventDefault();
            const currentDistance = getTouchDistance(event.touches);
            const currentMidpoint = getTouchMidpoint(event.touches, viewport);
            const activeGesture = pinchGestureRef.current;
            const currentGesture = activeGesture?.source === "touch" ? activeGesture : {
                source: "touch" as const,
                initialDistance: currentDistance,
                initialZoom: zoomRef.current,
                initialStagePoint: getStagePoint(
                    (event.touches[0].clientX + event.touches[1].clientX) / 2,
                    (event.touches[0].clientY + event.touches[1].clientY) / 2
                ) ?? { x: 0, y: 0 },
            };
            pinchGestureRef.current = currentGesture;
            if (currentGesture.initialDistance <= 0) return;
            const next = getPinchViewportTransform({
                start: currentGesture,
                currentDistance,
                currentMidpoint,
                bounds: zoomBounds,
                sensitivity: TOUCH_PINCH_SENSITIVITY,
            });
            applyViewportTransform(next.zoom, next.pan, { deferCommit: true });
        };

        const endPinch = (event: TouchEvent) => {
            if (event.touches.length >= 2) return;
            if (pinchGestureRef.current?.source === "touch") {
                suppressPaneClickUntilRef.current = Date.now() + 200;
                commitViewportTransform();
                pinchGestureRef.current = null;
            }
        };

        const startGesture = (event: Event) => {
            if (isMobile) return;
            event.preventDefault();
            const rect = viewport.getBoundingClientRect();
            const origin = "clientX" in event && typeof (event as WebKitGestureEvent).clientX === "number" && typeof (event as WebKitGestureEvent).clientY === "number"
                ? { x: (event as WebKitGestureEvent).clientX! - rect.left, y: (event as WebKitGestureEvent).clientY! - rect.top }
                : { x: rect.width / 2, y: rect.height / 2 };
            const currentZoom = zoomRef.current;
            const currentPan = panOffsetRef.current;
            pinchGestureRef.current = {
                source: "gesture",
                initialDistance: 1,
                initialZoom: currentZoom,
                initialStagePoint: {
                    x: (origin.x - currentPan.x) / currentZoom,
                    y: (origin.y - currentPan.y) / currentZoom,
                },
            };
            setPanState(null);
            setSelectionBox(null);
            dragStateRef.current = null;
            setDragState(null);
        };

        const moveGesture = (event: Event) => {
            if (isMobile) return;
            event.preventDefault();
            const gestureEvent = event as WebKitGestureEvent;
            const rect = viewport.getBoundingClientRect();
            const origin = typeof gestureEvent.clientX === "number" && typeof gestureEvent.clientY === "number"
                ? { x: gestureEvent.clientX - rect.left, y: gestureEvent.clientY - rect.top }
                : { x: rect.width / 2, y: rect.height / 2 };
            const activeGesture = pinchGestureRef.current;
            const currentGesture = activeGesture?.source === "gesture" ? activeGesture : {
                source: "gesture" as const,
                initialDistance: 1,
                initialZoom: zoomRef.current,
                initialStagePoint: {
                    x: (origin.x - panOffsetRef.current.x) / zoomRef.current,
                    y: (origin.y - panOffsetRef.current.y) / zoomRef.current,
                },
            };
            pinchGestureRef.current = currentGesture;
            const next = getPinchViewportTransform({
                start: currentGesture,
                currentDistance: gestureEvent.scale,
                currentMidpoint: origin,
                bounds: zoomBounds,
                sensitivity: DESKTOP_GESTURE_SENSITIVITY,
            });
            applyViewportTransform(next.zoom, next.pan, { deferCommit: true });
        };

        const endGesture = (event: Event) => {
            if (isMobile) return;
            event.preventDefault();
            if (pinchGestureRef.current?.source === "gesture") {
                suppressPaneClickUntilRef.current = Date.now() + 200;
                commitViewportTransform();
                pinchGestureRef.current = null;
            }
        };

        viewport.addEventListener("wheel", handleWheel, { passive: false });
        viewport.addEventListener("touchstart", startPinch, { passive: false });
        viewport.addEventListener("touchmove", movePinch, { passive: false });
        viewport.addEventListener("touchend", endPinch);
        viewport.addEventListener("touchcancel", endPinch);
        viewport.addEventListener("gesturestart", startGesture, { passive: false });
        viewport.addEventListener("gesturechange", moveGesture, { passive: false });
        viewport.addEventListener("gestureend", endGesture, { passive: false });

        return () => {
            viewport.removeEventListener("wheel", handleWheel);
            viewport.removeEventListener("touchstart", startPinch);
            viewport.removeEventListener("touchmove", movePinch);
            viewport.removeEventListener("touchend", endPinch);
            viewport.removeEventListener("touchcancel", endPinch);
            viewport.removeEventListener("gesturestart", startGesture);
            viewport.removeEventListener("gesturechange", moveGesture);
            viewport.removeEventListener("gestureend", endGesture);
        };
    }, [applyViewportTransform, commitViewportTransform, getStagePoint, handleWheel, isMobile, zoomBounds]);

    useEffect(() => {
        return () => {
            if (viewportRafRef.current !== null) {
                window.cancelAnimationFrame(viewportRafRef.current);
            }
            if (viewportAnimationFrameRef.current !== null) {
                window.cancelAnimationFrame(viewportAnimationFrameRef.current);
                viewportAnimationFrameRef.current = null;
            }
            if (dragAutoPanFrameRef.current !== null) {
                window.cancelAnimationFrame(dragAutoPanFrameRef.current);
                dragAutoPanFrameRef.current = null;
            }
        };
    }, []);

    const handleUpdateNodeStatus = useCallback(async (taskId: string, status: string) => {
        setOptimisticStatusByTaskId(prev => ({ ...prev, [taskId]: status }));

        try {
            await onUpdateStatus?.(taskId, status);
        } catch (error) {
            setOptimisticStatusByTaskId(prev => {
                const next = { ...prev };
                delete next[taskId];
                return next;
            });
            console.error("[CustomMindMap] Failed to update node status:", error);
        }
    }, [onUpdateStatus]);

    const cancelDragAutoPan = useCallback(() => {
        if (dragAutoPanFrameRef.current === null) return;
        window.cancelAnimationFrame(dragAutoPanFrameRef.current);
        dragAutoPanFrameRef.current = null;
    }, []);

    const getDragAutoPanVelocity = useCallback((clientX: number, clientY: number): Point => {
        const rect = viewportRef.current?.getBoundingClientRect();
        if (!isMobile || !rect || rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
        const visualViewport = window.visualViewport;
        const visualLeft = visualViewport?.offsetLeft ?? 0;
        const visualTop = visualViewport?.offsetTop ?? 0;
        const visualRight = visualLeft + (visualViewport?.width ?? window.innerWidth);
        const visualBottom = visualTop + (visualViewport?.height ?? window.innerHeight);
        const visibleRect = {
            left: Math.max(rect.left, visualLeft),
            right: Math.min(rect.right, visualRight),
            top: Math.max(rect.top, visualTop),
            bottom: Math.min(rect.bottom, visualBottom),
        };
        const visibleWidth = visibleRect.right - visibleRect.left;
        const visibleHeight = visibleRect.bottom - visibleRect.top;
        if (visibleWidth <= 0 || visibleHeight <= 0) return { x: 0, y: 0 };
        const edgeSize = Math.max(36, Math.min(MOBILE_DRAG_AUTOPAN_EDGE_PX, visibleWidth / 3, visibleHeight / 3));
        const speedForDistance = (distanceToEdge: number) => {
            const pressure = Math.min(1, Math.max(0, (edgeSize - distanceToEdge) / edgeSize));
            return MOBILE_DRAG_AUTOPAN_MAX_PX_PER_FRAME * pressure * pressure;
        };

        let x = 0;
        let y = 0;
        const distanceLeft = clientX - visibleRect.left;
        const distanceRight = visibleRect.right - clientX;
        const distanceTop = clientY - visibleRect.top;
        const distanceBottom = visibleRect.bottom - clientY;

        if (distanceLeft < edgeSize) x = speedForDistance(distanceLeft);
        else if (distanceRight < edgeSize) x = -speedForDistance(distanceRight);
        if (distanceTop < edgeSize) y = speedForDistance(distanceTop);
        else if (distanceBottom < edgeSize) y = -speedForDistance(distanceBottom);

        return { x, y };
    }, [isMobile]);

    const startDragAutoPan = useCallback(() => {
        if (dragAutoPanFrameRef.current !== null) return;

        const step = () => {
            const current = dragStateRef.current;
            if (!current?.dragging) {
                dragAutoPanFrameRef.current = null;
                return;
            }

            const velocity = getDragAutoPanVelocity(current.lastClientX, current.lastClientY);
            if (Math.abs(velocity.x) >= 0.1 || Math.abs(velocity.y) >= 0.1) {
                applyViewportTransform(zoomRef.current, {
                    x: panOffsetRef.current.x + velocity.x,
                    y: panOffsetRef.current.y + velocity.y,
                }, { deferCommit: true });

                const next = getDragStateForClientPoint(current, current.lastClientX, current.lastClientY, { forceDragging: true });
                if (next) {
                    dragStateRef.current = next;
                    setDragState(next);
                    publishNodeCalendarDrag("move", next, next.lastClientX, next.lastClientY);
                }
            }

            dragAutoPanFrameRef.current = window.requestAnimationFrame(step);
        };

        dragAutoPanFrameRef.current = window.requestAnimationFrame(step);
    }, [applyViewportTransform, getDragAutoPanVelocity, getDragStateForClientPoint, publishNodeCalendarDrag]);

    useEffect(() => {
        if (!isMobile || !dragState?.dragging) {
            cancelDragAutoPan();
            return;
        }
        startDragAutoPan();
        return cancelDragAutoPan;
    }, [cancelDragAutoPan, dragState?.dragging, isMobile, startDragAutoPan]);

    useEffect(() => {
        if (!dragState) return;

        const handlePointerMove = (event: PointerEvent) => {
            if (event.cancelable) event.preventDefault();
            clearMindMapTextSelection();
            const prev = dragStateRef.current;
            if (!prev) return;
            const next = getDragStateForClientPoint(prev, event.clientX, event.clientY);
            if (!next) return;
            dragStateRef.current = next;
            setDragState(next);
            if (next.dragging) {
                publishNodeCalendarDrag("move", next, event.clientX, event.clientY);
            }
        };

        const handlePointerUp = (event: PointerEvent) => {
            const prev = dragStateRef.current;
            if (prev) clearMindMapTextSelection();
            if (prev?.dragging) {
                suppressPaneClickUntilRef.current = Date.now() + 200;
                const dropElement = typeof document.elementFromPoint === "function"
                    ? document.elementFromPoint(event.clientX, event.clientY)
                    : null;
                const isCalendarDrop = !!dropElement?.closest?.('[data-focusmap-mindmap-node-calendar-target="true"]');
                publishNodeCalendarDrag(isCalendarDrop ? "end" : "cancel", prev, event.clientX, event.clientY);
                if (!isCalendarDrop) {
                    const fallbackDuplicateTarget: CustomDropTarget = {
                        nodeId: prev.primaryNodeId,
                        position: "below",
                    };
                    const target = prev.target ?? (event.altKey ? fallbackDuplicateTarget : null);
                    if (event.altKey && target && onDuplicateTasks) {
                        void onDuplicateTasks({
                            taskIds: prev.nodeIds,
                            targetId: target.nodeId,
                            position: target.position,
                        });
                    } else if (target && prev.nodeIds.length > 1 && onMoveTasks) {
                        void onMoveTasks({
                            taskIds: prev.nodeIds,
                            targetId: target.nodeId,
                            position: target.position,
                        });
                    } else if (target) {
                        void onMoveTask?.({
                            taskId: prev.primaryNodeId,
                            targetId: target.nodeId,
                            position: target.position,
                        });
                    }
                }
            }
            dragStateRef.current = null;
            setDragState(null);
            commitViewportTransform();
        };

        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerUp);
        window.addEventListener("pointercancel", handlePointerUp);
        return () => {
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", handlePointerUp);
            window.removeEventListener("pointercancel", handlePointerUp);
        };
    }, [commitViewportTransform, dragState, getDragStateForClientPoint, onDuplicateTasks, onMoveTask, onMoveTasks, publishNodeCalendarDrag]);

    const shouldLockTextSelection = !!dragState || !!selectionBox || !!panState;

    useEffect(() => {
        if (!shouldLockTextSelection || typeof document === "undefined") return;
        document.body.classList.add("mindmap-selection-lock");
        return () => {
            document.body.classList.remove("mindmap-selection-lock");
        };
    }, [shouldLockTextSelection]);

    useEffect(() => {
        if (!selectionBox) return;

        const handlePointerMove = (event: PointerEvent) => {
            const point = getStagePoint(event.clientX, event.clientY);
            if (!point) return;
            setSelectionBox(prev => prev ? { ...prev, currentX: point.x, currentY: point.y } : prev);
        };

        const handlePointerUp = () => {
            setSelectionBox(prev => {
                if (!prev) return null;
                const left = Math.min(prev.startX, prev.currentX);
                const right = Math.max(prev.startX, prev.currentX);
                const top = Math.min(prev.startY, prev.currentY);
                const bottom = Math.max(prev.startY, prev.currentY);
                const distance = Math.hypot(prev.currentX - prev.startX, prev.currentY - prev.startY);

                if (distance >= DRAG_START_THRESHOLD) {
                    suppressPaneClickUntilRef.current = Date.now() + 200;
                    const hitIds = positionedNodes
                        .filter(node => {
                            if (node.kind !== "task") return false;
                            const nodeLeft = node.x;
                            const nodeRight = node.x + node.width;
                            const nodeTop = node.y;
                            const nodeBottom = node.y + node.height;
                            return nodeLeft <= right && nodeRight >= left && nodeTop <= bottom && nodeBottom >= top;
                        })
                        .map(node => node.id);
                    const next = prev.additive ? new Set(selectedNodeIds) : new Set<string>();
                    for (const nodeId of hitIds) next.add(nodeId);
                    const primaryNodeId = hitIds[0] ?? (next.has(selectedNodeId ?? "") ? selectedNodeId : null);
                    onSelectNodes(Array.from(next), next.size > 0 ? primaryNodeId : null);
                }

                return null;
            });
        };

        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerUp);
        window.addEventListener("pointercancel", handlePointerUp);
        return () => {
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", handlePointerUp);
            window.removeEventListener("pointercancel", handlePointerUp);
        };
    }, [getStagePoint, onSelectNodes, positionedNodes, selectedNodeId, selectedNodeIds, selectionBox]);

    useEffect(() => {
        if (!panState) return;

        const handlePointerMove = (event: PointerEvent) => {
            if (pinchGestureRef.current) return;
            const deltaX = event.clientX - panState.startClientX;
            const deltaY = event.clientY - panState.startClientY;
            const nextPan = {
                x: panState.startPanX + deltaX,
                y: panState.startPanY + deltaY,
            };
            applyViewportTransform(zoomRef.current, nextPan, { deferCommit: true });
            panMovedRef.current = panMovedRef.current || Math.hypot(deltaX, deltaY) >= DRAG_START_THRESHOLD;
        };

        const handlePointerUp = () => {
            if (panMovedRef.current) {
                suppressPaneClickUntilRef.current = Date.now() + 200;
            }
            commitViewportTransform();
            panMovedRef.current = false;
            setPanState(null);
        };

        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerUp);
        window.addEventListener("pointercancel", handlePointerUp);
        return () => {
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", handlePointerUp);
            window.removeEventListener("pointercancel", handlePointerUp);
        };
    }, [applyViewportTransform, commitViewportTransform, panState]);

    const handleEditingChange = useCallback((taskId: string, editing: boolean) => {
        setActiveEditingNodeId(prev => {
            if (editing) return taskId;
            return prev === taskId ? null : prev;
        });
    }, []);

    const handleRegisterEditController = useCallback((taskId: string, controller: CustomTaskEditController | null) => {
        if (controller) {
            editControllersRef.current.set(taskId, controller);
            return;
        }
        editControllersRef.current.delete(taskId);
    }, []);

    const prepareMobileTextFocus = useCallback(() => {
        if (!isMobile) return;
        const anchor = keyboardAnchorRef.current;
        if (!anchor) return;
        anchor.value = "";
        setMobileKeyboardAccessoryPinned(true);
        anchor.focus({ preventScroll: true });
    }, [isMobile]);

    const preserveMobileKeyboardFocus = useCallback(() => {
        if (!isMobile) return;
        ignoreNextFloatingBlurRef.current = true;
        setMobileKeyboardAccessoryPinned(true);
        const input = floatingTextareaRef.current;
        if (input) {
            input.focus({ preventScroll: true });
        } else {
            prepareMobileTextFocus();
        }
        requestAnimationFrame(() => {
            ignoreNextFloatingBlurRef.current = false;
        });
    }, [isMobile, prepareMobileTextFocus]);

    const handoffActiveEdit = useCallback(async (taskId: string, options: { focusVisibleEditor?: boolean; waitForSave?: boolean } = {}) => {
        if (floatingEditNodeId === taskId) {
            if (options.focusVisibleEditor !== false) {
                focusFloatingTextarea(false);
            }
            await commitFloatingEdit({ close: false, waitForSave: options.waitForSave });
            return;
        }
        await editControllersRef.current.get(taskId)?.handoffEditing(prepareMobileTextFocus);
    }, [commitFloatingEdit, floatingEditNodeId, focusFloatingTextarea, prepareMobileTextFocus]);

    const runKeyboardAction = useCallback(async (action: () => Promise<void>) => {
        if (keyboardActionInFlightRef.current) return;
        keyboardActionInFlightRef.current = true;
        try {
            await action();
        } finally {
            requestAnimationFrame(() => {
                keyboardActionInFlightRef.current = false;
            });
        }
    }, []);

    const applyVoiceTextToFloatingEditor = useCallback((text: string) => {
        const transcript = text.trim();
        if (!transcript) return;

        const input = floatingTextareaRef.current;
        const currentValue = input?.value ?? floatingEditValueRef.current;
        const selectionStart = input?.selectionStart ?? currentValue.length;
        const selectionEnd = input?.selectionEnd ?? currentValue.length;
        const isReplacingAll = selectionStart === 0 && selectionEnd === currentValue.length;
        const isEmpty = currentValue.trim().length === 0;
        const before = currentValue.slice(0, selectionStart);
        const after = currentValue.slice(selectionEnd);
        const beforeSeparator = before.length > 0 && !/\s$/.test(before) ? "\n" : "";
        const afterSeparator = after.length > 0 && !/^\s/.test(after) ? "\n" : "";
        const nextValue = isEmpty || isReplacingAll
            ? transcript
            : `${before}${beforeSeparator}${transcript}${afterSeparator}${after}`;
        const cursorPosition = isEmpty || isReplacingAll
            ? transcript.length
            : before.length + beforeSeparator.length + transcript.length;

        if (input) input.value = nextValue;
        updateFloatingEditValue(nextValue);

        const restoreCursor = () => {
            const nextInput = floatingTextareaRef.current;
            if (!nextInput) return;
            nextInput.focus({ preventScroll: true });
            nextInput.setSelectionRange(cursorPosition, cursorPosition);
            syncFloatingTextareaHeight(nextInput);
        };
        restoreCursor();
        requestAnimationFrame(restoreCursor);
    }, [syncFloatingTextareaHeight, updateFloatingEditValue]);

    const handleAccessoryVoiceText = useCallback((text: string) => {
        void runKeyboardAction(async () => {
            const node = activeAccessoryNode;
            if (!node) return;

            await finishFloatingComposition();
            ignoreNextFloatingBlurRef.current = true;
            setMobileKeyboardAccessoryPinned(true);

            const applyText = () => {
                applyVoiceTextToFloatingEditor(text);
                requestAnimationFrame(() => {
                    ignoreNextFloatingBlurRef.current = false;
                });
            };

            if (floatingEditNodeId !== node.id) {
                const value = node.kind === "project"
                    ? node.title
                    : rawTaskTitleById.get(node.id) ?? node.title;
                startFloatingEdit(node.id, value, { selectAll: false });
                requestAnimationFrame(applyText);
                return;
            }

            preserveMobileKeyboardFocus();
            applyText();
        });
    }, [
        activeAccessoryNode,
        applyVoiceTextToFloatingEditor,
        finishFloatingComposition,
        floatingEditNodeId,
        preserveMobileKeyboardFocus,
        rawTaskTitleById,
        runKeyboardAction,
        startFloatingEdit,
    ]);

    const handleCreateRootNode = useCallback(async (options: { preserveTextFocus?: boolean } = {}) => {
        if (!options.preserveTextFocus) prepareMobileTextFocus();
        await onAddRootNode?.();
    }, [onAddRootNode, prepareMobileTextFocus]);

    const handleCreateChildNode = useCallback(async (taskId: string, options: { preserveTextFocus?: boolean } = {}) => {
        if (!options.preserveTextFocus) prepareMobileTextFocus();
        await onAddChildNode?.(taskId);
    }, [onAddChildNode, prepareMobileTextFocus]);

    const handleCreateSiblingNode = useCallback(async (taskId: string, options: { preserveTextFocus?: boolean } = {}) => {
        if (!options.preserveTextFocus) prepareMobileTextFocus();
        await onAddSiblingNode?.(taskId);
    }, [onAddSiblingNode, prepareMobileTextFocus]);

    const handleFloatingEditKeyDown = useCallback(async (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        event.stopPropagation();

        if (event.key === "Enter" && !event.nativeEvent.isComposing && !event.shiftKey) {
            event.preventDefault();
            await commitFloatingEdit({ close: true });
            return;
        }

        if (event.key === "Tab") {
            const node = floatingEditNode;
            if (!node) return;
            event.preventDefault();
            await finishFloatingComposition();
            await commitFloatingEdit({ close: false });
            if (node.kind === "project") {
                if (!event.shiftKey) await handleCreateRootNode({ preserveTextFocus: true });
            } else if (event.shiftKey) {
                await onPromoteNode?.(node.id);
            } else {
                await handleCreateChildNode(node.id, { preserveTextFocus: true });
            }
        }

        if (event.key === "Escape") {
            event.preventDefault();
            clearFloatingTaskPreview();
            setFloatingEditNodeId(null);
            setActiveEditingNodeId(null);
            setMobileKeyboardAccessoryPinned(false);
        }
    }, [clearFloatingTaskPreview, commitFloatingEdit, finishFloatingComposition, floatingEditNode, handleCreateChildNode, handleCreateRootNode, onPromoteNode]);

    const handleAccessoryAddChild = useCallback(async () => {
        await runKeyboardAction(async () => {
            const node = activeAccessoryNode;
            if (!node) return;
            await finishFloatingComposition();
            preserveMobileKeyboardFocus();
            await handoffActiveEdit(node.id, { focusVisibleEditor: false, waitForSave: false });
            if (node.kind === "project") {
                await handleCreateRootNode({ preserveTextFocus: true });
                return;
            }
            await handleCreateChildNode(node.id, { preserveTextFocus: true });
        });
    }, [activeAccessoryNode, finishFloatingComposition, handoffActiveEdit, handleCreateChildNode, handleCreateRootNode, preserveMobileKeyboardFocus, runKeyboardAction]);

    const handleAccessoryAddSibling = useCallback(async () => {
        await runKeyboardAction(async () => {
            const node = activeAccessoryNode;
            if (!node || node.kind !== "task") return;
            await finishFloatingComposition();
            preserveMobileKeyboardFocus();
            await handoffActiveEdit(node.id, { focusVisibleEditor: false, waitForSave: false });
            await handleCreateSiblingNode(node.id, { preserveTextFocus: true });
        });
    }, [activeAccessoryNode, finishFloatingComposition, handoffActiveEdit, handleCreateSiblingNode, preserveMobileKeyboardFocus, runKeyboardAction]);

    const handleAccessoryDelete = useCallback(async () => {
        await runKeyboardAction(async () => {
            const node = activeAccessoryNode;
            if (!node || node.kind !== "task") return;
            const siblingNodes = positionedNodes
                .filter(candidate => candidate.kind === "task" && candidate.parentId === node.parentId)
                .sort((a, b) => a.y - b.y || a.x - b.x);
            const siblingIndex = siblingNodes.findIndex(candidate => candidate.id === node.id);
            const fallbackNodeId = siblingNodes[siblingIndex + 1]?.id
                ?? siblingNodes[siblingIndex - 1]?.id
                ?? node.parentId
                ?? "project-root";
            const fallbackNode = nodeById.get(fallbackNodeId);
            ignoreNextFloatingBlurRef.current = true;
            try {
                await finishFloatingComposition();
                if (fallbackNode) {
                    const fallbackValue = fallbackNode.kind === "project"
                        ? fallbackNode.title
                        : rawTaskTitleById.get(fallbackNode.id) ?? fallbackNode.title;
                    startFloatingEdit(fallbackNode.id, fallbackValue, { selectAll: false });
                } else {
                    prepareMobileTextFocus();
                }
                void Promise.resolve(onDeleteNode?.(node.id)).catch(error => {
                    console.error("[CustomMindMap] Failed to delete node:", error);
                });
            } finally {
                requestAnimationFrame(() => {
                    ignoreNextFloatingBlurRef.current = false;
                });
            }
        });
    }, [activeAccessoryNode, finishFloatingComposition, nodeById, onDeleteNode, positionedNodes, prepareMobileTextFocus, rawTaskTitleById, runKeyboardAction, startFloatingEdit]);

    const handleAccessoryDismiss = useCallback(() => {
        if (typeof document !== "undefined" && document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
        }
        clearFloatingTaskPreview();
        setActiveEditingNodeId(null);
        setFloatingEditNodeId(null);
        setMobileKeyboardAccessoryPinned(false);
    }, [clearFloatingTaskPreview]);

    const clearExternalImportDragOverMap = useCallback(() => {
        if (externalImportDragResetTimerRef.current !== null) {
            window.clearTimeout(externalImportDragResetTimerRef.current);
            externalImportDragResetTimerRef.current = null;
        }
        setExternalImportDragOverMap(false);
        externalImportDropTargetRef.current = null;
        setExternalImportDropTarget(null);
        setExternalImportResetKey(key => key + 1);
    }, []);

    const handleExternalImportDragOverCapture = useCallback((event: React.DragEvent<HTMLDivElement>) => {
        if (!hasCodexChatImportDragPayload(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        const target = getExternalImportDropTarget(event.clientX, event.clientY);
        setExternalImportDragOverMap(true);
        externalImportDropTargetRef.current = target;
        setExternalImportDropTarget(target);
        if (externalImportDragResetTimerRef.current !== null) {
            window.clearTimeout(externalImportDragResetTimerRef.current);
        }
        externalImportDragResetTimerRef.current = window.setTimeout(() => {
            externalImportDragResetTimerRef.current = null;
            setExternalImportDragOverMap(false);
            externalImportDropTargetRef.current = null;
            setExternalImportDropTarget(null);
        }, 160);
    }, [getExternalImportDropTarget]);

    const dropExternalImportAtPoint = useCallback((event: React.DragEvent<HTMLDivElement>) => {
        const payload = readCodexChatImportDragPayload(event.dataTransfer);
        if (!payload) return;
        const target = getExternalImportDropTarget(event.clientX, event.clientY) ?? externalImportDropTargetRef.current ?? externalImportDropTarget;
        void Promise.resolve(onDropImportedChatNode?.({
            taskId: payload.taskId,
            targetId: target?.nodeId ?? "project-root",
            position: target?.position ?? "as-child",
        })).catch(error => {
            console.error("[CustomMindMap] Failed to drop imported Codex chat:", error);
        });
    }, [externalImportDropTarget, getExternalImportDropTarget, onDropImportedChatNode]);

    const handleExternalImportDragLeaveCapture = useCallback((event: React.DragEvent<HTMLDivElement>) => {
        if (!hasCodexChatImportDragPayload(event.dataTransfer)) return;
        const nextTarget = event.relatedTarget;
        if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
        clearExternalImportDragOverMap();
    }, [clearExternalImportDragOverMap]);

    const handleExternalImportDropCapture = useCallback((event: React.DragEvent<HTMLDivElement>) => {
        if (!hasCodexChatImportDragPayload(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
        dropExternalImportAtPoint(event);
        clearExternalImportDragOverMap();
    }, [clearExternalImportDragOverMap, dropExternalImportAtPoint]);

    const handleExternalImportDropOnViewport = useCallback((event: React.DragEvent<HTMLDivElement>) => {
        if (!hasCodexChatImportDragPayload(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
        dropExternalImportAtPoint(event);
        clearExternalImportDragOverMap();
    }, [clearExternalImportDragOverMap, dropExternalImportAtPoint]);

    useEffect(() => () => {
        if (externalImportDragResetTimerRef.current !== null) {
            window.clearTimeout(externalImportDragResetTimerRef.current);
            externalImportDragResetTimerRef.current = null;
        }
    }, []);

    const selectionRect = selectionBox
        ? {
            left: Math.min(selectionBox.startX, selectionBox.currentX),
            top: Math.min(selectionBox.startY, selectionBox.currentY),
            width: Math.abs(selectionBox.currentX - selectionBox.startX),
            height: Math.abs(selectionBox.currentY - selectionBox.startY),
        }
        : null;
    const externalImportPreview = useMemo<ExternalImportDropPreview | null>(() => {
        if (!externalImportDragOverMap || externalImportDropTarget?.position !== "as-child") return null;
        const target = nodeById.get(externalImportDropTarget.nodeId);
        if (!target) return null;

        const previewWidth = Math.max(180, Math.min(260, (importedChatDragTitle?.trim().length ?? 0) * 8 + 96));
        const previewHeight = 44;
        const rawX = target.x + target.width + 52;
        const preview = {
            x: Math.min(Math.max(rawX, 24), Math.max(24, stageWidth - previewWidth - 24)),
            y: Math.min(
                Math.max(target.y + target.height / 2 - previewHeight / 2, 24),
                Math.max(24, stageHeight - previewHeight - 24),
            ),
            width: previewWidth,
            height: previewHeight,
        };
        const sourceX = target.x + target.width;
        const sourceY = target.y + target.height / 2;
        const targetX = preview.x;
        const targetY = preview.y + preview.height / 2;
        const branchX = Math.round(sourceX + Math.max(28, (targetX - sourceX) / 2));
        const path = `M ${Math.round(sourceX)} ${Math.round(sourceY)} C ${branchX} ${Math.round(sourceY)}, ${branchX} ${Math.round(targetY)}, ${Math.round(targetX)} ${Math.round(targetY)}`;

        return {
            preview,
            badge: {
                x: Math.max(16, Math.min(stageWidth - 96, branchX - 42)),
                y: Math.max(16, Math.min(stageHeight - 28, Math.min(sourceY, targetY) - 28)),
            },
            path,
        };
    }, [externalImportDragOverMap, externalImportDropTarget, importedChatDragTitle, nodeById, stageHeight, stageWidth]);
    const shouldShowMobileAccessory = isMobile && !!activeAccessoryNode && (isKeyboardOpen || mobileKeyboardAccessoryPinned);
    const shouldShowCodexSummary = codexSummary.running > 0 || codexSummary.awaitingApproval > 0 || codexSummary.connectionFailed > 0;
    const codexRunnerUnavailable = codexRunnerStatus.loading || !codexRunnerStatus.ready;
    const codexRunnerTitle = codexRunnerStatus.loading || !codexRunnerStatus.checked
        ? "Macの通信状態を確認中です"
        : codexRunnerStatus.ready
            ? "Mac online"
            : "Mac offline";
    const codexThreadImportTitle = codexThreadImportAvailable
        ? codexRunnerUnavailable
            ? `${codexRunnerTitle}: Focusmap Macを起動するとCodex thread取り込みを切り替えられます`
            : codexThreadImportEnabled
                ? `Codex thread取り込み: ON (${codexThreadImportRepoPath ?? "repo設定済み"})`
                : `Codex thread取り込み: OFF (${codexThreadImportRepoPath ?? "repo設定済み"})`
        : "プロジェクトにリポジトリを設定するとCodex threadを取り込めます";

    return (
        <div className="relative h-full w-full overflow-hidden bg-muted/5" style={{ overscrollBehavior: "contain" }}>
            {isMobile && (
                <input
                    ref={keyboardAnchorRef}
                    aria-label="新規ノード入力準備"
                    data-testid="mobile-keyboard-anchor"
                    tabIndex={-1}
                    autoCapitalize="none"
                    autoComplete="off"
                    inputMode="text"
                    spellCheck={false}
                    onChange={handleKeyboardAnchorChange}
                    onInput={handleKeyboardAnchorInput}
                    onCompositionEnd={handleKeyboardAnchorCompositionEnd}
                    onKeyDown={handleKeyboardAnchorKeyDown}
                    className="pointer-events-none fixed bottom-0 left-0 h-px w-px opacity-0"
                />
            )}
            {!isMobile && (onToggleCodexThreadImport || shouldShowCodexSummary) && (
                <div className="absolute left-12 top-3 z-30 flex max-w-[calc(100%-6rem)] items-center gap-2">
                    {onToggleCodexThreadImport && (
                        <button
                            type="button"
                            className={cn(
                                "relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border bg-card/90 text-muted-foreground shadow-sm backdrop-blur transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-55",
                                codexThreadImportEnabled && codexThreadImportAvailable && "border-sky-400/70 bg-sky-500/10 text-sky-700 dark:text-sky-300",
                            )}
                            onClick={(event) => {
                                event.stopPropagation();
                                void onToggleCodexThreadImport();
                            }}
                            disabled={!codexThreadImportAvailable || codexThreadImportPending || codexRunnerUnavailable}
                            aria-label={codexThreadImportEnabled ? "Codex thread取り込みをOFFにする" : "Codex thread取り込みをONにする"}
                            aria-pressed={codexThreadImportEnabled}
                            title={codexThreadImportTitle}
                        >
                            {codexThreadImportPending ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <Bot className="h-5 w-5" />
                            )}
                            <span
                                className={cn(
                                    "absolute bottom-2 right-2 h-2 w-2 rounded-full border border-background bg-muted-foreground/50",
                                    codexThreadImportEnabled && codexThreadImportAvailable && "bg-sky-500",
                                    !codexThreadImportAvailable && "bg-amber-500",
                                    codexThreadImportAvailable && codexRunnerUnavailable && "bg-amber-500",
                                )}
                            />
                        </button>
                    )}
                    {shouldShowCodexSummary && (
                        <div className="flex min-w-0 items-center gap-2 rounded-lg border bg-card/90 px-2.5 py-1.5 text-[11px] font-medium shadow-sm backdrop-blur">
                            {codexSummary.running > 0 && (
                                <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                    実行中{codexSummary.running}
                                </span>
                            )}
                            {codexSummary.awaitingApproval > 0 && (
                                <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
                                    確認待ち{codexSummary.awaitingApproval}
                                </span>
                            )}
                            {codexSummary.connectionFailed > 0 && (
                                <span className="inline-flex items-center gap-1 text-red-700 dark:text-red-300">
                                    接続失敗{codexSummary.connectionFailed}
                                </span>
                            )}
                        </div>
                    )}
                </div>
            )}
            <div
                ref={viewportRef}
                data-testid="custom-mind-map-viewport"
                className={cn(
                    "mindmap-touch-guard h-full w-full overflow-hidden bg-[radial-gradient(circle,rgba(255,255,255,0.16)_1px,transparent_1px)] [background-size:20px_20px]",
                    panState ? "cursor-grabbing select-none" : spacePressed ? "cursor-grab" : "cursor-default"
                )}
                style={{ touchAction: "none", overscrollBehavior: "contain" }}
                onDragOverCapture={handleExternalImportDragOverCapture}
                onDragLeaveCapture={handleExternalImportDragLeaveCapture}
                onDropCapture={handleExternalImportDropCapture}
                onDrop={handleExternalImportDropOnViewport}
                onPointerDown={handleViewportPointerDown}
                onContextMenu={(event) => event.preventDefault()}
                onClick={() => {
                    if (Date.now() < suppressPaneClickUntilRef.current) return;
                    dismissFloatingEdit();
                    onSelectNode(null);
                }}
            >
                <div
                    className="absolute left-0 top-0 z-20 origin-top-left"
                    ref={stageRef}
                    data-testid="custom-mind-map-stage"
                    style={{
                        width: stageWidth,
                        height: stageHeight,
                        transform: `translate3d(${panOffset.x}px, ${panOffset.y}px, 0) scale(${zoom})`,
                        transformOrigin: "top left",
                        willChange: "transform",
                        backfaceVisibility: "hidden",
                    }}
                >
                    <svg
                        className="pointer-events-none absolute inset-0 z-0 text-muted-foreground"
                        width={stageWidth}
                        height={stageHeight}
                        aria-hidden="true"
                    >
                        {model.edges.map(edge => {
                            const source = nodeById.get(edge.source);
                            const target = nodeById.get(edge.target);
                            if (!source || !target) return null;
                            return (
                                <CustomBranchPath
                                    key={edge.id}
                                    source={source}
                                    target={target}
                                    offsetX={0}
                                    offsetY={0}
                                    branchX={branchXByDepth.get(source.depth)}
                                />
                            );
                        })}
                    </svg>
                    {externalImportPreview && (
                        <svg
                            className="pointer-events-none absolute inset-0 z-[5] text-amber-300"
                            width={stageWidth}
                            height={stageHeight}
                            aria-hidden="true"
                            data-testid="codex-chat-import-drop-connector"
                        >
                            <path
                                d={externalImportPreview.path}
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeDasharray="6 5"
                                fill="none"
                                strokeLinecap="round"
                                strokeOpacity="0.9"
                            />
                        </svg>
                    )}

                    {positionedNodes.map(node => {
                        const isDraggingNode = !!dragState?.nodeStarts[node.id];
                        const positionedNode = isDraggingNode && dragState?.dragging
                            ? {
                                ...node,
                                x: dragState.nodeStarts[node.id].x + dragState.deltaX,
                                y: dragState.nodeStarts[node.id].y + dragState.deltaY,
                            }
                            : node;
                        const importDropActive = externalImportDropTarget?.nodeId === node.id;
                        const dropPosition = dragState?.target?.nodeId === node.id
                            ? dragState.target.position
                            : importDropActive
                                ? externalImportDropTarget.position
                                : null;
                        if (node.kind === "project") {
                            return (
                                <CustomProjectNode
                                    key={node.id}
                                    node={positionedNode}
                                    selected={selectedNodeId === node.id}
                                    primarySelected={selectedNodeId === node.id}
                                    dropPosition={dropPosition}
                                    importDropActive={importDropActive}
                                    triggerEdit={pendingEditNodeId === node.id}
                                    floatingEditing={floatingEditNodeId === node.id}
                                    isMobile={isMobile}
                                    onSelectNode={onSelectNode}
                                    onAddChild={handleCreateRootNode}
                                    onSaveTitle={onSaveProjectTitle}
                                    onEditingChange={handleEditingChange}
                                    onRegisterEditController={handleRegisterEditController}
                                    onRequestEdit={startFloatingEdit}
                                    onDropImportedChatNode={onDropImportedChatNode}
                                    externalImportResetKey={externalImportResetKey}
                                    mobilePlacementMode={mobilePlacementMode}
                                />
                            );
                        }
                        return (
                            <CustomTaskNode
                                key={node.id}
                                node={positionedNode}
                                selected={selectedNodeIds.has(node.id)}
                                primarySelected={selectedNodeId === node.id}
                                selectedCount={selectedNodeIds.size}
                                dragging={isDraggingNode && dragState?.dragging}
                                dragReady={isDraggingNode && !!dragState && !dragState.dragging}
                                dropPosition={dropPosition}
                                importDropActive={importDropActive}
                                triggerEdit={pendingEditNodeId === node.id}
                                initialEditValue={rawTaskTitleById.get(node.id)}
                                floatingEditing={floatingEditNodeId === node.id}
                                onSelectNode={handleSelectTaskNode}
                                onStartDrag={handleStartDrag}
                                onToggleCollapse={onToggleCollapse}
                                onAddChild={handleCreateChildNode}
                                onAddSibling={handleCreateSiblingNode}
                                onPromote={onPromoteNode}
                                onDelete={onDeleteNode}
                                onNavigate={onNavigateNode}
                                onSaveTitle={onSaveTitle}
                                onUpdateStatus={handleUpdateNodeStatus}
                                onResize={onResizeNode ? handleResizeNode : undefined}
                                onGenerateHeadingFromLongNode={onGenerateHeadingFromLongNode}
                                isGeneratingHeading={generatingHeadingNodeIds.has(node.id)}
                                resizeScale={zoom}
                                isMobile={isMobile}
                                onRunCodex={onRunCodex}
                                codexState={codexRunByNodeId[node.id] ?? null}
                                taskProgress={taskProgressByNodeId[node.id] ?? null}
                                onOpenTaskProgress={onOpenTaskProgress}
                                onEditingChange={handleEditingChange}
                                onRegisterEditController={handleRegisterEditController}
                                onRequestEdit={startFloatingEdit}
                                onPreviewTitleChange={handlePreviewTitleChange}
                                onDropImportedChatNode={onDropImportedChatNode}
                                externalImportResetKey={externalImportResetKey}
                                mobilePlacementMode={mobilePlacementMode}
                        />
                        );
                    })}
                    {externalImportPreview && (
                        <>
                            <div
                                className="pointer-events-none absolute z-30 flex items-center gap-1.5 rounded-full border border-amber-300/50 bg-[#111111]/95 px-2 py-1 text-[11px] font-semibold text-amber-200 shadow-lg"
                                style={{ left: externalImportPreview.badge.x, top: externalImportPreview.badge.y }}
                                data-testid="codex-chat-import-drop-badge"
                            >
                                <Bot className="h-3 w-3" />
                                ここに紐づく
                            </div>
                            <div
                                className="pointer-events-none absolute z-30 flex items-center gap-1.5 rounded-lg border border-dashed border-amber-300/80 bg-[#171513]/92 px-2.5 py-1.5 text-[12px] font-semibold text-amber-50 shadow-[0_0_24px_rgba(245,158,11,0.32)]"
                                style={{
                                    left: externalImportPreview.preview.x,
                                    top: externalImportPreview.preview.y,
                                    width: externalImportPreview.preview.width,
                                    height: externalImportPreview.preview.height,
                                }}
                                data-testid="codex-chat-import-ghost-node"
                            >
                                <GitBranch className="h-3.5 w-3.5 shrink-0 text-amber-300" />
                                <span className="min-w-0 truncate">{importedChatDragTitle?.trim() || "Codexチャット"}</span>
                            </div>
                        </>
                    )}
                    {selectionRect && (
                        <div
                            className="pointer-events-none absolute z-40 rounded border border-sky-400 bg-sky-400/15 shadow-[0_0_16px_rgba(56,189,248,0.35)]"
                            style={selectionRect}
                        />
                    )}
                </div>
                {externalImportDragOverMap && (
                    <>
                        <div
                            className="pointer-events-none absolute inset-3 z-10 rounded-xl border border-sky-400/45 bg-sky-400/[0.06] shadow-[inset_0_0_0_1px_rgba(56,189,248,0.18),0_0_36px_rgba(56,189,248,0.16)]"
                            data-testid="codex-chat-import-map-drop-overlay"
                        />
                        <div className="pointer-events-none absolute right-6 top-6 z-50 flex max-w-[min(360px,calc(100%-3rem))] items-center gap-2 rounded-lg border border-sky-300/30 bg-background/90 px-3 py-2 text-xs shadow-xl backdrop-blur dark:bg-[#111111]/92">
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-sky-400/15 text-sky-300">
                                <Bot className="h-4 w-4" />
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="block truncate font-semibold text-foreground">{importedChatDragTitle?.trim() || "Codexチャット"}</span>
                                <span className="block truncate text-[11px] text-muted-foreground">上/下端で隣、中央で子ノード、空白で新しい枝</span>
                            </span>
                        </div>
                    </>
                )}
                {isMobile && floatingEditNode && floatingEditViewportStyle && (
                    <div
                        className={cn(
                            "absolute z-50 flex items-center justify-center rounded-lg shadow-lg ring-2 ring-white ring-offset-2 ring-offset-background",
                            floatingEditKind === "project"
                                ? "bg-primary px-4 py-2 text-primary-foreground"
                                : "border border-border bg-background px-1.5 py-1"
                        )}
                        style={floatingEditViewportStyle}
                        data-testid="floating-mind-map-editor"
                    >
                        {floatingEditKind === "task" && (
                            <span className="shrink-0 h-5 w-5 -m-1" aria-hidden="true" />
                        )}
                        <textarea
                            ref={floatingTextareaRef}
                            rows={1}
                            aria-label={floatingEditKind === "project" ? "プロジェクト名" : "ノード名"}
                            value={floatingEditValue}
                            className={cn(
                                "min-w-0 flex-1 resize-none overflow-hidden bg-transparent py-0 text-base font-bold leading-5 outline-none select-text whitespace-pre-wrap break-words [overflow-wrap:anywhere]",
                                floatingEditKind === "project"
                                    ? "h-5 min-h-5 text-center text-primary-foreground placeholder:text-primary-foreground/60"
                                    : "h-5 min-h-5 px-0.5 text-foreground placeholder:text-muted-foreground"
                            )}
                            onChange={handleFloatingEditValueChange}
                            onBlur={handleFloatingEditBlur}
                            onClick={(event) => event.stopPropagation()}
                            onPointerDown={(event) => event.stopPropagation()}
                            onCompositionStart={handleFloatingEditCompositionStart}
                            onCompositionEnd={handleFloatingEditCompositionEnd}
                            onKeyDown={handleFloatingEditKeyDown}
                        />
                        {floatingEditKind === "task" && (
                            <span className="h-6 w-6 shrink-0" aria-hidden="true" />
                        )}
                    </div>
                )}
            </div>
            {shouldShowMobileAccessory && activeAccessoryNode && (
                <KeyboardAccessoryBar
                    keyboardHeight={keyboardHeight}
                    viewportBottom={viewportBottom}
                    showIndentControls={false}
                    addSiblingLabel="親追加"
                    addSiblingAriaLabel="親ノード追加"
                    onAddChild={(activeAccessoryNode.kind === "project" ? onAddRootNode : onAddChildNode) ? handleAccessoryAddChild : undefined}
                    onAddSibling={activeAccessoryNode.kind === "task" && onAddSiblingNode ? handleAccessoryAddSibling : undefined}
                    onDelete={activeAccessoryNode.kind === "task" && onDeleteNode ? handleAccessoryDelete : undefined}
                    onVoiceText={handleAccessoryVoiceText}
                    onDismiss={handleAccessoryDismiss}
                />
            )}
        </div>
    );
}
