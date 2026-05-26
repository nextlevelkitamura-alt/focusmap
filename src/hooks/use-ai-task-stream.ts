'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';

export interface StreamedTask {
  id: string;
  status: 'pending' | 'running' | 'awaiting_approval' | 'needs_input' | 'completed' | 'failed';
  result: Record<string, unknown> | null;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
}

/**
 * 指定 task_id の ai_tasks status 変化を Supabase Realtime で監視
 * 初回マウント時に現在の状態をfetch、以降は postgres_changes で update
 */
export function useAiTaskStream(taskId: string | null): {
  task: StreamedTask | null;
  loading: boolean;
} {
  const [task, setTask] = useState<StreamedTask | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    if (!taskId) {
      setTask(null);
      setLoading(false);
      return;
    }

    const supabase = createClient();
    let mounted = true;

    // 1. 初回 fetch
    void (async () => {
      const { data } = await supabase
        .from('ai_tasks')
        .select('id, status, result, error, started_at, completed_at')
        .eq('id', taskId)
        .maybeSingle();
      if (mounted && data) {
        setTask(data as StreamedTask);
      }
      if (mounted) setLoading(false);
    })();

    // 2. Realtime 購読
    const channel = supabase
      .channel(`ai_task:${taskId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'ai_tasks',
          filter: `id=eq.${taskId}`,
        },
        (payload) => {
          if (!mounted) return;
          const newRow = payload.new as Partial<StreamedTask>;
          setTask((prev) => ({ ...(prev ?? ({} as StreamedTask)), ...newRow } as StreamedTask));
        },
      )
      .subscribe();

    return () => {
      mounted = false;
      void supabase.removeChannel(channel);
    };
  }, [taskId]);

  return { task, loading };
}
