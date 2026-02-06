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
      className={`relative rounded-md px-1.5 py-0.5 transition-all hover:brightness-95 cursor-pointer shadow-sm overflow-hidden flex flex-col justify-start ${className}`}
      style={{
        backgroundColor,
        color: textColor,
        borderLeft: `3px solid ${rawTextColor}`, // Subtle indicator instead of thick border
        fontSize: '11px',
        lineHeight: '1.2',
        cursor: isDraggable ? 'grab' : 'pointer'
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      draggable={isDraggable}
    >
      {/* Time & Title */}
      <div className="flex flex-wrap gap-x-1 items-baseline min-w-0">
        {!event.is_all_day && (
          <span className="font-medium opacity-90 text-[10px] whitespace-nowrap">
            {format(startTime, 'HH:mm')}
          </span>
        )}
        <h4 className="font-semibold truncate w-full">
          {event.title}
        </h4>
      </div>

      {/* ホバー時の編集・削除ボタン */}
      {isHovered && (onEdit || onDelete) && (
        <div className="absolute top-0.5 right-0.5 flex gap-0.5 flex-shrink-0 bg-inherit/10 backdrop-blur-[1px] rounded">
          {onEdit && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEdit(event.id);
              }}
              className="p-1 hover:bg-black/10 rounded transition-colors"
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
              className="p-1 hover:bg-black/10 rounded transition-colors"
              title="削除"
            >
              <Trash2 className="h-3 w-3" style={{ color: textColor }} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
