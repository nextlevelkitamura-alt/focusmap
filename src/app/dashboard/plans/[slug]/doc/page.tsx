import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { createClient } from '@/utils/supabase/server';
import { getPlanDocsBySlug, type PlanDoc } from '@/lib/turso/plan-docs';
import { SyncFreshness } from '../../_components/sync-freshness';
import { MarkdownDoc } from '../../_components/markdown-doc';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ p?: string }>;
}

async function load<T>(fallback: T, getter: () => Promise<T>): Promise<{ data: T; error: boolean }> {
  try {
    return { data: await getter(), error: false };
  } catch {
    return { data: fallback, error: true };
  }
}

// 相対リンク解決先の単一文書表示（同一計画内の子md・関連mdを内部ルートで開く）。
export default async function PlanDocPage({ params, searchParams }: PageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { slug } = await params;
  const { p } = await searchParams;

  const docsResult = await load([] as PlanDoc[], () => getPlanDocsBySlug(slug));
  const docs = docsResult.data;
  const knownPaths = new Set(docs.map((doc) => doc.path));
  const doc = p ? docs.find((d) => d.path === p) : undefined;

  if (!docsResult.error && !doc) notFound();

  return (
    <div className="relative min-h-0 flex-1 space-y-4 overflow-y-auto pb-20 p-4">
      <div className="flex items-center justify-between gap-2">
        <Link
          href={`/dashboard/plans/${encodeURIComponent(slug)}`}
          className="inline-flex h-11 items-center gap-1 rounded-md px-2 text-sm font-medium text-muted-foreground active:bg-muted"
        >
          <ChevronLeft className="h-4 w-4" />
          計画詳細
        </Link>
        {doc ? <SyncFreshness syncedAt={doc.syncedAt} /> : null}
      </div>

      {docsResult.error ? (
        <Card className="border-dashed">
          <CardContent className="p-4 text-sm text-muted-foreground">
            計画データの取得には PERSONAL_OS_INBOX_* の接続設定が必要です。
          </CardContent>
        </Card>
      ) : null}

      {doc ? (
        <>
          <h1 className="min-w-0 break-words text-lg font-bold">{doc.title || doc.path}</h1>
          <MarkdownDoc body={doc.body} path={doc.path} slug={slug} knownPaths={knownPaths} />
        </>
      ) : null}
    </div>
  );
}
