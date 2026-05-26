'use client';

import { useAiTaskStream } from '@/hooks/use-ai-task-stream';
import { Badge } from '@/components/ui/badge';
import { Loader2, Check, X, Activity } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

interface TaskResultCardProps {
  taskId: string;
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

  if (loading || !task) {
    return (
      <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs flex items-center gap-1.5">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        タスク情報を取得中...
      </div>
    );
  }

  const result = task.result as
    | { steps?: Array<{ label: string; status: string }>; output?: string }
    | null;

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
