'use client';

import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';

interface EventMemoPopupProps {
  /** 初期メモ（Google Calendar の description） */
  initialValue: string;
  isOpen: boolean;
  onClose: () => void;
  /** 保存ボタン押下で呼ばれる。空文字も渡る（クリアの場合） */
  onSave: (memo: string) => void;
}

const MAX_LEN = 1000;

/**
 * 予定編集モーダルから開くメモ専用ポップアップ。
 * モーダル本体を縦長にしないため、メモは別ポップアップで編集する。
 * 保存内容は Google Calendar の description に反映される。
 */
export function EventMemoPopup({
  initialValue,
  isOpen,
  onClose,
  onSave,
}: EventMemoPopupProps) {
  const [value, setValue] = useState(initialValue);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 開くたびに初期値をリセット（親側 state との整合）
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (isOpen) {
      setValue(initialValue);
      // 次フレームでフォーカス
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
  }, [isOpen, initialValue]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Escape で閉じる
  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const tooLong = value.length > MAX_LEN;

  const handleSave = () => {
    if (tooLong) return;
    onSave(value);
    onClose();
  };

  return (
    // z-60 で予定編集モーダル (z-50) より前面に
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      {/* 背景オーバーレイ */}
      <div
        className="absolute inset-0 bg-black/50 animate-in fade-in duration-150"
        onClick={onClose}
      />

      {/* ポップアップ本体 */}
      <div
        className="relative z-10 bg-popover text-popover-foreground rounded-xl shadow-2xl border border-border/50 w-[92vw] max-w-[400px] animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-border/50">
          <h3 className="text-sm font-semibold">メモ</h3>
          <button
            onClick={onClose}
            className="p-1 rounded-full hover:bg-muted transition-colors"
            aria-label="閉じる"
          >
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        {/* テキストエリア */}
        <div className="px-4 py-3">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="メモを入力（Google Calendar の説明欄に保存されます）"
            rows={8}
            className="w-full min-h-[160px] rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y"
          />
          <div className="mt-1.5 flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              Google Calendar の説明欄に保存
            </span>
            <span className={tooLong ? 'text-destructive font-medium' : 'text-muted-foreground'}>
              {value.length} / {MAX_LEN}
            </span>
          </div>
        </div>

        {/* フッター */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border/50">
          <Button variant="outline" onClick={onClose} size="sm" className="h-8 text-xs">
            キャンセル
          </Button>
          <Button onClick={handleSave} disabled={tooLong} size="sm" className="h-8 text-xs">
            保存
          </Button>
        </div>
      </div>
    </div>
  );
}
