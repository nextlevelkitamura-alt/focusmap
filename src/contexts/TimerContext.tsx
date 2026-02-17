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

    // Local tracking for timer data (works even when task is not in `tasks` prop)
    const localTimerDataRef = useRef<{
        lastStartedAt: string | null;
        baseElapsedSeconds: number;
        taskTitle: string;
    }>({ lastStartedAt: null, baseElapsedSeconds: 0, taskTitle: '' });

    // Find the running task from tasks array (may be null for habit child tasks)
    const runningTask = tasks.find(t => t.id === runningTaskId) ?? null;

    // Initialize: find any running timer on mount
    useEffect(() => {
        const runningTasks = tasks.filter(t => t.is_timer_running === true);

        if (runningTasks.length === 0) {
            return;
        }

        if (runningTasks.length === 1) {
            setRunningTaskId(runningTasks[0].id);
            localTimerDataRef.current = {
                lastStartedAt: runningTasks[0].last_started_at || null,
                baseElapsedSeconds: runningTasks[0].total_elapsed_seconds ?? 0,
                taskTitle: runningTasks[0].title,
            };
        } else {
            console.warn('[TimerContext] Multiple running timers detected:', runningTasks.length);

            const sorted = runningTasks.sort((a, b) => {
                const aTime = new Date(a.last_started_at || 0).getTime();
                const bTime = new Date(b.last_started_at || 0).getTime();
                return bTime - aTime;
            });

            const keepTask = sorted[0];
            setRunningTaskId(keepTask.id);
            localTimerDataRef.current = {
                lastStartedAt: keepTask.last_started_at || null,
                baseElapsedSeconds: keepTask.total_elapsed_seconds ?? 0,
                taskTitle: keepTask.title,
            };

            sorted.slice(1).forEach(async (task) => {
                console.log('[TimerContext] Stopping orphan timer:', task.id);
                await onUpdateTask(task.id, {
                    is_timer_running: false,
                    last_started_at: null
                });
            });
        }
    }, []); // Run only on mount

    // Update elapsed time every second when timer is running
    // Uses localTimerDataRef so it works even when runningTask is null
    useEffect(() => {
        const localData = localTimerDataRef.current;

        if (runningTaskId && localData.lastStartedAt) {
            const startTime = new Date(localData.lastStartedAt).getTime();
            const baseSeconds = localData.baseElapsedSeconds;

            const updateElapsed = () => {
                const now = Date.now();
                const additionalSeconds = Math.floor((now - startTime) / 1000);
                setCurrentElapsedSeconds(baseSeconds + additionalSeconds);
            };

            updateElapsed();
            intervalRef.current = setInterval(updateElapsed, 1000);

            return () => {
                if (intervalRef.current) {
                    clearInterval(intervalRef.current);
                }
            };
        } else if (runningTaskId) {
            setCurrentElapsedSeconds(localData.baseElapsedSeconds);
        } else {
            setCurrentElapsedSeconds(0);
        }
    }, [runningTaskId, runningTask]);

    // Stop any currently running timer (internal helper)
    // Works even when runningTask is null by using localTimerDataRef
    const stopCurrentTimer = useCallback(async () => {
        if (!runningTaskId) return;

        const localData = localTimerDataRef.current;

        // Calculate final elapsed time using local tracking data
        let finalSeconds = localData.baseElapsedSeconds;
        if (localData.lastStartedAt) {
            const startTime = new Date(localData.lastStartedAt).getTime();
            const additionalSeconds = Math.floor((Date.now() - startTime) / 1000);
            finalSeconds += additionalSeconds;
        }

        console.log('[TimerContext] Stopping timer:', runningTaskId.slice(0, 8), 'elapsed:', finalSeconds, 's');

        // Update task in database
        await onUpdateTask(runningTaskId, {
            is_timer_running: false,
            last_started_at: null,
            total_elapsed_seconds: finalSeconds,
            actual_time_minutes: Math.floor(finalSeconds / 60)
        });

        // Reset local state
        localTimerDataRef.current = { lastStartedAt: null, baseElapsedSeconds: 0, taskTitle: '' };
        setRunningTaskId(null);
        setCurrentElapsedSeconds(0);
    }, [runningTaskId, onUpdateTask]);

    // Start timer for a task
    const startTimer = useCallback(async (task: Task): Promise<boolean> => {
        // EXCLUSIVE CONTROL: Check if another timer is running
        if (runningTaskId && runningTaskId !== task.id) {
            const runningTaskTitle = runningTask?.title || localTimerDataRef.current.taskTitle || '別のタスク';

            const confirmed = window.confirm(
                `「${runningTaskTitle}」でタイマーが実行中です。\n\n停止して「${task.title || 'このタスク'}」を開始しますか？`
            );

            if (!confirmed) {
                return false;
            }

            await stopCurrentTimer();
        }

        setIsLoading(true);
        try {
            const now = new Date().toISOString();

            // Store timer data locally BEFORE the DB call
            localTimerDataRef.current = {
                lastStartedAt: now,
                baseElapsedSeconds: task.total_elapsed_seconds ?? 0,
                taskTitle: task.title,
            };

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
        if (!runningTaskId) return;

        setIsLoading(true);
        try {
            const localData = localTimerDataRef.current;

            let finalSeconds = localData.baseElapsedSeconds;
            if (localData.lastStartedAt) {
                const startTime = new Date(localData.lastStartedAt).getTime();
                const additionalSeconds = Math.floor((Date.now() - startTime) / 1000);
                finalSeconds += additionalSeconds;
            }

            await onUpdateTask(runningTaskId, {
                is_timer_running: false,
                last_started_at: null,
                total_elapsed_seconds: finalSeconds,
                actual_time_minutes: Math.floor(finalSeconds / 60),
                status: 'done'
            });

            localTimerDataRef.current = { lastStartedAt: null, baseElapsedSeconds: 0, taskTitle: '' };
            setRunningTaskId(null);
            setCurrentElapsedSeconds(0);
        } finally {
            setIsLoading(false);
        }
    }, [runningTaskId, onUpdateTask]);

    // Interrupt timer (same as pause)
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
