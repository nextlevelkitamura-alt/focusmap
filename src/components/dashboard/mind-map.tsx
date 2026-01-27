"use client"

import React, { useMemo, useState, useEffect, useLayoutEffect, useCallback, useRef, Component, ErrorInfo, ReactNode } from 'react';
import dynamic from 'next/dynamic';
import ReactFlow, {
    Node,
    Edge,
    Controls,
    Background,
    BackgroundVariant,
    Handle,
    Position,
    NodeProps,
    ReactFlowProvider,
    NodeMouseHandler,
    SelectionMode,
    useReactFlow,
} from 'reactflow';
import 'reactflow/dist/style.css';
import dagre from 'dagre';
import { Database } from "@/types/database";
import { cn } from "@/lib/utils";
import { Calendar as CalendarIcon, X, Target, Clock, Check, GripVertical, MoreHorizontal } from "lucide-react";
import { PriorityBadge, PriorityPopover, Priority, getPriorityIconColor } from "@/components/ui/priority-select";
import { EstimatedTimeBadge, EstimatedTimePopover, formatEstimatedTime } from "@/components/ui/estimated-time-select";
import { MindMapDisplaySettingsPopover, MindMapDisplaySettings, loadSettings } from "@/components/dashboard/mindmap-display-settings";
import { useDrag } from "@/contexts/DragContext";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

// DateTimePicker を dynamic import（SSR を完全に無効化）
const DateTimePicker = dynamic(
    () => import("@/components/ui/date-time-picker").then((mod) => ({ default: mod.DateTimePicker })),
    {
        ssr: false,
        loading: () => <div className="w-6 h-6 animate-spin border-2 border-zinc-600 border-t-transparent rounded-full" />,
    }
);

type TaskGroup = Database['public']['Tables']['task_groups']['Row']
type Project = Database['public']['Tables']['projects']['Row']
type Task = Database['public']['Tables']['tasks']['Row']

// --- Dagre Layout Function ---
const dagreGraph = new dagre.graphlib.Graph();
dagreGraph.setDefaultEdgeLabel(() => ({}));

const NODE_WIDTH = 225; // 1.5x of 150
const NODE_HEIGHT = 40;
const PROJECT_NODE_WIDTH = 300; // 1.5x of 200
const PROJECT_NODE_HEIGHT = 60;
const GROUP_NODE_WIDTH = 240; // 1.5x of 160
const GROUP_NODE_HEIGHT = 50;

function getLayoutedElements(nodes: Node[], edges: Edge[]): { nodes: Node[], edges: Edge[] } {
    // CRITICAL: Reset dagre graph to clear any stale node/edge data from previous layouts
    // This prevents "gap" issues when nodes are deleted and new ones are added
    dagreGraph.nodes().forEach(n => dagreGraph.removeNode(n));

    dagreGraph.setGraph({
        rankdir: 'LR',
        nodesep: 30,
        ranksep: 120,
        align: undefined // Ensures children center around parent (default behavior)
    });

    nodes.forEach((node) => {
        let width = NODE_WIDTH;
        let height = NODE_HEIGHT;

        if (node.type === 'projectNode') {
            width = PROJECT_NODE_WIDTH;
            height = PROJECT_NODE_HEIGHT;
        } else if (node.type === 'groupNode') {
            width = GROUP_NODE_WIDTH;
            height = GROUP_NODE_HEIGHT;
        }

        dagreGraph.setNode(node.id, { width, height });
    });

    edges.forEach((edge) => {
        dagreGraph.setEdge(edge.source, edge.target);
    });

    dagre.layout(dagreGraph);

    const layoutedNodes = nodes.map((node) => {
        const nodeWithPosition = dagreGraph.node(node.id);
        let width = NODE_WIDTH;
        let height = NODE_HEIGHT;

        if (node.type === 'projectNode') {
            width = PROJECT_NODE_WIDTH;
            height = PROJECT_NODE_HEIGHT;
        } else if (node.type === 'groupNode') {
            width = GROUP_NODE_WIDTH;
            height = GROUP_NODE_HEIGHT;
        }

        return {
            ...node,
            position: {
                x: nodeWithPosition.x - width / 2,
                y: nodeWithPosition.y - height / 2,
            },
        };
    });

    return { nodes: layoutedNodes, edges };
}

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

// --- Custom Nodes ---
const ProjectNode = React.memo(({ data, selected }: NodeProps) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(data?.label ?? '');
    const inputRef = useRef<HTMLInputElement>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);

    // Sync label when not editing
    useEffect(() => {
        if (!isEditing) {
            setEditValue(data?.label ?? '');
        }
    }, [data?.label, isEditing]);

    // IMPORTANT (IME): focus synchronously when node becomes selected.
    // Avoid rAF/select that can race with the first composition key and cause "hあ".
    useLayoutEffect(() => {
        if (selected && inputRef.current) {
            inputRef.current.focus();
        }
    }, [selected]);

    const saveValue = useCallback(async () => {
        const trimmed = editValue.trim();
        if (trimmed && trimmed !== data?.label && data?.onSave) {
            await data.onSave(trimmed);
        }
    }, [editValue, data]);

    const handleInputKeyDown = useCallback(async (e: React.KeyboardEvent<HTMLInputElement>) => {
        e.stopPropagation();
        if (!isEditing) {
            // Selection Mode behaviors for Project (root) node:
            // - Typing starts editing immediately (IME-compatible because input is already focused)
            // - Delete/Backspace triggers delete confirmation (same as before)
            if (e.key === 'Tab') {
                e.preventDefault();
                if (data?.onAddChild) {
                    await data.onAddChild();
                }
                return;
            }
            if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                if (typeof window === 'undefined') return;
                const confirmed = window.confirm(
                    `プロジェクト「${data?.label ?? 'このプロジェクト'}」を削除しますか？\n\nこの操作は取り消せません。`
                );
                if (confirmed && data?.onDelete) {
                    data.onDelete();
                }
                return;
            }
            if (e.key === 'F2' || e.key === ' ') {
                e.preventDefault();
                setIsEditing(true);
                return;
            }
            if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                // Do NOT preventDefault: allow the key/composition to flow into the already-focused input
                setIsEditing(true);
                if (inputRef.current) {
                    inputRef.current.setSelectionRange(0, inputRef.current.value.length);
            }
            return;
            }
        }

        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            await saveValue();
            setIsEditing(false);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            setEditValue(data?.label ?? '');
            setIsEditing(false);
        }
    }, [saveValue, data?.label, isEditing]);

    const handleWrapperKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
        if (isEditing) return;
        e.stopPropagation();

        if (e.key === 'Tab') {
            e.preventDefault();
            if (data?.onAddChild) {
                data.onAddChild();
            }
        } else if (e.key === ' ' || e.key === 'F2') {
            e.preventDefault();
            setIsEditing(true);
            setEditValue(data?.label ?? '');
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
            // ROOT NODE DELETE: Require confirmation
            e.preventDefault();
            if (typeof window === 'undefined') return;
            const confirmed = window.confirm(
                `プロジェクト「${data?.label ?? 'このプロジェクト'}」を削除しますか？\n\nこの操作は取り消せません。`
            );
            if (confirmed && data?.onDelete) {
                data.onDelete();
            }
        } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            // Start editing on typing (fallback in case wrapper has focus)
            setIsEditing(true);
            requestAnimationFrame(() => {
                if (inputRef.current) {
                    inputRef.current.focus();
                    inputRef.current.setSelectionRange(0, inputRef.current.value.length);
                }
            });
        }
    }, [isEditing, data]);

    const handleDoubleClick = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        setIsEditing(true);
        setEditValue(data?.label ?? '');
        requestAnimationFrame(() => {
            const len = inputRef.current?.value.length ?? 0;
            inputRef.current?.setSelectionRange(0, len);
        });
    }, [data?.label]);

    const handleInputBlur = useCallback(async () => {
        console.log('[ProjectNode] Input blur triggered, saving and exiting edit mode');
        try {
            await saveValue();
        } catch (error) {
            console.error('[ProjectNode] Error saving on blur:', error);
        } finally {
            setIsEditing(false);
            console.log('[ProjectNode] Edit mode exited via blur');
        }
    }, [saveValue]);

    return (
        <div
            ref={wrapperRef}
            className={cn(
                "w-[300px] px-4 py-3 rounded-xl bg-primary text-primary-foreground font-bold text-center shadow-lg transition-all outline-none min-h-[60px] flex items-center justify-center",
                selected && "ring-2 ring-white ring-offset-2 ring-offset-background"
            )}
            tabIndex={0}
            onKeyDown={handleWrapperKeyDown}
            onDoubleClick={handleDoubleClick}
        >
            {(selected || isEditing) ? (
                <textarea
                    ref={inputRef as any}
                    rows={1}
                    value={editValue}
                    onChange={(e) => {
                        setEditValue(e.target.value);
                        // Auto-resize
                        e.target.style.height = 'auto';
                        e.target.style.height = `${e.target.scrollHeight}px`;
                    }}
                    onBlur={handleInputBlur}
                    onKeyDown={handleInputKeyDown as any}
                    onClick={(e) => {
                        if (isEditing) e.stopPropagation();
                    }}
                    className="nodrag nopan w-full bg-transparent border-none text-center font-bold focus:outline-none focus:ring-0 text-primary-foreground resize-none overflow-hidden"
                />
            ) : (
                <div className="whitespace-pre-wrap break-words">{data?.label ?? 'Project'}</div>
            )}
            <Handle type="source" position={Position.Right} className="!bg-primary-foreground" />
        </div>
    );
});
ProjectNode.displayName = 'ProjectNode';

