import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ClipboardList } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { createClient } from '@/utils/supabase/server';
import { BoardPaneSwitch } from '@/components/today/board-pane-switch';
import { getActivePlanRootDocs, getAllPlanProgress, type PlanDoc, type PlanProgress } from '@/lib/turso/plan-docs';
import { parseMetaHeader } from './_lib/md-parse';
import { PlanCard } from './_components/plan-card';

export const dynamic = 'force-dynamic';

type DataSource = 'inbox';

async function load<T>(fallback: T, getter: () => Promise<T>): Promise<{ data: T; error: DataSource | null }> {
  try {
    return { data: await getter(), error: null };
  } catch {
    return { data: fallback, error: 'inbox' };
  }
}

function priorityRank(body: string): number {
  const meta = parseMetaHeader(body);
  const priority = meta.get('優先');
  if (priority === '◎') return 0;
  if (priority === '○') return 1;
  return 2;
}

export default async function PlansListPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [docsResult, progressResult] = await Promise.all([
    load([] as PlanDoc[], () => getActivePlanRootDocs()),
    load(new Map<string, PlanProgress>(), () => getAllPlanProgress()),
  ]);

  const docs = [...docsResult.data].sort((a, b) => {
    const rank = priorityRank(a.body) - priorityRank(b.body);
    if (rank !== 0) return rank;
    return b.programSlug.localeCompare(a.programSlug); // 新しいフォルダ名（日付接頭辞）を優先
  });
  const progressBySlug = progressResult.data;
  const hasError = docsResult.error !== null || progressResult.error !== null;

  return (
    <div className="relative min-h-0 flex-1 space-y-6 overflow-y-auto pb-20 p-4">
      <BoardPaneSwitch active="plans" />

      <header className="flex items-center gap-2">
        <ClipboardList className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-semibold">計画</h1>
      </header>

      <p className="text-xs text-muted-foreground">
        読み取り専用のミラー表示です。編集は常にmd側（Git）で行います。
      </p>

      {hasError ? (
        <Card className="border-dashed">
          <CardContent className="p-4 text-sm text-muted-foreground">
            計画データの取得には PERSONAL_OS_INBOX_* の接続設定が必要です。接続できたデータだけを表示しています。
          </CardContent>
        </Card>
      ) : null}

      {docs.length === 0 && !hasError ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          active状態の計画がまだありません。
        </div>
      ) : (
        <div className="space-y-3">
          {docs.map((doc) => (
            <PlanCard
              key={doc.path}
              slug={doc.programSlug}
              title={doc.title}
              kind={doc.kind}
              body={doc.body}
              syncedAt={doc.syncedAt}
              progress={progressBySlug.get(doc.programSlug)}
            />
          ))}
        </div>
      )}

      <p className="text-center text-[11px] text-muted-foreground">
        <Link href="/dashboard/board" className="underline underline-offset-2">
          AIボードへ戻る
        </Link>
      </p>
    </div>
  );
}
