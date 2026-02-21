'use client';

import { CalendarEvent } from '@/types/calendar';
import { Task } from '@/types/database';
import { format } from 'date-fns';
import { Loader2, X, Square, CheckSquare, Play, Pause, Bell } from 'lucide-react';
import { useMemo } from 'react';
import { EVENT_FONT_SIZES } from '@/lib/calendar-constants';
import { cn } from '@/lib/utils';
import { formatTime } from '@/contexts/TimerContext';

interface CalendarEventCardProps {
  event: CalendarEvent;
  onEdit?: (eventId: string) => void;
  onDelete?: (eventId: string) => void;
  onDragStart?: (event: CalendarEvent) => void;
  isDraggable?: boolean;
  className?: string;
  eventHeight?: number;
  isSaving?: boolean;
  // タスク連携用
  linkedTask?: Task;
  onToggleTask?: (taskId: string) => void;
  onStartTimer?: (task: Task) => void;
  onPauseTimer?: () => void;
  isTimerRunning?: boolean;
  timerElapsedSeconds?: number;
  reminderMinutes?: number;
}

export function CalendarEventCard({
  event,
  onEdit,
  onDelete,
  onDragStart,
  isDraggable = false,
  className = '',
  eventHeight,
  isSaving = false,
  linkedTask,
  onToggleTask,
  onStartTimer,
  onPauseTimer,
  isTimerRunning = false,
  timerElapsedSeconds,
  reminderMinutes,
}: CalendarEventCardProps) {
  const startTime = new Date(event.start_time);
  const isCompact = eventHeight != null && eventHeight < 40;
  const isDone = linkedTask?.status === 'done';

  // イベントの時間長（分）を計算
  const duration = useMemo(() => {
    const start = new Date(event.start_time).getTime();
    const end = new Date(event.end_time).getTime();
    return (end - start) / (1000 * 60);
  }, [event.start_time, event.end_time]);

  // durationに応じてフォントサイズを決定
  const { timeSize, titleSize } = useMemo(() => {
    if (duration < EVENT_FONT_SIZES.VERY_SHORT.duration) {
      return EVENT_FONT_SIZES.VERY_SHORT;
    } else if (duration < EVENT_FONT_SIZES.SHORT.duration) {
      return EVENT_FONT_SIZES.SHORT;
    } else if (duration < EVENT_FONT_SIZES.MEDIUM.duration) {
      return EVENT_FONT_SIZES.MEDIUM;
    }
    return EVENT_FONT_SIZES.NORMAL;
  }, [duration]);

  const backgroundColor = event.background_color || '#039BE5';

  const getContrastTextColor = (hexColor: string) => {
    const r = parseInt(hexColor.slice(1, 3), 16);
    const g = parseInt(hexColor.slice(3, 5), 16);
    const b = parseInt(hexColor.slice(5, 7), 16);
    const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
    return yiq >= 128 ? '#1f1f1f' : '#ffffff';
  };

  const textColor = getContrastTextColor(backgroundColor);

  // タスク紐付きの場合、タイマー実行中はボーダーを強調
  const borderStyle = isTimerRunning
    ? 'ring-2 ring-blue-400 ring-offset-1'
    : '';

  return (
    <div
      data-event-id={event.id}
      className={cn(
        "relative rounded-lg px-2 py-1.5 transition-all hover:brightness-95 hover:scale-[1.02] cursor-pointer overflow-hidden flex flex-col justify-start leading-tight group border border-black/5 hover:shadow-md",
        borderStyle,
        className,
      )}
      style={{
        backgroundColor,
        color: textColor,
        boxShadow: '0 2px 4px rgba(0,0,0,0.08)',
        cursor: isDraggable ? 'grab' : 'pointer',
      }}
      draggable={isDraggable}
      onDragStart={(e) => {
        if (isDraggable) {
          e.dataTransfer.setData('application/json', JSON.stringify({
            type: 'calendar-event',
            eventId: event.id,
            googleEventId: event.google_event_id,
            calendarId: event.calendar_id,
            title: event.title,
            start_time: event.start_time,
            end_time: event.end_time,
            duration: new Date(event.end_time).getTime() - new Date(event.start_time).getTime()
          }))
          onDragStart?.(event)
        }
      }}
      onClick={(e) => {
          e.stopPropagation();
          onEdit?.(event.id);
      }}
    >
      {/* 左側の色バー */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1.5 rounded-l-lg"
        style={{
          backgroundColor: event.color || backgroundColor,
          opacity: 0.9
        }}
      />

      {/* Content */}
      <div className="flex flex-col min-w-0 h-full gap-0.5 pl-1.5">
        <div className="flex items-center gap-1 min-w-0">
          {/* チェックボックス（タスク紐付き時のみ） */}
          {linkedTask && onToggleTask && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleTask(linkedTask.id);
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              className="flex-shrink-0 opacity-90 hover:opacity-100 transition-opacity"
            >
              {isDone ? (
                <CheckSquare className="w-3.5 h-3.5" style={{ color: textColor }} />
              ) : (
                <Square className="w-3.5 h-3.5" style={{ color: textColor }} />
              )}
            </button>
          )}

          {/* Time */}
          {!event.is_all_day && (
            <span
              className="font-medium whitespace-nowrap opacity-80 flex-shrink-0"
              style={{ fontSize: `${timeSize}px` }}
            >
              {format(startTime, 'HH:mm')}
            </span>
          )}

          {/* Title */}
          <span
            className={cn(
              "font-semibold select-none flex-1 min-w-0",
              isCompact ? "truncate" : "line-clamp-2",
              isDone && "line-through opacity-60"
            )}
            style={{ fontSize: `${titleSize}px` }}
          >
            {event.title}
          </span>

          {/* タイマーボタン（タスク紐付き時のみ） */}
          {linkedTask && (onStartTimer || onPauseTimer) && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (isTimerRunning) {
                  onPauseTimer?.();
                } else {
                  onStartTimer?.(linkedTask);
                }
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              className={cn(
                "flex-shrink-0 transition-opacity",
                isCompact ? "opacity-0 group-hover:opacity-100" : "opacity-80 hover:opacity-100"
              )}
            >
              {isTimerRunning ? (
                <Pause className="w-3.5 h-3.5" style={{ color: textColor }} />
              ) : (
                <Play className="w-3.5 h-3.5" style={{ color: textColor }} />
              )}
            </button>
          )}
        </div>

        {/* タイマー経過時間 + リマインダー表示（非compact時のみ） */}
        {!isCompact && (isTimerRunning || reminderMinutes) && (
          <div className="flex items-center gap-2 pl-0.5">
            {isTimerRunning && timerElapsedSeconds != null && (
              <span className="font-mono opacity-80" style={{ fontSize: '10px' }}>
                {formatTime(timerElapsedSeconds)}
              </span>
            )}
            {reminderMinutes != null && reminderMinutes > 0 && (
              <span className="flex items-center gap-0.5 opacity-70" style={{ fontSize: '9px' }}>
                <Bell className="w-2.5 h-2.5" />
                {reminderMinutes}分前
              </span>
            )}
          </div>
        )}
      </div>

      {/* 保存中スピナー or ホバー時削除ボタン */}
      {isSaving ? (
        <div className="absolute top-1 right-1.5 z-10">
          <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: textColor, opacity: 0.6 }} />
        </div>
      ) : onDelete && (
        <div
          role="button"
          tabIndex={0}
          className="absolute top-0 right-0 z-20 w-6 h-6 flex items-center justify-center rounded-bl-lg opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
          style={{ backgroundColor: `${textColor}30`, color: textColor }}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onDelete(event.id);
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <X className="h-3.5 w-3.5" strokeWidth={2.5} />
        </div>
      )}
    </div>
  );
}