// GROUP NODE with keyboard support
const GroupNode = React.memo(({ data, selected }: NodeProps) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(data?.label ?? '');
    const [showCaret, setShowCaret] = useState(false);
    
    const settings = data?.displaySettings || { showStatus: true, showPriority: true, showScheduledAt: true, showEstimatedTime: true, showProgress: true, showCollapseButton: true };

    // Auto-complete logic: Check if all tasks are completed
    const isGroupCompleted = useMemo(() => {
        const tasks = data?.tasks || [];
        if (tasks.length === 0) return false;
        return tasks.every((t: any) => t.status === 'done');
    }, [data?.tasks]);

    // Handle group checkbox toggle
    const handleGroupCheckToggle = useCallback(async (e: React.MouseEvent) => {
        e.stopPropagation();
        const tasks = data?.tasks || [];
        const newStatus = isGroupCompleted ? 'todo' : 'done';
        
        // Update all child tasks
        for (const task of tasks) {
            await data?.onUpdateTask?.(task.id, { status: newStatus });
        }
    }, [isGroupCompleted, data]);

    // Sync label
    useEffect(() => {
        if (!isEditing) {
            setEditValue(data?.label ?? '');
        }
    }, [data?.label, isEditing]);

    // Focus input when editing
    useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus();
            const len = inputRef.current.value.length;
            inputRef.current.setSelectionRange(len, len);
        }
    }, [isEditing]);

    // Keep input focused when selected so IME can start from first key
    useLayoutEffect(() => {
        if (selected && inputRef.current) {
            inputRef.current.focus();
            if (!isEditing) {
                setShowCaret(false);
                }
        }
    }, [selected, isEditing]);

    const saveValue = useCallback(async () => {
        const trimmed = editValue.trim();
        if (trimmed && trimmed !== data?.label && data?.onSave) {
            await data.onSave(trimmed);
        }
    }, [editValue, data]);

    const handleInputKeyDown = useCallback(async (e: React.KeyboardEvent<HTMLInputElement>) => {
        e.stopPropagation();
        if (!isEditing && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                setIsEditing(true);
            setShowCaret(true);
            if (inputRef.current) {
                inputRef.current.setSelectionRange(0, inputRef.current.value.length);
            }
            return;
        }

        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            await saveValue();
            setIsEditing(false);
            setShowCaret(false);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            setEditValue(data?.label ?? '');
            setIsEditing(false);
            setShowCaret(false);
        }
    }, [saveValue, data?.label]);

    const handleWrapperKeyDown = useCallback(async (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (isEditing) return;
        e.stopPropagation();

        if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            if (data?.onDelete) await data.onDelete();
        } else if (e.key === 'F2') {
            e.preventDefault();
            setIsEditing(true);
            setEditValue(data?.label ?? '');
        } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            // IMPORTANT (IME): don't inject the first character into state (causes "kあ").
            // The input is already focused while selected, so IME can start composition normally.
            setIsEditing(true);
            setShowCaret(true);
            if (inputRef.current) {
                inputRef.current.setSelectionRange(0, inputRef.current.value.length);
            }
        }
    }, [isEditing, data]);

    const handleDoubleClick = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        setIsEditing(true);
        setEditValue(data?.label ?? '');
        setShowCaret(true);
        requestAnimationFrame(() => {
            const len = inputRef.current?.value.length ?? 0;
            inputRef.current?.setSelectionRange(0, len);
        });
    }, [data?.label]);

    const handleInputBlur = useCallback(async () => {
        console.log('[GroupNode] Input blur triggered, saving and exiting edit mode');
        try {
            await saveValue();
        } catch (error) {
            console.error('[GroupNode] Error saving on blur:', error);
        } finally {
            setIsEditing(false);
            console.log('[GroupNode] Edit mode exited via blur');
        }
    }, [saveValue]);

    return (
        <div
            ref={wrapperRef}
            className={cn(
                "group w-auto min-w-[240px] max-w-[320px] px-3 py-2 rounded-lg bg-card border text-sm font-medium shadow transition-all outline-none min-h-[40px] flex items-center gap-2",
                selected && "ring-2 ring-white ring-offset-2 ring-offset-background",
                data?.isDropTarget && "ring-2 ring-sky-400 ring-offset-2 ring-offset-background"
            )}
            tabIndex={0}
            onKeyDown={handleWrapperKeyDown}
            onDoubleClick={handleDoubleClick}
        >
            <Handle type="target" position={Position.Left} className="!bg-muted-foreground" />
            
            {/* Checkbox (left) */}
            {settings.showStatus && (
                <button
                    type="button"
                    className={cn(
                        "nodrag nopan w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors",
                        isGroupCompleted 
                            ? "bg-primary border-primary text-primary-foreground" 
                            : "border-muted-foreground/30 hover:border-primary"
                    )}
                    onClick={handleGroupCheckToggle}
                    title={isGroupCompleted ? "グループを未完了に戻す" : "グループを完了"}
                >
                    {isGroupCompleted && (
                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                            <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                    )}
                </button>
            )}

            {/* Group Name */}
            <textarea
                ref={inputRef as any}
                rows={1}
                    value={editValue}
                onChange={(e) => {
                    if (!isEditing) {
                        setIsEditing(true);
                        setShowCaret(true);
                    }
                    setEditValue(e.target.value);
                    e.target.style.height = 'auto';
                    e.target.style.height = `${e.target.scrollHeight}px`;
                }}
                    onBlur={handleInputBlur}
                onKeyDown={handleInputKeyDown as any}
                onClick={(e) => {
                    if (isEditing) e.stopPropagation();
                }}
                onCompositionStart={() => {
                    if (!isEditing) {
                        setIsEditing(true);
                        setShowCaret(true);
                    }
                }}
                    className={cn(
                    "nodrag nopan flex-1 bg-transparent border-none text-sm text-center focus:outline-none focus:ring-0 resize-none overflow-hidden min-w-0",
                    !showCaret && "caret-transparent pointer-events-none select-none"
                )}
            />

            {/* Estimated Time (Group) */}
            {settings.showEstimatedTime && (
                <>
                    {(data?.estimatedDisplayMinutes ?? 0) > 0 ? (
                        <div className="nodrag nopan flex items-center gap-1 shrink-0">
                            <EstimatedTimePopover
                                valueMinutes={data.estimatedDisplayMinutes}
                                onChangeMinutes={(minutes) => data.onUpdateGroup?.({ estimated_time: minutes })}
                                isOverridden={!!data?.estimatedIsOverride}
                                autoMinutes={data?.estimatedAutoMinutes}
                                onResetAuto={() => data.onUpdateGroup?.({ estimated_time: null })}
                                trigger={
                                    <span
                                        className="cursor-pointer"
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <EstimatedTimeBadge
                                            minutes={data.estimatedDisplayMinutes}
                                            className="text-[10px] px-1.5 py-0.5"
                                            title={
                                                data?.estimatedIsOverride
                                                    ? `手動設定（自動集計: ${data.estimatedAutoMinutes ? formatEstimatedTime(data.estimatedAutoMinutes) : "0分"}）`
                                                    : `自動集計（全階層）: ${data.estimatedAutoMinutes ? formatEstimatedTime(data.estimatedAutoMinutes) : "0分"}`
                                            }
                                        />
                                    </span>
                                }
                            />
                            {data?.estimatedIsOverride && (
                                <button
                                    className="p-0.5 rounded text-zinc-500 hover:text-red-400 transition-colors"
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        data.onUpdateGroup?.({ estimated_time: null })
                                    }}
                                    title="自動集計に戻す"
                                >
                                    <X className="w-2.5 h-2.5" />
                                </button>
                            )}
                        </div>
                    ) : (
                        <EstimatedTimePopover
                            valueMinutes={0}
                            onChangeMinutes={(minutes) => data.onUpdateGroup?.({ estimated_time: minutes })}
                            isOverridden={false}
                            autoMinutes={data?.estimatedAutoMinutes}
                            trigger={
                        <button
                            className="nodrag nopan p-0.5 rounded text-zinc-500 hover:text-zinc-400 transition-colors text-xs opacity-0 group-hover:opacity-100"
                            title="見積もり（グループ上書き）"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <Clock className="w-3.5 h-3.5" />
                        </button>
                            }
                        />
                    )}
                </>
            )}

            {/* Priority Badge (if set) */}
            {settings.showPriority && data?.priority != null && (
                <PriorityPopover
                    value={data.priority as Priority}
                    onChange={(priority) => data.onUpdateGroup?.({ priority })}
                    trigger={
                        <span className="nodrag nopan cursor-pointer shrink-0">
                            <PriorityBadge value={data.priority as Priority} className="text-[10px] px-1.5 py-0.5" />
                        </span>
                    }
                />
            )}

            {/* Date Display (if set) */}
            {settings.showScheduledAt && data?.scheduled_at && (
                <DateTimePicker
                    date={new Date(data.scheduled_at)}
                    setDate={(date) => data.onUpdateGroup?.({ scheduled_at: date?.toISOString() || null })}
                    trigger={
                        <span className="nodrag nopan text-[10px] text-zinc-400 hover:text-zinc-200 cursor-pointer shrink-0 whitespace-nowrap">
                            {new Date(data.scheduled_at).toLocaleDateString('ja-JP', { 
                                month: 'numeric', 
                                day: 'numeric', 
                                hour: '2-digit', 
                                minute: '2-digit' 
                            })}
                        </span>
                    }
                />
            )}

            {/* Collapse Button (right) */}
            {settings.showCollapseButton && data?.onToggleCollapse && data?.hasChildren && (
                <button
                    type="button"
                    className="nodrag nopan ml-auto text-[10px] text-muted-foreground hover:text-foreground shrink-0"
                    onClick={(e) => {
                        e.stopPropagation();
                        data.onToggleCollapse?.();
                    }}
                    aria-label={data?.collapsed ? 'Expand' : 'Collapse'}
                >
                    {data?.collapsed ? '>' : 'v'}
                </button>
            )}
            
            <Handle type="source" position={Position.Right} className="!bg-muted-foreground" />
        </div>
    );
});
GroupNode.displayName = 'GroupNode';

