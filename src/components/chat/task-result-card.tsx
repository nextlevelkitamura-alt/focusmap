'use client';

import { useAiTaskStream } from '@/hooks/use-ai-task-stream';
import { Badge } from '@/components/ui/badge';
import { Loader2, Check, X, Activity, TriangleAlert, Workflow } from 'lucide-react';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface TaskResultCardProps {
  taskId: string;
}

interface RunnerSnapshot {
  id: string;
  hostname: string;
  display_name: string | null;
  executors: string[];
  last_heartbeat_at: string | null;
  metadata?: Record<string, unknown> | null;
}

const ONLINE_WINDOW_MS = 2 * 60 * 1000;

/**
 * Focusmap Lite (Phase F) のオンラインランナーが居るかどうかを軽量にpoll する。
 *
 * pending 状態のタスクが進まない最大の理由は executor='playwright' を claim できる Mac側
 * Focusmap Lite agent が起動していないこと。ここで明示警告を出して「自動化がハングしてる」
 * と誤解されるのを防ぐ。
 */
function useFocusmapLiteOnline(): { hasOnline: boolean | null; lastSeenMinutesAgo: number | null } {
  const [snapshot, setSnapshot] = useState<{ hasOnline: boolean | null; lastSeenMinutesAgo: number | null }>(
    { hasOnline: null, lastSeenMinutesAgo: null },
  );

  useEffect(() => {
    let cancelled = false;
    const fetchOnce = async () => {
      try {
        const res = await fetch('/api/ai-runners', { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as { runners?: RunnerSnapshot[] };
        const runners = data.runners ?? [];
        const now = Date.now();
        const liteRunners = runners.filter((r) => {
          const meta = r.metadata as { agent?: string; app?: string } | null;
          if (meta?.agent === 'focusmap-agent' || meta?.app === 'focusmap-lite') return true;
          const exec = r.executors ?? [];
          return exec.includes('playwright') || exec.includes('simple');
        });
        const onlineLite = liteRunners.filter((r) => {
          if (!r.last_heartbeat_at) return false;
          return now - new Date(r.last_heartbeat_at).getTime() < ONLINE_WINDOW_MS;
        });
        const latestHeartbeatMs = liteRunners.reduce<number>((max, r) => {
          if (!r.last_heartbeat_at) return max;
          const t = new Date(r.last_heartbeat_at).getTime();
          return t > max ? t : max;
        }, 0);
        const minutesAgo = latestHeartbeatMs > 0 ? Math.round((now - latestHeartbeatMs) / 60_000) : null;
        if (!cancelled) {
          setSnapshot({ hasOnline: onlineLite.length > 0, lastSeenMinutesAgo: minutesAgo });
        }
      } catch {
        if (!cancelled) setSnapshot({ hasOnline: null, lastSeenMinutesAgo: null });
      }
    };
    void fetchOnce();
    const id = window.setInterval(() => void fetchOnce(), 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return snapshot;
}

const STATUS_LABEL: Record<string, string> = {
  pending: '待機中',
  running: '実行中',
  awaiting_approval: '確認待ち',
  needs_input: '入力待ち',
  completed: '完了',
  failed: '失敗',
};

const STATUS_COLOR: Record<string, string> = {
  pending: 'text-muted-foreground',
  running: 'text-blue-600 dark:text-blue-400',
  awaiting_approval: 'text-amber-600 dark:text-amber-400',
  completed: 'text-emerald-600 dark:text-emerald-400',
  failed: 'text-red-600 dark:text-red-400',
};

export function TaskResultCard({ taskId }: TaskResultCardProps) {
  const { task, loading } = useAiTaskStream(taskId);
  const [showRaw, setShowRaw] = useState(false);
  const [liveLog, setLiveLog] = useState<string>('');
  const liteStatus = useFocusmapLiteOnline();

  useEffect(() => {
    if (!taskId) return;
    let mounted = true;

    const fetchLiveLog = async () => {
      try {
        const res = await fetch(`/api/ai-tasks/${taskId}/live-log`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (mounted) setLiveLog(typeof data.log === 'string' ? data.log : '');
      } catch {
        if (mounted) setLiveLog('');
      }
    };

    void fetchLiveLog();
    const interval = window.setInterval(() => {
      if (task?.status === 'completed' || task?.status === 'failed') {
        window.clearInterval(interval);
        return;
      }
      void fetchLiveLog();
    }, 4000);

    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, [task?.status, taskId]);

  if (loading || !task) {
    return (
      <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs flex items-center gap-1.5">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        タスク情報を取得中...
      </div>
    );
  }

  const result = task.result as
    | { steps?: Array<{ label: string; status: string }>; output?: string; live_log?: string; message?: string }
    | null;
  const rawLog = liveLog || result?.live_log || result?.message || '';
  const visibleLog = rawLog.trim().split('\n').slice(-8).join('\n');

  return (
    <div className="space-y-2 rounded-md border border-border/60 bg-muted/30 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs">
          {task.status === 'running' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {task.status === 'completed' && <Check className="h-3.5 w-3.5 text-emerald-500" />}
          {task.status === 'failed' && <X className="h-3.5 w-3.5 text-red-500" />}
          {!['running', 'completed', 'failed'].includes(task.status) && (
            <Activity className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <Badge variant="outline" className={cn('text-[10px]', STATUS_COLOR[task.status])}>
            {STATUS_LABEL[task.status] ?? task.status}
          </Badge>
        </div>
        <span className="text-[10px] text-muted-foreground font-mono">{taskId.slice(0, 8)}</span>
      </div>

      {/* Focusmap Lite が居ない → 待機中の理由を明示 (pending が 5秒以上続いたら表示) */}
      {task.status === 'pending' && liteStatus.hasOnline === false && (
        <div className="rounded-md border border-amber-300/50 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-950/30 p-2.5 text-[11px] space-y-1.5">
          <p className="flex items-center gap-1 font-medium text-amber-800 dark:text-amber-200">
            <TriangleAlert className="h-3.5 w-3.5" />
            Focusmap Lite が起動していないため待機中
          </p>
          <p className="text-amber-700/90 dark:text-amber-300/90 leading-5">
            このタスクは Mac 側の Focusmap Lite (Playwright 実行担当) が claim します。
            {liteStatus.lastSeenMinutesAgo !== null
              ? ` 最終 heartbeat は ${liteStatus.lastSeenMinutesAgo} 分前です。`
              : ' まだ heartbeat を受信していません。'}
          </p>
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            <Button asChild size="sm" className="h-7 gap-1 text-[11px]">
              <Link href="/dashboard/settings/automation">
                <Workflow className="h-3 w-3" />
                セットアップを開く
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="h-7 gap-1 text-[11px]">
              <Link href="/dashboard/workspace/setup?step=2">
                エージェント導入
              </Link>
            </Button>
          </div>
          <p className="text-[10px] text-amber-700/70 dark:text-amber-300/70">
            ヒント: ターミナルで <code className="bg-amber-100/60 dark:bg-amber-900/40 px-1 rounded">launchctl list | grep focusmap</code> で常駐状態を確認できます。
          </p>
        </div>
      )}

      {/* Steps progress */}
      {result?.steps && result.steps.length > 0 && (
        <ol className="space-y-1 text-xs">
          {result.steps.map((s, i) => (
            <li key={i} className="flex items-center gap-1.5">
              {s.status === 'done' && <Check className="h-3 w-3 text-emerald-500 shrink-0" />}
              {s.status === 'running' && (
                <Loader2 className="h-3 w-3 animate-spin shrink-0 text-blue-500" />
              )}
              {s.status === 'failed' && <X className="h-3 w-3 text-red-500 shrink-0" />}
              {s.status === 'pending' && (
                <Activity className="h-3 w-3 text-muted-foreground shrink-0" />
              )}
              <span
                className={cn(
                  'truncate',
                  s.status === 'done' && 'text-muted-foreground',
                  s.status === 'failed' && 'text-red-600 dark:text-red-400',
                )}
              >
                {s.label}
              </span>
            </li>
          ))}
        </ol>
      )}

      {visibleLog && (
        <div className="rounded border border-border/40 bg-background p-2">
          <div className="mb-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
            {task.status === 'running' && <Loader2 className="h-3 w-3 animate-spin" />}
            実行ログ
          </div>
          <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-4 text-muted-foreground">
            {visibleLog}
          </pre>
        </div>
      )}

      {/* Output (completed時) */}
      {task.status === 'completed' && result?.output && (
        <div className="rounded border border-border/40 bg-background p-2 text-xs">
          <pre className="whitespace-pre-wrap break-all font-mono text-[11px]">
            {tryFormatJson(result.output)}
          </pre>
        </div>
      )}

      {/* Error */}
      {task.status === 'failed' && task.error && (
        <p className="text-xs text-red-600 dark:text-red-400">{task.error}</p>
      )}

      <button
        type="button"
        onClick={() => setShowRaw((v) => !v)}
        className="text-[10px] text-muted-foreground hover:text-foreground"
      >
        {showRaw ? '詳細を閉じる' : '詳細を表示'}
      </button>

      {showRaw && (
        <pre className="rounded border border-border/40 bg-background p-2 text-[10px] overflow-x-auto">
          {JSON.stringify(task, null, 2)}
        </pre>
      )}
    </div>
  );
}

function tryFormatJson(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return raw;
  }
}
