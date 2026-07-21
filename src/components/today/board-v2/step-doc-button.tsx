'use client';

import { useState } from 'react';
import { FileText } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { MarkdownDoc } from '@/app/dashboard/plans/_components/markdown-doc';

// 子06: 工程ごとの📄ボタン。実装/修正工程→子計画/修正md、レビュー工程→評価md を、
// plan_docs.body の表示専用ビューア（Sheet）で開く。計画詳細ページの md 表示（MarkdownDoc）を共用する。
// body はボード payload を太らせないため、📄を開いた時に /api/board/plan-doc で遅延取得する。
type StepDoc = {
  path: string;
  title: string;
  body: string;
  nn: string;
  kind: string;
  siblingPaths: string[];
};

type LoadState = 'idle' | 'loading' | 'done' | 'empty' | 'error';

export function StepDocButton({
  slug,
  nn,
  kind,
  ariaLabel,
}: {
  slug: string;
  nn: string;
  kind: string;
  ariaLabel: string;
}) {
  const [doc, setDoc] = useState<StepDoc | null>(null);
  const [state, setState] = useState<LoadState>('idle');

  const load = () => {
    if (state === 'loading' || state === 'done') return;
    setState('loading');
    const query = new URLSearchParams({ slug, nn, kind }).toString();
    fetch(`/api/board/plan-doc?${query}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((json) => {
        if (json?.success && json.doc) {
          setDoc(json.doc as StepDoc);
          setState('done');
        } else {
          setState('empty');
        }
      })
      .catch(() => setState('error'));
  };

  return (
    <Sheet
      onOpenChange={(openValue) => {
        if (openValue) load();
      }}
    >
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          className="inline-flex h-7 shrink-0 items-center gap-0.5 rounded-md border border-border bg-background px-1.5 text-[10px] font-semibold text-muted-foreground active:scale-95"
        >
          <FileText className="h-3 w-3" />
          <span className="sr-only sm:not-sr-only">文書</span>
        </button>
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-xl">
        <SheetHeader>
          <SheetTitle>{doc?.title || '計画文書'}</SheetTitle>
        </SheetHeader>
        <div className="overflow-y-auto px-4 pb-6">
          {state === 'loading' ? <p className="text-sm text-muted-foreground">読み込み中…</p> : null}
          {state === 'error' ? (
            <p className="text-sm text-muted-foreground">文書を取得できませんでした。時間をおいて再度お試しください。</p>
          ) : null}
          {state === 'empty' ? (
            <p className="text-sm text-muted-foreground">この工程に対応する計画文書が見つかりませんでした。</p>
          ) : null}
          {state === 'done' && doc ? (
            <MarkdownDoc body={doc.body} path={doc.path} slug={slug} knownPaths={new Set(doc.siblingPaths)} />
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