// TASK NODE
const TaskNode = React.memo(({ data, selected }: NodeProps) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const [isEditing, setIsEditing] = useState<boolean>(false);
    const [isConfirmed, setIsConfirmed] = useState<boolean>(false); // 確定待ち状態（3段階目）
    const [editValue, setEditValue] = useState<string>(data?.label ?? '');
    const [showCaret, setShowCaret] = useState<boolean>(false);
    const [showScheduleMenu, setShowScheduleMenu] = useState<boolean>(false);

    // Flag to prevent double-save when exiting via keyboard (Enter/Tab/Escape)
    const isSavingViaKeyboardRef = useRef(false);

    // Trigger edit from external
    useEffect(() => {
        if (data?.triggerEdit && !isEditing) {
            setIsEditing(true);
            setShowCaret(true);
            setEditValue(data?.initialValue ?? '');
        }
    }, [data?.triggerEdit, data?.initialValue, isEditing]);

    // Sync label
    useEffect(() => {
        if (!isEditing) {
            setEditValue(data?.label ?? '');
        }
    }, [data?.label, isEditing]);

    // Auto-focus input when editing (avoid rAF/select to keep IME stable)
    useEffect(() => {
        if (isEditing && inputRef.current && document.activeElement !== inputRef.current) {
            inputRef.current.focus();
        }
    }, [isEditing]);

    // Auto-focus input when selected so the first key goes to IME safely
    useLayoutEffect(() => {
        if (selected && inputRef.current) {
            inputRef.current.focus();
            if (!isEditing) {
                setShowCaret(false);
            }
        } else {
            // 選択が外れたら確定待ち状態をリセット
            setIsConfirmed(false);
        }
    }, [selected, isEditing]);

    const saveValue = useCallback(async () => {
        const trimmed = editValue.trim() || 'Task';

        if (trimmed !== data?.label && data?.onSave) {
            console.log('[TaskNode] Optimistic save (background):', trimmed);
            Promise.resolve()
                .then(() => data.onSave!(trimmed))
                .catch((error: unknown) => {
                    console.error('[TaskNode] Save failed:', error);
                });
        }

        return trimmed;
    }, [editValue, data]);

    const exitEditMode = useCallback(() => {
        setIsEditing(false);
        requestAnimationFrame(() => {
            wrapperRef.current?.focus();
        });
    }, []);

    const handleInputKeyDown = useCallback(async (e: React.KeyboardEvent<HTMLInputElement>) => {
        e.stopPropagation();

        if (!isEditing) {
            // Selection Mode & Confirmed Mode behaviors (input is focused for IME-friendly first key)
            if (e.key === 'Tab') {
                e.preventDefault();
                setIsConfirmed(false); // 確定待ち状態をリセット
                if (data?.onAddChild) await data.onAddChild();
                return;
            }
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                setIsConfirmed(false); // 確定待ち状態をリセット
                if (data?.onAddSibling) await data.onAddSibling();
                return;
            }
            if (e.key === 'Escape') {
                // Confirmed Mode -> Selection Mode: exit confirmed state
                e.preventDefault();
                setIsConfirmed(false);
                return;
            }
            if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                if (data?.onDelete) await data.onDelete();
                return;
            }
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                e.preventDefault();
                if (data?.onNavigate) {
                    data.onNavigate(e.key as 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight');
                }
                return;
            }
            if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                // Selection Mode / Confirmed Mode -> Edit Mode: allow IME to start from first key
                setIsConfirmed(false); // 確定待ち状態をリセット
                setIsEditing(true);
                setShowCaret(true);
                if (inputRef.current) {
                    inputRef.current.setSelectionRange(0, inputRef.current.value.length);
                }
                return;
            }
        }

        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            // Edit Mode + Enter = Save text and enter "Confirmed" state (3-stage model)
            e.preventDefault();
            e.stopPropagation();

            isSavingViaKeyboardRef.current = true;

            await saveValue();
            setIsEditing(false);
            setShowCaret(false);
            setIsConfirmed(true); // 確定待ち状態へ遷移

            setTimeout(() => { isSavingViaKeyboardRef.current = false; }, 0);
        } else if (e.key === 'Tab') {
            // Edit Mode + Tab = Confirm + Create Child
            e.preventDefault();

            isSavingViaKeyboardRef.current = true;

            await saveValue();
            setIsEditing(false);
            setShowCaret(false);

            if (data?.onAddChild) {
                await data.onAddChild();
            }

            setTimeout(() => {
                isSavingViaKeyboardRef.current = false;
            }, 0);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            isSavingViaKeyboardRef.current = true;
            setEditValue(data?.label ?? '');
            setIsConfirmed(false); // Escapeはキャンセルなので確定待ち状態にしない
            exitEditMode();
            setShowCaret(false);
            setTimeout(() => {
                isSavingViaKeyboardRef.current = false;
            }, 0);
        }
    }, [saveValue, exitEditMode, data, isEditing]);

    const handleWrapperKeyDown = useCallback(async (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (isEditing) return;

        e.stopPropagation();

        if (e.key === 'Tab') {
            e.preventDefault();
            setIsConfirmed(false); // 確定待ち状態をリセット
            if (data?.onAddChild) await data.onAddChild();
        } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            setIsConfirmed(false); // 確定待ち状態をリセット
            if (data?.onAddSibling) await data.onAddSibling();
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            if (data?.onDelete) await data.onDelete();
        } else if (e.key === 'F2') {
            e.preventDefault();
            setIsConfirmed(false); // 確定待ち状態をリセット
            setIsEditing(true);
            setShowCaret(true);
            setEditValue(data?.label ?? '');
        } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
            // Arrow key navigation (tree-based, not visual)
            e.preventDefault();
            if (data?.onNavigate) {
                data.onNavigate(e.key as 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight');
            }
        } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            // Fallback: focus input and enter edit mode (IME-friendly)
            inputRef.current?.focus();
            setIsEditing(true);
            setShowCaret(true);
            if (inputRef.current) {
                inputRef.current.setSelectionRange(0, inputRef.current.value.length);
            }
        }
    }, [isEditing, data]);

    const handleDoubleClick = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        setIsConfirmed(false); // 確定待ち状態をリセット
        setIsEditing(true);
        setShowCaret(true);
        setEditValue(data?.label ?? '');
        requestAnimationFrame(() => {
            const len = inputRef.current?.value.length ?? 0;
            inputRef.current?.setSelectionRange(0, len);
        });
    }, [data?.label]);

    const handleInputBlur = useCallback(async () => {
        if (!isEditing) return;
        // Skip if exiting via keyboard (Enter/Tab/Escape already handled save)
        if (isSavingViaKeyboardRef.current) {
            console.log('[TaskNode] Blur skipped (keyboard exit)');
            return;
        }

        console.log('[TaskNode] Blur triggered (mouse), saving');
        try {
            await saveValue();
        } catch (error) {
            console.error('[TaskNode] Error saving on blur:', error);
        } finally {
            setIsEditing(false);
            setShowCaret(false);
        }
    }, [saveValue]);

    // Ensure focus when clicked (IME-friendly)
    const handleWrapperMouseDown = useCallback((e: React.MouseEvent) => {
        // Do not stop propagation: ReactFlow needs the event to manage selection.
        if (!isEditing) {
            setShowCaret(false);
        inputRef.current?.focus();
        }
    }, [isEditing]);

    // ドラッグ開始時の処理（カレンダーにドロップするため）
    const handleDragStart = useCallback((e: React.DragEvent) => {
        if (isEditing) {
            e.preventDefault()
            return
        }

        // タスクIDをドラッグデータに設定
        const taskId = (data as any)?.taskId || (data as any)?.id
        if (taskId) {
            e.dataTransfer.setData('text/plain', taskId)
            e.dataTransfer.effectAllowed = 'copy'

            // カスタムドラッグゴーストを作成
            const ghost = document.createElement('div')
            ghost.className = 'px-3 py-2 bg-primary text-primary-foreground text-xs rounded shadow-lg border border-primary/20 flex items-center gap-2 pointer-events-none'
            ghost.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                    <line x1="16" y1="2" x2="16" y2="6"></line>
                    <line x1="8" y1="2" x2="8" y2="6"></line>
                    <line x1="3" y1="10" x2="21" y2="10"></line>
                </svg>
                <span class="font-medium">${editValue || 'タスク'}</span>
            `
            document.body.appendChild(ghost)

            // カーソル位置にゴーストを配置
            e.dataTransfer.setDragImage(ghost, 20, 20)

            // クリーンアップ
            setTimeout(() => ghost.remove(), 0)

            // DragContextに通知（data経由で呼び出し）
            ;(data as any)?.onDragStart?.(taskId, editValue || 'タスク')

            console.log('[TaskNode] Drag started:', taskId)
        }
    }, [isEditing, data, editValue])

    // ドラッグ終了時の処理
    const handleDragEnd = useCallback(() => {
        // DragContextに通知（data経由で呼び出し）
        ;(data as any)?.onDragEnd?.()
    }, [])

    const settings = data?.displaySettings || { showStatus: true, showPriority: true, showScheduledAt: true, showEstimatedTime: true, showProgress: true, showCollapseButton: true };

    return (
        <div
            ref={wrapperRef}
            className={cn(
                "w-[225px] px-2 py-1.5 rounded bg-background border text-xs shadow-sm flex items-center gap-1 transition-all outline-none min-h-[30px] group",
                !isEditing && "cursor-grab active:cursor-grabbing",
                (selected || data?.isSelected) && "ring-2 ring-sky-400 ring-offset-1 ring-offset-background border-sky-400 shadow-[0_0_0_2px_rgba(56,189,248,0.20)]",
                data?.isDropTarget && "ring-2 ring-emerald-400 ring-offset-1 ring-offset-background border-emerald-400"
            )}
            tabIndex={0}
            draggable={!isEditing}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onKeyDown={handleWrapperKeyDown}
            onDoubleClick={handleDoubleClick}
            onMouseDown={handleWrapperMouseDown}
        >
            {settings.showCollapseButton && data?.onToggleCollapse && data?.hasChildren && (
                <button
                    type="button"
                    className="nodrag nopan w-3 h-3 text-[10px] leading-none text-muted-foreground hover:text-foreground shrink-0"
                    onClick={(e) => {
                        e.stopPropagation();
                        data.onToggleCollapse?.();
                    }}
                    aria-label={data?.collapsed ? 'Expand' : 'Collapse'}
        >
                    {data?.collapsed ? '>' : 'v'}
                </button>
            )}
            <Handle type="target" position={Position.Left} className="!bg-muted-foreground/50 !w-1 !h-1" />

            {/* コンテキストメニューボタン - ホバー時に表示 */}
            <DropdownMenu open={showScheduleMenu} onOpenChange={setShowScheduleMenu}>
                <DropdownMenuTrigger asChild>
                    <button
                        type="button"
                        className="nodrag nopan w-4 h-4 text-muted-foreground/30 hover:text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded hover:bg-muted/50"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <MoreHorizontal className="w-3 h-3" />
                    </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem
                        className="text-xs cursor-pointer"
                        onClick={(e) => {
                            e.stopPropagation()
                            // カレンダーへのドラッグ＆ドロップを促すヒントを表示
                            alert('ドラッグ＆ドロップ: タスクを右側のカレンダーにドラッグしてスケジュール設定します')
                        }}
                    >
                        <CalendarIcon className="w-3 h-3 mr-2" />
                        カレンダーにスケジュール
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>

            {/* ドラッグハンドルアイコン - ホバー時に表示 */}
            <GripVertical className="w-3 h-3 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors shrink-0" />

            {settings.showStatus && (
            <div className={cn("w-1.5 h-1.5 rounded-full shrink-0", data?.status === 'done' ? "bg-primary" : "bg-muted-foreground/30")} />
            )}

            <textarea
                ref={inputRef as any}
                rows={1}
                    value={editValue}
                onChange={(e) => {
                    if (!isEditing) {
                        setIsEditing(true);
                        setShowCaret(true);
                    }
                    setEditValue(e.target.value);
                    e.target.style.height = 'auto';
                    e.target.style.height = `${e.target.scrollHeight}px`;
                }}
                    onBlur={handleInputBlur}
                onKeyDown={handleInputKeyDown as any}
                onCompositionStart={() => {
                    if (!isEditing) {
                        setIsEditing(true);
                        setShowCaret(true);
                    }
                }}
                    className={cn(
                    "nodrag nopan flex-1 bg-transparent border-none text-xs focus:outline-none focus:ring-0 px-0.5 min-w-0 resize-none overflow-hidden whitespace-pre-wrap break-words",
                    !showCaret && "caret-transparent pointer-events-none select-none",
                    data?.status === 'done' && "line-through text-muted-foreground"
                )}
            />

            {/* Priority & DateTime Info Group */}
            <div className="nodrag nopan flex items-center gap-1 shrink-0 ml-1">
                {/* Estimated Time */}
                {settings.showEstimatedTime && (
                    <>
                        {(data?.estimatedDisplayMinutes ?? 0) > 0 ? (
                            <>
                                <EstimatedTimePopover
                                    valueMinutes={data.estimatedDisplayMinutes}
                                    onChangeMinutes={(minutes) => data?.onUpdateEstimatedTime?.(minutes)}
                                    isOverridden={!!data?.estimatedIsOverride}
                                    autoMinutes={data?.estimatedAutoMinutes}
                                    onResetAuto={data?.hasChildren ? () => data?.onUpdateEstimatedTime?.(0) : undefined}
                                    trigger={
                                        <span
                                            className="cursor-pointer"
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            <EstimatedTimeBadge
                                                minutes={data.estimatedDisplayMinutes}
                                                title={
                                                    data?.hasChildren
                                                        ? (data?.estimatedIsOverride
                                                            ? `手動設定（自動集計: ${data.estimatedAutoMinutes ? formatEstimatedTime(data.estimatedAutoMinutes) : "0分"}）`
                                                            : `子孫合計: ${formatEstimatedTime(data.estimatedDisplayMinutes)}`)
                                                        : `見積もり: ${formatEstimatedTime(data.estimatedDisplayMinutes)}`
                                                }
                                            />
                                        </span>
                                    }
                                />

                                {/* Clear (leaf) / Reset (parent override) */}
                                {(!data?.hasChildren || data?.estimatedIsOverride) && (
                                    <button
                                        className="p-0.5 rounded text-zinc-500 hover:text-red-400 transition-colors"
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            data?.onUpdateEstimatedTime?.(0)
                                        }}
                                        title={data?.hasChildren ? "自動集計に戻す" : "見積もり時間を削除"}
                                    >
                                        <X className="w-2.5 h-2.5" />
                                    </button>
                                )}
                            </>
                        ) : (
                            <EstimatedTimePopover
                                valueMinutes={0}
                                onChangeMinutes={(minutes) => data?.onUpdateEstimatedTime?.(minutes)}
                                isOverridden={false}
                                autoMinutes={data?.estimatedAutoMinutes}
                                trigger={
                            <button
                                className="p-0.5 rounded text-zinc-500 hover:text-zinc-400 transition-colors text-xs"
                                title={data?.hasChildren ? "見積もり（親タスク上書き）" : "見積もり時間を設定"}
                                onClick={(e) => e.stopPropagation()}
                            >
                                <Clock className="w-3.5 h-3.5" />
                            </button>
                                }
                            />
                        )}
                    </>
                )}

                {/* Priority Group */}
                {settings.showPriority && (
                    <>
                        {data?.priority != null ? (
                            <>
                                {/* Priority Badge (clickable) */}
                                <PriorityPopover
                                    value={data.priority as Priority}
                                    onChange={(priority) => data?.onUpdatePriority?.(priority)}
                                    trigger={
                                        <span className="cursor-pointer">
                                            <PriorityBadge value={data.priority as Priority} />
                </span>
                                    }
                                />
                                
                                {/* Clear Button */}
                                <button
                                    className="p-0.5 rounded text-zinc-500 hover:text-red-400 transition-colors"
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        data?.onUpdatePriority?.(undefined as any)
                                    }}
                                    title="優先度を削除"
                                >
                                    <X className="w-2.5 h-2.5" />
                                </button>
                            </>
                        ) : (
                            /* Priority not set: Icon only (gray) */
                        <PriorityPopover
                            value={3}
                            onChange={(priority) => data?.onUpdatePriority?.(priority)}
                            trigger={
                                <button 
                                    className="p-0.5 rounded text-zinc-500 hover:text-zinc-400 transition-colors text-xs"
                                    title="優先度を設定"
                                >
                                    <Target className="w-3.5 h-3.5" />
                                </button>
                            }
                        />
                        )}
                    </>
                )}
                
                {/* DateTime Picker */}
                {settings.showScheduledAt && (
                    <DateTimePicker
                        date={data?.scheduled_at ? new Date(data.scheduled_at) : undefined}
                        setDate={(date) => data?.onUpdateDate?.(date ? date.toISOString() : null)}
                        trigger={
                            data?.scheduled_at ? (
                                <div className="flex items-center gap-1">
                                    {/* Date Text (clickable) */}
                                    <span className="text-[10px] text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer">
                                        {new Date(data.scheduled_at).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                    
                                    {/* Clear Button */}
                                    <button
                                        className="p-0.5 rounded text-zinc-500 hover:text-red-400 transition-colors"
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            data?.onUpdateDate?.(null)
                                        }}
                                        title="日時設定を削除"
                                    >
                                        <X className="w-2.5 h-2.5" />
                                    </button>
                                </div>
                            ) : (
                                /* Date not set: Calendar icon only */
                                <button className="p-0.5 rounded text-zinc-500 hover:text-zinc-400 transition-colors"
                                    title="日時設定"
                                >
                                    <CalendarIcon className="w-3 h-3" />
                                </button>
                            )
                        }
                    />
                )}
            </div>

            {/* Calendar sync indicator */}
            {data?.google_event_id && (
                <div className="nodrag nopan shrink-0 ml-1" title="Googleカレンダーと同期済み">
                    <CalendarIcon className="w-3 h-3 text-blue-500" />
                </div>
            )}

            {/* Confirmed state indicator */}
            {isConfirmed && (
                <div className="nodrag nopan shrink-0 ml-1" title="確定済み - Enterで新規タスク作成">
                    <Check className="w-3 h-3 text-green-500" />
                </div>
            )}

            <Handle type="source" position={Position.Right} className="!bg-muted-foreground/50 !w-1 !h-1" />
        </div>
    );
});
TaskNode.displayName = 'TaskNode';

const nodeTypes = { projectNode: ProjectNode, groupNode: GroupNode, taskNode: TaskNode };
const defaultViewport = { x: 0, y: 0, zoom: 0.8 };

interface MindMapProps {
    project: Project
    groups: TaskGroup[]
    tasks: Task[]
    onUpdateGroupTitle: (groupId: string, newTitle: string) => void
    onUpdateGroup?: (groupId: string, updates: Partial<TaskGroup>) => Promise<void>
    onCreateGroup?: (title: string) => void
    onDeleteGroup?: (groupId: string) => void
    onUpdateProject?: (projectId: string, title: string) => Promise<void>
    onCreateTask?: (groupId: string, title?: string, parentTaskId?: string | null) => Promise<Task | null>
    onUpdateTask?: (taskId: string, updates: Partial<Task>) => Promise<void>
    onDeleteTask?: (taskId: string) => Promise<void>
    onMoveTask?: (taskId: string, newGroupId: string) => Promise<void>
}

function MindMapContent({ project, groups, tasks, onUpdateGroupTitle, onUpdateGroup, onCreateGroup, onDeleteGroup, onUpdateProject, onCreateTask, onUpdateTask, onDeleteTask }: MindMapProps) {
    const reactFlow = useReactFlow();
    const projectId = project?.id ?? '';
    const USER_ACTION_WINDOW_MS = 800;

    // DragContext - MindMapContentで使用してTaskNodeに渡す
    const { startDrag, endDrag } = useDrag()
    
    // MindMap Display Settings
    const [displaySettings, setDisplaySettings] = useState<MindMapDisplaySettings>(() => loadSettings());
    const groupsJson = JSON.stringify(groups?.map(g => ({
        id: g?.id,
        title: g?.title,
        priority: (g as any)?.priority ?? null,
        scheduled_at: (g as any)?.scheduled_at ?? null,
        estimated_time: (g as any)?.estimated_time ?? null,
    })) ?? []);
    const tasksJson = JSON.stringify(tasks?.map(t => ({
        id: t?.id,
        title: t?.title,
        status: t?.status,
        group_id: t?.group_id,
        parent_task_id: t?.parent_task_id,
        order_index: t?.order_index,
        created_at: t?.created_at,
        scheduled_at: t?.scheduled_at,
        google_event_id: t?.google_event_id,
        priority: (t as any)?.priority, // Include priority (no default value)
        estimated_time: t?.estimated_time ?? 0,
    })) ?? []);

    // STATE
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
    const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
    const [pendingEditNodeId, setPendingEditNodeId] = useState<string | null>(null);
    const [collapsedTaskIds, setCollapsedTaskIds] = useState<Set<string>>(new Set());
    const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(new Set());
    const [dropTargetNodeId, setDropTargetNodeId] = useState<string | null>(null);
    const [dragPositions, setDragPositions] = useState<Record<string, { x: number; y: number }>>({});
    const lastUserActionAtRef = useRef<number>(0);
    const selectedNodeIdRef = useRef<string | null>(null);
    const markUserAction = useCallback(() => {
        lastUserActionAtRef.current = Date.now();
    }, []);

    const applySelection = useCallback((ids: Set<string>, primaryId: string | null, source: 'user' | 'system') => {
        if (source === 'user') {
            markUserAction();
        }
        setSelectedNodeIds(ids);
        setSelectedNodeId(primaryId);

        // CRITICAL: Sync ReactFlow's internal selection state to match our custom selection
        // This prevents the "multiple blue nodes" bug where ReactFlow's drag-selection state
        // persists after keyboard navigation
        reactFlow.setNodes((nodes) =>
            nodes.map((node) => ({
                ...node,
                selected: ids.has(node.id),
            }))
        );
    }, [markUserAction, reactFlow]);

    useEffect(() => {
        selectedNodeIdRef.current = selectedNodeId;
    }, [selectedNodeId]);

    // REF: Flag to indicate we're waiting for a new node
    const isCreatingNodeRef = useRef(false);
    const prevTaskCountRef = useRef(tasks.length);
    const isCreatingGroupRef = useRef(false);
    const prevGroupCountRef = useRef(groups.length);

    // REF: Focus queue - persists through dagre re-layouts
    const focusQueueRef = useRef<string | null>(null);

    // HELPER: Robust DOM polling focus function
    // Uses React Flow's standard node wrapper structure for reliable element detection
    const focusNodeWithPolling = useCallback((targetId: string, maxDuration: number = 200) => {
        const startTime = Date.now();
        let attemptCount = 0;

        const attemptFocus = () => {
            attemptCount++;

            // Check if we've exceeded max duration
            if (Date.now() - startTime > maxDuration) {
                console.log('[MindMap] Focus polling timed out for:', targetId, 'after', attemptCount, 'attempts');
                focusQueueRef.current = null;
                return;
            }

            // Strategy 1: React Flow standard selector
            let nodeElement = document.querySelector(`.react-flow__node[data-id="${targetId}"]`);

            // Strategy 2: Fallback to data-id only (for custom nodes)
            if (!nodeElement) {
                nodeElement = document.querySelector(`[data-id="${targetId}"]`);
            }

            if (nodeElement) {
                // Look for input inside the node (edit mode)
                const inputElement = nodeElement.querySelector('input') as HTMLInputElement;
                if (inputElement) {
                    console.log('[MindMap] Focus success (input):', targetId, 'attempt:', attemptCount);
                    inputElement.focus();
                    inputElement.select(); // Select all text for easy replacement
                    focusQueueRef.current = null;
                    return;
                }

                // If no input, focus the wrapper with tabindex (select mode trigger)
                const wrapperElement = nodeElement.querySelector('[tabindex="0"]') as HTMLElement;
                if (wrapperElement) {
                    console.log('[MindMap] Focus success (wrapper):', targetId, 'attempt:', attemptCount);
                    wrapperElement.focus();
                    focusQueueRef.current = null;
                    return;
                }

                // Last resort: focus the node element itself if it has tabindex
                if (nodeElement instanceof HTMLElement && nodeElement.tabIndex >= 0) {
                    console.log('[MindMap] Focus success (node):', targetId, 'attempt:', attemptCount);
                    nodeElement.focus();
                    focusQueueRef.current = null;
                    return;
                }
            }

            // Element not found yet, retry on next animation frame
            requestAnimationFrame(attemptFocus);
        };

        // Clear any existing focus queue and start polling immediately
        focusQueueRef.current = targetId;
        requestAnimationFrame(attemptFocus);
    }, []);

    // HELPER: Persistent DOM polling using setInterval (V2)
    // Ensures focus is captured even if React renders are delayed
    // CRITICAL: Waits for input element to appear (new nodes need time to enter edit mode)
    // RACE CONDITION FIX: Cancels previous focus operation when new one starts
    const activeTimerRef = useRef<NodeJS.Timeout | null>(null);

    const focusNodeWithPollingV2 = useCallback((targetId: string, maxDuration: number = 500, preferInput: boolean = true) => {
        const startTime = Date.now();
        const pollingInterval = 10; // 10ms loop
        const inputWaitThreshold = 300; // Wait up to 300ms for input before settling for wrapper

        // CRITICAL: Cancel any ongoing focus operation to prevent race conditions
        if (activeTimerRef.current) {
            console.log('[MindMap] Cancelling previous focus operation');
            clearInterval(activeTimerRef.current);
            activeTimerRef.current = null;
        }

        console.log('[MindMap] Starting persistent focus polling V2 for:', targetId, 'preferInput:', preferInput);

        const timer = setInterval(() => {
            const elapsed = Date.now() - startTime;
            const currentSelected = selectedNodeIdRef.current;
            if (currentSelected && currentSelected !== targetId) {
                clearInterval(timer);
                activeTimerRef.current = null;
                focusQueueRef.current = null;
                return;
            }

            // Strategy 1: React Flow standard selector
            let nodeElement = document.querySelector(`.react-flow__node[data-id="${targetId}"]`);
            // Strategy 2: Fallback selector
            if (!nodeElement) nodeElement = document.querySelector(`[data-id="${targetId}"]`);

            if (nodeElement) {
                const inputElement = nodeElement.querySelector('input') as HTMLInputElement;
                const wrapperElement = nodeElement.querySelector('[tabindex="0"]') as HTMLElement;

                // If preferInput is true, wait for input unless we've exceeded the input wait threshold
                if (preferInput && !inputElement && elapsed < inputWaitThreshold) {
                    // Node found but input not ready yet - keep waiting
                    return;
                }

                // Now decide what to focus
                const targetElement = inputElement ?? wrapperElement ?? (nodeElement as HTMLElement);

                if (targetElement) {
                    console.log('[MindMap] Focus SUCCESS for:', targetId, `in ${elapsed}ms, element:`, inputElement ? 'input' : 'wrapper');
                    targetElement.focus();
                    if (inputElement) inputElement.select();

                    clearInterval(timer);
                    activeTimerRef.current = null;
                    focusQueueRef.current = null;
                    return;
                }
            }

            // Timeout check
            if (elapsed > maxDuration) {
                console.warn('[MindMap] Focus polling TIMED OUT for:', targetId);
                clearInterval(timer);
                activeTimerRef.current = null;
                focusQueueRef.current = null;
            }
        }, pollingInterval);

        // Store the timer reference for potential cancellation
        activeTimerRef.current = timer;
    }, []);

    // EFFECT: Detect new task and queue focus with DOM polling
    useEffect(() => {
        const currentCount = tasks.length;
        const prevCount = prevTaskCountRef.current;

        // Check if a new task was added while we were creating
        if (isCreatingNodeRef.current && currentCount > prevCount) {
            // Find the newest task by created_at
            const newestTask = tasks.reduce((newest, task) => {
                if (!newest) return task;
                const newestDate = new Date(newest.created_at).getTime();
                const taskDate = new Date(task.created_at).getTime();
                return taskDate > newestDate ? task : newest;
            }, null as Task | null);

            if (newestTask) {
                console.log('[MindMap] New task detected, starting DOM polling focus:', newestTask.id);
                // Queue for focus and start polling
                focusQueueRef.current = newestTask.id;
                applySelection(new Set([newestTask.id]), newestTask.id, 'user');
                setPendingEditNodeId(newestTask.id);

                // Start DOM polling for focus (V2)
                focusNodeWithPollingV2(newestTask.id);
            }

            // Reset the flag
            isCreatingNodeRef.current = false;
        }

        // Update prev count
        prevTaskCountRef.current = currentCount;
    }, [tasks, focusNodeWithPollingV2, applySelection]);

    // EFFECT: Detect new group creation and focus
    useEffect(() => {
        const currentCount = groups.length;
        const prevCount = prevGroupCountRef.current;

        if (isCreatingGroupRef.current && currentCount > prevCount) {
            const newestGroup = groups.reduce((newest, group) => {
                if (!newest) return group;
                const newestDate = new Date(newest.created_at).getTime();
                const groupDate = new Date(group.created_at).getTime();
                return groupDate > newestDate ? group : newest;
            }, null as TaskGroup | null);

            if (newestGroup?.id) {
                applySelection(new Set([newestGroup.id]), newestGroup.id, 'user');
                focusNodeWithPollingV2(newestGroup.id, 300, false);
            }

            isCreatingGroupRef.current = false;
        }

        prevGroupCountRef.current = currentCount;
    }, [groups, focusNodeWithPollingV2, applySelection]);

    // EFFECT: Backup focus trigger when pendingEditNodeId changes
    useEffect(() => {
        if (pendingEditNodeId && focusQueueRef.current === pendingEditNodeId) {
            // Additional polling attempt as backup (V2)
            focusNodeWithPollingV2(pendingEditNodeId, 100);
        }
    }, [pendingEditNodeId, focusNodeWithPollingV2]);

    // EFFECT: Clear pendingEditNodeId after a delay
    useEffect(() => {
        if (pendingEditNodeId) {
            const timer = setTimeout(() => {
                setPendingEditNodeId(null);
            }, 300);
            return () => clearTimeout(timer);
        }
    }, [pendingEditNodeId]);

    // Helpers
    const getTaskById = useCallback((id: string) => tasks.find(t => t.id === id), [tasks]);
    const getGroupForTask = useCallback((task: Task) => groups.find(g => g.id === task.group_id), [groups]);
    const hasChildren = useCallback((taskId: string) => tasks.some(t => t.parent_task_id === taskId), [tasks]);
    const hasGroupChildren = useCallback((groupId: string) => tasks.some(t => t.group_id === groupId), [tasks]);
    const isDescendant = useCallback((ancestorId: string, childId: string): boolean => {
        const taskById = new Map(tasks.map(t => [t.id, t]));
        let current = taskById.get(childId);
        const visited = new Set<string>();
        while (current?.parent_task_id) {
            if (current.parent_task_id === ancestorId) return true;
            if (visited.has(current.parent_task_id)) break;
            visited.add(current.parent_task_id);
            current = taskById.get(current.parent_task_id);
        }
        return false;
    }, [tasks]);

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

    const toggleGroupCollapse = useCallback((groupId: string) => {
        setCollapsedGroupIds(prev => {
            const next = new Set(prev);
            if (next.has(groupId)) {
                next.delete(groupId);
            } else {
                next.add(groupId);
            }
            return next;
        });
    }, []);

    const getDropTargetNode = useCallback((dragged: Node) => {
        const getNodeRect = (n: Node) => {
            const position = n.positionAbsolute ?? n.position;
            const width = n.width ?? (n.type === 'projectNode' ? PROJECT_NODE_WIDTH : n.type === 'groupNode' ? GROUP_NODE_WIDTH : NODE_WIDTH);
            const height = n.height ?? (n.type === 'projectNode' ? PROJECT_NODE_HEIGHT : n.type === 'groupNode' ? GROUP_NODE_HEIGHT : NODE_HEIGHT);
            return {
                left: position.x,
                top: position.y,
                right: position.x + width,
                bottom: position.y + height,
                centerX: position.x + width / 2,
                centerY: position.y + height / 2,
            };
        };

        const draggedRect = getNodeRect(dragged);
        const candidates = reactFlow
            .getNodes()
            .filter(n => n.id !== dragged.id && (n.type === 'taskNode' || n.type === 'groupNode'));

        let best: { node: Node; dist: number } | null = null;
        for (const candidate of candidates) {
            const rect = getNodeRect(candidate);
            const inside =
                draggedRect.centerX >= rect.left &&
                draggedRect.centerX <= rect.right &&
                draggedRect.centerY >= rect.top &&
                draggedRect.centerY <= rect.bottom;
            if (!inside) continue;

            const dx = rect.centerX - draggedRect.centerX;
            const dy = rect.centerY - draggedRect.centerY;
            const dist = Math.hypot(dx, dy);
            if (!best || dist < best.dist) {
                best = { node: candidate, dist };
            }
        }

        return best?.node ?? null;
    }, [reactFlow]);
    const createGroupAndFocus = useCallback(async (title: string) => {
        if (!onCreateGroup) return;
        isCreatingGroupRef.current = true;
        await onCreateGroup(title);
    }, [onCreateGroup]);

    const calculateNextFocus = useCallback((taskId: string): string | null => {
        const task = getTaskById(taskId);
        if (!task) return null;

        const allSiblings = tasks
            .filter(t => t.group_id === task.group_id && t.parent_task_id === task.parent_task_id)
            .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));

        const currentIndex = allSiblings.findIndex(t => t.id === taskId);

        // Delete focus order:
        // - Upper sibling
        // - Lower sibling
        // - Parent (fallback to group)
        if (currentIndex > 0) return allSiblings[currentIndex - 1].id;
        if (currentIndex === 0 && allSiblings.length > 1) return allSiblings[1].id;
        if (task.parent_task_id) return task.parent_task_id;
        return task.group_id;
    }, [tasks, getTaskById]);

    // Add child task
    const addChildTask = useCallback(async (parentTaskId: string) => {
        const parentTask = getTaskById(parentTaskId);
        if (!parentTask || !onCreateTask) return;
        const group = getGroupForTask(parentTask);
        if (!group) return;

        // Auto-expand parent when adding a child
        setCollapsedTaskIds(prev => {
            if (!prev.has(parentTaskId)) return prev;
            const next = new Set(prev);
            next.delete(parentTaskId);
            return next;
        });

        // Set flag (mostly for logs now)
        isCreatingNodeRef.current = true;

        const newTask = await onCreateTask(group.id, "", parentTaskId);
        if (newTask) {
            console.log('[MindMap] Child task created:', newTask.id, 'Focusing immediately (V2)');
            // Direct focus on the explicit ID
            focusNodeWithPollingV2(newTask.id);
            applySelection(new Set([newTask.id]), newTask.id, 'user');
            setPendingEditNodeId(newTask.id);
        }
    }, [getTaskById, getGroupForTask, onCreateTask, focusNodeWithPollingV2, applySelection]);

    // Add sibling task
    const addSiblingTask = useCallback(async (taskId: string) => {
        const task = getTaskById(taskId);
        if (!task || !onCreateTask) return;
        const group = getGroupForTask(task);
        if (!group) return;

        // Auto-expand parent when adding a sibling under a collapsed parent
        if (task.parent_task_id) {
            setCollapsedTaskIds(prev => {
                if (!prev.has(task.parent_task_id!)) return prev;
                const next = new Set(prev);
                next.delete(task.parent_task_id!);
                return next;
            });
        }

        // Set flag (mostly for logs now)
        isCreatingNodeRef.current = true;

        const newTask = await onCreateTask(group.id, "", task.parent_task_id);
        if (newTask) {
            console.log('[MindMap] Sibling task created:', newTask.id, 'Focusing immediately (V2)');
            // Direct focus on the explicit ID - fixes "focus reverting to old task" bug
            focusNodeWithPollingV2(newTask.id);
            applySelection(new Set([newTask.id]), newTask.id, 'user');
            setPendingEditNodeId(newTask.id);
        }
    }, [getTaskById, getGroupForTask, onCreateTask, focusNodeWithPollingV2, applySelection]);

    // Delete task
    const deleteTask = useCallback(async (taskId: string) => {
        if (!onDeleteTask) return;

        if (hasChildren(taskId)) {
            if (typeof window === 'undefined') return;
            const confirmed = window.confirm('子タスクを含むタスクを削除しますか？\nすべての子タスクも削除されます。');
            if (!confirmed) return;
        }

        const nextFocusId = calculateNextFocus(taskId);
        await onDeleteTask(taskId);
        applySelection(nextFocusId ? new Set([nextFocusId]) : new Set(), nextFocusId, 'user');
        if (nextFocusId) {
            requestAnimationFrame(() => {
                focusNodeWithPollingV2(nextFocusId, 300, false);
            });
        }
    }, [hasChildren, calculateNextFocus, onDeleteTask, applySelection]);

    // Navigation helpers for arrow keys
    const navigateToSibling = useCallback((taskId: string, direction: 'up' | 'down'): string | null => {
        const task = getTaskById(taskId);
        if (!task) return null;

        const siblings = tasks
            .filter(t => t.group_id === task.group_id && t.parent_task_id === task.parent_task_id)
            .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));

        const currentIndex = siblings.findIndex(t => t.id === taskId);
        if (currentIndex === -1) return null;

        const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
        return siblings[targetIndex]?.id ?? null;
    }, [tasks, getTaskById]);

    const navigateToParent = useCallback((taskId: string): string | null => {
        const task = getTaskById(taskId);
        if (!task) return null;
        return task.parent_task_id ?? task.group_id ?? null;
    }, [getTaskById]);

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
            applySelection(new Set([targetId]), targetId, 'user');
            // Focus the target node's wrapper using multiple selector strategies
            requestAnimationFrame(() => {
                // Try React Flow standard selector first
                let targetElement = document.querySelector(`.react-flow__node[data-id="${targetId}"] [tabindex="0"]`) as HTMLElement;

                // Fallback to data-id only
                if (!targetElement) {
                    targetElement = document.querySelector(`[data-id="${targetId}"] [tabindex="0"]`) as HTMLElement;
                }

                if (targetElement) {
                    targetElement.focus();
                } else {
                    console.warn('[MindMap] Could not find target element for navigation:', targetId);
                }
            });
        }
    }, [navigateToSibling, navigateToParent, navigateToFirstChild, applySelection]);

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

    const updateTaskPriority = useCallback(async (taskId: string, priority: number) => {
        if (onUpdateTask) {
            await onUpdateTask(taskId, { priority });
        }
    }, [onUpdateTask]);

    const updateTaskEstimatedTime = useCallback(async (taskId: string, minutes: number) => {
        if (onUpdateTask) {
            await onUpdateTask(taskId, { estimated_time: minutes });
        }
    }, [onUpdateTask]);

    // Check if node should trigger edit
    const shouldTriggerEdit = useCallback((taskId: string) => pendingEditNodeId === taskId, [pendingEditNodeId]);

    // DERIVED STATE
    const { nodes, edges } = useMemo(() => {
        const resultNodes: Node[] = [];
        const resultEdges: Edge[] = [];

        if (!projectId) return { nodes: resultNodes, edges: resultEdges };

        try {
            const parsedGroups = JSON.parse(groupsJson) as {
                id: string;
                title: string;
                priority: number | null;
                scheduled_at: string | null;
                estimated_time: number | null;
            }[];
            const parsedTasks = JSON.parse(tasksJson) as {
                id: string; title: string; status: string; group_id: string;
                parent_task_id: string | null; order_index: number; created_at: string;
                scheduled_at: string | null; // Typed
                google_event_id: string | null;
                priority: number | null;
                estimated_time: number;
            }[];

            resultNodes.push({
                id: 'project-root',
                type: 'projectNode',
                data: {
                    label: project?.title ?? 'Project',
                    onAddChild: () => createGroupAndFocus("New Group"),
                    isSelected: selectedNodeIds.has('project-root'),
                    onSave: async (newTitle: string) => {
                        console.log('[MindMap] Project title update requested:', newTitle);
                        if (onUpdateProject && project?.id) {
                            await onUpdateProject(project.id, newTitle);
                        }
                    },
                    onDelete: () => {
                        console.warn('[MindMap] Project deletion requested - this should be handled at dashboard level');
                        // Project deletion should be handled by parent component
                        // For now, just log a warning
                    }
                },
                position: { x: 50, y: 200 },
                draggable: false,
            });

            const safeGroups = parsedGroups.filter(g => g?.id);
            const groupIdSet = new Set(safeGroups.map(g => g.id));
            const safeTasks = parsedTasks.filter(t => t?.id && t?.group_id && groupIdSet.has(t.group_id));

            // Build child tasks map
            const childTasksByParent: Record<string, typeof safeTasks> = {};
            for (const task of safeTasks) {
                if (task.parent_task_id) {
                    if (!childTasksByParent[task.parent_task_id]) childTasksByParent[task.parent_task_id] = [];
                    childTasksByParent[task.parent_task_id].push(task);
                }
            }
            for (const key of Object.keys(childTasksByParent)) {
                childTasksByParent[key].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
            }

            const taskById: Record<string, typeof safeTasks[number]> = {};
            for (const t of safeTasks) {
                taskById[t.id] = t;
            }

            const getChildrenLocal = (taskId: string) => childTasksByParent[taskId] ?? [];

            const getTaskEffectiveMinutes = (taskId: string): number => {
                const self = taskById[taskId];
                if (!self) return 0;
                const children = getChildrenLocal(taskId);
                if (children.length === 0) return self.estimated_time ?? 0;
                if ((self.estimated_time ?? 0) > 0) return self.estimated_time;
                return children.reduce((acc, c) => acc + getTaskEffectiveMinutes(c.id), 0);
            };

            const getTaskAutoMinutes = (taskId: string): number => {
                const children = getChildrenLocal(taskId);
                if (children.length === 0) return taskById[taskId]?.estimated_time ?? 0;
                // ignore self override: sum children's effective minutes
                return children.reduce((acc, c) => acc + getTaskEffectiveMinutes(c.id), 0);
            };

            // Root tasks (no parent)
            const rootTasks = safeTasks.filter(t => !t.parent_task_id).sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));

            const rootTasksByGroup: Record<string, typeof safeTasks> = {};
            for (const task of rootTasks) {
                if (!rootTasksByGroup[task.group_id]) rootTasksByGroup[task.group_id] = [];
                rootTasksByGroup[task.group_id].push(task);
            }

            // Recursive function to render tasks (max 6 levels)
            const MAX_DEPTH = 6;
            const BASE_X = 520;
            const X_STEP = 180;

            const renderTasksRecursively = (
                task: typeof safeTasks[0],
                parentId: string,
                depth: number,
                yOffsetRef: { current: number }
            ) => {
                if (depth >= MAX_DEPTH) return;

                const triggerEdit = shouldTriggerEdit(task.id);
                const taskHasChildren = (childTasksByParent[task.id]?.length ?? 0) > 0;
                const taskIsEstimatedOverride = taskHasChildren && ((task.estimated_time ?? 0) > 0);
                const taskAutoEstimatedMinutes = taskHasChildren ? getTaskAutoMinutes(task.id) : 0;
                const taskDisplayEstimatedMinutes = taskHasChildren
                    ? (taskIsEstimatedOverride ? (task.estimated_time ?? 0) : taskAutoEstimatedMinutes)
                    : (task.estimated_time ?? 0);
                const xPos = BASE_X + (depth * X_STEP);

                resultNodes.push({
                    id: task.id,
                    type: 'taskNode',
                    data: {
                        taskId: task.id, // カレンダードラッグ&ドロップ用
                        label: task.title ?? 'Task',
                        status: task.status ?? 'todo',
                        scheduled_at: task.scheduled_at,
                        google_event_id: task.google_event_id,
                        priority: task.priority,
                        estimatedDisplayMinutes: taskDisplayEstimatedMinutes,
                        estimatedAutoMinutes: taskAutoEstimatedMinutes,
                        estimatedIsOverride: taskIsEstimatedOverride,
                        isSelected: selectedNodeIds.has(task.id),
                        triggerEdit,
                        initialValue: '',
                        onSave: (t: string) => saveTaskTitle(task.id, t),
                        onUpdateDate: (d: string | null) => updateTaskScheduledAt(task.id, d),
                        onUpdatePriority: (p: number) => updateTaskPriority(task.id, p),
                        onUpdateEstimatedTime: (m: number) => updateTaskEstimatedTime(task.id, m),
                        onAddChild: () => addChildTask(task.id),
                        onAddSibling: () => addSiblingTask(task.id),
                        onDelete: () => deleteTask(task.id),
                        onNavigate: (direction: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight') => handleNavigate(task.id, direction),
                        hasChildren: taskHasChildren,
                        collapsed: collapsedTaskIds.has(task.id),
                        onToggleCollapse: () => toggleTaskCollapse(task.id),
                        isDropTarget: dropTargetNodeId === task.id,
                        displaySettings: displaySettings,
                        onDragStart: (taskId: string, title: string) => startDrag(taskId, title),
                        onDragEnd: () => endDrag(),
                    },
                    position: { x: xPos, y: yOffsetRef.current },
                    draggable: true,
                });
                resultEdges.push({
                    id: `e-${parentId}-${task.id}`,
                    source: parentId,
                    target: task.id,
                    type: 'smoothstep'
                });

                yOffsetRef.current += 40;

                // Render children recursively (skip if collapsed)
                if (!collapsedTaskIds.has(task.id)) {
                const children = childTasksByParent[task.id] ?? [];
                for (const child of children) {
                    renderTasksRecursively(child, task.id, depth + 1, yOffsetRef);
                    }
                }
            };

            let globalYOffset = 50;

            safeGroups.forEach((group) => {
                const groupY = globalYOffset;

                // Get all tasks in this group (for auto-complete logic)
                const groupTasks = safeTasks.filter(t => t.group_id === group.id);
                const groupRootTasks = rootTasksByGroup[group.id] ?? [];
                const groupAutoEstimatedMinutes = groupRootTasks.reduce((acc, t) => acc + getTaskEffectiveMinutes(t.id), 0);
                const groupIsEstimatedOverride = group.estimated_time != null;
                const groupDisplayEstimatedMinutes = groupIsEstimatedOverride
                    ? (group.estimated_time ?? 0)
                    : groupAutoEstimatedMinutes;

                resultNodes.push({
                    id: group.id,
                    type: 'groupNode',
                    data: {
                        label: group.title ?? 'Group',
                        priority: group.priority,
                        scheduled_at: group.scheduled_at,
                        estimatedDisplayMinutes: groupDisplayEstimatedMinutes,
                        estimatedAutoMinutes: groupAutoEstimatedMinutes,
                        estimatedIsOverride: groupIsEstimatedOverride,
                        tasks: groupTasks,
                        isSelected: selectedNodeIds.has(group.id),
                        onSave: (newTitle: string) => onUpdateGroupTitle?.(group.id, newTitle),
                        onUpdateGroup: (updates: any) => onUpdateGroup?.(group.id, updates),
                        onUpdateTask: onUpdateTask,
                        onDelete: () => onDeleteGroup?.(group.id),
                        hasChildren: hasGroupChildren(group.id),
                        collapsed: collapsedGroupIds.has(group.id),
                        onToggleCollapse: () => toggleGroupCollapse(group.id),
                        isDropTarget: dropTargetNodeId === group.id,
                        displaySettings: displaySettings,
                    },
                    position: { x: 300, y: groupY },
                    draggable: false,
                });
                resultEdges.push({ id: `e-proj-${group.id}`, source: 'project-root', target: group.id, type: 'smoothstep' });

                if (collapsedGroupIds.has(group.id)) {
                    globalYOffset = Math.max(globalYOffset + 80, groupY + 30);
                    return;
                }

                const yOffsetRef = { current: groupY - 20 };

                for (const task of groupRootTasks) {
                    renderTasksRecursively(task, group.id, 0, yOffsetRef);
                }

                globalYOffset = Math.max(globalYOffset + 80, yOffsetRef.current + 30);
            });
        } catch (err) {
            console.error('[MindMap] Error:', err);
        }

        // Apply dagre layout to get optimal positions
        const layouted = getLayoutedElements(resultNodes, resultEdges);
        if (Object.keys(dragPositions).length === 0) {
            return layouted;
        }

        return {
            nodes: layouted.nodes.map((node) =>
                dragPositions[node.id] ? { ...node, position: dragPositions[node.id] } : node
            ),
            edges: layouted.edges,
        };
    }, [
        projectId,
        groupsJson,
        tasksJson,
        project?.title,
        shouldTriggerEdit,
        saveTaskTitle,
        updateTaskScheduledAt,
        updateTaskPriority,
        updateTaskEstimatedTime,
        addChildTask,
        addSiblingTask,
        deleteTask,
        onUpdateGroupTitle,
        onDeleteGroup,
        hasChildren,
        hasGroupChildren,
        collapsedTaskIds,
        collapsedGroupIds,
        toggleTaskCollapse,
        toggleGroupCollapse,
        handleNavigate,
        dropTargetNodeId,
        dragPositions,
        displaySettings,
    ]);

    const handleNodeClick: NodeMouseHandler = useCallback((_, node) => {
        applySelection(new Set([node.id]), node.id, 'user');
    }, [applySelection]);
    const handlePaneClick = useCallback(() => {
        applySelection(new Set(), null, 'user');
        setDropTargetNodeId(null);
    }, [applySelection]);

    const handleSelectionChange = useCallback((params: { nodes: Node[]; edges: Edge[] }) => {
        // IMPORTANT: Do NOT feed selection back into the `nodes` prop via `selected: ...`
        // ReactFlow should own selection UI state. We only track selected IDs for bulk actions.
        const now = Date.now();
        const recentUser = now - lastUserActionAtRef.current < USER_ACTION_WINDOW_MS;
        if (!recentUser) {
            return;
        }
        const nextIds = new Set(params.nodes.map(n => n.id));
        setSelectedNodeIds((prev) => {
            if (prev.size === nextIds.size) {
                let same = true;
                for (const id of prev) {
                    if (!nextIds.has(id)) { same = false; break; }
                }
                if (same) return prev; // avoid re-render loops
            }
            return nextIds;
        });
        setSelectedNodeId(params.nodes[0]?.id ?? null);
        if (params.nodes.length === 0) {
            setDropTargetNodeId(null);
        }
    }, []);

    // Prevent DB refreshes from stealing focus
    useLayoutEffect(() => {
        if (!selectedNodeId) return;
        const now = Date.now();
        const recentUser = now - lastUserActionAtRef.current < USER_ACTION_WINDOW_MS;
        if (recentUser) return;
        if (typeof document !== 'undefined') {
            const activeTag = document.activeElement?.tagName;
            if (activeTag === 'INPUT') return;
        }
        focusNodeWithPollingV2(selectedNodeId, 200, false);
    }, [groupsJson, tasksJson, selectedNodeId, focusNodeWithPollingV2]);

    const handlePaneWheel = useCallback((event: React.WheelEvent) => {
        if (!event.ctrlKey && !event.metaKey) return;
        event.preventDefault();
        const current = reactFlow.getZoom();
        const delta = event.deltaY > 0 ? -0.08 : 0.08;
        const next = Math.min(1.5, Math.max(0.5, current + delta));
        reactFlow.zoomTo(next);
    }, [reactFlow]);

    const handleNodeDrag = useCallback((_: React.MouseEvent, node: Node) => {
        if (node.type !== 'taskNode') return;
        const target = getDropTargetNode(node);
        setDropTargetNodeId(target?.id ?? null);
        setDragPositions(prev => ({ ...prev, [node.id]: node.position }));
    }, [getDropTargetNode]);

    const handleNodeDragStop = useCallback((_: React.MouseEvent, node: Node) => {
        if (node.type !== 'taskNode') return;
        if (!onUpdateTask) return;

        const draggedTask = getTaskById(node.id);
        if (!draggedTask) return;

        const target = getDropTargetNode(node);
        setDropTargetNodeId(null);
        setDragPositions(prev => {
            if (!prev[node.id]) return prev;
            const next = { ...prev };
            delete next[node.id];
            return next;
        });
        if (!target) return;

        if (target.type === 'taskNode') {
            if (isDescendant(node.id, target.id)) return;
            const targetTask = getTaskById(target.id);
            if (!targetTask) return;

            const newParentId = targetTask.id;
            const newGroupId = targetTask.group_id;

            if (newParentId === draggedTask.parent_task_id && newGroupId === draggedTask.group_id) return;

            setCollapsedTaskIds(prev => {
                if (!prev.has(newParentId)) return prev;
                const next = new Set(prev);
                next.delete(newParentId);
                return next;
            });

            onUpdateTask(draggedTask.id, { parent_task_id: newParentId, group_id: newGroupId });
            return;
        }

        if (target.type === 'groupNode') {
            const newParentId = null;
            const newGroupId = target.id;

            if (newParentId === draggedTask.parent_task_id && newGroupId === draggedTask.group_id) return;

            onUpdateTask(draggedTask.id, { parent_task_id: newParentId, group_id: newGroupId });
        }
    }, [onUpdateTask, getTaskById, isDescendant, getDropTargetNode]);

    const handleContainerKeyDown = useCallback(async (event: React.KeyboardEvent) => {
        markUserAction();
        // Bulk delete: drag-selection -> Delete/Backspace removes selected tasks
        if ((event.key === 'Delete' || event.key === 'Backspace') && selectedNodeIds.size > 0) {
            const taskById = new Map(tasks.map(t => [t.id, t]));
            const selectedTaskIds = Array.from(selectedNodeIds).filter(id => taskById.has(id));
            if (selectedTaskIds.length === 0) return;

            event.preventDefault();

            const anyHasChildren = selectedTaskIds.some(id => hasChildren(id));
            if (typeof window === 'undefined') return;
            const confirmed = window.confirm(
                anyHasChildren
                    ? `選択した${selectedTaskIds.length}件のタスクを削除しますか？\n子タスクがあるものは子タスクも削除されます。`
                    : `選択した${selectedTaskIds.length}件のタスクを削除しますか？`
            );
            if (!confirmed) return;
            if (!onDeleteTask) return;

            const depth = (id: string) => {
                let d = 0;
                let cur = taskById.get(id);
                const visited = new Set<string>();
                while (cur?.parent_task_id && taskById.has(cur.parent_task_id) && !visited.has(cur.parent_task_id)) {
                    visited.add(cur.parent_task_id);
                    d++;
                    cur = taskById.get(cur.parent_task_id);
                    if (d > 20) break;
                }
                return d;
            };
            selectedTaskIds.sort((a, b) => depth(b) - depth(a));

            for (const id of selectedTaskIds) {
                try {
                    await onDeleteTask(id);
                } catch (e) {
                    console.warn('[MindMap] Bulk delete failed (ignored):', id, e);
                }
            }

            applySelection(new Set(), null, 'user');
            return;
        }

        if (!selectedNodeId) return;
        const isGroupNode = groups.some(g => g.id === selectedNodeId);
        if (!isGroupNode) return;

        if (event.key === 'Tab') {
            event.preventDefault();
            if (onCreateTask) {
                isCreatingNodeRef.current = true;
                await onCreateTask(selectedNodeId, "", null);
            }
        } else if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            // Create new group when Enter is pressed on a group node
            event.preventDefault();
            await createGroupAndFocus("New Group");
            }
    }, [selectedNodeId, selectedNodeIds, tasks, groups, hasChildren, onDeleteTask, onCreateTask, createGroupAndFocus, markUserAction]);

    return (
        <div
            className="w-full h-full bg-muted/5 relative outline-none"
            tabIndex={0}
            onKeyDown={handleContainerKeyDown}
            onMouseDown={markUserAction}
        >
            {/* MindMap Display Settings Button (Top Right) */}
            <div className="absolute top-3 right-3 z-10">
                <MindMapDisplaySettingsPopover
                    value={displaySettings}
                    onChange={setDisplaySettings}
                />
            </div>

            <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                defaultViewport={defaultViewport}
                onNodeClick={handleNodeClick}
                onNodeDrag={handleNodeDrag}
                onNodeDragStop={handleNodeDragStop}
                onPaneClick={handlePaneClick}
                onSelectionChange={handleSelectionChange}
                onWheel={handlePaneWheel}
                fitView
                fitViewOptions={{ padding: 0.2 }}
                deleteKeyCode={null}
                nodesConnectable={false}
                nodesDraggable={true}
                selectionOnDrag={true}
                selectionMode={SelectionMode.Partial}
                panOnDrag={[1, 2]}
                panOnScroll={true}
                zoomOnScroll={false}
                minZoom={0.5}
                maxZoom={1.5}
            >
                <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="rgba(255, 255, 255, 0.15)" />
                <Controls showInteractive={false} />
            </ReactFlow>

            {selectedNodeId && selectedNodeId !== 'project-root' && (
                <div className="absolute bottom-4 left-4 bg-card/90 backdrop-blur border rounded-lg p-2 text-xs text-muted-foreground shadow-lg">
                    <div className="flex gap-3">
                        <span><kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">Tab</kbd> 子追加</span>
                        <span><kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">Enter</kbd> 兄弟追加</span>
                        <span><kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">文字</kbd> 編集</span>
                        <span><kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">Del</kbd> 削除</span>
                    </div>
                </div>
            )}
        </div>
    );
}

export function MindMap(props: MindMapProps) {
    const [mounted, setMounted] = useState(false);
    useEffect(() => { setMounted(true); }, []);
    if (!mounted) return <div className="w-full h-full bg-muted/5 flex items-center justify-center text-muted-foreground">Loading...</div>;

    return (
        <MindMapErrorBoundary>
            <ReactFlowProvider>
                <MindMapContent {...props} />
            </ReactFlowProvider>
        </MindMapErrorBoundary>
    );
}
