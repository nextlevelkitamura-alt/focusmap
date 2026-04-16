"use client"

import React, { useMemo, useState, useEffect, useLayoutEffect, useCallback, useRef, useSyncExternalStore, Component, ErrorInfo, ReactNode } from 'react';
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
    applyNodeChanges,
    NodeChange,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Task, Project } from "@/types/database";
import { cn } from "@/lib/utils";
import { Calendar as CalendarIcon, X, Target, Clock, GripVertical, StickyNote, ImagePlus, Copy, Link2, Sparkles } from "lucide-react";
import { PriorityBadge, PriorityPopover, Priority, getPriorityIconColor } from "@/components/ui/priority-select";
import { EstimatedTimeBadge, EstimatedTimePopover, formatEstimatedTime } from "@/components/ui/estimated-time-select";
import { MindMapDisplaySettingsPopover, MindMapDisplaySettings, loadSettings, DEFAULT_SETTINGS } from "@/components/dashboard/mindmap-display-settings";
import { useDrag } from "@/contexts/DragContext";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogTrigger, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { TaskCalendarSelect } from "@/components/tasks/task-calendar-select";
import { DateTimePicker } from "@/lib/dynamic-imports";
import { useMultiTaskCalendarSync } from "@/hooks/useMultiTaskCalendarSync";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import {
    NODE_WIDTH, NODE_HEIGHT, PROJECT_NODE_WIDTH, PROJECT_NODE_HEIGHT,
    estimateTaskNodeHeight, estimateTaskNodeWidth, getLayoutedElements
} from "@/lib/mindmap-layout";
import { BranchEdge } from "@/components/mindmap/branch-edge";

type HabitUpdatePayload = Partial<Pick<Task,
    'is_habit' | 'habit_frequency' | 'habit_icon' | 'habit_start_date' | 'habit_end_date'
>>;

type ProjectNodeData = {
    label?: string;
    isDropTarget?: boolean;
    onAddChild?: () => Promise<void> | void;
    onSave?: (newTitle: string) => Promise<void> | void;
    onDelete?: () => Promise<void> | void;
};

type TaskNodeData = {
    id?: string;
    taskId?: string;
    label?: string;
    triggerEdit?: boolean;
    initialValue?: string;
    displaySettings?: {
        showStatus: boolean;
        showPriority: boolean;
        showScheduledAt: boolean;
        showEstimatedTime: boolean;
        showProgress: boolean;
        showCollapseButton: boolean;
    };
    memo_images?: string[] | null;
    estimatedDisplayMinutes?: number;
    priority?: number | null;
    scheduled_at?: string | null;
    memo?: string | null;
    is_habit?: boolean;
    habit_icon?: string | null;
    habit_end_date?: string | null;
    status?: string;
    hasChildren?: boolean;
    onSave?: (title: string) => Promise<void> | void;
    onPromote?: () => Promise<void> | void;
    onAddChild?: () => Promise<void> | void;
    onAddSibling?: () => Promise<void> | void;
    onDelete?: () => Promise<void> | void;
    onNavigate?: (direction: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight') => void;
    onUpdateMemoImages?: (urls: string[] | null) => Promise<void> | void;
    onUpdateEstimatedTime?: (minutes: number) => Promise<void> | void;
    onUpdatePriority?: (priority: number | null) => Promise<void> | void;
    onUpdateDate?: (dateIso: string | null) => Promise<void> | void;
    onDragStart?: (taskId: string, title: string) => void;
    onDragEnd?: () => void;
    // Phase B 以降で追加されたプロパティ
    parentIsHabit?: boolean;
    isSelected?: boolean;
    isDropTarget?: boolean;
    dropPosition?: 'as-child' | 'above' | 'below' | 'before' | 'after' | 'inside';
    nodeWidth?: number;
    onToggleCollapse?: () => void;
    collapsed?: boolean;
    google_event_id?: string | null;
    onUpdateStatus?: (status: string) => void;
    estimatedIsOverride?: boolean;
    estimatedAutoMinutes?: number;
    onUpdateScheduledAt?: (scheduledAt: string | null) => void;
    calendar_id?: string | null;
    onUpdateCalendar?: (calendarId: string | null) => void;
    onUpdateMemo?: (memo: string | null) => void;
    onRegisterSchedule?: (params: { scheduledAt: string | null; estimatedMinutes: number; calendarId: string | null }) => Promise<void>;
};

type HabitSettingsPanelData = {
    is_habit?: boolean;
    habit_frequency?: string | null;
    habit_start_date?: string | null;
    habit_end_date?: string | null;
    onUpdateHabit?: (updates: HabitUpdatePayload) => void;
};

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
    startDrag: (taskId: string, title: string) => void;
    endDrag: () => void;
    createRootTaskAndFocus: (title: string) => Promise<void>;
    onUpdateProject?: (projectId: string, title: string) => Promise<void>;
    registerSchedule: (taskId: string, params: { scheduledAt: string | null; estimatedMinutes: number; calendarId: string | null }) => Promise<void>;
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

// --- Custom Nodes ---
const ProjectNode = React.memo(({ data, selected }: NodeProps<ProjectNodeData>) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(data?.label ?? '');
    const inputRef = useRef<HTMLTextAreaElement>(null);
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

    const handleInputKeyDown = useCallback(async (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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

        if (e.key === 'Enter' && !e.nativeEvent.isComposing && !e.shiftKey) {
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
            style={{ width: PROJECT_NODE_WIDTH, minHeight: PROJECT_NODE_HEIGHT }}
            className={cn(
                "px-3 py-2.5 rounded-xl bg-primary text-primary-foreground font-bold text-center shadow-lg transition-all outline-none flex items-center justify-center",
                selected && "ring-2 ring-white ring-offset-2 ring-offset-background",
                data?.isDropTarget && "ring-2 ring-sky-400 ring-offset-2 ring-offset-background bg-sky-500/10"
            )}
            tabIndex={0}
            onKeyDown={handleWrapperKeyDown}
            onDoubleClick={handleDoubleClick}
        >
            {(selected || isEditing) ? (
                <textarea
                    ref={inputRef}
                    rows={1}
                    value={editValue}
                    onChange={(e) => {
                        setEditValue(e.target.value);
                        // Auto-resize
                        e.target.style.height = 'auto';
                        e.target.style.height = `${e.target.scrollHeight}px`;
                    }}
                    onBlur={handleInputBlur}
                    onKeyDown={handleInputKeyDown}
                    onClick={(e) => {
                        if (isEditing) e.stopPropagation();
                    }}
                    className="nodrag nopan w-full bg-transparent border-none text-center font-bold focus:outline-none focus:ring-0 text-primary-foreground resize-none overflow-hidden"
                />
            ) : (
                <div className="w-full truncate">{data?.label ?? 'Project'}</div>
            )}
            <Handle type="source" position={Position.Right} className="!bg-primary-foreground" />
        </div>
    );
});
ProjectNode.displayName = 'ProjectNode';

// HABIT SETTINGS PANEL - local state for instant UI, saves via ref on popover close
const HABIT_DAYS = [
    { key: 'mon', label: '月' }, { key: 'tue', label: '火' }, { key: 'wed', label: '水' },
    { key: 'thu', label: '木' }, { key: 'fri', label: '金' }, { key: 'sat', label: '土' }, { key: 'sun', label: '日' },
] as const;

const fileToDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(new Error('Failed to read image file'));
        reader.readAsDataURL(file);
    });

