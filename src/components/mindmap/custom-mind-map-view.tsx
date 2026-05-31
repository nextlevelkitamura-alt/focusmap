"use client";

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Calendar as CalendarIcon, Check, ChevronDown, ChevronRight, Loader2, MoreVertical, RotateCcw, StickyNote } from "lucide-react";
import type { Project, Task } from "@/types/database";
import { cn } from "@/lib/utils";
import { buildMindMapModel, type MindMapModelNode } from "@/lib/mindmap-model";
import { useKeyboardHeight } from "@/hooks/useKeyboardHeight";
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
import { formatEstimatedTime } from "@/components/ui/estimated-time-select";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import type { CodexRunState } from "@/lib/codex-run-state";
import { useCalendars } from "@/hooks/useCalendars";

type CustomMindMapViewProps = {
    project: Project;
    groups: Task[];
    tasks: Task[];
    isMobile?: boolean;
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
    onRunCodex?: (taskId: string) => void | Promise<void>;
    onRefreshCodex?: () => void | Promise<void>;
    isRefreshingCodex?: boolean;
    codexRunByNodeId?: Record<string, CodexNodeState>;
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
};

type CodexNodeState = {
    state: CodexRunState;
    taskId: string;
    label: string;
    lastActivityAt?: string | null;
};

const PADDING = 72;
const DRAG_START_THRESHOLD = 6;
const TOUCH_DRAG_LONG_PRESS_DELAY_MS = 500;
const DROP_TARGET_MAX_DISTANCE = 190;
const WHEEL_PAN_SENSITIVITY = 1;
const WHEEL_ZOOM_SENSITIVITY = 0.0035;
const TOUCH_PINCH_SENSITIVITY = 1;
const DESKTOP_GESTURE_SENSITIVITY = 1.35;
const DONE_NODE_HIDE_DELAY_MS = 300;
const DONE_UNDO_WINDOW_MS = 5000;
const MOBILE_KEYBOARD_NODE_MARGIN = 12;
const MOBILE_KEYBOARD_ACCESSORY_CLEARANCE = 68;
const MOBILE_NODE_FOCUS_DURATION_MS = 120;
type CustomDropPosition = "above" | "below" | "as-child";
type CustomNavigationDirection = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

