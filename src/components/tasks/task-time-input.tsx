'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

const PRESETS = [
  { label: '15分', minutes: 15 },
  { label: '30分', minutes: 30 },
  { label: '1時間', minutes: 60 },
  { label: '2時間', minutes: 120 },
  { label: '4時間', minutes: 240 },
];

interface TaskTimeInputProps {
  value?: number; // 分単位
  onChange: (minutes: number) => void;
  className?: string;
}

/**
 * タスクの所要時間を入力するコンポーネント
 * 時間と分を別々に入力できる他、プリセットも選択可能
 */
export function TaskTimeInput({ value = 0, onChange, className }: TaskTimeInputProps) {
  const [hours, setHours] = useState(Math.floor(value / 60));
  const [minutes, setMinutes] = useState(value % 60);

  // 値が変わったら内部状態を更新
  useEffect(() => {
    setHours(Math.floor(value / 60));
    setMinutes(value % 60);
  }, [value]);

  // 時間または分が変わったら親コンポーネントに通知
  useEffect(() => {
    const totalMinutes = hours * 60 + minutes;
    onChange(totalMinutes);
  }, [hours, minutes, onChange]);

  const handlePresetClick = (presetMinutes: number) => {
    setHours(Math.floor(presetMinutes / 60));
    setMinutes(presetMinutes % 60);
  };

  const formatDisplay = () => {
    if (hours === 0 && minutes === 0) return '0分';
    if (hours === 0) return `${minutes}分`;
    if (minutes === 0) return `${hours}時間`;
    return `${hours}時間${minutes}分`;
  };

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {/* 表示 */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Clock className="h-4 w-4" />
        <span>所要時間: {formatDisplay()}</span>
      </div>

      {/* 入力エリア */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 flex-1">
          <Input
            type="number"
            min="0"
            max="99"
            value={hours}
            onChange={(e) => {
              const val = parseInt(e.target.value) || 0;
              setHours(Math.min(99, Math.max(0, val)));
            }}
            className="w-20 text-center"
            placeholder="0"
          />
          <span className="text-sm text-muted-foreground whitespace-nowrap">時間</span>
        </div>

        <div className="flex items-center gap-1 flex-1">
          <Input
            type="number"
            min="0"
            max="59"
            value={minutes}
            onChange={(e) => {
              const val = parseInt(e.target.value) || 0;
              setMinutes(Math.min(59, Math.max(0, val)));
            }}
            className="w-20 text-center"
            placeholder="0"
          />
          <span className="text-sm text-muted-foreground whitespace-nowrap">分</span>
        </div>
      </div>

      {/* プリセットボタン */}
      <div className="flex flex-wrap gap-1">
        {PRESETS.map((preset) => (
          <Button
            key={preset.label}
            variant="outline"
            size="sm"
            className={cn(
              'h-7 text-xs',
              hours * 60 + minutes === preset.minutes &&
                'bg-primary/10 text-primary border-primary/20'
            )}
            onClick={() => handlePresetClick(preset.minutes)}
          >
            {preset.label}
          </Button>
        ))}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs text-muted-foreground"
          onClick={() => {
            setHours(0);
            setMinutes(0);
          }}
        >
          クリア
        </Button>
      </div>
    </div>
  );
}

/**
 * 所要時間をフォーマット表示する関数
 */
export function formatTaskTime(minutes: number): string {
  if (!minutes || minutes <= 0) return '0分';
  if (minutes < 60) return `${minutes}分`;

  const hours = minutes / 60;
  const remainingMinutes = minutes % 60;

  if (Number.isInteger(hours)) return `${hours}時間`;
  return `${Math.floor(hours)}時間${remainingMinutes}分`;
}

/**
 * 所要時間を表示するバッジコンポーネント
 */
export function TaskTimeBadge({
  minutes,
  className
}: {
  minutes: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20',
        className
      )}
    >
      <Clock className="h-3 w-3" />
      {formatTaskTime(minutes)}
    </span>
  );
}
