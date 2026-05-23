"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, Maximize2, Minus, Plus, StickyNote } from "lucide-react";
import type { Project, Task } from "@/types/database";
import { cn } from "@/lib/utils";
import { buildMindMapModel, type MindMapModelNode } from "@/lib/mindmap-model";
import { formatEstimatedTime } from "@/components/ui/estimated-time-select";

type CustomMindMapViewProps = {
    project: Project;
    groups: Task[];
    tasks: Task[];
    collapsedTaskIds: Set<string>;
    selectedNodeId: string | null;
    selectedNodeIds: Set<string>;
    onSelectNode: (nodeId: string | null) => void;
    onSelectNodes: (nodeIds: string[], primaryNodeId: string | null) => void;
    onToggleCollapse: (taskId: string) => void;
    onUpdateStatus?: (taskId: string, status: string) => void | Promise<void>;
    onOpenLinkedMemos?: (taskId: string) => void;
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

const PADDING = 72;
const DRAG_START_THRESHOLD = 6;
const DROP_TARGET_MAX_DISTANCE = 190;

type CustomDropPosition = "above" | "below" | "as-child";

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
    moved: boolean;
};

type Point = {
    x: number;
    y: number;
};

const formatDateShort = (value: string | null) => {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return `${date.getMonth() + 1}/${date.getDate()}`;
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
    dragging,
    dropPosition,
    onSelectNode,
    onStartDrag,
    onToggleCollapse,
    onUpdateStatus,
    onOpenLinkedMemos,
}: {
    node: MindMapModelNode;
    selected: boolean;
    dragging?: boolean;
    dropPosition?: CustomDropPosition | null;
    onSelectNode: (nodeId: string, options?: { additive: boolean }) => void;
    onStartDrag: (node: MindMapModelNode, event: React.PointerEvent<HTMLDivElement>) => void;
    onToggleCollapse: (taskId: string) => void;
    onUpdateStatus?: (taskId: string, status: string) => void | Promise<void>;
    onOpenLinkedMemos?: (taskId: string) => void;
}) {
    const isMemoNode = node.source === "memo" || node.source === "wishlist" || node.hasMemo || node.hasMemoImages;
    const scheduledLabel = formatDateShort(node.scheduledAt);
    const hasMeta = node.estimatedDisplayMinutes > 0 || node.priority != null || !!scheduledLabel || node.hasMemo || node.hasMemoImages || isMemoNode;

    return (
        <div
            className={cn(
                "absolute rounded-lg border bg-background px-1.5 py-1 text-[13px] shadow-sm transition-colors",
                "flex flex-col gap-0 outline-none",
                selected && "ring-2 ring-white ring-offset-2 ring-offset-background",
                node.isHabit || node.parentIsHabit ? "border-blue-400" : "border-border",
                isMemoNode && !(node.isHabit || node.parentIsHabit) && "border-amber-400 bg-amber-50 dark:bg-amber-950/20",
                node.isDone && "border-muted-foreground/25 bg-muted/20 text-muted-foreground opacity-60 grayscale",
                selected && node.isDone && "ring-muted-foreground/40",
                dragging && "z-30 cursor-grabbing opacity-90 shadow-xl ring-2 ring-sky-400 ring-offset-2 ring-offset-background",
                !dragging && "cursor-grab active:cursor-grabbing",
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
            }}
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

                <div className={cn(
                    "min-w-0 flex-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere] px-0.5 font-bold leading-tight",
                    node.isDone && "line-through text-muted-foreground"
                )}>
                    {node.title}
                </div>

                {isMemoNode && (
                    <span className={cn(
                        "shrink-0 rounded-[4px] px-1 text-[9px] font-medium leading-4",
                        node.isDone
                            ? "bg-muted text-muted-foreground"
                            : "bg-amber-200 text-amber-900 dark:bg-amber-500/25 dark:text-amber-200"
                    )}>
                        メモ
                    </span>
                )}

                <div className="flex shrink-0 flex-col items-center leading-none">
                    {node.hasChildren && (
                        <button
                            type="button"
                            className={cn(
                                "flex h-2.5 items-center gap-px rounded-sm px-0.5 text-[9px] font-semibold transition-colors",
                                node.collapsed
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
                            {node.collapsed ? <ChevronRight className="h-2 w-2" strokeWidth={3} /> : <ChevronDown className="h-2 w-2" strokeWidth={3} />}
                        </button>
                    )}
                    <button
                        type="button"
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/40 transition-all hover:bg-muted/30 hover:text-muted-foreground"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                            event.stopPropagation();
                            onOpenLinkedMemos?.(node.id);
                        }}
                        title="関連メモ"
                        aria-label="関連メモを開く"
                    >
                        <svg className="h-3 w-3" viewBox="0 0 12 12" fill="currentColor">
                            <rect x="1" y="2" width="10" height="1.2" rx="0.6" />
                            <rect x="1" y="5.4" width="10" height="1.2" rx="0.6" />
                            <rect x="1" y="8.8" width="10" height="1.2" rx="0.6" />
                        </svg>
                    </button>
                </div>
            </div>

            {hasMeta && (
                <div className="flex flex-wrap items-center gap-1 pl-4 text-[10px] text-muted-foreground">
                    {node.estimatedDisplayMinutes > 0 && (
                        <span className="rounded bg-muted px-1 leading-4">{formatEstimatedTime(node.estimatedDisplayMinutes)}</span>
                    )}
                    {node.priority != null && (
                        <span className="rounded bg-muted px-1 leading-4">P{node.priority}</span>
                    )}
                    {scheduledLabel && (
                        <span className="rounded bg-muted px-1 leading-4">{scheduledLabel}</span>
                    )}
                    {node.hasMemo && <StickyNote className="h-3 w-3" />}
                </div>
            )}
        </div>
    );
}