type CustomDropTarget = {
    nodeId: string;
    position: CustomDropPosition;
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

type PinchGestureState = {
    source: "touch" | "gesture";
    initialDistance: number;
    initialZoom: number;
    initialStagePoint: Point;
};

type PendingLongPressDragState = {
    timerId: number;
    node: MindMapModelNode;
    startClientX: number;
    startClientY: number;
};

type DoneHideTimerState = {
    timerId: number;
    showUndo: boolean;
};

type UndoableDoneNode = {
    taskId: string;
    title: string;
};

type CustomTaskEditController = {
    handoffEditing: (focusTextInput: () => void) => Promise<void>;
    finishEditing: (options?: { refocus?: boolean }) => Promise<void>;
};

type CustomEditRequestOptions = {
    selectAll?: boolean;
};

type WebKitGestureEvent = Event & {
    scale: number;
    clientX?: number;
    clientY?: number;
};

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

const trackDetachedSave = (saveAction: void | Promise<void> | undefined, label: string) => {
    if (!saveAction) return;
    void Promise.resolve(saveAction).catch(error => {
        console.error(label, error);
    });
};

const formatDateShort = (value: string | null) => {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
};

function CustomBranchPath({
    source,
    target,
    offsetX,
    offsetY,
}: {
    source: MindMapModelNode;
    target: MindMapModelNode;
    offsetX: number;
    offsetY: number;
}) {
    const sourceX = Math.round(source.x + offsetX + source.width);
    const sourceY = Math.round(source.y + offsetY + source.height / 2);
    const targetX = Math.round(target.x + offsetX);
    const targetY = Math.round(target.y + offsetY + target.height / 2);
    const branchX = Math.min(sourceX + 16, Math.max(sourceX + 8, targetX - 14));
    const path = `M ${sourceX} ${sourceY} L ${branchX} ${sourceY} L ${branchX} ${targetY} L ${targetX} ${targetY}`;

    return <path d={path} stroke="currentColor" strokeWidth="1.5" fill="none" strokeOpacity="0.62" />;
}

function CustomTaskNode({
    node,
    selected,
    primarySelected,
    selectedCount,
    dragging,
    dragReady,
    dropPosition,
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
    onUpdateScheduledAt,
    onUpdateSchedule,
    onResize,
    resizeScale,
    isMobile,
    calendars,
    onRunCodex,
    codexState,
    onEditingChange,
    onRegisterEditController,
    onRequestEdit,
}: {
    node: MindMapModelNode;
    selected: boolean;
    primarySelected: boolean;
    selectedCount: number;
    dragging?: boolean;
    dragReady?: boolean;
    dropPosition?: CustomDropPosition | null;
    triggerEdit?: boolean;
    initialEditValue?: string;
    floatingEditing?: boolean;
    onSelectNode: (nodeId: string, options?: { additive: boolean }) => void;
    onStartDrag: (node: MindMapModelNode, event: React.PointerEvent<HTMLDivElement>) => void;
    onToggleCollapse: (taskId: string) => void;
    onAddChild?: (taskId: string) => void | Promise<void>;
    onAddSibling?: (taskId: string) => void | Promise<void>;
    onPromote?: (taskId: string) => void | Promise<void>;
    onDelete?: (taskId: string) => void | Promise<void>;
    onNavigate?: (taskId: string, direction: CustomNavigationDirection) => void;
    onSaveTitle?: (taskId: string, title: string) => void | Promise<void>;
    onUpdateStatus?: (taskId: string, status: string) => void | Promise<void>;
    onUpdateScheduledAt?: (taskId: string, scheduledAt: string | null) => void | Promise<void>;
    onUpdateSchedule?: (taskId: string, params: { scheduledAt: string; estimatedMinutes: number; calendarId: string }) => void | Promise<void>;
    onResize?: (taskId: string, width: number, commit: boolean) => void;
    resizeScale: number;
    isMobile: boolean;
    calendars: Array<{ google_calendar_id: string; name: string; selected?: boolean; is_primary?: boolean; color?: string | null; background_color?: string | null }>;
    onRunCodex?: (taskId: string) => void | Promise<void>;
    codexState?: CodexNodeState | null;
    onEditingChange?: (taskId: string, isEditing: boolean) => void;
    onRegisterEditController?: (taskId: string, controller: CustomTaskEditController | null) => void;
    onRequestEdit?: (nodeId: string, initialValue?: string, options?: CustomEditRequestOptions) => boolean;
}) {
    const wrapperRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const isFinishingEditRef = useRef(false);
    const handledTriggerEditRef = useRef<string | null>(null);
    const lastCommittedTitleRef = useRef(initialEditValue ?? node.title);
    const selectAllOnFocusRef = useRef(true);
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(initialEditValue ?? node.title);
    const [menuOpen, setMenuOpen] = useState(false);
    const isMemoNode = node.source === "memo" || node.source === "wishlist" || node.hasMemo || node.hasMemoImages;
    const isCodexWaitingForExecution = codexState?.state === "awaiting_approval" && codexState.label === "実行待ち";
    const scheduledLabel = formatDateShort(node.scheduledAt);

    useEffect(() => {
        if (!isEditing) setEditValue(initialEditValue ?? node.title);
    }, [initialEditValue, isEditing, node.title]);

    useEffect(() => {
        lastCommittedTitleRef.current = initialEditValue ?? node.title;
    }, [initialEditValue, node.title]);

    useEffect(() => {
        if (!menuOpen) return;
        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target;
            if (target instanceof Node && wrapperRef.current?.contains(target)) return;
            setMenuOpen(false);
        };
        window.addEventListener("pointerdown", handlePointerDown);
        return () => window.removeEventListener("pointerdown", handlePointerDown);
    }, [menuOpen]);

    useEffect(() => {
        if (selected) return;
        setMenuOpen(false);
    }, [selected]);

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
        setIsEditing(false);
        requestAnimationFrame(() => wrapperRef.current?.focus());
        setTimeout(() => {
            isFinishingEditRef.current = false;
        }, 0);
    }, [initialEditValue, node.title]);

    const beginEditing = useCallback((value?: string) => {
        const shouldSelectAll = value == null;
        if (isMobile && onRequestEdit?.(node.id, value ?? (initialEditValue ?? node.title), { selectAll: shouldSelectAll })) return;
        selectAllOnFocusRef.current = shouldSelectAll;
        setEditValue(value ?? (initialEditValue ?? node.title));
        setIsEditing(true);
    }, [initialEditValue, isMobile, node.id, node.title, onRequestEdit]);

    const handleMenuAction = useCallback((
        event: React.MouseEvent<HTMLButtonElement>,
        action?: () => void | Promise<void>,
    ) => {
        event.preventDefault();
        event.stopPropagation();
        setMenuOpen(false);
        if (!action) return;
        void Promise.resolve(action()).catch(error => {
            console.error("[CustomMindMap] Node menu action failed:", error);
        });
    }, []);

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

    const handleScheduleConfirm = useCallback((params: { date: Date; estimatedMinutes: number; calendarId: string }) => {
        const scheduledAt = params.date.toISOString();
        const action = onUpdateSchedule
            ? onUpdateSchedule(node.id, {
                scheduledAt,
                estimatedMinutes: params.estimatedMinutes,
                calendarId: params.calendarId,
            })
            : onUpdateScheduledAt?.(node.id, scheduledAt);
        void Promise.resolve(action).catch(error => {
            console.error("[CustomMindMap] Failed to update schedule:", error);
        });
        setMenuOpen(false);
    }, [node.id, onUpdateSchedule, onUpdateScheduledAt]);

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

    return (
        <div
            ref={wrapperRef}
            data-id={node.id}
            tabIndex={0}
            className={cn(
                "absolute rounded-lg border bg-background px-1.5 py-1 text-[13px] shadow-sm transition-colors",
                "group flex flex-col gap-0 outline-none",
                floatingEditing && "opacity-0",
                selected && "ring-2 ring-white ring-offset-2 ring-offset-background",
                node.isHabit || node.parentIsHabit ? "border-blue-400" : "border-border",
                isMemoNode && !(node.isHabit || node.parentIsHabit) && "border-amber-400 bg-amber-50 dark:bg-amber-950/20",
                node.isDone && "border-muted-foreground/25 bg-muted/20 text-muted-foreground opacity-60 grayscale",
                codexState?.state === "running" && "border-emerald-400/70 shadow-[0_0_18px_rgba(16,185,129,0.25)]",
                selected && node.isDone && "ring-muted-foreground/40",
                dragReady && !dragging && "z-30 border-sky-400 bg-sky-500/20 shadow-xl ring-2 ring-sky-400 ring-offset-2 ring-offset-background",
                dragging && "z-30 cursor-grabbing opacity-90 shadow-xl ring-2 ring-sky-400 ring-offset-2 ring-offset-background",
                !dragging && "cursor-grab",
                dropPosition === "as-child" && !dragging && "ring-2 ring-sky-400 ring-offset-2 ring-offset-background border-sky-400 bg-sky-500/15 shadow-[0_0_18px_rgba(56,189,248,0.65)]"
            )}
            style={{ left: node.x, top: node.y, width: node.width, minHeight: node.height }}
            onPointerDown={(event) => {
                const target = event.target;
                if (target instanceof HTMLElement && target.closest("button,input,textarea,select,a")) return;
                onStartDrag(node, event);
            }}
            onClick={(event) => {
                event.stopPropagation();
                onSelectNode(node.id, { additive: event.shiftKey || event.metaKey || event.ctrlKey });
                if (isMobile && !isEditing) beginEditing();
            }}
            onDoubleClick={(event) => {
                event.stopPropagation();
                beginEditing();
            }}
            onKeyDown={handleNodeKeyDown}
        >
            {dropPosition === "above" && !dragging && (
                <div className="absolute -top-1.5 left-0 right-0 h-1 rounded-full bg-sky-400 shadow-[0_0_10px_rgba(56,189,248,0.9)]" />
            )}
            {dropPosition === "below" && !dragging && (
                <div className="absolute -bottom-1.5 left-0 right-0 h-1 rounded-full bg-sky-400 shadow-[0_0_10px_rgba(56,189,248,0.9)]" />
            )}
            {isMemoNode && (
                <div className={cn("absolute -left-0.5 top-1 bottom-1 w-1 rounded-full", node.isDone ? "bg-muted-foreground/35" : "bg-amber-400")} />
            )}
            {codexState?.state === "running" && (
                <div
                    className="codex-node-running-orbit"
                    title="Codex 実行中"
                    aria-label="Codex 実行中"
                />
            )}
            {codexState?.state === "awaiting_approval" && (
                <div
                    className={cn(
                        "absolute -right-2 -top-2 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold leading-none shadow-sm",
                        isCodexWaitingForExecution
                            ? "border-sky-400/80 bg-sky-100 text-sky-900 dark:bg-sky-500/20 dark:text-sky-200"
                            : "border-amber-400/70 bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200"
                    )}
                    title={`Codex ${codexState.label}`}
                >
                    {codexState.label}
                </div>
            )}
            <div className="flex items-center gap-1">
                <button
                    type="button"
                    role="checkbox"
                    aria-checked={node.isDone}
                    aria-label={node.isDone ? "完了を取消" : "完了にする"}
                    className="shrink-0 h-5 w-5 -m-1 flex items-center justify-center rounded active:bg-muted"
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
                            "min-w-0 flex-1 resize-none overflow-hidden bg-transparent px-0.5 font-bold leading-tight outline-none",
                            "whitespace-pre",
                            node.isDone && "line-through text-muted-foreground"
                        )}
                        wrap="off"
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
                    <div className={cn(
                        "min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-pre px-0.5 font-bold leading-tight",
                        node.isDone && "line-through text-muted-foreground",
                        floatingEditing && "opacity-0"
                    )}>
                        {node.title}
                    </div>
                )}

                {node.codexStatus && (
                    <button
                        type="button"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                            event.stopPropagation();
                            onRunCodex?.(node.id);
                        }}
                        className={cn(
                            "shrink-0 rounded-full transition-transform active:scale-90",
                            node.codexStatus === "running" && "h-2.5 w-2.5 bg-amber-400 animate-pulse",
                            node.codexStatus === "done" && "h-2.5 w-2.5 bg-emerald-500",
                            node.codexStatus === "failed" && "h-2.5 w-2.5 bg-rose-500",
                        )}
                        title={
                            node.codexStatus === "running" ? "Codex 作業中（タップで開く）" :
                            node.codexStatus === "done" ? "Codex 完了（タップで開く）" :
                            node.codexStatus === "failed" ? "Codex 失敗（タップで開く）" : ""
                        }
                        aria-label={`Codex状態: ${node.codexStatus}`}
                    />
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
                    {isMobile ? (
                        <div className="relative">
                            <button
                                type="button"
                                className={cn(
                                    "flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground/60 transition-colors",
                                    menuOpen ? "bg-muted/50 text-foreground" : "active:bg-muted/60 active:text-foreground"
                                )}
                                onPointerDown={(event) => event.stopPropagation()}
                                onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    onSelectNode(node.id, { additive: false });
                                    setMenuOpen(prev => !prev);
                                }}
                                title="ノードメニュー"
                                aria-label="ノードメニューを開く"
                                aria-expanded={menuOpen}
                            >
                                <MoreVertical className="h-3.5 w-3.5" />
                            </button>
                            {menuOpen && (
                                <div
                                    className="absolute right-0 top-7 z-50 w-64 overflow-hidden rounded-lg border bg-popover text-[13px] text-popover-foreground shadow-xl"
                                    onPointerDown={(event) => event.stopPropagation()}
                                    onClick={(event) => event.stopPropagation()}
                                >
                                    <div className="border-b px-3 py-2">
                                        <div className="truncate text-xs font-semibold">{node.title}</div>
                                        <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                                            {codexState && (
                                                <span className="rounded bg-muted px-1.5 py-0.5">
                                                    Codex {codexState.label}
                                                </span>
                                            )}
                                            {scheduledLabel && <span>{scheduledLabel}</span>}
                                            {node.estimatedDisplayMinutes > 0 && <span>{formatEstimatedTime(node.estimatedDisplayMinutes)}</span>}
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        className="flex min-h-11 w-full items-center gap-2 bg-primary/10 px-3 text-left font-medium text-primary hover:bg-primary/15"
                                        onClick={(event) => handleMenuAction(event, () => onRunCodex?.(node.id))}
                                    >
                                        <StickyNote className="h-4 w-4" />
                                        メモの編集
                                    </button>
                                    <DateTimePicker
                                        date={node.scheduledAt ? new Date(node.scheduledAt) : undefined}
                                        estimatedMinutes={node.estimatedTime && node.estimatedTime > 0 ? node.estimatedTime : node.estimatedDisplayMinutes}
                                        calendarId={node.calendarId}
                                        calendars={calendars}
                                        onConfirmSchedule={handleScheduleConfirm}
                                        trigger={
                                            <button
                                                type="button"
                                                className="flex min-h-11 w-full items-center gap-2 px-3 text-left hover:bg-muted"
                                            >
                                                <CalendarIcon className="h-4 w-4" />
                                                <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                                                    <span>日時を指定する</span>
                                                    {scheduledLabel && <span className="shrink-0 text-xs text-muted-foreground">{scheduledLabel}</span>}
                                                </span>
                                            </button>
                                        }
                                    />
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="relative">
                            <button
                                type="button"
                                className={cn(
                                    "flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/40 transition-all hover:bg-muted/30 hover:text-muted-foreground",
                                    menuOpen && "bg-muted/50 text-foreground"
                                )}
                                onPointerDown={(event) => event.stopPropagation()}
                                onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    onSelectNode(node.id, { additive: false });
                                    setMenuOpen(prev => !prev);
                                }}
                                title="ノードメニュー"
                                aria-label="ノードメニューを開く"
                                aria-expanded={menuOpen}
                            >
                                <MoreVertical className="h-3.5 w-3.5" />
                            </button>
                            {menuOpen && (
                                <div
                                    className="absolute right-0 top-6 z-50 w-64 overflow-hidden rounded-lg border bg-popover text-[13px] text-popover-foreground shadow-xl"
                                    onPointerDown={(event) => event.stopPropagation()}
                                    onClick={(event) => event.stopPropagation()}
                                >
                                    <div className="border-b px-3 py-2">
                                        <div className="truncate text-xs font-semibold">{node.title}</div>
                                        <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                                            {codexState && (
                                                <span className="rounded bg-muted px-1.5 py-0.5">
                                                    Codex {codexState.label}
                                                </span>
                                            )}
                                            {scheduledLabel && <span>{scheduledLabel}</span>}
                                            {node.estimatedDisplayMinutes > 0 && <span>{formatEstimatedTime(node.estimatedDisplayMinutes)}</span>}
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        className="flex min-h-11 w-full items-center gap-2 bg-primary/10 px-3 text-left font-medium text-primary hover:bg-primary/15"
                                        onClick={(event) => handleMenuAction(event, () => onRunCodex?.(node.id))}
                                    >
                                        <StickyNote className="h-4 w-4" />
                                        メモの編集
                                    </button>
                                    <DateTimePicker
                                        date={node.scheduledAt ? new Date(node.scheduledAt) : undefined}
                                        estimatedMinutes={node.estimatedTime && node.estimatedTime > 0 ? node.estimatedTime : node.estimatedDisplayMinutes}
                                        calendarId={node.calendarId}
                                        calendars={calendars}
                                        onConfirmSchedule={handleScheduleConfirm}
                                        trigger={
                                            <button
                                                type="button"
                                                className="flex min-h-11 w-full items-center gap-2 px-3 text-left hover:bg-muted"
                                            >
                                                <CalendarIcon className="h-4 w-4" />
                                                <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                                                    <span>日時を指定する</span>
                                                    {scheduledLabel && <span className="shrink-0 text-xs text-muted-foreground">{scheduledLabel}</span>}
                                                </span>
                                            </button>
                                        }
                                    />
                                </div>
                            )}
                        </div>
                    )}
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
    triggerEdit,
    floatingEditing,
    isMobile,
    onSelectNode,
    onAddChild,
    onSaveTitle,
    onEditingChange,
    onRegisterEditController,
    onRequestEdit,
}: {
    node: MindMapModelNode;
    selected: boolean;
    primarySelected: boolean;
    dropPosition?: CustomDropPosition | null;
    triggerEdit?: boolean;
    floatingEditing?: boolean;
    isMobile: boolean;
    onSelectNode: (nodeId: string) => void;
    onAddChild?: () => void | Promise<void>;
    onSaveTitle?: (title: string) => void | Promise<void>;
    onEditingChange?: (nodeId: string, isEditing: boolean) => void;
    onRegisterEditController?: (nodeId: string, controller: CustomTaskEditController | null) => void;
    onRequestEdit?: (nodeId: string, initialValue?: string, options?: CustomEditRequestOptions) => boolean;
}) {
    const wrapperRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const isFinishingEditRef = useRef(false);
    const handledTriggerEditRef = useRef<string | null>(null);
    const lastCommittedTitleRef = useRef(node.title);
    const selectAllOnFocusRef = useRef(true);
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(node.title);

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

    return (
        <div
            ref={wrapperRef}
            data-id={node.id}
            role={isEditing ? undefined : "button"}
            aria-label={isEditing ? undefined : node.title}
            tabIndex={0}
            className={cn(
                "absolute flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-center text-sm font-bold text-primary-foreground shadow-sm outline-none",
                floatingEditing && "opacity-0",
                selected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
                dropPosition === "as-child" && "ring-2 ring-sky-400 ring-offset-2 ring-offset-background shadow-[0_0_18px_rgba(56,189,248,0.65)]"
            )}
            style={{ left: node.x, top: node.y, width: node.width, minHeight: node.height }}
            onClick={(event) => {
                const target = event.target;
                if (target instanceof HTMLElement && target.closest("input,textarea,select,a")) return;
                event.stopPropagation();
                onSelectNode(node.id);
                if (isMobile) beginEditing();
            }}
            onDoubleClick={(event) => {
                event.stopPropagation();
                beginEditing();
            }}
            onKeyDown={handleKeyDown}
        >
            {dropPosition === "as-child" && (
                <div className="pointer-events-none absolute inset-0 rounded-lg bg-sky-400/10" />
            )}
            {isEditing ? (
                <textarea
                    ref={inputRef}
                    rows={1}
                    value={editValue}
                    aria-label="プロジェクト名"
                    className="min-w-0 flex-1 resize-none overflow-hidden bg-transparent text-center font-bold leading-tight text-primary-foreground outline-none placeholder:text-primary-foreground/60"
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
                <span className={cn("truncate", floatingEditing && "opacity-0")}>{node.title}</span>
            )}
        </div>
    );
}

