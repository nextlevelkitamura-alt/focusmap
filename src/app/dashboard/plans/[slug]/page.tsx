import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ChevronLeft, ListTree } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { createClient } from '@/utils/supabase/server';
import {
  getPlanDocsBySlug,
  getPlanProgressBySlug,
  type PlanDoc,
  type PlanProgress,
} from '@/lib/turso/plan-docs';
import { getPlanLiveStepsBySlug, type PlanLiveStep } from '@/lib/turso/plan-links';
import {
  parseChildMap,
  parseCompletionItems,
  parseMetaHeader,
} from '../_lib/md-parse';
import { MetaBadges } from '../_components/meta-badges';
import { SyncFreshness } from '../_components/sync-freshness';
import { ChildMap } from '../_components/child-map';
import { CompletionList } from '../_components/completion-list';
import { MarkdownDoc } from '../_components/markdown-doc';
import { DocSheetButton } from '../_components/doc-sheet-button';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string }>;
}

// 子02: 計画詳細「ライブ進行」タブ。plan_slug でリンクした todos の全工程（未来含む）を時系列で並べる。
// StepFlow と同じ視覚言語（done緑✓＋斜線／doing「今ここ」＋経過分／todo白抜き）を md 非依存で再現する。
function LiveProgress({ steps }: { steps: PlanLiveStep[] }) {
  if (steps.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-4 text-sm text-muted-foreground">
          この計画に紐づくやること（todos.plan_slug）とステップがまだありません。daily-start
          で「全工程一括登録」すると、実装→レビュー→評価… が時系列で並びます。
        </CardContent>
      </Card>
    );
  }
  // todo 単位でグルーピング（do_date, todoId 昇順で並んでいる）。
  const groups: { todoId: string; title: string; doDate: string; steps: PlanLiveStep[] }[] = [];
  for (const step of steps) {
    let group = groups.find((g) => g.todoId === step.todoId);
    if (!group) {
      group = { todoId: step.todoId, title: step.todoTitle, doDate: step.todoDoDate, steps: [] };
      groups.push(group);
    }
    group.steps.push(step);
  }
  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <div key={group.todoId} className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="min-w-0 break-words text-sm font-semibold">{group.title || 'やること'}</h3>
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{group.doDate}</span>
          </div>
          <ul className="relative list-none space-y-0">
            {group.steps.map((step, index) => {
              const last = index === group.steps.length - 1;
              const nodeClass =
                step.status === 'done'
                  ? 'bg-emerald-700'
                  : step.status === 'doing'
                    ? 'bg-blue-600 animate-pulse motion-reduce:animate-none'
                    : step.status === 'skipped'
                      ? 'bg-slate-200 text-slate-400 dark:bg-slate-700'
                      : 'border-2 border-slate-300 bg-white dark:border-slate-600 dark:bg-transparent';
              const timeLabel =
                step.elapsedMin === null
                  ? null
                  : step.status === 'done'
                    ? `${step.elapsedMin}分`
                    : step.status === 'doing'
                      ? `${step.elapsedMin}分経過`
                      : null;
              return (
                <li key={step.id} className="relative flex items-start gap-2 py-[3px] text-xs leading-[1.45] text-muted-foreground">
                  {!last ? (
                    <span aria-hidden className="absolute bottom-[-4px] left-[6px] top-[19px] w-0.5 bg-slate-200 dark:bg-slate-700" />
                  ) : null}
                  <span
                    className={cn(
                      'relative z-[1] mt-[1.5px] grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[4.5px] text-[8.5px] font-extrabold leading-none text-white',
                      nodeClass,
                    )}
                  >
                    {step.status === 'done' ? '✓' : ''}
                  </span>
                  <span
                    className={cn(
                      'min-w-0 flex-1 break-words',
                      step.status === 'done' && 'text-slate-400 line-through dark:text-slate-500',
                      step.status === 'skipped' && 'line-through opacity-60',
                      step.kind === 'fix' && step.status !== 'done' && 'text-amber-700 dark:text-amber-400',
                    )}
                  >
                    {step.kind === 'fix' ? <span className="mr-1">🔧</span> : null}
                    {step.title}
                    {step.status === 'doing' ? (
                      <span className="ml-1.5 rounded bg-blue-100 px-1 py-px align-middle text-[9px] font-bold text-blue-700 dark:bg-blue-500/20 dark:text-blue-300">
                        今ここ
                      </span>
                    ) : null}
                  </span>
                  {timeLabel ? (
                    <span
                      className={cn(
                        'ml-1.5 shrink-0 text-[10px] tabular-nums',
                        step.status === 'doing' ? 'font-semibold text-blue-700 dark:text-blue-300' : 'text-slate-400',
                      )}
                    >
                      {timeLabel}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

async function load<T>(fallback: T, getter: () => Promise<T>): Promise<{ data: T; error: boolean }> {
  try {
    return { data: await getter(), error: false };
  } catch {
    return { data: fallback, error: true };
  }
}

export default async function PlanDetailPage({ params, searchParams }: PageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { slug } = await params;
  const { tab } = await searchParams;
  const activeTab: 'doc' | 'live' = tab === 'live' ? 'live' : 'doc';

  const [docsResult, progressResult, liveResult] = await Promise.all([
    load([] as PlanDoc[], () => getPlanDocsBySlug(slug)),
    load(null as PlanProgress | null, () => getPlanProgressBySlug(slug)),
    load([] as PlanLiveStep[], () => getPlanLiveStepsBySlug(slug)),
  ]);
  const liveSteps = liveResult.data;

  const docs = docsResult.data;
  if (!docsResult.error && docs.length === 0) notFound();

  const knownPaths = new Set(docs.map((doc) => doc.path));
  const root = docs.find((doc) => doc.kind === 'program' || doc.kind === 'single');
  const roleDocs = docs.filter((doc) => doc.kind === 'role');
  const evalDocs = docs.filter((doc) => doc.kind === 'eval');

  const progress = progressResult.data;
  const parseOk = progress ? progress.parseOk : true;
  const isProgram = root?.kind === 'program';

  const meta = root ? parseMetaHeader(root.body) : new Map<string, string>();
  const childBlocks = isProgram && root && parseOk ? parseChildMap(root.body) : [];
  const completionItems = root && parseOk ? parseCompletionItems(root.body) : [];

  return (
    <div className="relative min-h-0 flex-1 space-y-5 overflow-y-auto pb-20 p-4">
      <div className="flex items-center justify-between gap-2">
        <Link
          href="/dashboard/plans"
          className="inline-flex h-11 items-center gap-1 rounded-md px-2 text-sm font-medium text-muted-foreground active:bg-muted"
        >
          <ChevronLeft className="h-4 w-4" />
          計画一覧
        </Link>
        {root ? <SyncFreshness syncedAt={root.syncedAt} /> : null}
      </div>

      {docsResult.error ? (
        <Card className="border-dashed">
          <CardContent className="p-4 text-sm text-muted-foreground">
            計画データの取得には PERSONAL_OS_INBOX_* の接続設定が必要です。
          </CardContent>
        </Card>
      ) : null}

      {root ? (
        <header className="space-y-2">
          <div className="flex items-center gap-1.5">
            {isProgram ? <ListTree className="h-4 w-4 shrink-0 text-muted-foreground" /> : null}
            <h1 className="min-w-0 break-words text-lg font-bold">{root.title || slug}</h1>
          </div>
          <MetaBadges meta={meta} />
          {parseOk && progress && isProgram && progress.childTotal > 0 ? (
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <span className="font-semibold tabular-nums">
                子 {progress.childDone}/{progress.childTotal}
              </span>
              <span className="font-semibold tabular-nums">
                完了条件 {progress.condDone}/{progress.condTotal}
              </span>
            </div>
          ) : null}
        </header>
      ) : null}

      {/* 子02: md文書 / ライブ進行 タブ分離。md=計画本文スナップショット、live=todo_stepsのライブ進行（正本境界2）。 */}
      <nav className="flex gap-1 border-b border-border">
        {(['doc', 'live'] as const).map((key) => {
          const isActive = activeTab === key;
          const label = key === 'doc' ? 'md文書' : `ライブ進行${liveSteps.length > 0 ? ` (${liveSteps.length})` : ''}`;
          return (
            <Link
              key={key}
              href={key === 'doc' ? `/dashboard/plans/${slug}` : `/dashboard/plans/${slug}?tab=live`}
              className={cn(
                'inline-flex h-10 items-center border-b-2 px-3 text-sm font-semibold',
                isActive ? 'border-blue-600 text-blue-700 dark:text-blue-300' : 'border-transparent text-muted-foreground',
              )}
            >
              {label}
            </Link>
          );
        })}
      </nav>

      {activeTab === 'live' ? <LiveProgress steps={liveSteps} /> : null}

      {activeTab === 'doc' && !parseOk ? (
        <Card className="border-amber-300/70 bg-amber-50 dark:bg-amber-500/10">
          <CardContent className="p-4 text-sm text-amber-800 dark:text-amber-400">
            この計画は構造を自動抽出できませんでした。下の本文で内容を確認してください。
          </CardContent>
        </Card>
      ) : null}

      {activeTab === 'doc' && childBlocks.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-base font-semibold">子計画マップ</h2>
          <ChildMap blocks={childBlocks} />
        </section>
      ) : null}

      {activeTab === 'doc' && completionItems.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-base font-semibold">完了条件</h2>
          <CompletionList items={completionItems} />
        </section>
      ) : null}

      {activeTab === 'doc' && (roleDocs.length > 0 || evalDocs.length > 0) ? (
        <section className="space-y-2">
          <h2 className="text-base font-semibold">関連文書</h2>
          <div className="space-y-2">
            {roleDocs.map((doc) => (
              <DocSheetButton key={doc.path} doc={doc} slug={slug} knownPaths={knownPaths} />
            ))}
            {evalDocs.map((doc) => (
              <DocSheetButton key={doc.path} doc={doc} slug={slug} knownPaths={knownPaths} />
            ))}
          </div>
        </section>
      ) : null}

      {activeTab === 'doc' && root ? (
        <section className="space-y-2">
          <h2 className="text-base font-semibold">本文</h2>
          <MarkdownDoc body={root.body} path={root.path} slug={slug} knownPaths={knownPaths} />
        </section>
      ) : null}
    </div>
  );
}
