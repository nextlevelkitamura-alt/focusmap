'use client';

import { FormEvent, useState } from 'react';
import { Pencil } from 'lucide-react';
import { archiveThemeAction } from '../actions';

export type EditableTheme = {
  id: string;
  name: string;
  purpose: string;
  doneCriteria: string;
  goalRef: string;
};

// テーマ帯の鉛筆からカード内編集を開く。目的・完了条件を人間が直せる（AIが自動起草した文も上書き可）。
// 編集はDaily専用APIで楽観的にTursoへ保存し、アーカイブだけは既存server actionを維持する。
export function ThemeEditor({
  theme,
  date,
  isPreview = false,
  onThemeChange,
}: {
  theme: EditableTheme;
  date: string;
  isPreview?: boolean;
  onThemeChange?: (theme: EditableTheme) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(theme);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const openEditor = () => {
    setDraft(theme);
    setError('');
    setSaved(false);
    setOpen(true);
  };

  const updateDraft = (field: keyof Omit<EditableTheme, 'id'>, value: string) => {
    setDraft((previous) => ({ ...previous, [field]: value }));
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextTheme: EditableTheme = {
      ...draft,
      name: draft.name.trim(),
      purpose: draft.purpose.trim(),
      doneCriteria: draft.doneCriteria.trim(),
      goalRef: draft.goalRef.trim(),
    };
    if (!nextTheme.name) {
      setError('テーマ名を入力してください。');
      return;
    }

    setError('');
    setSaving(true);
    // 先にカード表示だけを置き換える。通信失敗時は直前値へ戻す。
    onThemeChange?.(nextTheme);

    if (isPreview) {
      setSaving(false);
      setSaved(true);
      return;
    }

    try {
      const response = await fetch(`/api/board/themes/${encodeURIComponent(theme.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextTheme),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.success) throw new Error('save failed');
      setSaved(true);
    } catch {
      onThemeChange?.(theme);
      setError('保存できませんでした。表示を元に戻しました。');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="contents">
      <button
        type="button"
        onClick={openEditor}
        aria-label={`テーマ「${theme.name}」を編集`}
        title={`テーマ「${theme.name}」を編集`}
        className="m-2 inline-grid h-11 w-11 shrink-0 place-items-center self-start rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95"
      >
        <Pencil className="h-4 w-4" />
      </button>

      {open ? (
        <div className="basis-full border-t border-border/70 bg-background/70 px-3 py-3">
          <form onSubmit={save} className="space-y-2 rounded-xl border border-primary/35 bg-card p-3 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold">テーマをそのまま編集</p>
              <span className="text-[10px] text-muted-foreground">
                {isPreview ? 'サンプル変更（保存なし）' : saved ? '保存しました' : 'Tursoへ保存'}
              </span>
            </div>
        <div>
          <label htmlFor={`tn-${theme.id}`} className="mb-1 block text-xs font-medium text-muted-foreground">
            テーマ名
          </label>
          <input
            id={`tn-${theme.id}`}
            value={draft.name}
            onChange={(event) => updateDraft('name', event.target.value)}
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
            value={draft.purpose}
            onChange={(event) => updateDraft('purpose', event.target.value)}
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
            value={draft.doneCriteria}
            onChange={(event) => updateDraft('doneCriteria', event.target.value)}
            rows={2}
            placeholder="どうなったら完了と言えるか"
            className="w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            disabled={saving}
            className="min-h-10 shrink-0 rounded-md border border-border px-3 text-sm text-muted-foreground"
          >
            やめる
          </button>
          <button
            type="submit"
            disabled={saving}
            className="min-h-10 flex-1 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-60 active:scale-[0.99]"
          >
            {saving ? '保存中…' : saved ? '保存しました' : '保存'}
          </button>
        </div>
        {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
          </form>
          {!isPreview ? (
            <form action={archiveThemeAction} className="mt-2">
              <input type="hidden" name="id" value={theme.id} />
              <input type="hidden" name="date" value={date} />
              <button
                type="submit"
                className="min-h-9 w-full rounded-md border border-dashed border-border px-3 text-xs text-muted-foreground active:scale-[0.99]"
              >
                このテーマをアーカイブ（配下タスクは未分類に残る）
              </button>
            </form>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