export function CustomMindMapView({
    project,
    groups,
    tasks,
    isMobile = false,
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
    onUpdateScheduledAt,
    onUpdateSchedule,
    onResizeNode,
    onRunCodex,
    codexRunByNodeId = {},
    onMoveTask,
    onMoveTasks,
}: CustomMindMapViewProps) {
    const [zoom, setZoom] = useState(() => isMobile ? 0.85 : 0.9);
    const [panOffset, setPanOffset] = useState<Point>(() => isMobile ? { x: -20, y: 4 } : { x: 0, y: 0 });
    const [dragState, setDragState] = useState<DragState | null>(null);
    const [selectionBox, setSelectionBox] = useState<SelectionBoxState | null>(null);
    const [panState, setPanState] = useState<PanState | null>(null);
    const [spacePressed, setSpacePressed] = useState(false);
    const [nodeWidthOverrides, setNodeWidthOverrides] = useState<Record<string, number>>({});
    const [optimisticStatusByTaskId, setOptimisticStatusByTaskId] = useState<Record<string, string>>({});
    const [hiddenDoneTaskIds, setHiddenDoneTaskIds] = useState<Set<string>>(new Set());
    const [undoableDoneNodes, setUndoableDoneNodes] = useState<UndoableDoneNode[]>([]);
    const [activeEditingNodeId, setActiveEditingNodeId] = useState<string | null>(null);
    const [floatingEditNodeId, setFloatingEditNodeId] = useState<string | null>(null);
    const [floatingEditValue, setFloatingEditValue] = useState("");
    const [mobileKeyboardAccessoryPinned, setMobileKeyboardAccessoryPinned] = useState(false);
    const { keyboardHeight, isKeyboardOpen, viewportBottom } = useKeyboardHeight();
    const { calendars } = useCalendars();
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
    const pinchGestureRef = useRef<PinchGestureState | null>(null);
    const panMovedRef = useRef(false);
    const pendingResizeSavesRef = useRef(new Map<string, number>());
    const pendingLongPressDragRef = useRef<PendingLongPressDragState | null>(null);
    const doneHideTimersRef = useRef(new Map<string, DoneHideTimerState>());
    const undoToastTimersRef = useRef(new Map<string, number>());
    const suppressPaneClickUntilRef = useRef(0);
    const savedNodeWidthById = useMemo(() => {
        const byId = new Map<string, number | null>();
        for (const task of [...groups, ...tasks]) {
            byId.set(task.id, task.node_width ?? null);
        }
        return byId;
    }, [groups, tasks]);
    const allTaskStatusById = useMemo(() => {
        const byId = new Map<string, string>();
        for (const task of [...groups, ...tasks]) {
            byId.set(task.id, task.status ?? "todo");
        }
        return byId;
    }, [groups, tasks]);
    const allTaskTitleById = useMemo(() => {
        const byId = new Map<string, string>();
        for (const task of [...groups, ...tasks]) {
            byId.set(task.id, task.title ?? "Task");
        }
        return byId;
    }, [groups, tasks]);
    const activeHiddenDoneTaskIds = useMemo(() => {
        const next = new Set<string>();
        for (const taskId of hiddenDoneTaskIds) {
            const effectiveStatus = optimisticStatusByTaskId[taskId] ?? allTaskStatusById.get(taskId);
            if (effectiveStatus === "done") next.add(taskId);
        }
        return next;
    }, [allTaskStatusById, hiddenDoneTaskIds, optimisticStatusByTaskId]);
    const groupsForModel = useMemo(
        () => groups.map(task => {
            const width = nodeWidthOverrides[task.id];
            const status = optimisticStatusByTaskId[task.id];
            if (width == null && status == null) return task;
            return { ...task, node_width: width ?? task.node_width, status: status ?? task.status };
        }).filter(task => !activeHiddenDoneTaskIds.has(task.id)),
        [activeHiddenDoneTaskIds, groups, nodeWidthOverrides, optimisticStatusByTaskId]
    );
    const tasksForModel = useMemo(
        () => tasks.map(task => {
            const width = nodeWidthOverrides[task.id];
            const status = optimisticStatusByTaskId[task.id];
            if (width == null && status == null) return task;
            return { ...task, node_width: width ?? task.node_width, status: status ?? task.status };
        }).filter(task => !activeHiddenDoneTaskIds.has(task.id)),
        [activeHiddenDoneTaskIds, nodeWidthOverrides, optimisticStatusByTaskId, tasks]
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
    const rawTaskTitleById = useMemo(() => new Map([...groups, ...tasks].map(task => [task.id, task.title ?? ""])), [groups, tasks]);
    const floatingEditNode = floatingEditNodeId ? nodeById.get(floatingEditNodeId) ?? null : null;
    const floatingEditKind = floatingEditNode?.kind ?? null;
    const floatingEditStageStyle = floatingEditNode
        ? {
            left: floatingEditNode.x,
            top: floatingEditNode.y,
            width: floatingEditNode.width,
            minHeight: floatingEditNode.height,
        }
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
            waitingForExecution: states.filter(state => state.state === "awaiting_approval" && state.label === "実行待ち").length,
            awaitingApproval: states.filter(state => state.state === "awaiting_approval" && state.label !== "実行待ち").length,
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

    const handleSelectTaskNode = useCallback((nodeId: string, options?: { additive: boolean }) => {
        if (Date.now() < suppressPaneClickUntilRef.current) return;

        if (!options?.additive) {
            onSelectNode(nodeId);
            return;
        }

        const next = new Set(selectedNodeIds);
        if (next.has(nodeId)) {
            next.delete(nodeId);
        } else {
            next.add(nodeId);
        }
        const primaryNodeId = next.has(selectedNodeId ?? "") ? selectedNodeId : nodeId;
        onSelectNodes(Array.from(next), next.size > 0 ? primaryNodeId : null);
    }, [onSelectNode, onSelectNodes, selectedNodeId, selectedNodeIds]);

    const syncFloatingTextareaHeight = useCallback((input: HTMLTextAreaElement) => {
        input.style.height = "auto";
        input.style.height = `${input.scrollHeight}px`;
    }, []);

    const updateFloatingEditValue = useCallback((nextValue: string) => {
        floatingEditValueRef.current = nextValue;
        setFloatingEditValue(nextValue);
        const input = floatingTextareaRef.current;
        if (input) syncFloatingTextareaHeight(input);
    }, [syncFloatingTextareaHeight]);

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
    }, [floatingEditNodeId, focusFloatingTextarea, isMobile, nodeById, rawTaskTitleById]);

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
        } else if (nextTitle !== node.title) {
            saveAction = onSaveTitle?.(node.id, nextTitle);
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
    }, [floatingEditNodeId, nodeById, onSaveProjectTitle, onSaveTitle]);

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
            setFloatingEditNodeId(null);
            setActiveEditingNodeId(null);
            setMobileKeyboardAccessoryPinned(false);
        }
    }, [commitFloatingEdit, floatingEditNodeId]);

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

        const nodeLeft = currentPan.x + node.x * currentZoom;
        const nodeRight = nodeLeft + node.width * currentZoom;
        const nodeTop = currentPan.y + node.y * currentZoom;
        const nodeBottom = nodeTop + node.height * currentZoom;

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
    }, [animateViewportTransform, applyViewportTransform, isKeyboardOpen, mobileKeyboardAccessoryPinned, viewportBottom]);

    useEffect(() => {
        if (!isMobile || (!isKeyboardOpen && !mobileKeyboardAccessoryPinned)) return;
        const nodeId = floatingEditNodeId ?? selectedNodeId;
        if (!nodeId) return;
        const frameIds: number[] = [];
        const timeoutIds: number[] = [];
        const trackNode = () => {
            const node = nodeById.get(nodeId);
            if (node) keepNodeAboveKeyboard(node, { animate: pendingEditNodeId === nodeId });
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

    const clearPendingLongPressDrag = useCallback(() => {
        const pending = pendingLongPressDragRef.current;
        if (!pending) return;
        window.clearTimeout(pending.timerId);
        pendingLongPressDragRef.current = null;
    }, []);

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

        setDragState({
            primaryNodeId: node.id,
            nodeIds: Object.keys(nodeStarts),
            nodeStarts,
            startPointerX: point.x,
            startPointerY: point.y,
            primaryStartX: node.x,
            primaryStartY: node.y,
            deltaX: 0,
            deltaY: 0,
            dragging: false,
            target: null,
        });
    }, [getStagePoint, nodeById, onSelectNode, selectedNodeIds, selectedTaskIds]);

    const handleStartDrag = useCallback((node: MindMapModelNode, event: React.PointerEvent<HTMLDivElement>) => {
        if (node.kind !== "task" || event.button !== 0) return;
        if (event.shiftKey || event.metaKey || event.ctrlKey) {
            event.stopPropagation();
            return;
        }

        clearPendingLongPressDrag();

        if (isMobile && event.pointerType === "touch") {
            const startClientX = event.clientX;
            const startClientY = event.clientY;
            const timerId = window.setTimeout(() => {
                const pending = pendingLongPressDragRef.current;
                if (!pending || pending.node.id !== node.id) return;
                pendingLongPressDragRef.current = null;
                setPanState(null);
                setSelectionBox(null);
                beginDragFromClientPoint(node, startClientX, startClientY);
            }, TOUCH_DRAG_LONG_PRESS_DELAY_MS);

            pendingLongPressDragRef.current = {
                timerId,
                node,
                startClientX,
                startClientY,
            };
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        beginDragFromClientPoint(node, event.clientX, event.clientY);
    }, [beginDragFromClientPoint, clearPendingLongPressDrag, isMobile]);

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
            clearPendingLongPressDrag();
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
    }, [applyViewportTransform, clearPendingLongPressDrag, commitViewportTransform, getStagePoint, handleWheel, isMobile, zoomBounds]);

    useEffect(() => {
        return () => clearPendingLongPressDrag();
    }, [clearPendingLongPressDrag]);

    useEffect(() => {
        const doneHideTimers = doneHideTimersRef.current;
        const undoToastTimers = undoToastTimersRef.current;
        return () => {
            if (viewportRafRef.current !== null) {
                window.cancelAnimationFrame(viewportRafRef.current);
            }
            if (viewportAnimationFrameRef.current !== null) {
                window.cancelAnimationFrame(viewportAnimationFrameRef.current);
                viewportAnimationFrameRef.current = null;
            }
            for (const { timerId } of doneHideTimers.values()) {
                window.clearTimeout(timerId);
            }
            doneHideTimers.clear();
            for (const timerId of undoToastTimers.values()) {
                window.clearTimeout(timerId);
            }
            undoToastTimers.clear();
        };
    }, []);

    const clearDoneHideTimer = useCallback((taskId: string) => {
        const timer = doneHideTimersRef.current.get(taskId);
        if (!timer) return;
        window.clearTimeout(timer.timerId);
        doneHideTimersRef.current.delete(taskId);
    }, []);

    const clearUndoToastTimer = useCallback((taskId: string) => {
        const timerId = undoToastTimersRef.current.get(taskId);
        if (timerId == null) return;
        window.clearTimeout(timerId);
        undoToastTimersRef.current.delete(taskId);
    }, []);

    const dismissDoneUndo = useCallback((taskId: string) => {
        clearUndoToastTimer(taskId);
        setUndoableDoneNodes(prev => prev.filter(item => item.taskId !== taskId));
    }, [clearUndoToastTimer]);

    const showDoneUndo = useCallback((taskId: string) => {
        clearUndoToastTimer(taskId);
        const title = allTaskTitleById.get(taskId) ?? "Task";
        setUndoableDoneNodes(prev => [
            ...prev.filter(item => item.taskId !== taskId),
            { taskId, title },
        ]);
        const timerId = window.setTimeout(() => {
            undoToastTimersRef.current.delete(taskId);
            setUndoableDoneNodes(prev => prev.filter(item => item.taskId !== taskId));
        }, DONE_UNDO_WINDOW_MS);
        undoToastTimersRef.current.set(taskId, timerId);
    }, [allTaskTitleById, clearUndoToastTimer]);

    const scheduleDoneNodeHide = useCallback((taskId: string, options: { showUndo?: boolean } = {}) => {
        clearDoneHideTimer(taskId);
        const timerId = window.setTimeout(() => {
            doneHideTimersRef.current.delete(taskId);
            setHiddenDoneTaskIds(prev => {
                if (prev.has(taskId)) return prev;
                const next = new Set(prev);
                next.add(taskId);
                return next;
            });
            if (options.showUndo) {
                showDoneUndo(taskId);
            }
        }, DONE_NODE_HIDE_DELAY_MS);
        doneHideTimersRef.current.set(taskId, { timerId, showUndo: !!options.showUndo });
    }, [clearDoneHideTimer, showDoneUndo]);

    useEffect(() => {
        for (const [taskId, status] of allTaskStatusById) {
            if (status === "done" && !activeHiddenDoneTaskIds.has(taskId) && !doneHideTimersRef.current.has(taskId)) {
                scheduleDoneNodeHide(taskId);
            }
        }
    }, [activeHiddenDoneTaskIds, allTaskStatusById, scheduleDoneNodeHide]);

    useEffect(() => {
        if (activeHiddenDoneTaskIds.size === 0 || selectedNodeIds.size === 0) return;
        const visibleNodeIds = new Set(positionedNodes.map(node => node.id));
        const nextSelectedIds = Array.from(selectedNodeIds).filter(nodeId => visibleNodeIds.has(nodeId));
        if (nextSelectedIds.length === selectedNodeIds.size) return;
        const nextPrimaryId = selectedNodeId && nextSelectedIds.includes(selectedNodeId)
            ? selectedNodeId
            : nextSelectedIds[0] ?? null;
        onSelectNodes(nextSelectedIds, nextPrimaryId);
    }, [activeHiddenDoneTaskIds, onSelectNodes, positionedNodes, selectedNodeId, selectedNodeIds]);

    const handleUpdateNodeStatus = useCallback(async (taskId: string, status: string) => {
        clearDoneHideTimer(taskId);
        setOptimisticStatusByTaskId(prev => ({ ...prev, [taskId]: status }));

        if (status === "done") {
            dismissDoneUndo(taskId);
            scheduleDoneNodeHide(taskId, { showUndo: true });
        } else {
            dismissDoneUndo(taskId);
            setHiddenDoneTaskIds(prev => {
                if (!prev.has(taskId)) return prev;
                const next = new Set(prev);
                next.delete(taskId);
                return next;
            });
        }

        try {
            await onUpdateStatus?.(taskId, status);
        } catch (error) {
            clearDoneHideTimer(taskId);
            setOptimisticStatusByTaskId(prev => {
                const next = { ...prev };
                delete next[taskId];
                return next;
            });
            setHiddenDoneTaskIds(prev => {
                if (!prev.has(taskId)) return prev;
                const next = new Set(prev);
                next.delete(taskId);
                return next;
            });
            console.error("[CustomMindMap] Failed to update node status:", error);
        }
    }, [clearDoneHideTimer, dismissDoneUndo, onUpdateStatus, scheduleDoneNodeHide]);

    const handleUndoDone = useCallback(async (taskId: string) => {
        clearDoneHideTimer(taskId);
        dismissDoneUndo(taskId);
        setHiddenDoneTaskIds(prev => {
            if (!prev.has(taskId)) return prev;
            const next = new Set(prev);
            next.delete(taskId);
            return next;
        });
        setOptimisticStatusByTaskId(prev => ({ ...prev, [taskId]: "todo" }));

        try {
            await onUpdateStatus?.(taskId, "todo");
        } catch (error) {
            setOptimisticStatusByTaskId(prev => ({ ...prev, [taskId]: "done" }));
            scheduleDoneNodeHide(taskId);
            console.error("[CustomMindMap] Failed to undo node completion:", error);
        }
    }, [clearDoneHideTimer, dismissDoneUndo, onUpdateStatus, scheduleDoneNodeHide]);

    useEffect(() => {
        if (!dragState) return;

        const handlePointerMove = (event: PointerEvent) => {
            const point = getStagePoint(event.clientX, event.clientY);
            if (!point) return;
            setDragState(prev => {
                if (!prev) return prev;
                const deltaX = point.x - prev.startPointerX;
                const deltaY = point.y - prev.startPointerY;
                const x = prev.primaryStartX + deltaX;
                const y = prev.primaryStartY + deltaY;
                const distance = Math.hypot(deltaX, deltaY);
                const dragging = prev.dragging || distance >= DRAG_START_THRESHOLD;
                return {
                    ...prev,
                    deltaX,
                    deltaY,
                    dragging,
                    target: dragging ? getDropTarget(prev.nodeIds, prev.primaryNodeId, x, y) : null,
                };
            });
        };

        const handlePointerUp = () => {
            setDragState(prev => {
                if (prev?.dragging) {
                    suppressPaneClickUntilRef.current = Date.now() + 200;
                    if (prev.target) {
                        if (prev.nodeIds.length > 1 && onMoveTasks) {
                            void onMoveTasks({
                                taskIds: prev.nodeIds,
                                targetId: prev.target.nodeId,
                                position: prev.target.position,
                            });
                        } else {
                            void onMoveTask?.({
                                taskId: prev.primaryNodeId,
                                targetId: prev.target.nodeId,
                                position: prev.target.position,
                            });
                        }
                    }
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
    }, [dragState, getDropTarget, getStagePoint, onMoveTask, onMoveTasks]);

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
            const pendingDrag = pendingLongPressDragRef.current;
            if (pendingDrag && Math.hypot(event.clientX - pendingDrag.startClientX, event.clientY - pendingDrag.startClientY) >= DRAG_START_THRESHOLD) {
                clearPendingLongPressDrag();
            }
            const nextPan = {
                x: panState.startPanX + deltaX,
                y: panState.startPanY + deltaY,
            };
            applyViewportTransform(zoomRef.current, nextPan, { deferCommit: true });
            panMovedRef.current = panMovedRef.current || Math.hypot(deltaX, deltaY) >= DRAG_START_THRESHOLD;
        };

        const handlePointerUp = () => {
            clearPendingLongPressDrag();
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
    }, [applyViewportTransform, clearPendingLongPressDrag, commitViewportTransform, panState]);

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
            setFloatingEditNodeId(null);
            setActiveEditingNodeId(null);
            setMobileKeyboardAccessoryPinned(false);
        }
    }, [commitFloatingEdit, finishFloatingComposition, floatingEditNode, handleCreateChildNode, handleCreateRootNode, onPromoteNode]);

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
        setActiveEditingNodeId(null);
        setFloatingEditNodeId(null);
        setMobileKeyboardAccessoryPinned(false);
    }, []);

    const selectionRect = selectionBox
        ? {
            left: Math.min(selectionBox.startX, selectionBox.currentX),
            top: Math.min(selectionBox.startY, selectionBox.currentY),
            width: Math.abs(selectionBox.currentX - selectionBox.startX),
            height: Math.abs(selectionBox.currentY - selectionBox.startY),
        }
        : null;
    const shouldShowMobileAccessory = isMobile && !!activeAccessoryNode && (isKeyboardOpen || mobileKeyboardAccessoryPinned);

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
            {(codexSummary.running > 0 || codexSummary.waitingForExecution > 0 || codexSummary.awaitingApproval > 0) && (
                <div className="absolute left-12 top-3 z-30 flex items-center gap-2 rounded-lg border bg-card/90 px-2.5 py-1.5 text-[11px] font-medium shadow-sm backdrop-blur">
                    {codexSummary.running > 0 && (
                        <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            実行中{codexSummary.running}
                        </span>
                    )}
                    {codexSummary.waitingForExecution > 0 && (
                        <span className="inline-flex items-center gap-1 text-sky-700 dark:text-sky-300">
                            実行待ち{codexSummary.waitingForExecution}
                        </span>
                    )}
                    {codexSummary.awaitingApproval > 0 && (
                        <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
                            確認待ち{codexSummary.awaitingApproval}
                        </span>
                    )}
                </div>
            )}
            <div
                ref={viewportRef}
                data-testid="custom-mind-map-viewport"
                className={cn(
                    "h-full w-full overflow-hidden bg-[radial-gradient(circle,rgba(255,255,255,0.16)_1px,transparent_1px)] [background-size:20px_20px]",
                    panState ? "cursor-grabbing select-none" : spacePressed ? "cursor-grab" : "cursor-default"
                )}
                style={{ touchAction: "none", overscrollBehavior: "contain" }}
                onPointerDown={handleViewportPointerDown}
                onContextMenu={(event) => event.preventDefault()}
                onClick={() => {
                    if (Date.now() < suppressPaneClickUntilRef.current) return;
                    dismissFloatingEdit();
                    onSelectNode(null);
                }}
            >
                <div
                    className="absolute left-0 top-0 origin-top-left"
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
                        className="absolute inset-0 text-muted-foreground"
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
                                />
                            );
                        })}
                    </svg>

                    {positionedNodes.map(node => {
                        const isDraggingNode = !!dragState?.nodeStarts[node.id];
                        const positionedNode = isDraggingNode && dragState?.dragging
                            ? {
                                ...node,
                                x: dragState.nodeStarts[node.id].x + dragState.deltaX,
                                y: dragState.nodeStarts[node.id].y + dragState.deltaY,
                            }
                            : node;
                        const dropPosition = dragState?.target?.nodeId === node.id ? dragState.target.position : null;
                        if (node.kind === "project") {
                            return (
                                <CustomProjectNode
                                    key={node.id}
                                    node={positionedNode}
                                    selected={selectedNodeId === node.id}
                                    primarySelected={selectedNodeId === node.id}
                                    dropPosition={dropPosition}
                                    triggerEdit={pendingEditNodeId === node.id}
                                    floatingEditing={floatingEditNodeId === node.id}
                                    isMobile={isMobile}
                                    onSelectNode={onSelectNode}
                                    onAddChild={handleCreateRootNode}
                                    onSaveTitle={onSaveProjectTitle}
                                    onEditingChange={handleEditingChange}
                                    onRegisterEditController={handleRegisterEditController}
                                    onRequestEdit={startFloatingEdit}
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
                                onUpdateScheduledAt={onUpdateScheduledAt}
                                onUpdateSchedule={onUpdateSchedule}
                                onResize={onResizeNode ? handleResizeNode : undefined}
                                resizeScale={zoom}
                                isMobile={isMobile}
                                calendars={calendars}
                                onRunCodex={onRunCodex}
                                codexState={codexRunByNodeId[node.id] ?? null}
                                onEditingChange={handleEditingChange}
                                onRegisterEditController={handleRegisterEditController}
                                onRequestEdit={startFloatingEdit}
                            />
                        );
                    })}
                    {isMobile && floatingEditNode && floatingEditStageStyle && (
                        <div
                            className={cn(
                                "absolute z-50 flex items-center justify-center rounded-lg shadow-lg ring-2 ring-white ring-offset-2 ring-offset-background",
                                floatingEditKind === "project"
                                    ? "bg-primary px-4 py-2 text-primary-foreground"
                                    : "border border-border bg-background px-1.5 py-1"
                            )}
                            style={floatingEditStageStyle}
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
                                    "min-w-0 flex-1 resize-none overflow-hidden bg-transparent py-0 font-bold outline-none",
                                    floatingEditKind === "project"
                                        ? "h-5 min-h-5 text-center text-sm leading-5 text-primary-foreground placeholder:text-primary-foreground/60"
                                        : "h-[18px] min-h-[18px] px-0.5 text-[13px] leading-[18px] text-foreground placeholder:text-muted-foreground"
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
                    {selectionRect && (
                        <div
                            className="pointer-events-none absolute z-40 rounded border border-sky-400 bg-sky-400/15 shadow-[0_0_16px_rgba(56,189,248,0.35)]"
                            style={selectionRect}
                        />
                    )}
                </div>
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
                    onDismiss={handleAccessoryDismiss}
                />
            )}
            {undoableDoneNodes.length > 0 && (
                <div className="absolute bottom-4 left-4 z-50 flex max-w-[min(360px,calc(100%-2rem))] flex-col gap-2">
                    {undoableDoneNodes.map(item => (
                        <div
                            key={item.taskId}
                            role="dialog"
                            aria-label="完了の取り消し"
                            className="flex items-center gap-3 rounded-lg border bg-card/95 px-3 py-2 text-sm shadow-lg backdrop-blur"
                        >
                            <div className="min-w-0 flex-1">
                                <div className="truncate font-medium">{item.title}</div>
                                <div className="text-xs text-muted-foreground">完了にしました</div>
                            </div>
                            <button
                                type="button"
                                className="flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors hover:bg-muted"
                                onClick={() => void handleUndoDone(item.taskId)}
                            >
                                <RotateCcw className="h-3.5 w-3.5" />
                                戻す
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