function HabitSettingsPanel({ data }: { data: HabitSettingsPanelData }) {
    const [isHabit, setIsHabit] = useState<boolean>(data?.is_habit ?? false);
    const [frequency, setFrequency] = useState<string>(data?.habit_frequency ?? '');
    const [startDate, setStartDate] = useState<string>(data?.habit_start_date ?? '');
    const [endDate, setEndDate] = useState<string>(data?.habit_end_date ?? '');

    // Save immediately on any change via stable ref to onUpdateHabit
    const onUpdateHabitRef = useRef(data?.onUpdateHabit);
    useEffect(() => {
        onUpdateHabitRef.current = data?.onUpdateHabit;
    }, [data?.onUpdateHabit]);

    const saveNow = useCallback((updates: {
        isHabit: boolean; frequency: string; startDate: string; endDate: string;
    }) => {
        onUpdateHabitRef.current?.({
            is_habit: updates.isHabit,
            habit_frequency: updates.frequency || null,
            habit_icon: null,
            habit_start_date: updates.startDate || null,
            habit_end_date: updates.endDate || null,
        });
    }, []);

    const handleToggle = useCallback(() => {
        setIsHabit(prev => {
            const next = !prev;
            saveNow({ isHabit: next, frequency, startDate, endDate });
            return next;
        });
    }, [saveNow, frequency, startDate, endDate]);

    const selectedDays = new Set(frequency.split(',').filter(Boolean));
    const toggleDay = (key: string) => {
        const next = new Set(selectedDays);
        if (next.has(key)) next.delete(key); else next.add(key);
        const newFreq = HABIT_DAYS.map(d => d.key).filter(k => next.has(k)).join(',');
        setFrequency(newFreq);
        saveNow({ isHabit, frequency: newFreq, startDate, endDate });
    };

    const handlePreset = (val: string) => {
        setFrequency(val);
        saveNow({ isHabit, frequency: val, startDate, endDate });
    };

    const handleStartDate = (val: string) => {
        setStartDate(val);
        saveNow({ isHabit, frequency, startDate: val, endDate });
    };

    const handleEndDate = (val: string) => {
        setEndDate(val);
        saveNow({ isHabit, frequency, startDate, endDate: val });
    };

    return (
        <>
            <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">習慣</div>
            <div className="nodrag nopan px-2 pb-2 space-y-2">
                {/* Toggle */}
                <button type="button" className="flex items-center justify-between w-full"
                    onClick={(e) => { e.stopPropagation(); handleToggle(); }}
                    onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
                    <span className="text-xs">習慣として設定</span>
                    <div className={cn("inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-xs transition-colors", isHabit ? "bg-primary" : "bg-input")}>
                        <span className={cn("pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform", isHabit ? "translate-x-4" : "translate-x-0")} />
                    </div>
                </button>

                {isHabit && (
                    <>
                        {/* Day-of-week + presets in compact layout */}
                        <div className="text-xs text-muted-foreground">曜日</div>
                        <div className="flex gap-0.5">
                            {HABIT_DAYS.map(({ key, label }) => (
                                <button key={key} type="button"
                                    className={cn("flex-1 h-6 text-[11px] rounded font-medium transition-colors",
                                        selectedDays.has(key) ? "bg-primary text-primary-foreground" : "bg-muted/50 text-muted-foreground hover:bg-muted")}
                                    onClick={(e) => { e.stopPropagation(); toggleDay(key); }}>
                                    {label}
                                </button>
                            ))}
                        </div>
                        <div className="flex gap-1">
                            {[{ label: '毎日', val: 'mon,tue,wed,thu,fri,sat,sun' }, { label: '平日', val: 'mon,tue,wed,thu,fri' }, { label: '土日', val: 'sat,sun' }].map(p => (
                                <button key={p.val} type="button"
                                    className={cn("flex-1 h-5 text-[10px] rounded transition-colors", frequency === p.val ? "bg-primary/20 text-primary" : "text-muted-foreground hover:bg-muted/50")}
                                    onClick={(e) => { e.stopPropagation(); handlePreset(p.val); }}>
                                    {p.label}
                                </button>
                            ))}
                        </div>

                        {/* Period - compact horizontal */}
                        <div className="text-xs text-muted-foreground">期間</div>
                        <div className="flex items-center gap-1">
                            <input type="date" className="flex-1 h-6 px-1 text-[11px] border rounded bg-background min-w-0"
                                value={startDate} onChange={(e) => { e.stopPropagation(); handleStartDate(e.target.value); }}
                                onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} />
                            <span className="text-[10px] text-muted-foreground shrink-0">〜</span>
                            <input type="date" className="flex-1 h-6 px-1 text-[11px] border rounded bg-background min-w-0"
                                value={endDate} onChange={(e) => { e.stopPropagation(); handleEndDate(e.target.value); }}
                                onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} />
                        </div>
                    </>
                )}
            </div>
        </>
    );
}