function CustomProjectNode({
    node,
    selected,
    dropPosition,
    onSelectNode,
}: {
    node: MindMapModelNode;
    selected: boolean;
    dropPosition?: CustomDropPosition | null;
    onSelectNode: (nodeId: string) => void;
}) {
    return (
        <button
            type="button"
            className={cn(
                "absolute flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-center text-sm font-bold text-primary-foreground shadow-sm",
                selected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
                dropPosition === "as-child" && "ring-2 ring-sky-400 ring-offset-2 ring-offset-background shadow-[0_0_18px_rgba(56,189,248,0.65)]"
            )}
            style={{ left: node.x, top: node.y, width: node.width, minHeight: node.height }}
            onClick={(event) => {
                event.stopPropagation();
                onSelectNode(node.id);
            }}
        >
            <span className="truncate">{node.title}</span>
        </button>
    );
}

export function CustomMindMapView({
    project,
    groups,
    tasks,
    collapsedTaskIds,
    selectedNodeId,
    selectedNodeIds,
    onSelectNode,
    onSelectNodes,
    onToggleCollapse,
    onUpdateStatus,
    onOpenLinkedMemos,
    onMoveTask,
    onMoveTasks,
}: CustomMindMapViewProps) {
    const [zoom, setZoom] = useState(0.9);
    const [panOffset, setPanOffset] = useState<Point>({ x: 0, y: 0 });
    const [dragState, setDragState] = useState<DragState | null>(null);
    const [selectionBox, setSelectionBox] = useState<SelectionBoxState | null>(null);
    const [panState, setPanState] = useState<PanState | null>(null);
    const [spacePressed, setSpacePressed] = useState(false);
    const viewportRef = useRef<HTMLDivElement>(null);
    const stageRef = useRef<HTMLDivElement>(null);
    const zoomRef = useRef(zoom);
    const panOffsetRef = useRef(panOffset);
    const suppressPaneClickUntilRef = useRef(0);
    const model = useMemo(
        () => buildMindMapModel({ project, groups, tasks, collapsedTaskIds }),
        [project, groups, tasks, collapsedTaskIds]
    );

    const offsetX = PADDING - model.bounds.minX;
    const offsetY = PADDING - model.bounds.minY;
    const stageWidth = Math.max(960, model.bounds.width + PADDING * 2);
    const stageHeight = Math.max(640, model.bounds.height + PADDING * 2);
    const positionedNodes = useMemo(
        () => model.nodes.map(node => ({ ...node, x: node.x + offsetX, y: node.y + offsetY })),
        [model.nodes, offsetX, offsetY]
    );
    const nodeById = useMemo(() => new Map(positionedNodes.map(node => [node.id, node])), [positionedNodes]);
    const selectedTaskIds = useMemo(
        () => positionedNodes
            .filter(node => node.kind === "task" && selectedNodeIds.has(node.id))
            .map(node => node.id),
        [positionedNodes, selectedNodeIds]
    );

    useEffect(() => {
        zoomRef.current = zoom;
    }, [zoom]);

    useEffect(() => {
        panOffsetRef.current = panOffset;
    }, [panOffset]);

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

    const setZoomAtViewportPoint = useCallback((nextZoomRaw: number, origin: Point | null = null) => {
        const nextZoom = Math.min(1.4, Math.max(0.55, Number(nextZoomRaw.toFixed(2))));
        const currentZoom = zoomRef.current;
        if (nextZoom === currentZoom) return;
        const rect = viewportRef.current?.getBoundingClientRect();
        const originPoint = origin ?? {
            x: rect ? rect.width / 2 : 0,
            y: rect ? rect.height / 2 : 0,
        };
        const currentPan = panOffsetRef.current;
        const stageX = (originPoint.x - currentPan.x) / currentZoom;
        const stageY = (originPoint.y - currentPan.y) / currentZoom;
        const nextPan = {
            x: originPoint.x - stageX * nextZoom,
            y: originPoint.y - stageY * nextZoom,
        };
        zoomRef.current = nextZoom;
        panOffsetRef.current = nextPan;
        setZoom(nextZoom);
        setPanOffset(nextPan);
    }, []);

    const fitView = useCallback(() => {
        const rect = viewportRef.current?.getBoundingClientRect();
        if (!rect) return;
        const padding = 80;
        const fittedZoom = Math.min(
            1.1,
            Math.max(
                0.55,
                Math.min(
                    (rect.width - padding) / Math.max(stageWidth, 1),
                    (rect.height - padding) / Math.max(stageHeight, 1)
                )
            )
        );
        const nextZoom = Number(fittedZoom.toFixed(2));
        const nextPan = {
            x: (rect.width - stageWidth * nextZoom) / 2,
            y: (rect.height - stageHeight * nextZoom) / 2,
        };
        zoomRef.current = nextZoom;
        panOffsetRef.current = nextPan;
        setZoom(nextZoom);
        setPanOffset(nextPan);
    }, [stageHeight, stageWidth]);

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

    const handleStartDrag = useCallback((node: MindMapModelNode, event: React.PointerEvent<HTMLDivElement>) => {
        if (node.kind !== "task" || event.button !== 0) return;
        if (event.shiftKey || event.metaKey || event.ctrlKey) {
            event.stopPropagation();
            return;
        }
        const point = getStagePoint(event.clientX, event.clientY);
        if (!point) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);

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

    const handlePanePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        if (spacePressed) return;
        const target = event.target;
        if (target instanceof HTMLElement && target.closest("button,input,textarea,select,a")) return;
        const point = getStagePoint(event.clientX, event.clientY);
        if (!point) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        setSelectionBox({
            startX: point.x,
            startY: point.y,
            currentX: point.x,
            currentY: point.y,
            additive: event.shiftKey || event.metaKey || event.ctrlKey,
        });
    }, [getStagePoint, spacePressed]);

    const handlePanPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        const isPanButton = event.button === 1 || event.button === 2 || (event.button === 0 && spacePressed);
        if (!isPanButton) return;
        const target = event.target;
        if (target instanceof HTMLElement && target.closest("input,textarea,select,a")) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        setSelectionBox(null);
        setDragState(null);
        setPanState({
            startClientX: event.clientX,
            startClientY: event.clientY,
            startPanX: panOffsetRef.current.x,
            startPanY: panOffsetRef.current.y,
            moved: false,
        });
    }, [spacePressed]);

    const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
        if (!event.ctrlKey && !event.metaKey) return;
        event.preventDefault();
        const rect = viewportRef.current?.getBoundingClientRect();
        if (!rect) return;
        const delta = event.deltaY > 0 ? -0.08 : 0.08;
        setZoomAtViewportPoint(zoomRef.current + delta, {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
        });
    }, [setZoomAtViewportPoint]);

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
            const deltaX = event.clientX - panState.startClientX;
            const deltaY = event.clientY - panState.startClientY;
            const nextPan = {
                x: panState.startPanX + deltaX,
                y: panState.startPanY + deltaY,
            };
            panOffsetRef.current = nextPan;
            setPanOffset(nextPan);
            const moved = panState.moved || Math.hypot(deltaX, deltaY) >= DRAG_START_THRESHOLD;
            if (moved !== panState.moved) {
                setPanState(prev => prev ? { ...prev, moved } : prev);
            }
        };

        const handlePointerUp = () => {
            if (panState.moved) {
                suppressPaneClickUntilRef.current = Date.now() + 200;
            }
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
    }, [panState]);

    const selectionRect = selectionBox
        ? {
            left: Math.min(selectionBox.startX, selectionBox.currentX),
            top: Math.min(selectionBox.startY, selectionBox.currentY),
            width: Math.abs(selectionBox.currentX - selectionBox.startX),
            height: Math.abs(selectionBox.currentY - selectionBox.startY),
        }
        : null;

    return (
        <div className="relative h-full w-full overflow-hidden bg-muted/5">
            <div className="absolute right-3 top-14 z-20 flex items-center gap-1 rounded-lg border bg-card/90 p-1 shadow-sm backdrop-blur">
                <button
                    type="button"
                    className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={() => setZoomAtViewportPoint(zoom - 0.1)}
                    title="縮小"
                >
                    <Minus className="h-3.5 w-3.5" />
                </button>
                <div className="min-w-10 text-center text-[11px] text-muted-foreground">{Math.round(zoom * 100)}%</div>
                <button
                    type="button"
                    className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={() => setZoomAtViewportPoint(zoom + 0.1)}
                    title="拡大"
                >
                    <Plus className="h-3.5 w-3.5" />
                </button>
                <button
                    type="button"
                    className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={fitView}
                    title="全体を表示"
                >
                    <Maximize2 className="h-3.5 w-3.5" />
                </button>
            </div>

            <div
                ref={viewportRef}
                className={cn(
                    "h-full w-full overflow-hidden bg-[radial-gradient(circle,rgba(255,255,255,0.16)_1px,transparent_1px)] [background-size:20px_20px]",
                    panState ? "cursor-grabbing select-none" : spacePressed ? "cursor-grab" : "cursor-default"
                )}
                onPointerDown={handlePanPointerDown}
                onContextMenu={(event) => event.preventDefault()}
                onWheel={handleWheel}
                onClick={() => {
                    if (Date.now() < suppressPaneClickUntilRef.current) return;
                    onSelectNode(null);
                }}
            >
                <div
                    className="absolute left-0 top-0 origin-top-left"
                    ref={stageRef}
                    onPointerDown={handlePanePointerDown}
                    style={{
                        width: stageWidth,
                        height: stageHeight,
                        transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom})`,
                        transformOrigin: "top left",
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
                                    dropPosition={dropPosition}
                                    onSelectNode={onSelectNode}
                                />
                            );
                        }
                        return (
                            <CustomTaskNode
                                key={node.id}
                                node={positionedNode}
                                selected={selectedNodeIds.has(node.id)}
                                dragging={isDraggingNode && dragState?.dragging}
                                dropPosition={dropPosition}
                                onSelectNode={handleSelectTaskNode}
                                onStartDrag={handleStartDrag}
                                onToggleCollapse={onToggleCollapse}
                                onUpdateStatus={onUpdateStatus}
                                onOpenLinkedMemos={onOpenLinkedMemos}
                            />
                        );
                    })}
                    {selectionRect && (
                        <div
                            className="pointer-events-none absolute z-40 rounded border border-sky-400 bg-sky-400/15 shadow-[0_0_16px_rgba(56,189,248,0.35)]"
                            style={selectionRect}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}
