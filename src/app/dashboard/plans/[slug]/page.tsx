import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ChevronLeft, ListTree } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { createClient } from '@/utils/supabase/server';
import {
  getPlanDocsBySlug,
  getPlanProgressBySlug,
  type PlanDoc,
  type PlanProgress,
} from '@/lib/turso/plan-docs';
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
}

async function load<T>(fallback: T, getter: () => Promise<T>): Promise<{ data: T; error: boolean }> {
  try {
    return { data: await getter(), error: false };
  } catch {
    return { data: fallback, error: true };
  }
}

export default async function PlanDetailPage({ params }: PageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { slug } = await params;

  const [docsResult, progressResult] = await Promise.all([
    load([] as PlanDoc[], () => getPlanDocsBySlug(slug)),
    load(null as PlanProgress | null, () => getPlanProgressBySlug(slug)),
  ]);

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

      {!parseOk ? (
        <Card className="border-amber-300/70 bg-amber-50 dark:bg-amber-500/10">
          <CardContent className="p-4 text-sm text-amber-800 dark:text-amber-400">
            この計画は構造を自動抽出できませんでした。下の本文で内容を確認してください。
          </CardContent>
        </Card>
      ) : null}

      {childBlocks.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-base font-semibold">子計画マップ</h2>
          <ChildMap blocks={childBlocks} />
        </section>
      ) : null}

      {completionItems.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-base font-semibold">完了条件</h2>
          <CompletionList items={completionItems} />
        </section>
      ) : null}

      {roleDocs.length > 0 || evalDocs.length > 0 ? (
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

      {root ? (
        <section className="space-y-2">
          <h2 className="text-base font-semibold">本文</h2>
          <MarkdownDoc body={root.body} path={root.path} slug={slug} knownPaths={knownPaths} />
        </section>
      ) : null}
    </div>
  );
}
