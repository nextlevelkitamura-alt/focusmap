'use client';

import { FileText } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { MarkdownDoc } from './markdown-doc';
import type { PlanDoc } from '@/lib/turso/plan-docs';

// 実装/レビュー共通・評価mdの下部導線。ページ遷移せずボトムシートで開く（方針3）。
export function DocSheetButton({ doc, slug, knownPaths }: { doc: PlanDoc; slug: string; knownPaths: Set<string> }) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <button
          type="button"
          className="flex min-h-11 w-full items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-left text-sm active:bg-muted"
        >
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 break-words font-medium">{doc.title || doc.path}</span>
        </button>
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-xl">
        <SheetHeader>
          <SheetTitle>{doc.title || doc.path}</SheetTitle>
        </SheetHeader>
        <div className="overflow-y-auto px-4 pb-6">
          <MarkdownDoc body={doc.body} path={doc.path} slug={slug} knownPaths={knownPaths} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
