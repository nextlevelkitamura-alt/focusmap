'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * セッション画面で表示する記録内容の切替入口。
 * 現在はDailyだけを提供し、別種別を作るまでは既存データを別の概念として見せない。
 */
export function DailyContentSelector() {
  return (
    <Select defaultValue="daily">
      <SelectTrigger
        aria-label="表示する記録内容"
        className="h-9 min-w-[108px] border-border/60 bg-background text-sm font-semibold"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="start">
        <SelectItem value="daily">デイリー</SelectItem>
      </SelectContent>
    </Select>
  );
}
