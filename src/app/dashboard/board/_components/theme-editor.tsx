'use client';

import { type FormEvent, type ReactNode, useState } from 'react';

export type EditableTheme = {
  id: string;
  name: string;
  purpose: string;
};

export type ThemeEditorControls = {
  editing: boolean;
  draft: EditableTheme;
  saving: boolean;
  error: string;
  saved: boolean;
  startEditing: () => void;
  cancelEditing: () => void;
  updateDraft: (field: keyof Omit<EditableTheme, 'id'>, value: string) => void;
  save: (event: FormEvent<HTMLFormElement>) => Promise<void>;
};

// 保存・楽観更新だけを担当する。見た目はThemeカード自身が描画し、閲覧時の文字位置を編集時にも保つ。
export function ThemeEditor({
  theme,
  isPreview = false,
  onThemeChange,
  children,
}: {
  theme: EditableTheme;
  isPreview?: boolean;
  onThemeChange?: (theme: EditableTheme) => void;
  children: (controls: ThemeEditorControls) => ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(theme);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const startEditing = () => {
    setDraft(theme);
    setError('');
    setSaved(false);
    setEditing(true);
  };

  const cancelEditing = () => {
    setDraft(theme);
    setError('');
    setSaved(false);
    setEditing(false);
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
    };
    if (!nextTheme.name) {
      setError('テーマ名を入力してください。');
      return;
    }

    setError('');
    setSaving(true);
    // カードを先に置き換え、失敗時だけ親コンポーネント経由で元へ戻す。
    onThemeChange?.(nextTheme);

    if (isPreview) {
      setSaving(false);
      setSaved(true);
      setEditing(false);
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
      setEditing(false);
    } catch {
      onThemeChange?.(theme);
      setError('保存できませんでした。表示を元に戻しました。');
    } finally {
      setSaving(false);
    }
  };

  return children({
    editing,
    draft,
    saving,
    error,
    saved,
    startEditing,
    cancelEditing,
    updateDraft,
    save,
  });
}
