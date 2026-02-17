"use client"

import React, { useMemo, useState, useEffect, useLayoutEffect, useCallback, useRef, Component, ErrorInfo, ReactNode } from 'react';
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
import { Task, Project } from "@/types/database";
import { cn } from "@/lib/utils";
import { Calendar as CalendarIcon, X, Target, Clock, GripVertical } from "lucide-react";
import { PriorityBadge, PriorityPopover, Priority, getPriorityIconColor } from "@/components/ui/priority-select";
import { EstimatedTimeBadge, EstimatedTimePopover, formatEstimatedTime } from "@/components/ui/estimated-time-select";
import { MindMapDisplaySettingsPopover, MindMapDisplaySettings, loadSettings } from "@/components/dashboard/mindmap-display-settings";
import { useDrag } from "@/contexts/DragContext";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { TaskCalendarSelect } from "@/components/tasks/task-calendar-select";
import { DateTimePicker } from "@/lib/dynamic-imports";
import { useMultiTaskCalendarSync } from "@/hooks/useMultiTaskCalendarSync";

// --- Dagre Layout Function ---
const dagreGraph = new dagre.graphlib.Graph();
dagreGraph.setDefaultEdgeLabel(() => ({}));

const NODE_WIDTH = 225; // 1.5x of 150
const NODE_HEIGHT = 40;
const PROJECT_NODE_WIDTH = 300; // 1.5x of 200
const PROJECT_NODE_HEIGHT = 60;

