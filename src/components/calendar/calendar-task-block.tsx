'use client';

import { Database } from '@/types/database';

type Task = Database['public']['Tables']['tasks']['Row'];
import { format } from 'date-fns';
import { Target, Clock, Edit2, Trash2, Calendar } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

interface CalendarTaskBlockProps {
  task: Task;
  startTime: Date;
  endTime: Date;
  onEdit?: (taskId: string) => void;
  onDelete?: (taskId: string) => void;
  onTimeChange?: (taskId: string, newStartTime: Date) => void;
  className?: string;
}

/**
 * カレンダー上でタスクをブロック表示するコンポーネント
 * イベントとは異なるスタイルでタスクを区別する
 */
export function CalendarTaskBlock({
  task,
  startTime,
  endTime,
  onEdit,
  onDelete,
  onTimeChange,
  className = ''
}: CalendarTaskBlockProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // タスクの色（イベントと区別するための配色）
  const backgroundColor = 'rgba(59, 130, 246, 0.15)'; // blue-500/15 - 少し濃く
  const borderColor = 'rgb(59, 130, 246)'; // blue-500
  const textColor = '#1a1a1a'; // 常にダークテキスト

  const duration = Math.round((endTime.getTime() - startTime.getTime()) / (1000 * 60));

  const handleDragStart = (e: React.DragEvent) => {
    setIsDragging(true);
    e.dataTransfer.setData('text/plain', task.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnd = () => {
    setIsDragging(false);
  };

  return (
    <div
      className={cn(
        'relative rounded-md border-l-4 border-dashed p-1 transition-all cursor-pointer',
        'hover:shadow-md hover:bg-blue-500/20',
        isDragging && 'opacity-50',
        className
      )}
      style={{
        backgroundColor,
        borderColor,
        color: textColor
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      draggable={!!onTimeChange}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      {/* タスクアイコンとタイトルのみ（シンプルに） */}
      <div className="flex items-center justify-between gap-0.5">
        <div className="flex items-center gap-0.5 flex-1 min-w-0">
          <Target className="h-2 w-2 flex-shrink-0" style={{ color: borderColor }} />
          <h4 className="text-[9px] font-medium line-clamp-3 leading-tight" style={{ color: textColor }}>
            {task.title}
          </h4>
        </div>

        {/* ホバー時の編集・削除ボタン */}
        {isHovered && (onEdit || onDelete) && (
          <div className="flex gap-0.5 flex-shrink-0">
            {onEdit && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(task.id);
                }}
                className="p-0.5 hover:bg-white/60 rounded transition-colors"
                title="編集"
              >
                <Edit2 className="h-2.5 w-2.5" style={{ color: borderColor }} />
              </button>
            )}
            {onDelete && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(task.id);
                }}
                className="p-0.5 hover:bg-white/60 rounded transition-colors"
                title="スケジュール解除"
              >
                <Trash2 className="h-2.5 w-2.5" style={{ color: borderColor }} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * タスクブロックの簡易版（月ビュー用など）
 */
export function CalendarTaskBadge({
  task,
  className
}: {
  task: Task;
  className?: string;
}) {
  const textColor = 'rgb(59, 130, 246)'; // blue-500

  return (
    <div
      className={cn(
        'flex items-center gap-0.5 text-[9px] px-1 py-0.5 rounded bg-blue-500/10 border border-blue-500/20',
        className
      )}
    >
      <Target className="h-2.5 w-2.5 flex-shrink-0" style={{ color: textColor }} />
      <span className="truncate font-medium" style={{ color: textColor }}>
        {task.title}
      </span>
    </div>
  );
}
