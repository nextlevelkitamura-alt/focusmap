'use client';

import { useEffect, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Cpu,
  Laptop,
  Loader2,
  RefreshCw,
  Server,
  Terminal,
  TriangleAlert,
  WifiOff,
  Bot,
  Workflow,
  HelpCircle,
} from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Runner {
  id: string;
  hostname: string;
  display_name: string | null;
  executors: string[];
  last_heartbeat_at: string | null;
  available_secret_names?: string[];
  metadata?: Record<string, unknown> | null;
}

/**
 * エージェント種別判定:
 * - codex-rpc-bridge (旧): executors に claude/codex/codex_app
 * - focusmap-agent (Phase F): executors に playwright/simple、 metadata.agent === 'focusmap-agent'
 * - 不明: それ以外
 */
type AgentKind = 'focusmap-lite' | 'codex-bridge' | 'unknown';

function detectAgentKind(r: Runner): AgentKind {
  const meta = r.metadata as { agent?: string; app?: string } | null;
  if (meta?.agent === 'focusmap-agent' || meta?.app === 'focusmap-lite') return 'focusmap-lite';
  const exec = r.executors ?? [];
  if (exec.includes('playwright') || exec.includes('simple')) return 'focusmap-lite';
  if (exec.includes('claude') || exec.includes('codex') || exec.includes('codex_app')) return 'codex-bridge';
  return 'unknown';
}

const KIND_META: Record<AgentKind, { label: string; icon: typeof Bot; color: string }> = {
  'focusmap-lite': {
    label: 'Focusmap Lite',
    icon: Workflow,
    color: 'text-blue-600 dark:text-blue-400',
  },
  'codex-bridge': {
    label: 'Claude / Codex Bridge (既存)',
    icon: Bot,
    color: 'text-purple-600 dark:text-purple-400',
  },
  unknown: {
    label: '不明 (executor未識別)',
    icon: HelpCircle,
    color: 'text-muted-foreground',
  },
};

const HEARTBEAT_ONLINE_WINDOW_MS = 2 * 60 * 1000; // 2分以内なら ONLINE
const POLL_INTERVAL_MS = 5_000;

