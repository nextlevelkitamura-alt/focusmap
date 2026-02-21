'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { CalendarEvent } from '@/types/calendar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DateTimePicker } from '@/components/ui/date-time-picker';
import { Trash2, X } from 'lucide-react';
import { format, addMinutes } from 'date-fns';
import { useNotificationSettings } from '@/hooks/useNotificationSettings';

interface CalendarEventEditModalProps {
  event: CalendarEvent | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (eventId: string, updates: EventUpdatePayload) => Promise<void>;
  onDelete?: (eventId: string) => Promise<void>;
  availableCalendars?: Array<{ id: string; name: string; background_color?: string }>;
}

export interface EventUpdatePayload {
  title: string;
  start_time: string; // ISO format
  end_time: string;
  priority?: 'high' | 'medium' | 'low';
  reminders?: number[]; // minutes before event
  calendar_id?: string;
  estimated_time?: number; // 所要時間（分）
}

const DURATION_OPTIONS = [
  { label: '15分', value: 15 },
  { label: '30分', value: 30 },
  { label: '45分', value: 45 },
  { label: '1時間', value: 60 },
  { label: '1.5時間', value: 90 },
  { label: '2時間', value: 120 },
  { label: '3時間', value: 180 },
  { label: 'カスタム', value: -1 },
];

const REMINDER_OPTIONS = [
  { label: 'なし', value: -1 },
  { label: '予定の時刻', value: 0 },
  { label: '5分前', value: 5 },
  { label: '10分前', value: 10 },
  { label: '15分前', value: 15 },
  { label: '30分前', value: 30 },
  { label: '1時間前', value: 60 },
];