// TASK NODE
const TaskNode = React.memo(({ data, selected, dragging }: NodeProps<TaskNodeData>) => {
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const [isEditing, setIsEditing] = useState<boolean>(false);
    const [editValue, setEditValue] = useState<string>(data?.label ?? '');
    const [showCaret, setShowCaret] = useState<boolean>(false);
    const [showScheduleMenu, setShowScheduleMenu] = useState<boolean>(false);
    const [imageUrlInput, setImageUrlInput] = useState<string>('');
    const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
    // スケジュールパネル用ローカル状態（登録ボタンを押すまで確定しない）
    const [localScheduledAt, setLocalScheduledAt] = useState<Date | null>(null);
    const [localDurationMinutes, setLocalDurationMinutes] = useState<number>(0);
    const [localCalendarId, setLocalCalendarId] = useState<string | null>(null);
    const [isRegistering, setIsRegistering] = useState<boolean>(false);


    // Flag to prevent double-save when exiting via keyboard (Enter/Tab/Escape)
    const isSavingViaKeyboardRef = useRef(false);
    // Track whether node was already selected before a mousedown (for click-to-edit)
    const wasSelectedRef = useRef(false);
    // Guard: prevent focus operations from triggering onChange → edit mode
    const justFocusedRef = useRef(false);

    // スケジュールパネルが開いた時にローカル状態を現在値で初期化
    useEffect(() => {
        if (showScheduleMenu) {
            setLocalScheduledAt(data?.scheduled_at ? new Date(data.scheduled_at) : null);
            setLocalDurationMinutes(data?.estimatedDisplayMinutes ?? 0);
            setLocalCalendarId(data?.calendar_id || null);
        }
    }, [showScheduleMenu]);

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

    const handleInputKeyDown = useCallback(async (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
        if (e.key === 'Enter' && !e.nativeEvent.isComposing && !e.shiftKey) {
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

        // Keep focus on wrapper for keyboard shortcuts (Return, Tab, etc.)
        // Only move focus to input when entering edit mode via double-click or F2
        if (!isEditing) {
            setShowCaret(false);
            // Ensure wrapper maintains focus for keyboard events
            requestAnimationFrame(() => {
                wrapperRef.current?.focus();
            });
        }
    }, [isEditing, selected]);

    // ドラッグ開始時の処理（カレンダーにドロップするため）
    const handleDragStart = useCallback((e: React.DragEvent) => {
        // Note: Prevent parent logic (like dragging text content)
        e.stopPropagation();

        if (isEditing) {
            e.preventDefault()
            return
        }

        // タスクIDをドラッグデータに設定
        const taskId = data?.taskId || data?.id
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
                data?.onDragStart?.(taskId, editValue || 'タスク')

        }
    }, [isEditing, data, editValue])

    // ドラッグ終了時の処理
    const handleDragEnd = useCallback(() => {
        // DragContextに通知（data経由で呼び出し）
        data?.onDragEnd?.()
    }, [data])

    const settings = data?.displaySettings || { showStatus: true, showPriority: true, showScheduledAt: true, showEstimatedTime: true, showProgress: true, showCollapseButton: true };
    const memoImages: string[] = Array.isArray(data?.memo_images)
        ? (data.memo_images as string[]).filter((url: string) => typeof url === 'string' && !!url.trim())
        : [];

    const hasEstimatedTime = settings.showEstimatedTime && (data?.estimatedDisplayMinutes ?? 0) > 0;
    const hasPriority = settings.showPriority && data?.priority != null;
    const hasScheduledAt = settings.showScheduledAt && !!data?.scheduled_at;
    const hasMemo = !!data?.memo;
    const hasMemoImages = memoImages.length > 0;
    const hasInfoRow = hasEstimatedTime || hasPriority || hasScheduledAt || hasMemo || hasMemoImages;
    const isTaskDone = data?.is_habit
        ? (data?.status === 'done' && !!data?.habit_end_date && new Date(data.habit_end_date) < new Date())
        : data?.status === 'done';

    const writeClipboard = useCallback(async (text: string, successMessage: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopyFeedback(successMessage);
            setTimeout(() => setCopyFeedback(null), 1400);
        } catch (error) {
            console.error('[TaskNode] Failed to write clipboard:', error);
            setCopyFeedback('コピーに失敗しました');
            setTimeout(() => setCopyFeedback(null), 1600);
        }
    }, []);

    const handleAddImageUrl = useCallback(() => {
        const nextUrl = imageUrlInput.trim();
        if (!nextUrl) return;
        if (memoImages.includes(nextUrl)) {
            setImageUrlInput('');
            return;
        }
        data?.onUpdateMemoImages?.([...memoImages, nextUrl]);
        setImageUrlInput('');
    }, [imageUrlInput, memoImages, data]);

    const handleImageFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files ?? []);
        if (files.length === 0) return;

        try {
            const encoded = await Promise.all(
                files
                    .filter(file => file.type.startsWith('image/'))
                    .map(fileToDataUrl)
            );
            const merged = [...memoImages, ...encoded.filter(Boolean)];
            data?.onUpdateMemoImages?.(merged.length > 0 ? merged : null);
        } catch (error) {
            console.error('[TaskNode] Failed to encode image files:', error);
        } finally {
            event.target.value = '';
        }
    }, [memoImages, data]);

    const handleRemoveImage = useCallback((targetUrl: string) => {
        const filtered = memoImages.filter(url => url !== targetUrl);
        data?.onUpdateMemoImages?.(filtered.length > 0 ? filtered : null);
    }, [memoImages, data]);

    const buildAiMemoPayload = useCallback(() => {
        const memoText = typeof data?.memo === 'string' ? data.memo.trim() : '';
        const sections: string[] = [];
        if (memoText) sections.push(`メモ:\n${memoText}`);
        if (memoImages.length > 0) {
            sections.push(`画像:\n${memoImages.map((url, idx) => `![image-${idx + 1}](${url})`).join('\n')}`);
        }
        return sections.join('\n\n').trim();
    }, [data?.memo, memoImages]);

    return (
        <div
            ref={wrapperRef}
            className={cn(
                "relative px-1.5 py-1 rounded-lg bg-background border text-[13px] shadow-sm flex flex-col gap-0 transition-all outline-none min-h-[30px] group",
                !isEditing && "cursor-grab active:cursor-grabbing",
                dragging && "is-dragging-active",
                (data?.is_habit || data?.parentIsHabit) && "border-blue-400",
                (selected || data?.isSelected) && (data?.is_habit || data?.parentIsHabit)
                    ? "ring-2 ring-blue-400 ring-offset-2 ring-offset-background"
                    : (selected || data?.isSelected) && "ring-2 ring-white ring-offset-2 ring-offset-background",
                data?.isDropTarget && data?.dropPosition === 'as-child' && "ring-2 ring-emerald-400 ring-offset-1 ring-offset-background border-emerald-400 bg-emerald-500/10",
            )}
            tabIndex={0}
            style={{ width: isEditing ? estimateTaskNodeWidth(editValue) : (typeof data?.nodeWidth === 'number' ? data.nodeWidth : NODE_WIDTH) }}
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

                {/* Calendar Drag Handle (HTML5 Drag) */}
                <div
                    draggable={!isEditing}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                    className="nodrag nopan cursor-grab active:cursor-grabbing w-4 h-4 text-muted-foreground/30 hover:text-blue-500 transition-colors shrink-0 flex items-center justify-center p-0.5 rounded hover:bg-muted"
                    title="ドラッグしてカレンダーへ配置"
                >
                    <GripVertical className="w-3 h-3" />
                </div>

                {settings.showStatus && (
                    <div className={cn("w-1.5 h-1.5 rounded-full shrink-0", isTaskDone ? "bg-primary" : "bg-muted-foreground/30")} />
                )}

                {/* Habit Icon Badge */}
                {data?.is_habit && data?.habit_icon && (
                    <span className="text-sm shrink-0" title="習慣">
                        {data.habit_icon}
                    </span>
                )}

                <textarea
                    ref={inputRef}
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
                    onKeyDown={handleInputKeyDown}
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
                        "nodrag nopan flex-1 bg-transparent border-none text-[13px] font-semibold leading-tight focus:outline-none focus:ring-0 px-0.5 min-w-0 resize-none overflow-hidden whitespace-pre-wrap break-words [overflow-wrap:anywhere]",
                        !showCaret && "caret-transparent",
                        !showCaret && !selected && "pointer-events-none select-none",
                        isTaskDone && "line-through text-muted-foreground"
                    )}
                />

                {/* Calendar sync indicator */}
                {data?.google_event_id && (
                    <div className="nodrag nopan shrink-0" title="Googleカレンダーと同期済み">
                        <CalendarIcon className="w-3 h-3 text-blue-500" />
                    </div>
                )}

                {/* Quick Action Menu */}
                <Dialog open={showScheduleMenu} onOpenChange={setShowScheduleMenu}>
                    <DialogTrigger asChild>
                        <button
                            type="button"
                            className="nodrag nopan w-5 h-5 text-muted-foreground/40 hover:text-muted-foreground hover:bg-muted/30 transition-all flex items-center justify-center rounded shrink-0 ml-0.5"
                            onClick={(e) => e.stopPropagation()}
                            title="タスク詳細設定"
                        >
                            <svg className="w-3 h-3" viewBox="0 0 12 12" fill="currentColor">
                                <rect x="1" y="2" width="10" height="1.2" rx="0.6" />
                                <rect x="1" y="5.4" width="10" height="1.2" rx="0.6" />
                                <rect x="1" y="8.8" width="10" height="1.2" rx="0.6" />
                            </svg>
                        </button>
                    </DialogTrigger>
                    <DialogContent
                        showCloseButton={false}
                        className="nodrag nopan w-[min(94vw,46rem)] max-w-[min(94vw,46rem)] h-[min(88vh,46rem)] p-3 overflow-hidden"
                        style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-y' }}
                        onTouchMove={(e) => e.stopPropagation()}
                        onOpenAutoFocus={(e) => e.preventDefault()}
                    >
                        <div className="grid h-full grid-cols-2 gap-3">
                            <div className="min-h-0 overflow-y-auto pr-1 space-y-1.5">
                        {/* Task Completion */}
                        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">タスク</div>
                        <div className="nodrag nopan px-2 pb-2">
                            <button
                                type="button"
                                className="flex items-center justify-between w-full h-8 rounded px-1 hover:bg-muted/40 transition-colors"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    data?.onUpdateStatus?.(isTaskDone ? 'todo' : 'done');
                                }}
                            >
                                <span className="text-xs">完了</span>
                                <Switch
                                    checked={isTaskDone}
                                    onCheckedChange={(checked) => data?.onUpdateStatus?.(checked ? 'done' : 'todo')}
                                    onClick={(e) => e.stopPropagation()}
                                />
                            </button>
                        </div>

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

                        {/* Schedule Section */}
                        {(() => {
                            const hasDuration = localDurationMinutes > 0;
                            const hasDate = !!localScheduledAt;
                            const hasCalendar = !!localCalendarId;
                            const isReady = hasDuration && hasDate && hasCalendar;
                            const steps = [
                                { label: '所要時間', done: hasDuration },
                                { label: '日時', done: hasDate },
                                { label: 'カレンダー', done: hasCalendar },
                            ];
                            return (
                                <div className="px-2 pt-2 pb-1">
                                    <div className={cn(
                                        "rounded-xl border-2 transition-colors duration-300 overflow-hidden",
                                        isReady ? "border-primary/60 bg-primary/5" : "border-border bg-muted/20"
                                    )}>
                                        {/* ヘッダー */}
                                        <div className={cn(
                                            "flex items-center justify-between px-3 py-2 border-b transition-colors duration-300",
                                            isReady ? "border-primary/30 bg-primary/10" : "border-border"
                                        )}>
                                            <div className="flex items-center gap-1.5">
                                                <CalendarIcon className={cn("w-4 h-4 transition-colors", isReady ? "text-primary" : "text-muted-foreground")} />
                                                <span className={cn("text-sm font-semibold transition-colors", isReady ? "text-primary" : "text-foreground")}>スケジュール</span>
                                            </div>
                                            {/* ステップインジケーター */}
                                            <div className="flex items-center gap-1">
                                                {steps.map((s, i) => (
                                                    <div key={i} className={cn(
                                                        "w-1.5 h-1.5 rounded-full transition-all duration-300",
                                                        s.done ? "bg-primary scale-110" : "bg-muted-foreground/30"
                                                    )} title={s.label} />
                                                ))}
                                            </div>
                                        </div>
                                        {/* フィールド群 */}
                                        <div className="p-3 space-y-2.5">
                                            {/* ① 所要時間 */}
                                            <div className="flex items-center gap-2">
                                                <span className={cn("text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center shrink-0 transition-colors duration-200",
                                                    hasDuration ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                                                )}>1</span>
                                                <div className="flex-1">
                                                    <EstimatedTimePopover
                                                        valueMinutes={localDurationMinutes}
                                                        onChangeMinutes={(minutes) => setLocalDurationMinutes(minutes)}
                                                        isOverridden={!!data?.estimatedIsOverride}
                                                        autoMinutes={data?.estimatedAutoMinutes}
                                                        onResetAuto={data?.hasChildren ? () => setLocalDurationMinutes(0) : undefined}
                                                        trigger={
                                                            <Button variant="outline" size="sm" className={cn("w-full justify-start text-xs h-8 transition-colors", hasDuration && "border-primary/40 text-foreground")}>
                                                                <Clock className="w-3 h-3 mr-2 shrink-0" />
                                                                {hasDuration ? <EstimatedTimeBadge minutes={localDurationMinutes} /> : <span className="text-muted-foreground">所要時間を設定</span>}
                                                            </Button>
                                                        }
                                                    />
                                                </div>
                                            </div>
                                            {/* ② 日時 */}
                                            <div className="flex items-center gap-2">
                                                <span className={cn("text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center shrink-0 transition-colors duration-200",
                                                    hasDate ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                                                )}>2</span>
                                                <div className="flex-1">
                                                    <DateTimePicker
                                                        date={localScheduledAt ?? undefined}
                                                        setDate={(date) => setLocalScheduledAt(date ?? null)}
                                                        trigger={
                                                            <Button variant="outline" size="sm" className={cn("w-full justify-start text-xs h-8 transition-colors", hasDate && "border-primary/40")}>
                                                                <CalendarIcon className="w-3 h-3 mr-2 shrink-0" />
                                                                {hasDate ? <span>{format(localScheduledAt!, 'M/d (E) HH:mm', { locale: ja })}</span> : <span className="text-muted-foreground">日時を設定</span>}
                                                            </Button>
                                                        }
                                                    />
                                                </div>
                                            </div>
                                            {/* ③ カレンダー */}
                                            <div className="flex items-center gap-2">
                                                <span className={cn("text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center shrink-0 transition-colors duration-200",
                                                    hasCalendar ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                                                )}>3</span>
                                                <div className="flex-1">
                                                    <TaskCalendarSelect
                                                        value={localCalendarId}
                                                        onChange={(calendarId) => setLocalCalendarId(calendarId)}
                                                        className={cn("w-full h-8 justify-start transition-colors", hasCalendar && "border-primary/40")}
                                                    />
                                                </div>
                                            </div>
                                            {/* 登録ボタン */}
                                            <button
                                                type="button"
                                                disabled={!isReady || isRegistering}
                                                onClick={async (e) => {
                                                    e.stopPropagation();
                                                    if (!isReady) return;
                                                    setIsRegistering(true);
                                                    try {
                                                        await data?.onRegisterSchedule?.({
                                                            scheduledAt: localScheduledAt!.toISOString(),
                                                            estimatedMinutes: localDurationMinutes,
                                                            calendarId: localCalendarId,
                                                        });
                                                    } finally {
                                                        setIsRegistering(false);
                                                    }
                                                }}
                                                className={cn(
                                                    "w-full h-10 rounded-lg text-sm font-semibold mt-1 transition-all duration-300",
                                                    isReady
                                                        ? "bg-primary text-primary-foreground shadow-md shadow-primary/30 hover:brightness-110 active:scale-[0.98] cursor-pointer animate-[pulse_2s_ease-in-out_1]"
                                                        : "bg-muted text-muted-foreground cursor-not-allowed opacity-50"
                                                )}
                                            >
                                                {isRegistering ? '登録中...' : isReady ? '✓ スケジュールに登録' : 'スケジュールに登録'}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })()}

                        {/* Memo */}
                        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">メモ</div>
                        <div className="px-2 pb-2">
                            <textarea
                                className="nodrag nopan w-full text-xs border rounded p-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary resize-none min-h-[60px]"
                                placeholder="メモを入力..."
                                defaultValue={data?.memo || ''}
                                key={data?.taskId + '-memo'}
                                onBlur={(e) => {
                                    const val = e.target.value.trim() || null;
                                    if (val !== (data?.memo || null)) {
                                        data?.onUpdateMemo?.(val);
                                    }
                                }}
                                onClick={(e) => e.stopPropagation()}
                            />
                        </div>
                            </div>

                        {/* Memo Images */}
                            <div className="min-h-0 overflow-y-auto pr-1 space-y-1.5">
                        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">画像</div>
                        <div className="px-2 pb-2 space-y-2">
                            <div className="flex gap-1">
                                <input
                                    className="nodrag nopan flex-1 h-8 text-xs border rounded px-2 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                                    placeholder="画像URL または data:image..."
                                    value={imageUrlInput}
                                    onChange={(e) => setImageUrlInput(e.target.value)}
                                    onClick={(e) => e.stopPropagation()}
                                />
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-8 px-2 text-xs"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleAddImageUrl();
                                    }}
                                >
                                    追加
                                </Button>
                            </div>

                            <label className="flex items-center justify-center gap-1 h-8 border rounded text-xs cursor-pointer hover:bg-muted/40">
                                <ImagePlus className="w-3 h-3" />
                                画像ファイルを追加
                                <input
                                    type="file"
                                    accept="image/*"
                                    multiple
                                    className="hidden"
                                    onChange={handleImageFileChange}
                                    onClick={(e) => e.stopPropagation()}
                                />
                            </label>

                            {memoImages.length > 0 && (
                                <div className="space-y-1.5">
                                    {memoImages.map((url, index) => (
                                        <div key={`${url}-${index}`} className="border rounded p-1.5 space-y-1">
                                            <img
                                                src={url}
                                                alt={`memo-image-${index + 1}`}
                                                className="w-full h-16 object-cover rounded bg-muted"
                                            />
                                            <div className="grid grid-cols-3 gap-1">
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    className="h-6 text-[10px] px-1"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        writeClipboard(url, 'URLをコピーしました');
                                                    }}
                                                >
                                                    <Link2 className="w-3 h-3 mr-1" />
                                                    URL
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    className="h-6 text-[10px] px-1"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        writeClipboard(`![image-${index + 1}](${url})`, 'Markdownをコピーしました');
                                                    }}
                                                >
                                                    <Copy className="w-3 h-3 mr-1" />
                                                    MD
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    className="h-6 text-[10px] px-1 text-red-400"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleRemoveImage(url);
                                                    }}
                                                >
                                                    削除
                                                </Button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="w-full h-8 justify-start text-xs"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    const aiPayload = buildAiMemoPayload();
                                    if (!aiPayload) return;
                                    writeClipboard(aiPayload, 'AI用メモをコピーしました');
                                }}
                            >
                                <Sparkles className="w-3 h-3 mr-2" />
                                AI用にメモ+画像をコピー
                            </Button>
                            {copyFeedback && (
                                <div className="text-[10px] text-emerald-400">{copyFeedback}</div>
                            )}
                        </div>

                        {/* Habit Settings - uses HabitSettingsPanel */}
                        <HabitSettingsPanel data={data} />
                        {/* 閉じるボタン */}
                        <div className="px-2 pb-2">
                            <Button size="sm" className="w-full h-7 text-xs" onClick={(e) => { e.stopPropagation(); setShowScheduleMenu(false); }}>
                                閉じる
                            </Button>
                        </div>
                            </div>
                        </div>
                    </DialogContent>
                </Dialog>
            </div>

            {/* Row 2: メタデータ（値が設定されている場合のみ表示） */}
            {
                hasInfoRow && (
                    <div className="nodrag nopan flex items-center gap-1 pl-4 flex-wrap">
                        {/* Estimated Time Badge */}
                        {hasEstimatedTime && (
                            <>
                                <EstimatedTimePopover
                                    valueMinutes={data.estimatedDisplayMinutes ?? 0}
                                    onChangeMinutes={(minutes) => data?.onUpdateEstimatedTime?.(minutes)}
                                    isOverridden={!!data?.estimatedIsOverride}
                                    autoMinutes={data?.estimatedAutoMinutes}
                                    onResetAuto={data?.hasChildren ? () => data?.onUpdateEstimatedTime?.(0) : undefined}
                                    trigger={
                                        <span className="cursor-pointer" onClick={(e) => e.stopPropagation()}>
                                            <EstimatedTimeBadge
                                                minutes={data.estimatedDisplayMinutes ?? 0}
                                                title={
                                                    data?.hasChildren
                                                        ? (data?.estimatedIsOverride
                                                            ? `手動設定（自動集計: ${data.estimatedAutoMinutes ? formatEstimatedTime(data.estimatedAutoMinutes ?? 0) : "0分"}）`
                                                            : `子孫合計: ${formatEstimatedTime(data.estimatedDisplayMinutes ?? 0)}`)
                                                        : `見積もり: ${formatEstimatedTime(data.estimatedDisplayMinutes ?? 0)}`
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
                                        data?.onUpdatePriority?.(null)
                                    }}
                                    title="優先度を削除"
                                >
                                    <X className="w-2.5 h-2.5" />
                                </button>
                            </>
                        )}

                        {/* Memo indicator */}
                        {hasMemo && (
                            <StickyNote className="w-3 h-3 text-muted-foreground" />
                        )}
                        {hasMemoImages && (
                            <ImagePlus className="w-3 h-3 text-muted-foreground" />
                        )}

                        {/* DateTime（右寄せ） */}
                        {hasScheduledAt && (
                            <div className="ml-auto">
                                <DateTimePicker
                                    date={new Date(data.scheduled_at!)}
                                    setDate={(date) => data?.onUpdateDate?.(date ? date.toISOString() : null)}
                                    trigger={
                                        <div className="flex items-center gap-1">
                                            <span className="text-[10px] text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer">
                                                {format(new Date(data.scheduled_at!), 'M/d HH:mm')}
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
                )
            }

            <Handle type="source" position={Position.Right} className="!bg-muted-foreground/50 !w-1 !h-1" />
        </div >
    );
});
TaskNode.displayName = 'TaskNode';