function formatAge(ms: number): string {
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}秒前`;
  if (ms < 60 * 60_000) return `${Math.round(ms / 60_000)}分前`;
  if (ms < 24 * 60 * 60_000) return `${Math.round(ms / (60 * 60_000))}時間前`;
  return `${Math.round(ms / (24 * 60 * 60_000))}日前`;
}

/**
 * 設定画面に常時表示するエージェント常駐状況バッジ。
 * - 5秒ごとに /api/ai-runners をpollして 最新状態を反映
 * - 接続中の数を カード で表示
 * - 接続無しなら 「セットアップ手順を開く」 CTA
 * - 各 runner の hostname / executors / 最終heartbeat を一覧表示
 */
export function AgentStatusBadge() {
  const [runners, setRunners] = useState<Runner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchRunners = async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const res = await fetch('/api/ai-runners', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRunners(Array.isArray(data?.runners) ? data.runners : []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '取得失敗');
    } finally {
      setLoading(false);
      if (manual) setTimeout(() => setRefreshing(false), 400);
    }
  };

  useEffect(() => {
    void fetchRunners();
    const id = window.setInterval(() => void fetchRunners(), POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, []);

  const now = Date.now();
  const annotated = runners.map((r) => {
    const lastSeenAt = r.last_heartbeat_at ? new Date(r.last_heartbeat_at).getTime() : 0;
    const ageMs = lastSeenAt > 0 ? now - lastSeenAt : Infinity;
    const isOnline = ageMs < HEARTBEAT_ONLINE_WINDOW_MS;
    const kind = detectAgentKind(r);
    return { ...r, isOnline, ageMs, kind };
  });
  const onlineCount = annotated.filter((r) => r.isOnline).length;
  const totalCount = annotated.length;
  const hasOnline = onlineCount > 0;
  const hasFocusmapLiteOnline = annotated.some((r) => r.isOnline && r.kind === 'focusmap-lite');
  const hasCodexBridgeOnline = annotated.some((r) => r.isOnline && r.kind === 'codex-bridge');
  const hasCodexAppOnline = annotated.some((r) => r.isOnline && (r.executors ?? []).includes('codex_app'));

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border/40 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        エージェント状態を取得中…
      </div>
    );
  }

  return (
    <section
      className={cn(
        'rounded-lg border bg-gradient-to-br p-4 md:p-5 space-y-3',
        hasOnline
          ? 'border-emerald-300/50 from-emerald-50/50 to-transparent dark:border-emerald-900/40 dark:from-emerald-950/20'
          : totalCount > 0
          ? 'border-amber-300/50 from-amber-50/50 to-transparent dark:border-amber-900/40 dark:from-amber-950/20'
          : 'border-border/40 from-muted/30 to-transparent',
      )}
    >
      {/* ヘッダー: アイコン + 状態タイトル + 更新 */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-3 min-w-0">
          <span
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-full shadow-sm',
              hasOnline
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                : totalCount > 0
                ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                : 'bg-muted text-muted-foreground',
            )}
          >
            {hasOnline ? (
              <CheckCircle2 className="h-5 w-5" />
            ) : totalCount > 0 ? (
              <TriangleAlert className="h-5 w-5" />
            ) : (
              <WifiOff className="h-5 w-5" />
            )}
          </span>
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              常駐エージェント (Focusmap Lite)
            </p>
            <h3 className="text-base font-semibold">
              {hasOnline
                ? `${onlineCount}台 オンライン`
                : totalCount > 0
                ? `${totalCount}台 登録済み (オフライン)`
                : '未接続'}
            </h3>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {hasOnline
                ? hasCodexAppOnline
                  ? '自動化タスクとCodex.app送信を実行できます。Mac側 launchd で常駐中。'
                  : '自動化タスクを実行できます。Codex.app送信はCodex.app導入後にセットアップを再実行してください。'
                : totalCount > 0
                ? 'エージェントから heartbeat が届いていません。Mac が起動しているか、 launchctl 経由で動いているか確認してください。'
                : 'まだエージェントが導入されていません。 セットアップ画面からダウンロード → ダブルクリックで起動できます。'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1 text-[11px]"
            onClick={() => void fetchRunners(true)}
            disabled={refreshing}
          >
            <RefreshCw className={cn('h-3 w-3', refreshing && 'animate-spin')} />
            更新
          </Button>
        </div>
      </div>

      {error && (
        <p className="text-[11px] text-red-600 dark:text-red-400">取得エラー: {error}</p>
      )}

      {/* 接続無し: CTA */}
      {totalCount === 0 && (
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" className="gap-1">
            <Link href="/dashboard/workspace/setup?step=2">
              <Server className="h-3.5 w-3.5" />
              セットアップする
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="gap-1">
            <Link href="https://focusmap-official.com/install.sh" target="_blank" rel="noreferrer">
              <Terminal className="h-3.5 w-3.5" />
              install.sh を確認
            </Link>
          </Button>
        </div>
      )}

      {/* Focusmap Lite が未起動の警告 */}
      {totalCount > 0 && !hasFocusmapLiteOnline && (
        <div className="rounded-md border border-amber-300/50 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-950/30 px-3 py-2 text-[11px] space-y-1.5">
          <p className="flex items-center gap-1 font-medium text-amber-800 dark:text-amber-200">
            <TriangleAlert className="h-3.5 w-3.5" />
            Focusmap Lite (Phase F の新機能) は未起動
          </p>
          <p className="text-amber-700/90 dark:text-amber-300/90">
            ファイル操作 / ブラウザ自動操作 / Playwright を使うには Focusmap Lite が必要です。
            {hasCodexBridgeOnline && '現在オンラインの Claude/Codex Bridge は別エージェントで、 Phase F の新コマンドには対応していません。'}
          </p>
          <Button asChild size="sm" className="h-7 gap-1 text-[11px]">
            <Link href="/dashboard/workspace/setup?step=2">
              <Workflow className="h-3 w-3" />
              Focusmap Lite をセットアップ
            </Link>
          </Button>
        </div>
      )}

      {/* 各 runner の一覧 */}
      {annotated.length > 0 && (
        <ul className="space-y-1.5">
          {annotated.map((r) => {
            const kindMeta = KIND_META[r.kind];
            const KindIcon = kindMeta.icon;
            return (
              <li
                key={r.id}
                className={cn(
                  'flex items-start justify-between gap-3 rounded-md border bg-background/60 px-3 py-2 text-xs',
                  r.isOnline ? 'border-emerald-300/50 dark:border-emerald-900/40' : 'border-border/40',
                )}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Laptop
                    className={cn(
                      'h-3.5 w-3.5 shrink-0',
                      r.isOnline ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground',
                    )}
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 truncate">
                      <p className="truncate font-medium text-foreground">
                        {r.display_name ?? r.hostname}
                      </p>
                      <span
                        className={cn(
                          'inline-flex shrink-0 items-center gap-0.5 rounded border border-border/40 bg-muted/40 px-1 py-0.5 text-[9px]',
                          kindMeta.color,
                        )}
                        title={`エージェント種別: ${kindMeta.label}`}
                      >
                        <KindIcon className="h-2.5 w-2.5" />
                        {kindMeta.label}
                      </span>
                    </div>
                    <p className="truncate text-[10px] text-muted-foreground">
                      {r.hostname} ・ executors: {r.executors.join(', ') || '-'}
                    </p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px]',
                      r.isOnline
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                        : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {r.isOnline ? <Activity className="h-2.5 w-2.5 animate-pulse" /> : <WifiOff className="h-2.5 w-2.5" />}
                    {r.isOnline ? 'オンライン' : 'オフライン'}
                  </span>
                  <p className="mt-0.5 text-[10px] text-muted-foreground tabular-nums">
                    {r.last_heartbeat_at
                      ? `最終 ${formatAge(r.ageMs)}`
                      : 'heartbeat なし'}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* トラブルシュート */}
      <details className="text-[11px] text-muted-foreground">
        <summary className="cursor-pointer select-none hover:text-foreground">
          常駐状況をターミナルで確認する方法
        </summary>
        <div className="mt-2 space-y-2">
          <div>
            <p className="font-medium text-foreground">プロセス確認:</p>
            <pre className="mt-1 overflow-x-auto rounded border border-border/40 bg-background px-2 py-1.5 font-mono text-[10px]">
launchctl list | grep focusmap
            </pre>
          </div>
          <div>
            <p className="font-medium text-foreground">ログを tail:</p>
            <pre className="mt-1 overflow-x-auto rounded border border-border/40 bg-background px-2 py-1.5 font-mono text-[10px]">
tail -f ~/.focusmap/logs/agent.log
            </pre>
          </div>
          <div>
            <p className="font-medium text-foreground">再起動:</p>
            <pre className="mt-1 overflow-x-auto rounded border border-border/40 bg-background px-2 py-1.5 font-mono text-[10px]">
launchctl unload ~/Library/LaunchAgents/com.focusmap-official.agent.plist
launchctl load   ~/Library/LaunchAgents/com.focusmap-official.agent.plist
            </pre>
          </div>
          <p className="flex items-center gap-1 text-[10px]">
            <Cpu className="h-3 w-3" />
            設定ファイル: <code className="bg-muted/60 px-1 rounded">~/.focusmap/config.json</code>
          </p>
        </div>
      </details>
    </section>
  );
}
