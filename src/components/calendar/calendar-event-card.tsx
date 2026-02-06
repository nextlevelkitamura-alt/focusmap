'use client';

import { CalendarEvent } from '@/types/calendar';
import { format } from 'date-fns';
import { MapPin, Clock, Edit2, Trash2 } from 'lucide-react';
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
  const endTime = new Date(event.end_time);

  // 背景色と文字色のコントラストを確保
  const backgroundColor = event.background_color || '#E3F2FD';
  const rawTextColor = event.color || '#1976D2';

  // 背景色が明るい場合は暗い文字、暗い場合は明るい文字を使用
  const getContrastColor = (bgColor: string, defaultColor: string) => {
    // 背景色が白に近い場合はダークテキストを返す
    const lightColors = ['#ffffff', '#fff', '#f5f5f5', '#fafafa', '#E3F2FD'];
    const isLightBg = lightColors.some(c => bgColor.toLowerCase().includes(c.toLowerCase()) || bgColor === c);
    return isLightBg ? '#1a1a1a' : defaultColor;
  };

  const textColor = getContrastColor(backgroundColor, rawTextColor);

  return (
    <div
      className={`relative rounded-md border-l-4 p-1 transition-all hover:shadow-md cursor-pointer ${className}`}
      style={{
        backgroundColor,
        borderColor: rawTextColor,
        cursor: isDraggable ? 'grab' : 'pointer'
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      draggable={isDraggable}
    >
      {/* イベントタイトルのみ表示（シンプルに） */}
      <div className="flex items-center justify-between gap-0.5">
        <h4 className="text-[9px] font-medium line-clamp-3 leading-tight" style={{ color: textColor }}>
          {event.title}
        </h4>

        {/* ホバー時の編集・削除ボタン */}
        {isHovered && (onEdit || onDelete) && (
          <div className="flex gap-0.5 flex-shrink-0">
            {onEdit && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(event.id);
                }}
                className="p-0.5 hover:bg-white/60 rounded transition-colors"
                title="編集"
              >
                <Edit2 className="h-2.5 w-2.5" style={{ color: textColor }} />
              </button>
            )}
            {onDelete && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(event.id);
                }}
                className="p-0.5 hover:bg-white/60 rounded transition-colors"
                title="削除"
              >
                <Trash2 className="h-2.5 w-2.5" style={{ color: textColor }} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