const nodeTypes = { projectNode: ProjectNode, taskNode: TaskNode };
const edgeTypes = { branch: BranchEdge };
const defaultViewport = { x: 0, y: 0, zoom: 0.75 };
const MINDMAP_CLIPBOARD_PREFIX = 'SHIKUMIKA_MINDMAP_NODE_V1:';

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
}

function MindMapContent({ project, groups, tasks, onCreateGroup, onDeleteGroup, onReorderGroup, onUpdateProject, onCreateTask, onUpdateTask, onDeleteTask, onBulkDelete, onReorderTask, onRefreshCalendar, onAddOptimisticEvent, onRemoveOptimisticEvent }: MindMapProps) {
    const reactFlow = useReactFlow();
    const projectId = project?.id ?? '';
    const USER_ACTION_WINDOW_MS = 800;

    // DragContext - MindMapContentで使用してTaskNodeに渡す
    const { startDrag, endDrag } = useDrag()

    // MindMap Display Settings (consistent default for SSR, restore from localStorage after mount)
    const [displaySettings, setDisplaySettings] = useState<MindMapDisplaySettings>(DEFAULT_SETTINGS);
    useEffect(() => { setDisplaySettings(loadSettings()) }, []);

    // カレンダー同期（マインドマップのタスク全体）+ 楽観的UI更新
    useMultiTaskCalendarSync({
        tasks: [...groups, ...tasks], // ルートタスク + 子タスク
        onRefreshCalendar,
        onUpdateTask,
        onAddOptimisticEvent,
        onRemoveOptimisticEvent,
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
        // Habit fields
        is_habit: g?.is_habit ?? false,
            habit_frequency: g?.habit_frequency ?? null,
            habit_icon: g?.habit_icon ?? null,
            habit_start_date: g?.habit_start_date ?? null,
            habit_end_date: g?.habit_end_date ?? null,
            memo: g?.memo ?? null,
            memo_images: g?.memo_images ?? null,
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
        priority: t?.priority ?? null,
        estimated_time: t?.estimated_time ?? 0,
        // Habit fields
        is_habit: t?.is_habit ?? false,
            habit_frequency: t?.habit_frequency ?? null,
            habit_icon: t?.habit_icon ?? null,
            habit_start_date: t?.habit_start_date ?? null,
            habit_end_date: t?.habit_end_date ?? null,
            memo: t?.memo ?? null,
            memo_images: t?.memo_images ?? null,
        })) ?? []);

    // STATE
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
    const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
    const [clipboardFeedback, setClipboardFeedback] = useState<string | null>(null);
    const [pendingEditNodeId, setPendingEditNodeId] = useState<string | null>(null);
    const [collapsedTaskIds, setCollapsedTaskIds] = useState<Set<string>>(new Set());
    const dropInfoRef = useRef<{ nodeId: string; position: 'above' | 'below' | 'as-child' } | null>(null);
    const dragPositionsRef = useRef<Record<string, { x: number; y: number }>>({});
    const dragStartPositionRef = useRef<{ x: number; y: number } | null>(null);
    const NODE_DRAG_THRESHOLD = 30; // 30px minimum drag distance to trigger drop
    const lastUserActionAtRef = useRef<number>(0);
    const selectedNodeIdRef = useRef<string | null>(null);
    const isDraggingRef = useRef(false);
    const clipboardFeedbackTimerRef = useRef<NodeJS.Timeout | null>(null);

    // Local node state for smooth drag tracking (decoupled from static dagre layout)
    const [nodes, setNodes] = useState<Node[]>([]);

    const markUserAction = useCallback(() => {
        lastUserActionAtRef.current = Date.now();
    }, []);

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
            applySelection(new Set(createdRootIds), primaryId, 'user');
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
        // 150px: かなり近づけないと吸い付かないようにして精度を上げる
        const MAX_DIST = 150;
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

                // X軸でターゲットの右側 30% 以上にカーソルがある場合は「子要素（as-child）」として扱う
                // それ以外（左側や重なっている場合）は「兄弟要素（above/below）」として扱う
                if (relativeX > rect.width * 0.3) {
                    // もしターゲットの下側により近い場合は 'below' になるのを防ぎ、右側なら常に child 優先気味にする
                    if (relativeY < rect.height * 0.25) {
                        position = 'above';
                    } else if (relativeY > rect.height * 0.75) {
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

    const registerSchedule = useCallback(async (taskId: string, params: { scheduledAt: string | null; estimatedMinutes: number; calendarId: string | null }) => {
        if (onUpdateTask) {
            await onUpdateTask(taskId, {
                scheduled_at: params.scheduledAt,
                estimated_time: params.estimatedMinutes || null,
                calendar_id: params.calendarId,
            });
        }
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
        onUpdateTask, toggleTaskCollapse, startDrag, endDrag,
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
        startDrag,
        endDrag,
        createRootTaskAndFocus,
        onUpdateProject,
        registerSchedule,
    ]);

    // ===== STEP 1: Structure + dagre layout (expensive, only on data/collapse change) =====
    type ParsedTask = {
        id: string; title: string; status: string;
        parent_task_id: string | null; order_index: number;
        created_at: string; priority: number | null;
        scheduled_at: string | null; estimated_time: number | null;
        calendar_id: string | null; google_event_id: string | null;
        is_habit: boolean; habit_frequency: string | null; habit_icon: string | null;
        habit_start_date: string | null; habit_end_date: string | null;
        memo: string | null;
        memo_images: string[] | null;
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
                yOffsetCursor: { value: number }
            ) => {
                if (depth >= MAX_DEPTH) return;

                const taskHasChildren = (childTasksByParent[task.id]?.length ?? 0) > 0;
                const taskIsEstimatedOverride = taskHasChildren && ((task.estimated_time ?? 0) > 0);
                const taskAutoEstimatedMinutes = taskHasChildren ? getTaskAutoMinutes(task.id) : 0;
                const taskDisplayEstimatedMinutes = taskHasChildren
                    ? (taskIsEstimatedOverride ? (task.estimated_time ?? 0) : taskAutoEstimatedMinutes)
                    : (task.estimated_time ?? 0);
                const xPos = BASE_X + (depth * X_STEP);
                const taskNodeWidth = estimateTaskNodeWidth(task.title || '');

                const taskHasInfo = (taskDisplayEstimatedMinutes > 0)
                    || task.priority != null
                    || !!task.scheduled_at
                    || !!task.memo
                    || !!(task.memo_images && task.memo_images.length > 0);
                const taskNodeHeight = estimateTaskNodeHeight(task.title || '', taskHasInfo, taskNodeWidth);

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
                    width: taskNodeWidth,
                    height: taskNodeHeight,
                    data: {
                        taskId: task.id,
                        label: task.title ?? 'Task',
                        nodeWidth: taskNodeWidth,
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
                    position: { x: xPos, y: yOffsetCursor.value },
                    draggable: true,
                });
                resultEdges.push({
                    id: `e-${parentId}-${task.id}`,
                    source: parentId,
                    target: task.id,
                    type: 'branch'
                });

                // ノード実高さ + マージンで次のY位置を計算（固定40pxだと長いテキストで重なる）
                yOffsetCursor.value += taskNodeHeight + 6;

                if (!collapsedTaskIds.has(task.id)) {
                    const children = childTasksByParent[task.id] ?? [];
                    for (const child of children) {
                        renderTasksRecursively(child, task.id, depth + 1, yOffsetCursor);
                    }
                }
            };

            const sortedRootTasks = [...safeGroups].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
            let globalYOffset = 50;

            for (const rootTask of sortedRootTasks) {
                const yOffsetCursor = { value: globalYOffset };
                renderTasksRecursively(rootTask, 'project-root', 0, yOffsetCursor);
                globalYOffset = Math.max(globalYOffset + 80, yOffsetCursor.value + 30);
            }

            // 同じ親を持つ兄弟ノードの幅を最大幅に統一する
            const parentToChildIds = new Map<string, string[]>();
            resultEdges.forEach(e => {
                if (!parentToChildIds.has(e.source)) parentToChildIds.set(e.source, []);
                parentToChildIds.get(e.source)!.push(e.target);
            });

            const nodeById = new Map<string, Node>();
            resultNodes.forEach(n => nodeById.set(n.id, n));

            parentToChildIds.forEach((childIds) => {
                const taskChildren = childIds.filter(id => nodeById.get(id)?.type === 'taskNode');
                if (taskChildren.length < 2) return;
                const maxWidth = Math.max(...taskChildren.map(id => (nodeById.get(id)?.width as number) ?? 0));
                taskChildren.forEach(id => {
                    const n = nodeById.get(id);
                    if (!n || n.width === maxWidth) return;
                    const task = dataMap.get(id);
                    const hasInfo = task ? (
                        (task.estimatedDisplayMinutes > 0) ||
                        task.priority != null ||
                        !!task.scheduled_at ||
                        !!task.memo ||
                        !!(task.memo_images && task.memo_images.length > 0)
                    ) : false;
                    const newHeight = estimateTaskNodeHeight(task?.title || String(n.data?.label ?? ''), hasInfo, maxWidth);
                    n.width = maxWidth;
                    n.height = newHeight;
                    (n.data as Record<string, unknown>).nodeWidth = maxWidth;
                });
            });
        } catch (err) {
            console.error('[MindMap] Error:', err);
        }

        const { nodes: layouted, edges: layoutedEdges } = getLayoutedElements(resultNodes, resultEdges);
        return { structureNodes: layouted, edges: layoutedEdges, taskDataMap: dataMap };
    }, [projectId, groupsJson, tasksJson, project?.title, collapsedTaskIds]);

    // ===== STEP 2: Inject interactive data (cheap, runs on selection/edit/settings change) =====
    const layoutNodes = useMemo(() => {
        const cbs = callbacks;
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
                        onDelete: () => { }
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
                    nodeWidth: typeof node.width === 'number' ? node.width : NODE_WIDTH,
                    onSave: (t: string) => cbs.saveTaskTitle(taskId, t),
                    onUpdateDate: (d: string | null) => cbs.updateTaskScheduledAt(taskId, d),
                    onUpdateScheduledAt: (d: string) => cbs.updateTaskScheduledAt(taskId, d),
                    onUpdateStatus: (status: string) => cbs.onUpdateTask?.(taskId, { status }),
                    onUpdatePriority: (p: number) => cbs.updateTaskPriority(taskId, p),
                    onUpdateEstimatedTime: (m: number) => cbs.updateTaskEstimatedTime(taskId, m),
                    onUpdateCalendar: (calendarId: string | null) => cbs.onUpdateTask?.(taskId, { calendar_id: calendarId }),
                    onRegisterSchedule: (params) => cbs.registerSchedule(taskId, params),
                    is_habit: taskData?.is_habit ?? false,
                    parentIsHabit: taskData?.parent_task_id ? (taskDataMap.get(taskData.parent_task_id)?.is_habit ?? false) : false,
                    habit_frequency: taskData?.habit_frequency ?? null,
                    habit_icon: taskData?.habit_icon ?? null,
                    habit_start_date: taskData?.habit_start_date ?? null,
                    habit_end_date: taskData?.habit_end_date ?? null,
                    onUpdateHabit: (habitUpdates: Partial<Pick<ParsedTask, 'is_habit' | 'habit_frequency' | 'habit_icon' | 'habit_start_date' | 'habit_end_date'>>) => cbs.onUpdateTask?.(taskId, habitUpdates),
                    memo: taskData?.memo ?? null,
                    onUpdateMemo: (memo: string | null) => cbs.onUpdateTask?.(taskId, { memo }),
                    memo_images: taskData?.memo_images ?? null,
                    onUpdateMemoImages: (memo_images: string[] | null) => cbs.onUpdateTask?.(taskId, { memo_images }),
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
    }, [callbacks, structureNodes, taskDataMap, selectedNodeIds, pendingEditNodeId, collapsedTaskIds, displaySettings, project?.title, project?.id]);

    // Sync computed static layout to controllable local state
    useEffect(() => {
        setNodes(layoutNodes);
    }, [layoutNodes]);

    // Intercept ReactFlow drag events and update local state for smooth mouse tracking
    const onNodesChange = useCallback((changes: NodeChange[]) => {
        setNodes((nds) => applyNodeChanges(changes, nds));
    }, []);

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
        // Save initial position to calculate drag distance later
        dragStartPositionRef.current = { x: node.position.x, y: node.position.y };
    }, []);

    const handleNodeDrag = useCallback((_: React.MouseEvent, node: Node) => {
        if (node.type === 'projectNode') return;

        // Don't show drop targets until drag distance exceeds threshold
        const startPos = dragStartPositionRef.current;
        if (startPos) {
            const dist = Math.sqrt(Math.pow(node.position.x - startPos.x, 2) + Math.pow(node.position.y - startPos.y, 2));
            if (dist < NODE_DRAG_THRESHOLD) {
                clearDropTargetDOM();
                dragPositionsRef.current[node.id] = node.position;
                return;
            }
        }

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

        // Calculate drag distance from start position
        const startPos = dragStartPositionRef.current;
        const dragDistance = startPos
            ? Math.sqrt(Math.pow(node.position.x - startPos.x, 2) + Math.pow(node.position.y - startPos.y, 2))
            : 0;
        dragStartPositionRef.current = null;

        const info = getDropInfo(node);
        clearDropTargetDOM();
        delete dragPositionsRef.current[node.id];

        // CRITICAL: Ignore drop if drag distance is too small (prevents accidental drops on click)
        if (dragDistance < NODE_DRAG_THRESHOLD) return;

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
    }, [
        selectedNodeIds,
        tasks,
        groups,
        onDeleteTask,
        onDeleteGroup,
        onBulkDelete,
        markUserAction,
        applySelection,
        getIsTypingTarget,
        getCopyRootNodeIds,
        buildClipboardNode,
        normalizeClipboardPayload,
        pasteClipboardTree,
        flashClipboardFeedback,
    ]);

    return (
        <div
            className="w-full h-full bg-muted/5 relative outline-none"
            tabIndex={0}
            onKeyDown={handleContainerKeyDown}
            onPasteCapture={handleContainerPasteCapture}
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
                onNodesChange={onNodesChange}
                edges={edges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
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
                fitViewOptions={{ padding: 0.35 }}
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
                        <span><kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">⌘C/⌘V</kbd> 複製</span>
                    </div>
                </div>
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
            <ReactFlowProvider>
                <MindMapContent {...props} />
            </ReactFlowProvider>
        </MindMapErrorBoundary>
    );
}
