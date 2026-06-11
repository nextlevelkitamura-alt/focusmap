'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Bot,
  CheckCircle2,
  Clock3,
  Laptop,
  Loader2,
  RefreshCw,
  TriangleAlert,
  WifiOff,
} from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { fetchWithSupabaseAuth } from '@/lib/auth/supabase-auth-fetch';
import { cn } from '@/lib/utils';

interface Runner {
  id: string;
  hostname: string;
  display_name: string | null;
  executors: string[];
  last_heartbeat_at: string | null;
  metadata?: Record<string, unknown> | null;
}

interface HeartbeatRow {
  runner_id?: string | null;
  device_id?: string | null;
  status?: string | null;
  last_seen_at?: string | null;
  current_task_id?: string | null;
  version?: string | null;
  metadata_json?: Record<string, unknown> | null;
}

type AnnotatedRunner = Runner & {
  ageMs: number;
  isOnline: boolean;
  isFocusmapAgent: boolean;
};

const HEARTBEAT_ONLINE_WINDOW_MS = 90 * 1000;
const POLL_INTERVAL_MS = 30_000;

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : [];
}

function boolFromMetadata(metadata: Record<string, unknown> | null | undefined, key: string) {
  return metadata?.[key] === true;
}

function stringFromMetadata(metadata: Record<string, unknown> | null | undefined, key: string) {
  const value = metadata?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isFocusmapAgent(runner: Runner) {
  const metadata = runner.metadata ?? {};
  return metadata.agent === 'focusmap-agent' || metadata.app === 'focusmap-lite';
}

function mapHeartbeat(row: HeartbeatRow, registered?: Runner): Runner | null {
  const id = row.runner_id?.trim() || registered?.id;
  if (!id) return null;
  const heartbeatMetadata = row.metadata_json ?? {};
  const metadata: Record<string, unknown> = {
    ...(registered?.metadata ?? {}),
    ...heartbeatMetadata,
    ...(row.status ? { runner_status: row.status } : {}),
    ...(row.current_task_id !== undefined ? { current_task_id: row.current_task_id } : {}),
    ...(row.version ? { version: row.version } : {}),
  };
  return {
    id,
    hostname: row.device_id?.trim() || registered?.hostname || id,
    display_name: registered?.display_name ?? row.device_id?.trim() ?? id,
    executors: registered?.executors?.length
      ? registered.executors
      : stringArray(metadata.executors),
    last_heartbeat_at: row.last_seen_at ?? registered?.last_heartbeat_at ?? null,
    metadata,
  };
}

function formatAge(ms: number): string {
  if (!Number.isFinite(ms)) return '未取得';
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}秒前`;
  if (ms < 60 * 60_000) return `${Math.round(ms / 60_000)}分前`;
  if (ms < 24 * 60 * 60_000) return `${Math.round(ms / (60 * 60_000))}時間前`;
  return `${Math.round(ms / (24 * 60 * 60_000))}日前`;
}

function formatTime(value: string | null | undefined) {
  if (!value) return '未取得';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未取得';
  return date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function statusChip(ok: boolean, label: string) {
  return (
    <span
      className={cn(
        'inline-flex h-7 shrink-0 items-center rounded-full px-3 text-xs font-medium',
        ok
          ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-500/12 dark:text-emerald-300 dark:ring-emerald-400/30'
          : 'bg-zinc-100 text-zinc-600 ring-1 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-white/[0.08]',
      )}
    >
      {label}
    </span>
  );
}

function StatusRow({
  icon: Icon,
  label,
  value,
  detail,
  ok,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  detail: string;
  ok: boolean;
}) {
  return (
    <div className="flex min-h-[64px] items-center gap-3 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-white/[0.08] dark:bg-black/30">
      <span
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-md',
          ok ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{label}</p>
          {statusChip(ok, value)}
        </div>
        <p className="mt-1 truncate text-xs text-zinc-500">{detail}</p>
      </div>
    </div>
  );
}

/**
 * Settings AI page primary status.
 * Shows the single Mac-side Focusmap agent as the operational source of truth.
 */
export function AgentStatusBadge() {
  const [runners, setRunners] = useState<Runner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchRunners = async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const [heartbeatRes, runnerRes] = await Promise.all([
        fetchWithSupabaseAuth('/api/task-progress/runner-heartbeats?limit=20', { cache: 'no-store' }),
        fetchWithSupabaseAuth('/api/ai-runners', { cache: 'no-store' }),
      ]);
      if (!heartbeatRes.ok && !runnerRes.ok) {
        throw new Error(`heartbeat HTTP ${heartbeatRes.status} / runners HTTP ${runnerRes.status}`);
      }

      const runnerData = runnerRes.ok ? await runnerRes.json() : null;
      const registered = Array.isArray(runnerData?.runners) ? runnerData.runners as Runner[] : [];
      const registeredById = new Map(registered.map((runner) => [runner.id, runner]));

      if (heartbeatRes.ok) {
        const heartbeatData = await heartbeatRes.json();
        const heartbeats = Array.isArray(heartbeatData?.heartbeats) ? heartbeatData.heartbeats as HeartbeatRow[] : [];
        const mapped = heartbeats
          .map((row) => mapHeartbeat(row, row.runner_id ? registeredById.get(row.runner_id) : undefined))
          .filter((row): row is Runner => Boolean(row));
        setRunners(mapped.length > 0 ? mapped : registered);
      } else {
        setRunners(registered);
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '取得失敗');
    } finally {
      setLoading(false);
      if (manual) window.setTimeout(() => setRefreshing(false), 400);
    }
  };

  useEffect(() => {
    void fetchRunners();
    const id = window.setInterval(() => void fetchRunners(), POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, []);

  const annotated = useMemo<AnnotatedRunner[]>(() => {
    const now = Date.now();
    return runners.map((runner) => {
      const lastSeenAt = runner.last_heartbeat_at ? new Date(runner.last_heartbeat_at).getTime() : 0;
      const ageMs = lastSeenAt > 0 ? now - lastSeenAt : Infinity;
      return {
        ...runner,
        ageMs,
        isOnline: ageMs < HEARTBEAT_ONLINE_WINDOW_MS,
        isFocusmapAgent: isFocusmapAgent(runner),
      };
    });
  }, [runners]);

  const primary = useMemo(() => {
    const candidates = annotated.filter((runner) => runner.isFocusmapAgent);
    const pool = candidates.length > 0 ? candidates : annotated;
    return [...pool].sort((a, b) => {
      if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
      return a.ageMs - b.ageMs;
    })[0] ?? null;
  }, [annotated]);

  if (loading) {
    return (
      <section className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-600 shadow-sm dark:border-white/[0.08] dark:bg-[#1c1c1e] dark:text-zinc-400 dark:shadow-none">
        <Loader2 className="h-4 w-4 animate-spin" />
        AIエージェント状態を取得中...
      </section>
    );
  }

  const metadata = primary?.metadata ?? {};
  const isOnline = Boolean(primary?.isOnline);
  const currentTaskId = stringFromMetadata(metadata, 'current_task_id');
  const agentState = stringFromMetadata(metadata, 'agent_state') ?? (currentTaskId ? 'running' : 'idle');
  const codexInstalled = boolFromMetadata(metadata, 'codex_app_installed') || Boolean(primary?.executors?.includes('codex_app'));
  const codexServerReady = boolFromMetadata(metadata, 'codex_app_server_ready');
  const codexReady = isOnline && codexInstalled && codexServerReady;
  const hiddenRegistrations = Math.max(0, annotated.length - (primary ? 1 : 0));

  return (
    <section
      className={cn(
        'rounded-lg border bg-white p-4 shadow-sm md:p-5 dark:bg-[#1c1c1e] dark:shadow-none',
        isOnline ? 'border-emerald-200 dark:border-emerald-400/30' : 'border-zinc-200 dark:border-white/[0.08]',
      )}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={cn(
              'flex h-11 w-11 shrink-0 items-center justify-center rounded-lg',
              isOnline ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
            )}
          >
            {isOnline ? <CheckCircle2 className="h-5 w-5" /> : <WifiOff className="h-5 w-5" />}
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">AI Agent</p>
            <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
              {isOnline ? 'Macエージェント オンライン' : primary ? 'Macエージェント オフライン' : 'Macエージェント未接続'}
            </h2>
            <p className="mt-1 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
              {primary
                ? `${primary.display_name ?? primary.hostname} がFocusmapのAI実行とCodex連携を巡回します。`
                : 'まだMacエージェントが登録されていません。'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-10 gap-1.5"
            onClick={() => void fetchRunners(true)}
            disabled={refreshing}
          >
            <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
            更新
          </Button>
          {!primary && (
            <Button asChild className="h-10">
              <Link href="/dashboard/workspace/setup?step=2">Macエージェントを導入</Link>
            </Button>
          )}
        </div>
      </div>

      {error && (
        <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-400/20 dark:bg-red-500/10 dark:text-red-200">
          取得エラー: {error}
        </p>
      )}

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <StatusRow
          icon={Clock3}
          label="最終更新"
          value={isOnline ? '有効' : '停止'}
          detail={primary?.last_heartbeat_at ? `${formatTime(primary.last_heartbeat_at)} / ${formatAge(primary.ageMs)}` : 'heartbeatなし'}
          ok={isOnline}
        />
        <StatusRow
          icon={Activity}
          label="巡回状態"
          value={agentState === 'running' ? '実行中' : isOnline ? '待機中' : '停止'}
          detail={currentTaskId ? `実行中タスク: ${currentTaskId}` : '実行中タスクなし'}
          ok={isOnline}
        />
        <StatusRow
          icon={Bot}
          label="Codex連携"
          value={codexReady ? 'OK' : codexInstalled ? '要確認' : '未導入'}
          detail={codexReady ? 'Codex Desktop / app-server を確認済み' : codexInstalled ? 'Codexは導入済み。app-server確認待ち' : 'Codex Desktopの導入が必要です'}
          ok={codexReady}
        />
        <StatusRow
          icon={Laptop}
          label="表示中のMac"
          value={primary ? '登録済み' : '未登録'}
          detail={primary?.hostname ?? 'Macエージェントを導入するとここに表示されます'}
          ok={Boolean(primary)}
        />
      </div>

      <div className="mt-3 flex flex-col gap-1 text-xs leading-5 text-zinc-500 md:flex-row md:items-center md:justify-between">
        <span>この画面は30秒ごとに自動更新します。</span>
        {hiddenRegistrations > 0 && <span>古い/重複した登録 {hiddenRegistrations}件は通常表示から隠しています。</span>}
      </div>

      {!isOnline && primary && (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-100">
          <div className="flex items-center gap-1.5 font-medium">
            <TriangleAlert className="h-3.5 w-3.5" />
            Macエージェントから最近の更新が届いていません。
          </div>
          <p className="mt-1 text-amber-700 dark:text-amber-100/80">Macが起動しているか、Focusmap Macアプリを開いて再接続してください。</p>
        </div>
      )}
    </section>
  );
}
