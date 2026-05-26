'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Copy, Check, Terminal, Loader2, Wifi, WifiOff, ChevronLeft, RefreshCw } from 'lucide-react';
import { createClient } from '@/utils/supabase/client';

interface SetupStepAgentProps {
  spaceId: string | null;
  userId: string;
  connected: boolean;
  onBack: () => void;
  onNext: () => void;
}

export function SetupStepAgent({ spaceId, userId, connected, onBack, onNext }: SetupStepAgentProps) {
  const [token, setToken] = useState<string | null>(null);
  const [installCmd, setInstallCmd] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [waiting, setWaiting] = useState<boolean>(!connected);
  const [error, setError] = useState<string | null>(null);

  // トークン発行
  const issueToken = async () => {
    if (!spaceId) {
      setError('Workspace が選択されていません');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/agents/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ space_id: spaceId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'トークン発行に失敗しました');
      setToken(data.token);
      setInstallCmd(data.install_command);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'エラーが発生しました');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!token && spaceId) {
      void issueToken();
    }
  }, [spaceId]); // eslint-disable-line react-hooks/exhaustive-deps

  // 接続待機: Realtime でai_runners 監視
  useEffect(() => {
    if (!spaceId || connected) {
      setWaiting(false);
      return;
    }
    setWaiting(true);
    const supabase = createClient();
    const channel = supabase
      .channel(`agent-setup:${spaceId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ai_runners' },
        () => {
          setWaiting(false);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [spaceId, connected]);

  const handleCopy = async () => {
    if (!installCmd) return;
    await navigator.clipboard.writeText(installCmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Mac mini にエージェントを導入</h2>
        <p className="text-sm text-muted-foreground">
          常時起動しておく Mac mini のターミナルで以下のコマンドを実行してください。
          Node.js / Playwright / launchd 設定が自動で行われます。
        </p>
      </div>

      <div className="rounded-md border border-border/60 bg-muted/40 p-3 text-xs text-muted-foreground">
        <div className="mb-1 font-medium text-foreground flex items-center gap-1">
          <Terminal className="h-3.5 w-3.5" />
          ターミナルで実行
        </div>
        {loading && (
          <div className="flex items-center gap-2 py-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            トークンを発行しています...
          </div>
        )}
        {installCmd && (
          <div className="relative">
            <pre className="overflow-x-auto rounded bg-background px-3 py-2.5 font-mono text-xs">
              {installCmd}
            </pre>
            <Button
              size="icon"
              variant="ghost"
              className="absolute right-1 top-1 h-7 w-7"
              onClick={handleCopy}
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-emerald-500" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        )}
        {error && (
          <div className="mt-2 text-red-600 dark:text-red-400">{error}</div>
        )}
      </div>

      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none font-medium hover:text-foreground">
          ターミナルの開き方
        </summary>
        <ol className="mt-2 space-y-1 pl-4">
          <li>1. ⌘ + Space で Spotlight を開く</li>
          <li>2. 「ターミナル」と入力 → Enter</li>
          <li>3. 上のコマンドを貼り付けて Enter</li>
          <li>4. 完了画面が出るまで5〜10分待つ</li>
        </ol>
      </details>

      <div
        className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
          connected
            ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
            : 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300'
        }`}
      >
        {connected ? (
          <>
            <Wifi className="h-4 w-4" />
            <span>エージェントが接続されました!</span>
          </>
        ) : waiting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>エージェントの接続を待機中... (上のコマンドを実行してください)</span>
          </>
        ) : (
          <>
            <WifiOff className="h-4 w-4" />
            <span>エージェントが未接続です</span>
          </>
        )}
      </div>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>
          <ChevronLeft className="mr-1 h-3.5 w-3.5" />
          戻る
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={issueToken} disabled={loading || !spaceId}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" />
            トークン再発行
          </Button>
          <Button onClick={onNext} disabled={!connected}>
            次へ: 最初のスキル試行 →
          </Button>
        </div>
      </div>
    </div>
  );
}
