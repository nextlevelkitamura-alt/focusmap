'use client';

import { CalendarEvent } from '@/types/calendar';
import { format } from 'date-fns';
import { Edit2, Trash2 } from 'lucide-react';
import { useState, useMemo } from 'react';
import { EVENT_FONT_SIZES } from '@/lib/calendar-constants';
import { cn } from '@/lib/utils';

interface CalendarEventCardProps {
  event: CalendarEvent;
  onEdit?: (eventId: string) => void;
  onDelete?: (eventId: string) => void;
  onDragStart?: (event: CalendarEvent) => void;
  isDraggable?: boolean;
  className?: string;
  eventHeight?: number; // イベントの高さ（px）- 親から渡される
}

export function CalendarEventCard({
  event,
  onEdit,
  onDelete,
  onDragStart,
  isDraggable = false,
  className = '',
  eventHeight
}: CalendarEventCardProps) {
  const [isHovered, setIsHovered] = useState(false);

  const startTime = new Date(event.start_time);

  // イベントの時間長（分）を計算
  const duration = useMemo(() => {
    const start = new Date(event.start_time).getTime();
    const end = new Date(event.end_time).getTime();
    return (end - start) / (1000 * 60); // 分単位
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

  // 背景色と文字色のコントラストを確保
  const backgroundColor = event.background_color || '#039BE5'; // Default to a Google Calendar blue if missing

  // 相対輝度を計算して適当な文字色（白または黒）を返す
  const getContrastTextColor = (hexColor: string) => {
    // HEXをRGBに変換
    const r = parseInt(hexColor.slice(1, 3), 16);
    const g = parseInt(hexColor.slice(3, 5), 16);
    const b = parseInt(hexColor.slice(5, 7), 16);

    // 相対輝度計算 (sRGB)
    const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
    
    // 閾値（128）より明るければ黒、暗ければ白を返す
    return yiq >= 128 ? '#1f1f1f' : '#ffffff';
  };

  const textColor = getContrastTextColor(backgroundColor);

  return (
    <div
      className={`relative rounded-lg px-2 py-1.5 transition-all hover:brightness-95 hover:scale-[1.02] cursor-pointer overflow-hidden flex flex-col justify-start leading-tight group border border-black/5 hover:shadow-md ${className}`}
      style={{
        backgroundColor,
        color: textColor,
        boxShadow: '0 2px 4px rgba(0,0,0,0.08)',
        cursor: isDraggable ? 'grab' : 'pointer',
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      draggable={isDraggable}
      onDragStart={(e) => {
        if (isDraggable && onDragStart) {
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
          onDragStart(event)
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

      {/* Time & Title */}
      <div className="flex flex-col min-w-0 h-full gap-0.5 pl-1.5">
         <div className="flex items-baseline gap-1.5 min-w-0">
          {!event.is_all_day && (
            <span
              className="font-medium whitespace-nowrap opacity-80 flex-shrink-0"
              style={{ fontSize: `${timeSize}px` }}
            >
              {format(startTime, 'HH:mm')}
            </span>
          )}
          <span
            className={cn(
              "font-semibold select-none",
              eventHeight && eventHeight < 40 ? "truncate" : "line-clamp-2"
            )}
            style={{ fontSize: `${titleSize}px` }}
          >
            {event.title}
          </span>
         </div>
      </div>

      {/* ホバー時の編集・削除ボタン */}
      {isHovered && (onEdit || onDelete) && (
        <div className="absolute top-0 right-0 bottom-0 flex items-center pr-1.5 pl-3 bg-gradient-to-l from-black/50 via-black/25 to-transparent rounded-r-lg">
             <div className="flex gap-1 animate-in fade-in duration-200">
               {onEdit && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(event.id);
                  }}
                  className="p-1.5 rounded-md transition-all hover:bg-white/20 backdrop-blur-sm"
                  title="編集"
                >
                  <Edit2 className="h-3 w-3" style={{ color: textColor }} />
                </button>
              )}
              {onDelete && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(event.id);
                  }}
                  className="p-1.5 rounded-md transition-all hover:bg-white/20 backdrop-blur-sm"
                  title="削除"
                >
                  <Trash2 className="h-3 w-3" style={{ color: textColor }} />
                </button>
              )}
             </div>
        </div>
      )}
    </div>
  );
}
