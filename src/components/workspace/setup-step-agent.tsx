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
  Download,
  MousePointerClick,
  ShieldAlert,
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
  const [downloading, setDownloading] = useState<boolean>(false);
  const [downloaded, setDownloaded] = useState<boolean>(false);
  const [mode, setMode] = useState<'easy' | 'classic'>('easy');

  // トークン発行 (classic mode 用、 1度だけ)
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
    if (!token && spaceId && mode === 'classic') {
      void issueToken();
    }
  }, [spaceId, mode]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // classic: コピー + 次ステップに進める
  const handleCopyAndAdvance = async () => {
    if (!installCmd) return;
    try {
      await navigator.clipboard.writeText(installCmd);
      setCopied(true);
      if (guideStep < 2) setGuideStep(2);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError('クリップボードに自動コピーできませんでした。 下の「コマンドを見る」から手動でコピーしてください。');
      setShowRawCommand(true);
    }
  };

  // easy: .command ファイル ダウンロード
  const handleDownloadScript = async () => {
    if (!spaceId) {
      setError('Workspace が選択されていません');
      return;
    }
    setDownloading(true);
    setError(null);
    try {
      const res = await fetch('/api/agents/setup-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ space_id: spaceId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? 'スクリプト生成に失敗しました');
      }
      const blob = await res.blob();
      const tokenShort = res.headers.get('X-Token-Short') ?? 'setup';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Focusmap-Setup-${tokenShort}.command`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setDownloaded(true);
      if (guideStep < 2) setGuideStep(2);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ダウンロードに失敗しました');
    } finally {
      setDownloading(false);
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

      {/* モード切替 */}
      <div className="inline-flex rounded-md border border-border/60 bg-muted/30 p-0.5 text-xs">
        <button
          type="button"
          onClick={() => setMode('easy')}
          className={cn(
            'rounded px-3 py-1 font-medium transition-colors',
            mode === 'easy' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Download className="mr-1 inline h-3 w-3" />
          かんたん (推奨)
        </button>
        <button
          type="button"
          onClick={() => setMode('classic')}
          className={cn(
            'rounded px-3 py-1 font-medium transition-colors',
            mode === 'classic' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Terminal className="mr-1 inline h-3 w-3" />
          コピペ (上級)
        </button>
      </div>

      {/* メインCTA */}
      {mode === 'easy' ? (
        <div className="rounded-lg border border-primary/30 bg-primary/[0.04] p-4 space-y-3">
          <Button
            size="lg"
            className="w-full h-auto py-4 flex flex-col items-center gap-1"
            onClick={handleDownloadScript}
            disabled={downloading || !spaceId}
          >
            {downloading ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-xs">スクリプトを生成中…</span>
              </>
            ) : downloaded ? (
              <>
                <Check className="h-5 w-5" />
                <span className="text-sm font-semibold">ダウンロード完了 ✓</span>
                <span className="text-[10px] opacity-90">
                  次は Downloads フォルダで .command ファイルをダブルクリック
                </span>
              </>
            ) : (
              <>
                <Download className="h-5 w-5" />
                <span className="text-sm font-semibold">セットアップファイルをダウンロード</span>
                <span className="text-[10px] opacity-90">
                  ダブルクリックでターミナルが自動起動&セットアップ実行
                </span>
              </>
            )}
          </Button>

          {downloaded && (
            <div className="rounded-md border border-amber-300/50 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-950/30 px-3 py-2 text-[11px] space-y-1.5">
              <p className="flex items-center gap-1 font-medium text-amber-800 dark:text-amber-200">
                <ShieldAlert className="h-3.5 w-3.5" />
                初回は「開発元未確認」 警告が出ます
              </p>
              <ol className="space-y-0.5 pl-4 list-decimal text-amber-700 dark:text-amber-300">
                <li>
                  Downloads フォルダで{' '}
                  <code className="bg-amber-100/60 dark:bg-amber-900/40 px-1 rounded">
                    Focusmap-Setup-*.command
                  </code>{' '}
                  を <strong>control + クリック</strong>
                </li>
                <li>
                  メニューから「<strong>開く</strong>」を選択
                </li>
                <li>
                  確認ダイアログで「<strong>開く</strong>」を再度クリック
                </li>
              </ol>
              <p className="text-[10px] text-amber-700/70 dark:text-amber-300/70">
                ※ Apple Developer 署名は将来対応。 現状この警告承認が必要です (毎回ではなく初回のみ)。
              </p>
            </div>
          )}

          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        </div>
      ) : (
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

          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

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
      )}

      {/* 4ステップ視覚ガイド */}
      <div className="space-y-2">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">セットアップ手順</p>

        {mode === 'easy' ? (
          <>
            <GuideStepRow
              step={1}
              active={guideStep === 1}
              done={guideStep > 1}
              icon={Download}
              title="上のボタンでファイルをダウンロード"
              desc="セットアップ用の .command ファイル がDownloadsに保存されます"
            />
            <GuideStepRow
              step={2}
              active={guideStep === 2}
              done={guideStep > 2}
              icon={MousePointerClick}
              title="ファイルをダブルクリック (初回は control+クリック →「開く」)"
              desc="ターミナルが自動的に起動して セットアップが始まります"
              onClick={() => guideStep >= 2 && setGuideStep(3)}
              actionLabel={guideStep === 2 ? '開いたら次へ' : undefined}
            />
            <GuideStepRow
              step={3}
              active={guideStep === 3}
              done={guideStep > 3}
              icon={Loader2}
              title="そのまま待つだけ (5-10分)"
              desc="Node.js / Playwright を自動でインストールします。何もする必要はありません。"
              onClick={() => guideStep >= 3 && setGuideStep(4)}
              actionLabel={guideStep === 3 ? '進行中→次へ' : undefined}
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
                  : '接続検知次第、自動で「✓ 完了」表示に切り替わります (最大10分)。'
              }
              waiting={!connected && guideStep === 4}
            />
          </>
        ) : (
          <>
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
          </>
        )}
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

      {/* トラブルシューティング */}
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none font-medium hover:text-foreground">
          うまくいかない場合
        </summary>
        <ul className="mt-2 space-y-1.5 pl-4 list-disc">
          <li>10分経っても接続にならない → 「ファイル再ダウンロード」 ボタンで token 新発行</li>
          <li>「開発元未確認」 警告が消えない → control+クリック → 「開く」 を選択 (初回のみ)</li>
          <li>ターミナルでエラーが出た → エラーメッセージをコピーして サポートに連絡</li>
          <li>Mac mini をお持ちでない → 常時起動できるMac環境推奨</li>
          <li>Windows 非対応 → 現状 macOS のみ対応</li>
        </ul>
      </details>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>
          <ChevronLeft className="mr-1 h-3.5 w-3.5" />
          戻る
        </Button>
        <div className="flex gap-2">
          {mode === 'easy' ? (
            <Button variant="outline" size="sm" onClick={handleDownloadScript} disabled={downloading || !spaceId}>
              <RefreshCw className={cn('mr-1 h-3.5 w-3.5', downloading && 'animate-spin')} />
              ファイル再発行
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={issueToken} disabled={loading || !spaceId}>
              <RefreshCw className={cn('mr-1 h-3.5 w-3.5', loading && 'animate-spin')} />
              トークン再発行
            </Button>
          )}
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
          <p
            className={cn(
              'text-sm font-medium',
              active && 'text-foreground',
              !active && !done && 'text-muted-foreground',
            )}
          >
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
