'use client';

import { CalendarEvent } from '@/types/calendar';
import { format } from 'date-fns';
import { Edit2, Trash2 } from 'lucide-react';
import { useState } from 'react';

interface CalendarEventCardProps {
  event: CalendarEvent;
  onEdit?: (eventId: string) => void;
  onDelete?: (eventId: string) => void;
  isDraggable?: boolean;
  className?: string;
}

export function CalendarEventCard({
  event,
  onEdit,
  onDelete,
  isDraggable = false,
  className = ''
}: CalendarEventCardProps) {
  const [isHovered, setIsHovered] = useState(false);

  const startTime = new Date(event.start_time);

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
      className={`relative rounded-[4px] px-1.5 py-0.5 transition-all hover:brightness-95 cursor-pointer overflow-hidden flex flex-col justify-start leading-tight group border border-transparent hover:shadow-sm ${className}`}
      style={{
        backgroundColor,
        color: textColor,
        boxShadow: '0 1px 1px rgba(0,0,0,0.1)',
        cursor: isDraggable ? 'grab' : 'pointer',
        borderLeft: `3px solid ${event.color || 'transparent'}` // Optional: keep the original accent color as a border
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      draggable={isDraggable}
      onClick={(e) => {
          e.stopPropagation();
          onEdit?.(event.id);
      }}
    >
      {/* Time & Title */}
      <div className="flex flex-col min-w-0 h-full">
         <div className="flex items-baseline gap-1 min-w-0">
          {!event.is_all_day && (
            <span className="font-medium text-[10px] whitespace-nowrap opacity-90 flex-shrink-0">
              {format(startTime, 'HH:mm')}
            </span>
          )}
          <span className="font-semibold text-[11px] truncate select-none">
            {event.title}
          </span>
         </div>
      </div>

      {/* ホバー時の編集・削除ボタン */}
      {isHovered && (onEdit || onDelete) && (
        <div className="absolute top-0 right-0 bottom-0 flex items-center pr-1 pl-2 bg-gradient-to-l from-black/40 via-black/20 to-transparent">
             <div className="flex gap-0.5 animate-in fade-in duration-200">
               {onEdit && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(event.id);
                  }}
                  className="p-1 rounded-full transition-colors hover:brightness-125"
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
                  className="p-1 rounded-full transition-colors hover:brightness-125"
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