/** タイトル長とメタデータ有無からTaskNodeの高さを推定（dagre layout用） */
const estimateTaskNodeHeight = (title: string, hasInfoRow: boolean) => {
    const len = title?.length || 0;
    const charsPerLine = 22; // テキスト行にはアイコンがないので幅が広い
    const lines = Math.max(1, Math.ceil(len / charsPerLine));
    const textHeight = Math.max(30, 14 + lines * 16);
    const infoRowHeight = hasInfoRow ? 20 : 0;
    return textHeight + infoRowHeight;
};

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
        } else if (node.type === 'taskNode' && node.height) {
            height = node.height;
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
        } else if (node.type === 'taskNode' && node.height) {
            height = node.height;
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
        try {
            await saveValue();
        } catch (error) {
            console.error('[ProjectNode] Error saving on blur:', error);
        } finally {
            setIsEditing(false);
        }
    }, [saveValue]);

    return (
        <div
            ref={wrapperRef}
            className={cn(
                "w-[300px] px-4 py-3 rounded-xl bg-primary text-primary-foreground font-bold text-center shadow-lg transition-all outline-none min-h-[60px] flex items-center justify-center",
                selected && "ring-2 ring-white ring-offset-2 ring-offset-background",
                data?.isDropTarget && "ring-2 ring-sky-400 ring-offset-2 ring-offset-background bg-sky-500/10"
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

// TASK NODE
const TaskNode = React.memo(({ data, selected }: NodeProps) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const [isEditing, setIsEditing] = useState<boolean>(false);
    const [editValue, setEditValue] = useState<string>(data?.label ?? '');
    const [showCaret, setShowCaret] = useState<boolean>(false);
    const [showScheduleMenu, setShowScheduleMenu] = useState<boolean>(false);

    // Flag to prevent double-save when exiting via keyboard (Enter/Tab/Escape)
    const isSavingViaKeyboardRef = useRef(false);
    // Track whether node was already selected before a mousedown (for click-to-edit)
    const wasSelectedRef = useRef(false);
    // Guard: prevent focus operations from triggering onChange → edit mode
    const justFocusedRef = useRef(false);

    // Trigger edit from external
    useEffect(() => {
        if (data?.triggerEdit && !isEditing) {
            setIsEditing(true);
            setShowCaret(true);
            setEditValue(data?.initialValue ?? '');
        }
    }, [data?.triggerEdit, data?.initialValue, isEditing]);

    // Sync label (skip when triggerEdit is active to prevent overwriting empty edit value for new nodes)
    useEffect(() => {
        if (!isEditing && !data?.triggerEdit) {
            setEditValue(data?.label ?? '');
        }
    }, [data?.label, isEditing, data?.triggerEdit]);

    // Auto-focus input when editing (avoid rAF/select to keep IME stable)
    useEffect(() => {
        if (isEditing && inputRef.current && document.activeElement !== inputRef.current) {
            inputRef.current.focus();
        }
    }, [isEditing]);

    // Auto-focus input when selected so the first key goes to IME safely
    useLayoutEffect(() => {
        if (selected && inputRef.current) {
            justFocusedRef.current = true;
            inputRef.current.focus();
            // Don't hide caret if triggerEdit is pending (new node entering edit mode)
            if (!isEditing && !data?.triggerEdit) {
                setShowCaret(false);
            }
            requestAnimationFrame(() => {
                justFocusedRef.current = false;
            });
        }
    }, [selected, isEditing, data?.triggerEdit]);

    // テキストが長い場合にtextareaを自動リサイズ
    useEffect(() => {
        const textarea = inputRef.current;
        if (textarea) {
            requestAnimationFrame(() => {
                textarea.style.height = 'auto';
                textarea.style.height = `${textarea.scrollHeight}px`;
            });
        }
    }, [editValue]);

    const saveValue = useCallback(async () => {
        const trimmed = editValue.trim() || 'Task';

        if (trimmed !== data?.label && data?.onSave) {
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
            // Selection Mode: XMind-style keyboard shortcuts
            if (e.key === 'Tab') {
                e.preventDefault();
                if (e.shiftKey) {
                    // Shift+Tab → promote (move to parent's sibling level)
                    if (data?.onPromote) await data.onPromote();
                } else {
                    if (data?.onAddChild) await data.onAddChild();
                }
                return;
            }
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                // Enter in selection mode → create sibling task
                e.preventDefault();
                if (data?.onAddSibling) await data.onAddSibling();
                return;
            }
            if (e.key === 'Escape') {
                e.preventDefault();
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
            if (e.key === 'F2' || e.key === ' ') {
                // F2 / Space → edit mode with cursor at end
                e.preventDefault();
                setIsEditing(true);
                setShowCaret(true);
                requestAnimationFrame(() => {
                    if (inputRef.current) {
                        const len = inputRef.current.value.length;
                        inputRef.current.setSelectionRange(len, len);
                    }
                });
                return;
            }
            if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                // Typing → overwrite mode (select all text, new input replaces)
                setIsEditing(true);
                setShowCaret(true);
                if (inputRef.current) {
                    inputRef.current.setSelectionRange(0, inputRef.current.value.length);
                }
                return;
            }
        }

        // Edit Mode key handlers
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            // Edit Mode + Enter = Save and return to selection mode (XMind 2-stage)
            e.preventDefault();
            e.stopPropagation();

            isSavingViaKeyboardRef.current = true;

            await saveValue();
            setIsEditing(false);
            setShowCaret(false);

            setTimeout(() => { isSavingViaKeyboardRef.current = false; }, 0);
        } else if (e.key === 'Tab') {
            // Edit Mode + Tab = Save + Create Child
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
            // Edit Mode + Escape = Cancel and return to selection mode
            e.preventDefault();
            isSavingViaKeyboardRef.current = true;
            setEditValue(data?.label ?? '');
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
            if (e.shiftKey) {
                // Shift+Tab → promote (move to parent's sibling level)
                if (data?.onPromote) await data.onPromote();
            } else {
                if (data?.onAddChild) await data.onAddChild();
            }
        } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (data?.onAddSibling) await data.onAddSibling();
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            if (data?.onDelete) await data.onDelete();
        } else if (e.key === 'F2') {
            e.preventDefault();
            setIsEditing(true);
            setShowCaret(true);
            setEditValue(data?.label ?? '');
        } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
            e.preventDefault();
            if (data?.onNavigate) {
                data.onNavigate(e.key as 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight');
            }
        } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            // Typing → overwrite mode (IME-friendly)
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
        setIsEditing(true);
        setShowCaret(true);
        setEditValue(data?.label ?? '');
        requestAnimationFrame(() => {
            const len = inputRef.current?.value.length ?? 0;
            inputRef.current?.setSelectionRange(len, len);
        });
    }, [data?.label]);

    const handleInputBlur = useCallback(async () => {
        if (!isEditing) return;
        // Skip if exiting via keyboard (Enter/Tab/Escape already handled save)
        if (isSavingViaKeyboardRef.current) {
            return;
        }

        try {
            await saveValue();
        } catch (error) {
            console.error('[TaskNode] Error saving on blur:', error);
        } finally {
            setIsEditing(false);
            setShowCaret(false);
        }
    }, [saveValue]);

    // Track selection state before mousedown for click-to-edit detection
    const handleWrapperMouseDown = useCallback((e: React.MouseEvent) => {
        // Record whether node was already selected before this click
        wasSelectedRef.current = !!selected;
        if (!isEditing) {
            setShowCaret(false);
            inputRef.current?.focus();
        }
    }, [isEditing, selected]);

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

        }
    }, [isEditing, data, editValue])

    // ドラッグ終了時の処理
    const handleDragEnd = useCallback(() => {
        // DragContextに通知（data経由で呼び出し）
        ;(data as any)?.onDragEnd?.()
    }, [])

    const settings = data?.displaySettings || { showStatus: true, showPriority: true, showScheduledAt: true, showEstimatedTime: true, showProgress: true, showCollapseButton: true };

    const hasEstimatedTime = settings.showEstimatedTime && (data?.estimatedDisplayMinutes ?? 0) > 0;
    const hasPriority = settings.showPriority && data?.priority != null;
    const hasScheduledAt = settings.showScheduledAt && !!data?.scheduled_at;
    const hasInfoRow = hasEstimatedTime || hasPriority || hasScheduledAt;

    return (
        <div
            ref={wrapperRef}
            className={cn(
                "relative w-[225px] px-2 py-1.5 rounded bg-background border text-xs shadow-sm flex flex-col gap-0.5 transition-all outline-none min-h-[30px] group",
                !isEditing && "cursor-grab active:cursor-grabbing",
                (selected || data?.isSelected) && "ring-2 ring-white ring-offset-2 ring-offset-background",
                data?.isDropTarget && data?.dropPosition === 'as-child' && "ring-2 ring-emerald-400 ring-offset-1 ring-offset-background border-emerald-400 bg-emerald-500/10",
            )}
            tabIndex={0}
            draggable={!isEditing}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onKeyDown={handleWrapperKeyDown}
            onDoubleClick={handleDoubleClick}
            onMouseDown={handleWrapperMouseDown}
        >
            {/* Drop position indicators */}
            {data?.isDropTarget && data?.dropPosition === 'above' && (
                <div className="absolute -top-1 left-0 right-0 h-0.5 bg-blue-400 rounded-full shadow-[0_0_6px_rgba(96,165,250,0.6)]" />
            )}
            {data?.isDropTarget && data?.dropPosition === 'below' && (
                <div className="absolute -bottom-1 left-0 right-0 h-0.5 bg-blue-400 rounded-full shadow-[0_0_6px_rgba(96,165,250,0.6)]" />
            )}
            {/* Row 1: テキスト + メニュー */}
            <div className="flex items-center gap-1 w-full">
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

                <GripVertical className="w-3 h-3 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors shrink-0" />

                {settings.showStatus && (
                    <div className={cn("w-1.5 h-1.5 rounded-full shrink-0", data?.status === 'done' ? "bg-primary" : "bg-muted-foreground/30")} />
                )}

                {/* Habit Icon Badge */}
                {data?.is_habit && data?.habit_icon && (
                    <span className="text-sm shrink-0" title="習慣">
                        {data.habit_icon}
                    </span>
                )}

                <textarea
                    ref={inputRef as any}
                    rows={1}
                    value={editValue}
                    onChange={(e) => {
                        if (!isEditing) {
                            if (justFocusedRef.current) return;
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
                        if (isEditing) {
                            e.stopPropagation();
                        } else if (wasSelectedRef.current) {
                            e.stopPropagation();
                            setIsEditing(true);
                            setShowCaret(true);
                        }
                    }}
                    onCompositionStart={() => {
                        if (!isEditing) {
                            setIsEditing(true);
                            setShowCaret(true);
                        }
                    }}
                    className={cn(
                        "nodrag nopan flex-1 bg-transparent border-none text-xs focus:outline-none focus:ring-0 px-0.5 min-w-0 resize-none overflow-hidden whitespace-pre-wrap break-words",
                        !showCaret && "caret-transparent",
                        !showCaret && !selected && "pointer-events-none select-none",
                        data?.status === 'done' && "line-through text-muted-foreground"
                    )}
                />

                {/* Calendar sync indicator */}
                {data?.google_event_id && (
                    <div className="nodrag nopan shrink-0" title="Googleカレンダーと同期済み">
                        <CalendarIcon className="w-3 h-3 text-blue-500" />
                    </div>
                )}

                {/* Quick Action Menu */}
                <DropdownMenu open={showScheduleMenu} onOpenChange={setShowScheduleMenu}>
                    <DropdownMenuTrigger asChild>
                        <button
                            type="button"
                            className="nodrag nopan w-5 h-5 text-muted-foreground/40 hover:text-muted-foreground hover:bg-muted/30 transition-all flex items-center justify-center rounded shrink-0 ml-0.5"
                            onClick={(e) => e.stopPropagation()}
                            title="タスク詳細設定"
                        >
                            <svg className="w-3 h-3" viewBox="0 0 12 12" fill="currentColor">
                                <rect x="1" y="2" width="10" height="1.2" rx="0.6"/>
                                <rect x="1" y="5.4" width="10" height="1.2" rx="0.6"/>
                                <rect x="1" y="8.8" width="10" height="1.2" rx="0.6"/>
                            </svg>
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                        {/* Priority */}
                        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">優先度</div>
                        <div className="px-2 pb-2">
                            <PriorityPopover
                                value={(data?.priority ?? 3) as Priority}
                                onChange={(priority) => data?.onUpdatePriority?.(priority)}
                                trigger={
                                    <Button variant="outline" size="sm" className="w-full justify-start text-xs h-8">
                                        <Target className="w-3 h-3 mr-2" style={{ color: getPriorityIconColor((data?.priority ?? 3) as Priority) }} />
                                        {data?.priority != null ? (
                                            <PriorityBadge value={data.priority as Priority} />
                                        ) : (
                                            <span className="text-muted-foreground">優先度を設定</span>
                                        )}
                                    </Button>
                                }
                            />
                        </div>

                        {/* Estimated Time */}
                        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">所要時間</div>
                        <div className="px-2 pb-2">
                            <EstimatedTimePopover
                                valueMinutes={data?.estimatedDisplayMinutes ?? 0}
                                onChangeMinutes={(minutes) => data?.onUpdateEstimatedTime?.(minutes)}
                                isOverridden={!!data?.estimatedIsOverride}
                                autoMinutes={data?.estimatedAutoMinutes}
                                onResetAuto={data?.hasChildren ? () => data?.onUpdateEstimatedTime?.(0) : undefined}
                                trigger={
                                    <Button variant="outline" size="sm" className="w-full justify-start text-xs h-8">
                                        <Clock className="w-3 h-3 mr-2" />
                                        {(data?.estimatedDisplayMinutes ?? 0) > 0 ? (
                                            <EstimatedTimeBadge minutes={data.estimatedDisplayMinutes} />
                                        ) : (
                                            <span className="text-muted-foreground">所要時間を設定</span>
                                        )}
                                    </Button>
                                }
                            />
                        </div>

                        {/* Scheduled At */}
                        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">スケジュール</div>
                        <div className="px-2 pb-2">
                            <DateTimePicker
                                date={data?.scheduled_at ? new Date(data.scheduled_at) : undefined}
                                setDate={(date) => {
                                    data?.onUpdateScheduledAt?.(date ? date.toISOString() : null);
                                }}
                                trigger={
                                    <Button variant="outline" size="sm" className="w-full justify-start text-xs h-8">
                                        <CalendarIcon className="w-3 h-3 mr-2" />
                                        {data?.scheduled_at ? (
                                            <span>{new Date(data.scheduled_at).toLocaleString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                                        ) : (
                                            <span className="text-muted-foreground">日時を設定</span>
                                        )}
                                    </Button>
                                }
                            />
                        </div>

                        {/* Calendar Selection */}
                        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">カレンダー</div>
                        <div className="px-2 pb-2">
                            <TaskCalendarSelect
                                value={data?.calendar_id || null}
                                onChange={(calendarId) => {
                                    data?.onUpdateCalendar?.(calendarId);
                                }}
                                className="w-full h-8 justify-start"
                            />
                        </div>

                        {/* Habit Settings */}
                        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">習慣</div>
                        <div className="px-2 pb-2 space-y-2">
                            {/* Habit Toggle */}
                            <div className="flex items-center justify-between">
                                <span className="text-xs">習慣として設定</span>
                                <Switch
                                    checked={data?.is_habit ?? false}
                                    onCheckedChange={(checked) => {
                                        data?.onUpdateHabit?.({ is_habit: checked });
                                    }}
                                />
                            </div>

                            {/* Habit Frequency (only show when is_habit is true) */}
                            {data?.is_habit && (
                                <>
                                    <div className="text-xs text-muted-foreground">頻度</div>
                                    <div className="flex gap-1">
                                        <Button
                                            variant={data?.habit_frequency === 'daily' ? 'default' : 'outline'}
                                            size="sm"
                                            className="flex-1 h-7 text-xs"
                                            onClick={() => data?.onUpdateHabit?.({ habit_frequency: 'daily' })}
                                        >
                                            毎日
                                        </Button>
                                        <Button
                                            variant={data?.habit_frequency === 'weekdays' ? 'default' : 'outline'}
                                            size="sm"
                                            className="flex-1 h-7 text-xs"
                                            onClick={() => data?.onUpdateHabit?.({ habit_frequency: 'weekdays' })}
                                        >
                                            平日
                                        </Button>
                                        <Button
                                            variant={data?.habit_frequency === 'custom' ? 'default' : 'outline'}
                                            size="sm"
                                            className="flex-1 h-7 text-xs"
                                            onClick={() => data?.onUpdateHabit?.({ habit_frequency: 'custom' })}
                                        >
                                            カスタム
                                        </Button>
                                    </div>

                                    {/* Habit Icon Selection */}
                                    <div className="text-xs text-muted-foreground">アイコン</div>
                                    <div className="grid grid-cols-6 gap-1">
                                        {['🏃', '💪', '📚', '🧘', '🎯', '✍️', '🌱', '💧', '🍎', '😴', '🧹', '💰'].map((icon) => (
                                            <button
                                                key={icon}
                                                type="button"
                                                className={cn(
                                                    "h-8 rounded text-lg hover:bg-muted transition-colors",
                                                    data?.habit_icon === icon ? "bg-primary/20 ring-1 ring-primary" : ""
                                                )}
                                                onClick={() => data?.onUpdateHabit?.({ habit_icon: icon })}
                                            >
                                                {icon}
                                            </button>
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>

            {/* Row 2: メタデータ（値が設定されている場合のみ表示） */}
            {hasInfoRow && (
                <div className="nodrag nopan flex items-center gap-1.5 pl-5 flex-wrap">
                    {/* Estimated Time Badge */}
                    {hasEstimatedTime && (
                        <>
                            <EstimatedTimePopover
                                valueMinutes={data.estimatedDisplayMinutes}
                                onChangeMinutes={(minutes) => data?.onUpdateEstimatedTime?.(minutes)}
                                isOverridden={!!data?.estimatedIsOverride}
                                autoMinutes={data?.estimatedAutoMinutes}
                                onResetAuto={data?.hasChildren ? () => data?.onUpdateEstimatedTime?.(0) : undefined}
                                trigger={
                                    <span className="cursor-pointer" onClick={(e) => e.stopPropagation()}>
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
                    )}

                    {/* Priority Badge */}
                    {hasPriority && (
                        <>
                            <PriorityPopover
                                value={data.priority as Priority}
                                onChange={(priority) => data?.onUpdatePriority?.(priority)}
                                trigger={
                                    <span className="cursor-pointer">
                                        <PriorityBadge value={data.priority as Priority} />
                                    </span>
                                }
                            />
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
                    )}

                    {/* DateTime（右寄せ） */}
                    {hasScheduledAt && (
                        <div className="ml-auto">
                            <DateTimePicker
                                date={new Date(data.scheduled_at)}
                                setDate={(date) => data?.onUpdateDate?.(date ? date.toISOString() : null)}
                                trigger={
                                    <div className="flex items-center gap-1">
                                        <span className="text-[10px] text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer">
                                            {new Date(data.scheduled_at).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                        </span>
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
                                }
                            />
                        </div>
                    )}
                </div>
            )}

            <Handle type="source" position={Position.Right} className="!bg-muted-foreground/50 !w-1 !h-1" />
        </div>
    );
});
TaskNode.displayName = 'TaskNode';

const nodeTypes = { projectNode: ProjectNode, taskNode: TaskNode };
const defaultViewport = { x: 0, y: 0, zoom: 0.8 };

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
}

function MindMapContent({ project, groups, tasks, onCreateGroup, onDeleteGroup, onReorderGroup, onUpdateProject, onCreateTask, onUpdateTask, onDeleteTask, onBulkDelete, onReorderTask, onRefreshCalendar }: MindMapProps) {
    const reactFlow = useReactFlow();
    const projectId = project?.id ?? '';
    const USER_ACTION_WINDOW_MS = 800;

    // DragContext - MindMapContentで使用してTaskNodeに渡す
    const { startDrag, endDrag } = useDrag()

    // MindMap Display Settings
    const [displaySettings, setDisplaySettings] = useState<MindMapDisplaySettings>(() => loadSettings());

    // カレンダー同期（マインドマップのタスク全体）
    useMultiTaskCalendarSync({
        tasks: [...groups, ...tasks], // ルートタスク + 子タスク
        onRefreshCalendar,
        onUpdateTask,
    });
    const groupsJson = JSON.stringify(groups?.map(g => ({
        id: g?.id,
        title: g?.title,
        status: g?.status ?? 'todo',
        parent_task_id: g?.parent_task_id ?? null,
        order_index: g?.order_index ?? 0,
        created_at: g?.created_at,
        priority: g?.priority ?? null,
        scheduled_at: g?.scheduled_at ?? null,
        estimated_time: g?.estimated_time ?? null,
        calendar_id: g?.calendar_id ?? null,
        google_event_id: g?.google_event_id ?? null,
    })) ?? []);
    const tasksJson = JSON.stringify(tasks?.map(t => ({
        id: t?.id,
        title: t?.title,
        status: t?.status,
        // 新スキーマ: group_id は不要（parent_task_id のみ使用）
        parent_task_id: t?.parent_task_id,
        order_index: t?.order_index,
        created_at: t?.created_at,
        scheduled_at: t?.scheduled_at,
        google_event_id: t?.google_event_id,
        calendar_id: t?.calendar_id,
        priority: (t as any)?.priority, // Include priority (no default value)
        estimated_time: t?.estimated_time ?? 0,
    })) ?? []);

    // STATE
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
    const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
    const [pendingEditNodeId, setPendingEditNodeId] = useState<string | null>(null);
    const [collapsedTaskIds, setCollapsedTaskIds] = useState<Set<string>>(new Set());
    const dropInfoRef = useRef<{ nodeId: string; position: 'above' | 'below' | 'as-child' } | null>(null);
    const dragPositionsRef = useRef<Record<string, { x: number; y: number }>>({});
    const lastUserActionAtRef = useRef<number>(0);
    const selectedNodeIdRef = useRef<string | null>(null);
    const isDraggingRef = useRef(false);
    // Hold latest callbacks in a ref so they don't invalidate useMemos
    const callbacksRef = useRef<Record<string, any>>({});
    const markUserAction = useCallback(() => {
        lastUserActionAtRef.current = Date.now();
    }, []);

    const applySelection = useCallback((ids: Set<string>, primaryId: string | null, source: 'user' | 'system') => {
        if (source === 'user') {
            markUserAction();
        }
        setSelectedNodeIds(ids);
        setSelectedNodeId(primaryId);
        // CRITICAL: Sync ref immediately so focusNodeWithPollingV2 doesn't cancel itself
        selectedNodeIdRef.current = primaryId;

        // Sync ReactFlow's internal selection state immediately
        // (the `nodes` prop will also update on next render, but this ensures no gap)
        reactFlow.setNodes((nodes) =>
            nodes.map((node) => ({
                ...node,
                selected: ids.has(node.id),
            }))
        );
    }, [markUserAction, reactFlow]);

    // HELPER: Find the editable element (textarea or input) inside a node
    const findEditableElement = useCallback((nodeElement: Element): HTMLTextAreaElement | HTMLInputElement | null => {
        return (nodeElement.querySelector('textarea') ?? nodeElement.querySelector('input')) as HTMLTextAreaElement | HTMLInputElement | null;
    }, []);

    // HELPER: Persistent DOM polling using setInterval
    // Ensures focus is captured even if React renders are delayed
    // CRITICAL: Waits for input element to appear (new nodes need time to enter edit mode)
    // RACE CONDITION FIX: Cancels previous focus operation when new one starts
    const activeTimerRef = useRef<NodeJS.Timeout | null>(null);

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
            const currentActive = document.activeElement as HTMLElement;
            if (currentActive && (currentActive.tagName === 'INPUT' || currentActive.tagName === 'TEXTAREA')) {
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

            let nodeElement = document.querySelector(`.react-flow__node[data-id="${targetId}"]`);
            if (!nodeElement) nodeElement = document.querySelector(`[data-id="${targetId}"]`);

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
            }, 300);
            return () => clearTimeout(timer);
        }
    }, [pendingEditNodeId]);

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

    const getDropInfo = useCallback((dragged: Node): { node: Node; position: 'above' | 'below' | 'as-child' } | null => {
        const getNodeRect = (n: Node) => {
            const position = n.positionAbsolute ?? n.position;
            const width = n.width ?? (n.type === 'projectNode' ? PROJECT_NODE_WIDTH : NODE_WIDTH);
            const height = n.height ?? (n.type === 'projectNode' ? PROJECT_NODE_HEIGHT : NODE_HEIGHT);
            return {
                left: position.x,
                top: position.y,
                right: position.x + width,
                bottom: position.y + height,
                centerX: position.x + width / 2,
                centerY: position.y + height / 2,
                width,
                height,
            };
        };

        const draggedRect = getNodeRect(dragged);
        const candidates = reactFlow
            .getNodes()
            .filter(n => n.id !== dragged.id);

        // 純粋な距離ベース: 最も近いノードをドロップターゲットにする
        // （overlap判定だとY方向に離れたグループ間の移動ができない）
        // 500px: 2階層目(x=700)からグループ(x≈300)への距離をカバー
        const MAX_DIST = 500;
        let best: { node: Node; dist: number; position: 'above' | 'below' | 'as-child' } | null = null;

        for (const candidate of candidates) {
            const rect = getNodeRect(candidate);

            // ドラッグノードの中心からターゲットの矩形までの最短距離を計算
            const clampedX = Math.max(rect.left, Math.min(draggedRect.centerX, rect.right));
            const clampedY = Math.max(rect.top, Math.min(draggedRect.centerY, rect.bottom));
            const dist = Math.hypot(clampedX - draggedRect.centerX, clampedY - draggedRect.centerY);

            if (dist > MAX_DIST) continue;

            // ドロップ位置を判定
            let position: 'above' | 'below' | 'as-child';
            if (candidate.type === 'projectNode') {
                position = 'as-child';
            } else {
                const relativeY = draggedRect.centerY - rect.top;
                const relativeX = draggedRect.centerX - rect.centerX;

                // LR layout: as-child は、ドラッグ位置がターゲットの右寄りの場合のみ
                // （左 or 同じ位置 = 兄弟として above/below）
                if (relativeX > rect.width * 0.3) {
                    // ターゲットより右にいる → as-child 可能
                    if (relativeY < rect.height * 0.33) {
                        position = 'above';
                    } else if (relativeY > rect.height * 0.67) {
                        position = 'below';
                    } else {
                        position = 'as-child';
                    }
                } else {
                    // 同じX位置 or 左 → 兄弟のみ（above/below）
                    position = relativeY < rect.height * 0.5 ? 'above' : 'below';
                }
            }

            if (!best || dist < best.dist) {
                best = { node: candidate, dist, position };
            }
        }

        return best ? { node: best.node, position: best.position } : null;
    }, [reactFlow]);
    const createRootTaskAndFocus = useCallback(async (title: string) => {
        if (!onCreateGroup) return;
        const newTask = await onCreateGroup(title);
        if (newTask?.id) {
            setPendingEditNodeId(newTask.id);
            applySelection(new Set([newTask.id]), newTask.id, 'user');
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
            applySelection(new Set([newTask.id]), newTask.id, 'user');
            focusNodeWithPollingV2(newTask.id);
        }
    }, [onCreateTask, focusNodeWithPollingV2, applySelection]);

    // Add sibling task（統一版：ルートタスクなら新しいルートを作成）
    const addSiblingTask = useCallback(async (taskId: string) => {
        // ルートタスクの場合 → 新しいルートタスクを作成
        const isRootTask = groups.some(g => g.id === taskId);
        if (isRootTask) {
            await createRootTaskAndFocus("New Task");
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
            applySelection(new Set([newTask.id]), newTask.id, 'user');
            focusNodeWithPollingV2(newTask.id);
        }
    }, [groups, getTaskById, onCreateTask, createRootTaskAndFocus, focusNodeWithPollingV2, applySelection]);

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
        applySelection(nextFocusId ? new Set([nextFocusId]) : new Set(), nextFocusId, 'user');
        if (nextFocusId) {
            focusNodeWithPollingV2(nextFocusId, 300, false);
        }
    }, [hasChildren, calculateNextFocus, onDeleteTask, applySelection, focusNodeWithPollingV2]);

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
            applySelection(new Set([targetId]), targetId, 'user');
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

    const shouldTriggerEdit = useCallback((taskId: string) => {
        return pendingEditNodeId === taskId;
    }, [pendingEditNodeId]);

    // Keep callbacksRef in sync (avoids putting callbacks in useMemo deps)
    callbacksRef.current = {
        saveTaskTitle, addChildTask, addSiblingTask, deleteTask,
        handleNavigate, promoteTask, updateTaskScheduledAt,
        updateTaskPriority, updateTaskEstimatedTime,
        onUpdateTask, toggleTaskCollapse, startDrag, endDrag,
        createRootTaskAndFocus, onUpdateProject,
    };

    // ===== STEP 1: Structure + dagre layout (expensive, only on data/collapse change) =====
    type ParsedTask = {
        id: string; title: string; status: string;
        parent_task_id: string | null; order_index: number;
        created_at: string; priority: number | null;
        scheduled_at: string | null; estimated_time: number | null;
        calendar_id: string | null; google_event_id: string | null;
        is_habit: boolean; habit_frequency: string | null; habit_icon: string | null;
    };

    const { structureNodes, edges, taskDataMap } = useMemo(() => {
        const resultNodes: Node[] = [];
        const resultEdges: Edge[] = [];
        const dataMap = new Map<string, ParsedTask & { hasChildren: boolean; estimatedDisplayMinutes: number; estimatedAutoMinutes: number; estimatedIsOverride: boolean }>();

        if (!projectId) return { structureNodes: resultNodes, edges: resultEdges, taskDataMap: dataMap };

        try {
            const parsedGroups = JSON.parse(groupsJson) as ParsedTask[];
            const parsedTasks = JSON.parse(tasksJson) as ParsedTask[];

            resultNodes.push({
                id: 'project-root',
                type: 'projectNode',
                data: { label: project?.title ?? 'Project' },
                position: { x: 50, y: 200 },
                draggable: false,
            });

            const safeGroups = parsedGroups.filter(g => g?.id);
            const safeTasks = parsedTasks.filter(t => t?.id);

            const taskById: Record<string, ParsedTask> = {};
            for (const g of safeGroups) { taskById[g.id] = g; }
            for (const t of safeTasks) { taskById[t.id] = t; }

            const childTasksByParent: Record<string, ParsedTask[]> = {};
            for (const task of safeTasks) {
                if (task.parent_task_id) {
                    if (!childTasksByParent[task.parent_task_id]) childTasksByParent[task.parent_task_id] = [];
                    childTasksByParent[task.parent_task_id].push(task);
                }
            }
            for (const key of Object.keys(childTasksByParent)) {
                childTasksByParent[key].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
            }

            const getChildrenLocal = (taskId: string) => childTasksByParent[taskId] ?? [];

            const getTaskEffectiveMinutes = (taskId: string): number => {
                const self = taskById[taskId];
                if (!self) return 0;
                const children = getChildrenLocal(taskId);
                if (children.length === 0) return self.estimated_time ?? 0;
                if ((self.estimated_time ?? 0) > 0) return self.estimated_time!;
                return children.reduce((acc, c) => acc + getTaskEffectiveMinutes(c.id), 0);
            };

            const getTaskAutoMinutes = (taskId: string): number => {
                const children = getChildrenLocal(taskId);
                if (children.length === 0) return taskById[taskId]?.estimated_time ?? 0;
                return children.reduce((acc, c) => acc + getTaskEffectiveMinutes(c.id), 0);
            };

            const MAX_DEPTH = 7;
            const BASE_X = 300;
            const X_STEP = 180;

            const renderTasksRecursively = (
                task: ParsedTask,
                parentId: string,
                depth: number,
                yOffsetRef: { current: number }
            ) => {
                if (depth >= MAX_DEPTH) return;

                const taskHasChildren = (childTasksByParent[task.id]?.length ?? 0) > 0;
                const taskIsEstimatedOverride = taskHasChildren && ((task.estimated_time ?? 0) > 0);
                const taskAutoEstimatedMinutes = taskHasChildren ? getTaskAutoMinutes(task.id) : 0;
                const taskDisplayEstimatedMinutes = taskHasChildren
                    ? (taskIsEstimatedOverride ? (task.estimated_time ?? 0) : taskAutoEstimatedMinutes)
                    : (task.estimated_time ?? 0);
                const xPos = BASE_X + (depth * X_STEP);

                const taskHasInfo = (taskDisplayEstimatedMinutes > 0) || task.priority != null || !!task.scheduled_at;
                const taskNodeHeight = estimateTaskNodeHeight(task.title || '', taskHasInfo);

                // Store computed data for data injection pass
                dataMap.set(task.id, {
                    ...task,
                    hasChildren: taskHasChildren,
                    estimatedDisplayMinutes: taskDisplayEstimatedMinutes,
                    estimatedAutoMinutes: taskAutoEstimatedMinutes,
                    estimatedIsOverride: taskIsEstimatedOverride,
                });

                resultNodes.push({
                    id: task.id,
                    type: 'taskNode',
                    height: taskNodeHeight,
                    data: {
                        taskId: task.id,
                        label: task.title ?? 'Task',
                        status: task.status ?? 'todo',
                        scheduled_at: task.scheduled_at,
                        google_event_id: task.google_event_id,
                        calendar_id: task.calendar_id,
                        priority: task.priority,
                        estimatedDisplayMinutes: taskDisplayEstimatedMinutes,
                        estimatedAutoMinutes: taskAutoEstimatedMinutes,
                        estimatedIsOverride: taskIsEstimatedOverride,
                        hasChildren: taskHasChildren,
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

                if (!collapsedTaskIds.has(task.id)) {
                    const children = childTasksByParent[task.id] ?? [];
                    for (const child of children) {
                        renderTasksRecursively(child, task.id, depth + 1, yOffsetRef);
                    }
                }
            };

            const sortedRootTasks = [...safeGroups].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
            let globalYOffset = 50;

            for (const rootTask of sortedRootTasks) {
                const yOffsetRef = { current: globalYOffset };
                renderTasksRecursively(rootTask, 'project-root', 0, yOffsetRef);
                globalYOffset = Math.max(globalYOffset + 80, yOffsetRef.current + 30);
            }
        } catch (err) {
            console.error('[MindMap] Error:', err);
        }

        const { nodes: layouted, edges: layoutedEdges } = getLayoutedElements(resultNodes, resultEdges);
        return { structureNodes: layouted, edges: layoutedEdges, taskDataMap: dataMap };
    }, [projectId, groupsJson, tasksJson, project?.title, collapsedTaskIds]);

    // ===== STEP 2: Inject interactive data (cheap, runs on selection/edit/settings change) =====
    const layoutNodes = useMemo(() => {
        const cbs = callbacksRef.current;
        return structureNodes.map(node => {
            if (node.type === 'projectNode') {
                return {
                    ...node,
                    selected: selectedNodeIds.has('project-root'),
                    data: {
                        ...node.data,
                        label: project?.title ?? 'Project',
                        onAddChild: () => cbs.createRootTaskAndFocus("New Task"),
                        isSelected: selectedNodeIds.has('project-root'),
                        isDropTarget: false,
                        dropPosition: null,
                        onSave: async (newTitle: string) => {
                            if (cbs.onUpdateProject && project?.id) {
                                await cbs.onUpdateProject(project.id, newTitle);
                            }
                        },
                        onDelete: () => {}
                    },
                };
            }

            // TaskNode
            const taskId = node.id;
            const taskData = taskDataMap.get(taskId);
            const triggerEdit = pendingEditNodeId === taskId;

            return {
                ...node,
                selected: selectedNodeIds.has(taskId),
                data: {
                    ...node.data,
                    isSelected: selectedNodeIds.has(taskId),
                    triggerEdit,
                    initialValue: '',
                    collapsed: collapsedTaskIds.has(taskId),
                    isDropTarget: false,
                    dropPosition: null,
                    displaySettings: displaySettings,
                    onSave: (t: string) => cbs.saveTaskTitle(taskId, t),
                    onUpdateDate: (d: string | null) => cbs.updateTaskScheduledAt(taskId, d),
                    onUpdateScheduledAt: (d: string) => cbs.updateTaskScheduledAt(taskId, d),
                    onUpdatePriority: (p: number) => cbs.updateTaskPriority(taskId, p),
                    onUpdateEstimatedTime: (m: number) => cbs.updateTaskEstimatedTime(taskId, m),
                    onUpdateCalendar: (calendarId: string | null) => cbs.onUpdateTask?.(taskId, { calendar_id: calendarId }),
                    is_habit: taskData?.is_habit ?? false,
                    habit_frequency: taskData?.habit_frequency ?? null,
                    habit_icon: taskData?.habit_icon ?? null,
                    onUpdateHabit: (habitUpdates: Partial<Pick<ParsedTask, 'is_habit' | 'habit_frequency' | 'habit_icon'>>) => cbs.onUpdateTask?.(taskId, habitUpdates),
                    onAddChild: () => cbs.addChildTask(taskId),
                    onAddSibling: () => cbs.addSiblingTask(taskId),
                    onPromote: () => cbs.promoteTask(taskId),
                    onDelete: () => cbs.deleteTask(taskId),
                    onNavigate: (direction: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight') => cbs.handleNavigate(taskId, direction),
                    onToggleCollapse: () => cbs.toggleTaskCollapse(taskId),
                    onDragStart: (tid: string, title: string) => cbs.startDrag(tid, title),
                    onDragEnd: () => cbs.endDrag(),
                },
            };
        });
    }, [structureNodes, taskDataMap, selectedNodeIds, pendingEditNodeId, collapsedTaskIds, displaySettings, project?.title, project?.id]);

    // DOM 直接操作でドロップターゲットの CSS クラスを切り替え（React 再レンダリングなし）
    const DROP_CLASSES = ['drop-target-above', 'drop-target-below', 'drop-target-child'] as const;
    const clearDropTargetDOM = useCallback(() => {
        const prev = dropInfoRef.current;
        if (prev) {
            const el = document.querySelector(`.react-flow__node[data-id="${prev.nodeId}"]`);
            if (el) DROP_CLASSES.forEach(c => el.classList.remove(c));
        }
        dropInfoRef.current = null;
    }, []);

    const applyDropTargetDOM = useCallback((nodeId: string, position: 'above' | 'below' | 'as-child') => {
        const el = document.querySelector(`.react-flow__node[data-id="${nodeId}"]`);
        if (el) {
            DROP_CLASSES.forEach(c => el.classList.remove(c));
            el.classList.add(position === 'as-child' ? 'drop-target-child' : `drop-target-${position}`);
        }
    }, []);

    const handleNodeClick: NodeMouseHandler = useCallback((_, node) => {
        applySelection(new Set([node.id]), node.id, 'user');
    }, [applySelection]);
    const handlePaneClick = useCallback(() => {
        applySelection(new Set(), null, 'user');
        clearDropTargetDOM();
        // フォーカスをマインドマップの外に移す（input/textareaからフォーカスを外す）
        if (typeof document !== 'undefined') {
            const activeElement = document.activeElement as HTMLElement;
            if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
                activeElement.blur();
            }
        }
    }, [applySelection, clearDropTargetDOM]);

    const handleSelectionChange = useCallback((params: { nodes: Node[]; edges: Edge[] }) => {
        // Skip if drag is in progress (ReactFlow fires selection changes during drag)
        if (isDraggingRef.current) return;

        // Only process selection changes from recent user interactions (mouse/keyboard)
        const now = Date.now();
        const recentUser = now - lastUserActionAtRef.current < USER_ACTION_WINDOW_MS;
        if (!recentUser) {
            return;
        }

        const nextIds = new Set(params.nodes.map(n => n.id));

        // Debounce: avoid processing identical selections
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

        const primaryId = params.nodes[0]?.id ?? null;
        setSelectedNodeId(primaryId);
        selectedNodeIdRef.current = primaryId;

        if (params.nodes.length === 0) {
            clearDropTargetDOM();
        }
    }, [clearDropTargetDOM]);

    // Prevent DB refreshes from stealing focus
    useLayoutEffect(() => {
        if (!selectedNodeId) return;
        const now = Date.now();
        const recentUser = now - lastUserActionAtRef.current < USER_ACTION_WINDOW_MS;
        if (recentUser) return;
        if (typeof document !== 'undefined') {
            const activeTag = document.activeElement?.tagName;
            if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;
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

    const handleNodeDragStart = useCallback((_: React.MouseEvent, node: Node) => {
        if (node.type === 'projectNode') return;
        isDraggingRef.current = true;
        dragPositionsRef.current[node.id] = node.position;
    }, []);

    const handleNodeDrag = useCallback((_: React.MouseEvent, node: Node) => {
        if (node.type === 'projectNode') return;

        const info = getDropInfo(node);
        const prev = dropInfoRef.current;
        const newNodeId = info?.node.id ?? null;
        const newPosition = info?.position ?? null;

        // 変更がなければ位置だけ更新して終了（DOM 操作もなし）
        if (prev?.nodeId === newNodeId && prev?.position === newPosition) {
            dragPositionsRef.current[node.id] = node.position;
            return;
        }

        // 前のターゲットのクラスを除去
        clearDropTargetDOM();

        // 新しいターゲットにクラスを付与
        if (newNodeId && newPosition) {
            applyDropTargetDOM(newNodeId, newPosition);
            dropInfoRef.current = { nodeId: newNodeId, position: newPosition };
        }

        dragPositionsRef.current[node.id] = node.position;
    }, [getDropInfo, clearDropTargetDOM, applyDropTargetDOM]);

    const handleNodeDragStop = useCallback((_evt: React.MouseEvent, node: Node) => {
        isDraggingRef.current = false;
        if (node.type === 'projectNode') return;

        const info = getDropInfo(node);
        clearDropTargetDOM();
        delete dragPositionsRef.current[node.id];
        if (!info) return;

        const { node: target, position } = info;

        // ====== Task ノードのドラッグ ======
        if (node.type === 'taskNode') {
            const draggedTask = getTaskById(node.id);
            if (!draggedTask) return;

            if (target.type === 'taskNode') {
                if (isDescendant(node.id, target.id)) return;
                const targetTask = getTaskById(target.id);
                if (!targetTask) return;

                const isRootDragged = groups.some(g => g.id === node.id);
                const isRootTarget = groups.some(g => g.id === target.id);

                if (position === 'as-child') {
                    // 既に子の場合 → 兄弟に昇格（below扱い）
                    if (draggedTask.parent_task_id === targetTask.id) {
                        onReorderTask?.(draggedTask.id, targetTask.id, 'below');
                        return;
                    }
                    // ターゲットの子になる
                    const newParentId = targetTask.id;
                    if (newParentId === draggedTask.parent_task_id) return;

                    setCollapsedTaskIds(prev => {
                        if (!prev.has(newParentId)) return prev;
                        const next = new Set(prev);
                        next.delete(newParentId);
                        return next;
                    });
                    const updates: Partial<Task> = { parent_task_id: newParentId };
                    if (isRootDragged) updates.project_id = null;
                    onUpdateTask?.(draggedTask.id, updates);
                } else {
                    // above/below = 兄弟としてリオーダー
                    if (isRootDragged && isRootTarget) {
                        // ルートタスク同士
                        onReorderGroup?.(draggedTask.id, targetTask.id, position);
                    } else {
                        onReorderTask?.(draggedTask.id, targetTask.id, position);
                    }
                }
                return;
            }

            if (target.type === 'projectNode') {
                // ProjectNode にドロップ = ルートタスクに昇格
                const isAlreadyRoot = groups.some(g => g.id === draggedTask.id);
                if (isAlreadyRoot) return;
                onUpdateTask?.(draggedTask.id, { parent_task_id: null, project_id: project?.id ?? null });
                return;
            }
        }
    }, [groups, onUpdateTask, onReorderTask, onReorderGroup, getTaskById, isDescendant, getDropInfo, clearDropTargetDOM, project?.id]);

    // Selection drag handlers for multi-node move
    const handleSelectionDragStart = useCallback((_: React.MouseEvent, nodes: Node[]) => {
        isDraggingRef.current = true;
    }, []);

    const handleSelectionDragStop = useCallback((_: React.MouseEvent, nodes: Node[]) => {
        isDraggingRef.current = false;
        clearDropTargetDOM();

        // Filter out project nodes from selection
        const draggedNodes = nodes.filter(n => n.type !== 'projectNode');
        if (draggedNodes.length === 0) return;

        // Use the first node as the primary drag target to determine drop location
        const primaryNode = draggedNodes[0];
        const info = getDropInfo(primaryNode);
        if (!info) return;

        const { node: target, position } = info;

        // Single node: use existing logic
        if (draggedNodes.length === 1) {
            const draggedTask = getTaskById(primaryNode.id);
            if (!draggedTask) return;

            if (target.type === 'taskNode') {
                const targetTask = getTaskById(target.id);
                if (!targetTask) return;
                if (isDescendant(primaryNode.id, target.id)) return;

                if (position === 'as-child') {
                    const newParentId = targetTask.id;
                    if (newParentId !== draggedTask.parent_task_id) {
                        setCollapsedTaskIds(prev => {
                            if (!prev.has(newParentId)) return prev;
                            const next = new Set(prev);
                            next.delete(newParentId);
                            return next;
                        });
                        onUpdateTask?.(draggedTask.id, { parent_task_id: newParentId });
                    }
                } else {
                    const isRootDragged = groups.some(g => g.id === primaryNode.id);
                    const isRootTarget = groups.some(g => g.id === target.id);
                    if (isRootDragged && isRootTarget) {
                        onReorderGroup?.(draggedTask.id, targetTask.id, position);
                    } else {
                        onReorderTask?.(draggedTask.id, targetTask.id, position);
                    }
                }
            } else if (target.type === 'projectNode') {
                const isAlreadyRoot = groups.some(g => g.id === draggedTask.id);
                if (!isAlreadyRoot) {
                    onUpdateTask?.(draggedTask.id, { parent_task_id: null, project_id: project?.id ?? null });
                }
            }
            return;
        }

        // Multiple nodes: move all to the same parent (as-child) or same level (above/below)
        if (target.type === 'taskNode') {
            const targetTask = getTaskById(target.id);
            if (!targetTask) return;

            // Filter out descendants of target (can't move parent into its child)
            const validNodes = draggedNodes.filter(n => !isDescendant(n.id, target.id));
            if (validNodes.length === 0) return;

            if (position === 'as-child') {
                // Move all selected nodes as children of target
                const newParentId = targetTask.id;
                setCollapsedTaskIds(prev => {
                    if (!prev.has(newParentId)) return prev;
                    const next = new Set(prev);
                    next.delete(newParentId);
                    return next;
                });
                for (const node of validNodes) {
                    const task = getTaskById(node.id);
                    if (task && task.parent_task_id !== newParentId) {
                        onUpdateTask?.(node.id, { parent_task_id: newParentId });
                    }
                }
            } else {
                // Move all selected nodes as siblings of target (same parent as target)
                const newParentId = targetTask.parent_task_id;
                for (const node of validNodes) {
                    const task = getTaskById(node.id);
                    if (task && task.parent_task_id !== newParentId) {
                        const isRootTask = groups.some(g => g.id === node.id);
                        if (newParentId === null && !isRootTask) {
                            // Moving to root level
                            onUpdateTask?.(node.id, { parent_task_id: null, project_id: project?.id ?? null });
                        } else if (newParentId !== null) {
                            onUpdateTask?.(node.id, { parent_task_id: newParentId });
                        }
                    }
                }
            }
        } else if (target.type === 'projectNode') {
            // Move all selected nodes to root level
            for (const node of draggedNodes) {
                const isAlreadyRoot = groups.some(g => g.id === node.id);
                if (!isAlreadyRoot) {
                    onUpdateTask?.(node.id, { parent_task_id: null, project_id: project?.id ?? null });
                }
            }
        }
    }, [groups, onUpdateTask, onReorderTask, onReorderGroup, getTaskById, isDescendant, getDropInfo, clearDropTargetDOM, project?.id]);

    const handleSelectionDrag = useCallback((_: React.MouseEvent, nodes: Node[]) => {
        const primaryNode = nodes.find(n => n.type !== 'projectNode');
        if (!primaryNode) return;

        const info = getDropInfo(primaryNode);
        const prev = dropInfoRef.current;
        const newNodeId = info?.node.id ?? null;
        const newPosition = info?.position ?? null;

        if (prev?.nodeId === newNodeId && prev?.position === newPosition) return;

        clearDropTargetDOM();
        if (newNodeId && newPosition) {
            applyDropTargetDOM(newNodeId, newPosition);
            dropInfoRef.current = { nodeId: newNodeId, position: newPosition };
        }
    }, [getDropInfo, clearDropTargetDOM, applyDropTargetDOM]);

    const handleContainerKeyDown = useCallback(async (event: React.KeyboardEvent) => {
        markUserAction();
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

            if (typeof window === 'undefined') return;
            const anyHasChildren = filteredIds.some(id => hasChildren(id));
            const msg = anyHasChildren
                ? `${filteredIds.length}件のタスクを削除しますか？\n子タスクがあるものは子タスクも削除されます。`
                : `${filteredIds.length}件のタスクを削除しますか？`;
            if (!window.confirm(msg)) return;

            applySelection(new Set(), null, 'user');

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
    }, [selectedNodeIds, tasks, groups, hasChildren, isDescendant, onDeleteTask, onDeleteGroup, onBulkDelete, markUserAction, applySelection]);

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
                nodes={layoutNodes}
                edges={edges}
                nodeTypes={nodeTypes}
                defaultViewport={defaultViewport}
                onNodeClick={handleNodeClick}
                onNodeDragStart={handleNodeDragStart}
                onNodeDrag={handleNodeDrag}
                onNodeDragStop={handleNodeDragStop}
                onSelectionDragStart={handleSelectionDragStart}
                onSelectionDrag={handleSelectionDrag}
                onSelectionDragStop={handleSelectionDragStop}
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
                selectNodesOnDrag={true}
                multiSelectionKeyCode="Shift"
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
