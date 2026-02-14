'use client';

import { CalendarEvent } from '@/types/calendar';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { X, Pencil, Trash2, Clock, Calendar, Flag, Bell } from 'lucide-react';
import { useEffect, useRef } from 'react';

interface CalendarEventPopoverProps {
  event: CalendarEvent;
  anchorRect: { top: number; left: number; width: number; height: number } | null;
  isOpen: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDelete: (eventId: string) => Promise<void>;
}

const PRIORITY_CONFIG = {
  high: { label: '高', color: 'text-red-500', bg: 'bg-red-500/10' },
  medium: { label: '中', color: 'text-yellow-500', bg: 'bg-yellow-500/10' },
  low: { label: '低', color: 'text-green-500', bg: 'bg-green-500/10' },
} as const;

export function CalendarEventPopover({
  event,
  anchorRect,
  isOpen,
  onClose,
  onEdit,
  onDelete,
}: CalendarEventPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);

  // 外側クリックで閉じる
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    // 少し遅延させて、開くトリガーのクリックイベントが伝搬しないようにする
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
    }, 10);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose]);

  if (!isOpen || !anchorRect) return null;

  const startTime = new Date(event.start_time);
  const endTime = new Date(event.end_time);
  const priority = event.priority;
  const priorityConfig = priority ? PRIORITY_CONFIG[priority] : null;

  // ポップオーバーの位置を計算（画面端を考慮）
  const POPOVER_WIDTH = 280;
  const POPOVER_HEIGHT = 260;

  let top = anchorRect.top;
  let left = anchorRect.left + anchorRect.width + 8;

  // 右端を超える場合は左側に表示
  if (left + POPOVER_WIDTH > window.innerWidth - 16) {
    left = anchorRect.left - POPOVER_WIDTH - 8;
  }

  // 下端を超える場合は上にずらす
  if (top + POPOVER_HEIGHT > window.innerHeight - 16) {
    top = window.innerHeight - POPOVER_HEIGHT - 16;
  }

  // 上端を超える場合
  if (top < 16) {
    top = 16;
  }

  const handleDelete = async () => {
    if (!confirm(`「${event.title}」を削除しますか？`)) return;
    await onDelete(event.id);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50" style={{ pointerEvents: 'none' }}>
      <div
        ref={popoverRef}
        className="absolute bg-popover text-popover-foreground rounded-xl shadow-xl border border-border/50 overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        style={{
          top,
          left,
          width: POPOVER_WIDTH,
          pointerEvents: 'auto',
        }}
      >
        {/* ヘッダー（イベントカラーバー + 閉じるボタン） */}
        <div
          className="h-2 w-full"
          style={{ backgroundColor: event.background_color || event.color || '#039BE5' }}
        />

        <div className="p-4">
          {/* 閉じるボタン */}
          <button
            onClick={onClose}
            className="absolute top-3 right-3 p-1 rounded-full hover:bg-muted transition-colors"
          >
            <X className="h-4 w-4 text-muted-foreground" />
          </button>

          {/* タイトル */}
          <h3 className="font-semibold text-base pr-6 mb-3 leading-tight">
            {event.title}
          </h3>

          {/* 情報リスト */}
          <div className="space-y-2 text-sm">
            {/* 日時 */}
            <div className="flex items-center gap-2.5 text-muted-foreground">
              <Clock className="h-4 w-4 flex-shrink-0" />
              <span>
                {event.is_all_day ? (
                  format(startTime, 'M月d日(E)', { locale: ja })
                ) : (
                  <>
                    {format(startTime, 'M月d日(E)', { locale: ja })}
                    {' '}
                    <span className="text-foreground font-medium">
                      {format(startTime, 'HH:mm')} ~ {format(endTime, 'HH:mm')}
                    </span>
                  </>
                )}
              </span>
            </div>

            {/* カレンダー名 */}
            {event.calendar_id && (
              <div className="flex items-center gap-2.5 text-muted-foreground">
                <Calendar className="h-4 w-4 flex-shrink-0" />
                <div className="flex items-center gap-1.5">
                  <div
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: event.background_color || event.color || '#039BE5' }}
                  />
                  <span>{event.calendar_id}</span>
                </div>
              </div>
            )}

            {/* 優先度 */}
            {priorityConfig && (
              <div className="flex items-center gap-2.5 text-muted-foreground">
                <Flag className="h-4 w-4 flex-shrink-0" />
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${priorityConfig.bg} ${priorityConfig.color}`}>
                  優先度: {priorityConfig.label}
                </span>
              </div>
            )}

            {/* 説明（あれば） */}
            {event.description && (
              <p className="text-muted-foreground text-xs mt-1 line-clamp-2 pl-6.5">
                {event.description}
              </p>
            )}
          </div>

          {/* アクションボタン */}
          <div className="flex gap-2 mt-4 pt-3 border-t border-border/50">
            <button
              onClick={() => {
                onClose();
                onEdit();
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Pencil className="h-3.5 w-3.5" />
              編集
            </button>
            <button
              onClick={handleDelete}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg text-destructive hover:bg-destructive/10 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
              削除
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