export function CalendarEventEditModal({
  event,
  isOpen,
  onClose,
  onSave,
  onDelete,
  availableCalendars = [],
}: CalendarEventEditModalProps) {
  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState<Date | undefined>(undefined);
  const [duration, setDuration] = useState<number>(60);
  const [isCustomDuration, setIsCustomDuration] = useState(false);
  const [customHours, setCustomHours] = useState(1);
  const [customMinutes, setCustomMinutes] = useState(0);
  const [priority, setPriority] = useState<'high' | 'medium' | 'low'>('medium');
  const [reminder, setReminder] = useState<number>(15);
  const [calendarId, setCalendarId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const { settings: notificationSettings } = useNotificationSettings();

  const isTaskLinked = !!event?.task_id;

  // 通知設定のデフォルト値を取得
  const defaultReminderMinutes = useMemo(() => {
    const eventStartSetting = notificationSettings.find(
      s => s.notification_type === 'event_start' && s.is_enabled
    );
    return eventStartSetting?.advance_minutes ?? 15;
  }, [notificationSettings]);

  // 実際の所要時間（分）：カスタムの場合はcustomHours/customMinutesから計算
  const effectiveDuration = isCustomDuration ? (customHours * 60 + customMinutes) : duration;

  // 現在のdurationがプリセットオプションにない場合、動的にオプションを追加
  const durationOptions = useMemo(() => {
    const opts = [...DURATION_OPTIONS];
    const presetValues = DURATION_OPTIONS.map(o => o.value);
    if (!isCustomDuration && duration > 0 && !presetValues.includes(duration)) {
      const label = duration < 60
        ? `${duration}分`
        : duration % 60 === 0
          ? `${duration / 60}時間`
          : `${(duration / 60).toFixed(1)}時間`;
      opts.splice(opts.length - 1, 0, { label, value: duration }); // カスタムの前に挿入
    }
    return opts;
  }, [duration, isCustomDuration]);

  // 終了時刻の計算（プレビュー用）
  const endTime = useMemo(() => {
    if (!startDate) return null;
    return addMinutes(startDate, effectiveDuration || 60);
  }, [startDate, effectiveDuration]);

  // イベントが変更されたらフォームを初期化
  useEffect(() => {
    if (event && isOpen) {
      setTitle(event.title);
      setStartDate(new Date(event.start_time));
      setPriority(event.priority || 'medium');
      setCalendarId(event.calendar_id);
      // Google Calendarのリマインダーがあればそれを使用、なければデフォルト
      if (event.reminders && event.reminders.length > 0) {
        setReminder(event.reminders[0]); // 最初のリマインダー値を使用（0=予定の時刻）
      } else if (event.reminders && event.reminders.length === 0) {
        setReminder(-1); // 空配列 = なし
      } else {
        setReminder(defaultReminderMinutes);
      }
      setError(null);

      // 所要時間: estimated_time > イベントの実際のduration
      const eventDuration = Math.round(
        (new Date(event.end_time).getTime() - new Date(event.start_time).getTime()) / 60000
      );
      const dur = event.estimated_time || eventDuration || 60;
      const presetValues = DURATION_OPTIONS.filter(o => o.value > 0).map(o => o.value);
      if (presetValues.includes(dur)) {
        setDuration(dur);
        setIsCustomDuration(false);
      } else {
        // プリセットにない値はそのまま表示（動的追加される）
        setDuration(dur);
        setIsCustomDuration(false);
      }
      setCustomHours(Math.floor(dur / 60));
      setCustomMinutes(dur % 60);
    }
  }, [event, isOpen, defaultReminderMinutes]);

  // Escapeキーで閉じる
  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  const handleSave = () => {
    if (!event || !startDate) return;

    if (!title.trim()) {
      setError('タイトルは必須です');
      return;
    }

    const saveDuration = effectiveDuration || 60;
    if (isCustomDuration && saveDuration <= 0) {
      setError('所要時間を1分以上に設定してください');
      return;
    }

    setError(null);

    const computedEndTime = addMinutes(startDate, saveDuration);

    // 即座にモーダルを閉じ、バックグラウンドで保存
    onClose();
    onSave(event.id, {
      title: title.trim(),
      start_time: startDate.toISOString(),
      end_time: computedEndTime.toISOString(),
      priority: isTaskLinked ? priority : undefined,
      reminders: reminder >= 0 ? [reminder] : [], // -1=なし(空配列), 0=予定の時刻, N>0=N分前
      calendar_id: calendarId,
      estimated_time: saveDuration,
    });
  };

  if (!isOpen || !event) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 背景オーバーレイ */}
      <div
        className="absolute inset-0 bg-black/40 animate-in fade-in duration-150"
        onClick={onClose}
      />

      {/* コンパクトなポップアップ */}
      <div
        ref={panelRef}
        className="relative z-10 bg-popover text-popover-foreground rounded-xl shadow-2xl border border-border/50 w-[340px] max-h-[85vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-150"
      >
        {/* カラーバー */}
        <div
          className="h-1.5 w-full rounded-t-xl"
          style={{ backgroundColor: event.background_color || event.color || '#039BE5' }}
        />

        {/* ヘッダー */}
        <div className="flex items-center justify-between px-4 pt-3 pb-1">
          <h3 className="text-sm font-semibold">予定を編集</h3>
          <button
            onClick={onClose}
            className="p-1 rounded-full hover:bg-muted transition-colors"
          >
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        {/* フォーム */}
        <div className="flex flex-col gap-3.5 px-4 py-3">
          {/* タイトル */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="title" className="text-xs">タイトル</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="予定のタイトル"
              disabled={false}
              className="h-8 text-sm"
            />
          </div>

          {/* 開始時刻 + 所要時間 */}
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">開始時刻</Label>
              <DateTimePicker
                date={startDate}
                setDate={setStartDate}
                trigger={
                  <Button variant="outline" className="w-full justify-start text-left font-normal h-8 text-xs px-2">
                    {startDate ? format(startDate, 'MM/dd HH:mm') : '選択'}
                  </Button>
                }
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">所要時間</Label>
              <Select
                value={isCustomDuration ? '-1' : String(duration)}
                onValueChange={(v) => {
                  if (v === '-1') {
                    setIsCustomDuration(true);
                    // 現在のdurationをカスタム初期値に
                    const cur = duration > 0 ? duration : 60;
                    setCustomHours(Math.floor(cur / 60));
                    setCustomMinutes(cur % 60);
                  } else {
                    setIsCustomDuration(false);
                    setDuration(Number(v));
                  }
                }}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {durationOptions.map((opt) => (
                    <SelectItem key={opt.value} value={String(opt.value)}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* カスタム所要時間入力 */}
          {isCustomDuration && (
            <div className="flex items-center gap-2 -mt-1">
              <input
                type="number"
                min={0}
                max={23}
                value={customHours}
                onChange={(e) => setCustomHours(Math.max(0, Math.min(23, Number(e.target.value) || 0)))}
                className="w-14 h-8 text-xs text-center border rounded-md bg-background"
              />
              <span className="text-xs text-muted-foreground">時間</span>
              <input
                type="number"
                min={0}
                max={59}
                step={5}
                value={customMinutes}
                onChange={(e) => setCustomMinutes(Math.max(0, Math.min(59, Number(e.target.value) || 0)))}
                className="w-14 h-8 text-xs text-center border rounded-md bg-background"
              />
              <span className="text-xs text-muted-foreground">分</span>
            </div>
          )}

          {/* 終了時刻プレビュー */}
          {endTime && (
            <div className="text-xs text-muted-foreground -mt-2 pl-1">
              終了: {format(endTime, 'MM/dd HH:mm')}
            </div>
          )}

          {/* タスク紐付き: 優先度 + カレンダー */}
          {isTaskLinked && (
            <div className="grid grid-cols-2 gap-2">
              {/* 優先度 */}
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">優先度</Label>
                <Select value={priority} onValueChange={(v: 'high' | 'medium' | 'low') => setPriority(v)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="high">高</SelectItem>
                    <SelectItem value="medium">中</SelectItem>
                    <SelectItem value="low">低</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* カレンダー選択 */}
              {availableCalendars.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs">カレンダー</Label>
                  <Select value={calendarId} onValueChange={setCalendarId}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="選択" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableCalendars.map((cal) => (
                        <SelectItem key={cal.id} value={cal.id}>
                          <div className="flex items-center gap-2">
                            {cal.background_color && (
                              <div
                                className="w-2.5 h-2.5 rounded-full"
                                style={{ backgroundColor: cal.background_color }}
                              />
                            )}
                            <span className="text-xs">{cal.name}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

          {/* 通知 */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">通知</Label>
            <Select
              value={String(reminder)}
              onValueChange={(v) => setReminder(Number(v))}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REMINDER_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={String(opt.value)}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* エラー */}
          {error && (
            <div className="text-xs text-destructive bg-destructive/10 px-2.5 py-1.5 rounded-md">
              {error}
            </div>
          )}
        </div>

        {/* フッター */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border/50">
          {onDelete ? (
            <button
              onClick={async () => {
                if (!confirm(`「${event.title}」を削除しますか？`)) return;
                try {
                  await onDelete(event.id);
                  onClose();
                } catch (err) {
                  setError(err instanceof Error ? err.message : '削除に失敗しました');
                }
              }}
              disabled={false}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          ) : (
            <div />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={false} size="sm" className="h-8 text-xs">
              キャンセル
            </Button>
            <Button onClick={handleSave} disabled={false} size="sm" className="h-8 text-xs">

              保存
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
