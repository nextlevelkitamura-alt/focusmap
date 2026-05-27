'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Copy,
  Check,
  Terminal,
  Loader2,
  Wifi,
  WifiOff,
  ChevronLeft,
  RefreshCw,
  Search,
  ClipboardPaste,
  Sparkles,
  CornerDownLeft,
  PartyPopper,
} from 'lucide-react';
import { createClient } from '@/utils/supabase/client';
import { cn } from '@/lib/utils';

interface SetupStepAgentProps {
  spaceId: string | null;
  userId: string;
  connected: boolean;
  onBack: () => void;
  onNext: () => void;
}

type GuideStep = 1 | 2 | 3 | 4;

export function SetupStepAgent({ spaceId, userId, connected, onBack, onNext }: SetupStepAgentProps) {
  const [token, setToken] = useState<string | null>(null);
  const [installCmd, setInstallCmd] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [waiting, setWaiting] = useState<boolean>(!connected);
  const [error, setError] = useState<string | null>(null);
  const [guideStep, setGuideStep] = useState<GuideStep>(1);
  const [showRawCommand, setShowRawCommand] = useState<boolean>(false);

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

  // 接続待機: Realtime でai_runners 監視 + 接続検知時に Step4 へ
  useEffect(() => {
    if (!spaceId || connected) {
      setWaiting(false);
      if (connected) setGuideStep(4);
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
          setGuideStep(4);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [spaceId, connected]);

  // ボタン: コピー + 次ステップに進める
  const handleCopyAndAdvance = async () => {
    if (!installCmd) return;
    try {
      await navigator.clipboard.writeText(installCmd);
      setCopied(true);
      // Step 1 (コピー) → Step 2 (Spotlight) に自動進める
      if (guideStep < 2) setGuideStep(2);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // クリップボード非対応環境 → 手動でコピーしてもらう
      setError('クリップボードに自動コピーできませんでした。 下の「コマンドを見る」から手動でコピーしてください。');
      setShowRawCommand(true);
    }
  };

  const isInstallReady = Boolean(installCmd && !loading);

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Mac mini にエージェントを導入</h2>
        <p className="text-sm text-muted-foreground">
          初心者でも安心な4ステップ。所要 約30秒〜1分 (初回のみ +5-10分の自動インストール)。
        </p>
      </div>

      {/* メインCTA: ワンクリックでコピー */}
      <div className="rounded-lg border border-primary/30 bg-primary/[0.04] p-4 space-y-3">
        <Button
          size="lg"
          className="w-full h-auto py-4 flex flex-col items-center gap-1"
          onClick={handleCopyAndAdvance}
          disabled={!isInstallReady}
        >
          {loading ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-xs">トークンを発行中…</span>
            </>
          ) : copied ? (
            <>
              <Check className="h-5 w-5" />
              <span className="text-sm font-semibold">コピーしました ✓</span>
              <span className="text-[10px] opacity-90">次は ⌘+Space → 「ターミナル」</span>
            </>
          ) : (
            <>
              <Copy className="h-5 w-5" />
              <span className="text-sm font-semibold">ワンクリックでコマンドをコピー</span>
              <span className="text-[10px] opacity-90">セットアップ用のコマンドが自動でコピーされます</span>
            </>
          )}
        </Button>

        {error && (
          <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
        )}

        <details
          className="text-[11px] text-muted-foreground"
          open={showRawCommand}
          onToggle={(e) => setShowRawCommand((e.target as HTMLDetailsElement).open)}
        >
          <summary className="cursor-pointer select-none hover:text-foreground">
            コマンドを見る (上級者向け)
          </summary>
          {installCmd && (
            <pre className="mt-1.5 overflow-x-auto rounded border border-border/40 bg-background px-2 py-1.5 font-mono text-[10px]">
              {installCmd}
            </pre>
          )}
        </details>
      </div>

      {/* 4ステップ視覚ガイド */}
      <div className="space-y-2">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">セットアップ手順</p>

        <GuideStepRow
          step={1}
          active={guideStep === 1}
          done={guideStep > 1}
          icon={Copy}
          title="上のボタンを押す"
          desc="コマンドが自動的にクリップボードへコピーされます"
        />

        <GuideStepRow
          step={2}
          active={guideStep === 2}
          done={guideStep > 2}
          icon={Search}
          title="⌘ + Space → 「ターミナル」と入力 → Enter"
          desc="macOS の Spotlight検索でターミナル.app が起動します"
          onClick={() => guideStep >= 2 && setGuideStep(3)}
          actionLabel={guideStep === 2 ? '開いたら次へ' : undefined}
        />

        <GuideStepRow
          step={3}
          active={guideStep === 3}
          done={guideStep > 3}
          icon={ClipboardPaste}
          title="ターミナルで ⌘ + V → Enter"
          desc="貼り付けた後に Enter で実行。 5-10分待つと自動完了します"
          onClick={() => guideStep >= 3 && setGuideStep(4)}
          actionLabel={guideStep === 3 ? '実行中→次へ' : undefined}
        />

        <GuideStepRow
          step={4}
          active={guideStep === 4}
          done={connected}
          icon={connected ? PartyPopper : Sparkles}
          title={connected ? 'セットアップ完了！' : 'エージェントの接続を待機中…'}
          desc={
            connected
              ? 'Mac mini が Focusmap に接続されました。次のステップへ進めます。'
              : 'コマンド実行後、自動で「✓ 完了」表示に切り替わります (最大10分)。'
          }
          waiting={!connected && guideStep === 4}
        />
      </div>

      {/* 接続状況バナー */}
      <div
        className={cn(
          'flex items-center gap-2 rounded-md border px-3 py-2 text-sm',
          connected
            ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
            : waiting
            ? 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300'
            : 'border-border/50 bg-muted/40 text-muted-foreground',
        )}
      >
        {connected ? (
          <>
            <Wifi className="h-4 w-4" />
            <span>エージェントが接続されました!</span>
          </>
        ) : waiting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>接続を待機中…</span>
          </>
        ) : (
          <>
            <WifiOff className="h-4 w-4" />
            <span>未接続</span>
          </>
        )}
      </div>

      {/* よくある質問 / トラブル */}
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none font-medium hover:text-foreground">
          うまくいかない場合
        </summary>
        <ul className="mt-2 space-y-1.5 pl-4 list-disc">
          <li>10分経っても接続にならない → 「トークンを再発行」 ボタンで新しい token を取得</li>
          <li>ターミナルでエラーが出た → エラーメッセージをコピーして サポートに連絡</li>
          <li>Mac mini をお持ちでない → ご自分の Mac で常時起動できる環境が必要 (動作中は閉じない設定推奨)</li>
          <li>Windowsをお使いの方 → 現状 Windows非対応。 Mac mini導入をご検討ください</li>
        </ul>
      </details>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>
          <ChevronLeft className="mr-1 h-3.5 w-3.5" />
          戻る
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={issueToken} disabled={loading || !spaceId}>
            <RefreshCw className={cn('mr-1 h-3.5 w-3.5', loading && 'animate-spin')} />
            トークン再発行
          </Button>
          <Button onClick={onNext} disabled={!connected}>
            次へ: 最初のスキル試行
            <CornerDownLeft className="ml-1 h-3.5 w-3.5 rotate-180" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 内部コンポーネント: ガイドステップ行
// ─────────────────────────────────────────────

interface GuideStepRowProps {
  step: number;
  active: boolean;
  done: boolean;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
  onClick?: () => void;
  actionLabel?: string;
  waiting?: boolean;
}

function GuideStepRow({
  step,
  active,
  done,
  icon: Icon,
  title,
  desc,
  onClick,
  actionLabel,
  waiting,
}: GuideStepRowProps) {
  return (
    <div
      className={cn(
        'flex items-start gap-2.5 rounded-md border px-3 py-2.5 transition-all',
        done
          ? 'border-emerald-300/60 bg-emerald-50/50 dark:border-emerald-900/40 dark:bg-emerald-950/20'
          : active
          ? 'border-primary/40 bg-primary/[0.04] shadow-sm'
          : 'border-border/40 bg-muted/20 opacity-70',
      )}
    >
      <span
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
          done
            ? 'bg-emerald-500 text-white'
            : active
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-muted-foreground',
        )}
      >
        {done ? <Check className="h-3.5 w-3.5" /> : step}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <Icon
            className={cn(
              'h-3.5 w-3.5 shrink-0',
              done ? 'text-emerald-600 dark:text-emerald-400' : active ? 'text-primary' : 'text-muted-foreground',
              waiting && 'animate-pulse',
            )}
          />
          <p className={cn('text-sm font-medium', active && 'text-foreground', !active && !done && 'text-muted-foreground')}>
            {title}
          </p>
        </div>
        <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{desc}</p>
        {actionLabel && active && onClick && (
          <button
            type="button"
            onClick={onClick}
            className="mt-1.5 text-[11px] font-medium text-primary hover:underline"
          >
            {actionLabel} →
          </button>
        )}
      </div>
    </div>
  );
}
