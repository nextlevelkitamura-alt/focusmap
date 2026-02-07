"use client"

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { createClient } from '@/utils/supabase/client';
import { Task } from '@/types/database';

interface TimerContextType {
    // Current running task
    runningTaskId: string | null;
    runningTask: Task | null;

    // Calculated elapsed time (updates every second)
    currentElapsedSeconds: number;

    // Actions
    startTimer: (task: Task) => Promise<boolean>;
    pauseTimer: () => Promise<void>;
    completeTimer: () => Promise<void>;
    interruptTimer: () => Promise<void>;

    // Loading state
    isLoading: boolean;
}

const TimerContext = createContext<TimerContextType | null>(null);

export function useTimer() {
    const context = useContext(TimerContext);
    if (!context) {
        throw new Error('useTimer must be used within a TimerProvider');
    }
    return context;
}

interface TimerProviderProps {
    children: React.ReactNode;
    tasks: Task[];
    onUpdateTask: (taskId: string, updates: Partial<Task>) => Promise<void>;
}

export function TimerProvider({ children, tasks, onUpdateTask }: TimerProviderProps) {
    const supabase = createClient();
    const [runningTaskId, setRunningTaskId] = useState<string | null>(null);
    const [currentElapsedSeconds, setCurrentElapsedSeconds] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const intervalRef = useRef<NodeJS.Timeout | null>(null);

    // Find the running task from tasks array
    const runningTask = tasks.find(t => t.id === runningTaskId) ?? null;

    // Initialize: find any running timer on mount
    // IMPORTANT: If multiple timers are running (data inconsistency), keep only the most recent one
    useEffect(() => {
        const runningTasks = tasks.filter(t => t.is_timer_running === true);

        if (runningTasks.length === 0) {
            return;
        }

        if (runningTasks.length === 1) {
            // Normal case: exactly one timer running
            setRunningTaskId(runningTasks[0].id);
        } else {
            // Data inconsistency: multiple timers running
            // Keep the most recently started one, stop others
            console.warn('[TimerContext] Multiple running timers detected:', runningTasks.length);

            const sorted = runningTasks.sort((a, b) => {
                const aTime = new Date(a.last_started_at || 0).getTime();
                const bTime = new Date(b.last_started_at || 0).getTime();
                return bTime - aTime; // Most recent first
            });

            const keepTask = sorted[0];
            setRunningTaskId(keepTask.id);

            // Stop other timers (async, fire-and-forget for initialization)
            sorted.slice(1).forEach(async (task) => {
                console.log('[TimerContext] Stopping orphan timer:', task.id);
                await onUpdateTask(task.id, {
                    is_timer_running: false,
                    last_started_at: null
                });
            });
        }
    }, []); // Run only on mount, not on every tasks change

    // Update elapsed time every second when timer is running
    useEffect(() => {
        if (runningTask && runningTask.is_timer_running && runningTask.last_started_at) {
            // Calculate initial elapsed
            const startTime = new Date(runningTask.last_started_at).getTime();
            const baseSeconds = runningTask.total_elapsed_seconds ?? 0;

            const updateElapsed = () => {
                const now = Date.now();
                const additionalSeconds = Math.floor((now - startTime) / 1000);
                setCurrentElapsedSeconds(baseSeconds + additionalSeconds);
            };

            updateElapsed(); // Initial update

            intervalRef.current = setInterval(updateElapsed, 1000);

            return () => {
                if (intervalRef.current) {
                    clearInterval(intervalRef.current);
                }
            };
        } else if (runningTask) {
            // Timer exists but not running - show stored time
            setCurrentElapsedSeconds(runningTask.total_elapsed_seconds ?? 0);
        } else {
            setCurrentElapsedSeconds(0);
        }
    }, [runningTask]);

    // Calculate current elapsed for a specific task (for display)
    const getTaskElapsed = useCallback((task: Task): number => {
        if (task.is_timer_running && task.last_started_at) {
            const startTime = new Date(task.last_started_at).getTime();
            const additionalSeconds = Math.floor((Date.now() - startTime) / 1000);
            return (task.total_elapsed_seconds ?? 0) + additionalSeconds;
        }
        return task.total_elapsed_seconds ?? 0;
    }, []);

    // Stop any currently running timer (internal helper)
    const stopCurrentTimer = useCallback(async () => {
        if (!runningTaskId || !runningTask) return;

        // Calculate final elapsed time
        let finalSeconds = runningTask.total_elapsed_seconds ?? 0;
        if (runningTask.last_started_at) {
            const startTime = new Date(runningTask.last_started_at).getTime();
            const additionalSeconds = Math.floor((Date.now() - startTime) / 1000);
            finalSeconds += additionalSeconds;
        }

        // Update task in database
        await onUpdateTask(runningTaskId, {
            is_timer_running: false,
            last_started_at: null,
            total_elapsed_seconds: finalSeconds,
            actual_time_minutes: Math.floor(finalSeconds / 60)
        });

        setRunningTaskId(null);
        setCurrentElapsedSeconds(0);
    }, [runningTaskId, runningTask, onUpdateTask]);

    // Start timer for a task
    const startTimer = useCallback(async (task: Task): Promise<boolean> => {
        // EXCLUSIVE CONTROL: Check if another timer is running
        if (runningTaskId && runningTaskId !== task.id) {
            // Get the currently running task's title for the confirmation message
            const runningTaskTitle = runningTask?.title || '別のタスク';

            // Require explicit user confirmation before switching
            const confirmed = window.confirm(
                `「${runningTaskTitle}」でタイマーが実行中です。\n\n停止して「${task.title || 'このタスク'}」を開始しますか？`
            );

            if (!confirmed) {
                return false; // User cancelled - do not switch
            }

            // User confirmed - stop current timer first
            await stopCurrentTimer();
        }

        setIsLoading(true);
        try {
            // Start the new timer
            const now = new Date().toISOString();
            await onUpdateTask(task.id, {
                is_timer_running: true,
                last_started_at: now
            });

            setRunningTaskId(task.id);
            return true;
        } finally {
            setIsLoading(false);
        }
    }, [runningTaskId, runningTask, stopCurrentTimer, onUpdateTask]);

    // Pause timer (stop without completing)
    const pauseTimer = useCallback(async () => {
        setIsLoading(true);
        try {
            await stopCurrentTimer();
        } finally {
            setIsLoading(false);
        }
    }, [stopCurrentTimer]);

    // Complete timer (stop and mark task as done)
    const completeTimer = useCallback(async () => {
        if (!runningTaskId || !runningTask) return;

        setIsLoading(true);
        try {
            // Calculate final elapsed time
            let finalSeconds = runningTask.total_elapsed_seconds ?? 0;
            if (runningTask.last_started_at) {
                const startTime = new Date(runningTask.last_started_at).getTime();
                const additionalSeconds = Math.floor((Date.now() - startTime) / 1000);
                finalSeconds += additionalSeconds;
            }

            // Update task: stop timer AND mark as done
            await onUpdateTask(runningTaskId, {
                is_timer_running: false,
                last_started_at: null,
                total_elapsed_seconds: finalSeconds,
                actual_time_minutes: Math.floor(finalSeconds / 60),
                status: 'done'
            });

            setRunningTaskId(null);
            setCurrentElapsedSeconds(0);
        } finally {
            setIsLoading(false);
        }
    }, [runningTaskId, runningTask, onUpdateTask]);

    // Interrupt timer (same as pause, but UI indicates "returning to list")
    const interruptTimer = useCallback(async () => {
        await pauseTimer();
    }, [pauseTimer]);

    return (
        <TimerContext.Provider value={{
            runningTaskId,
            runningTask,
            currentElapsedSeconds,
            startTimer,
            pauseTimer,
            completeTimer,
            interruptTimer,
            isLoading
        }}>
            {children}
        </TimerContext.Provider>
    );
}

// Utility function to format seconds as HH:MM:SS
export function formatTime(totalSeconds: number): string {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}
