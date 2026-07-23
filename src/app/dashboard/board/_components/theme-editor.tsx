'use client';

import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { archiveThemeAction, updateThemeAction } from '../actions';

// 子09: テーマ帯の鉛筆からインライン編集を開く。目的・完了条件を人間が直せる（AIが自動起草した文も上書き可）。
// アーカイブは同フォーム内の別 server action。配下タスクは「未分類」に落ち消えない。
export function ThemeEditor({
  theme,
  date,
}: {
  theme: { id: string; name: string; purpose: string; doneCriteria: string; goalRef: string };
  date: string;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`テーマ「${theme.name}」を編集`}
        className="inline-grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95"
      >
        <Pencil className="h-4 w-4" />
      </button>
    );
  }

  return (
    <div className="mt-2 w-full space-y-2 rounded-lg border border-border bg-background p-3">
      <form action={updateThemeAction} className="space-y-2">
        <input type="hidden" name="id" value={theme.id} />
        <input type="hidden" name="date" value={date} />
        <div>
          <label htmlFor={`tn-${theme.id}`} className="mb-1 block text-xs font-medium text-muted-foreground">
            テーマ名
          </label>
          <input
            id={`tn-${theme.id}`}
            name="name"
            defaultValue={theme.name}
            required
            className="h-10 w-full rounded-md border border-input bg-transparent px-2.5 text-sm"
          />
        </div>
        <div>
          <label htmlFor={`tp-${theme.id}`} className="mb-1 block text-xs font-medium text-muted-foreground">
            目的
          </label>
          <textarea
            id={`tp-${theme.id}`}
            name="purpose"
            defaultValue={theme.purpose}
            rows={2}
            placeholder="このテーマで達成したいこと"
            className="w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm"
          />
        </div>
        <div>
          <label htmlFor={`td-${theme.id}`} className="mb-1 block text-xs font-medium text-muted-foreground">
            完了条件（これがこうなったら完了）
          </label>
          <textarea
            id={`td-${theme.id}`}
            name="doneCriteria"
            defaultValue={theme.doneCriteria}
            rows={2}
            placeholder="どうなったら完了と言えるか"
            className="w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm"
          />
        </div>
        <input type="hidden" name="goalRef" value={theme.goalRef} />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="min-h-10 shrink-0 rounded-md border border-border px-3 text-sm text-muted-foreground"
          >
            やめる
          </button>
          <button
            type="submit"
            className="min-h-10 flex-1 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground active:scale-[0.99]"
          >
            保存
          </button>
        </div>
      </form>
      <form action={archiveThemeAction}>
        <input type="hidden" name="id" value={theme.id} />
        <input type="hidden" name="date" value={date} />
        <button
          type="submit"
          className="min-h-9 w-full rounded-md border border-dashed border-border px-3 text-xs text-muted-foreground active:scale-[0.99]"
        >
          このテーマをアーカイブ（配下タスクは未分類に残る）
        </button>
      </form>
    </div>
  );
}
