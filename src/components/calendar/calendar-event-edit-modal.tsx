'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { CalendarEvent } from '@/types/calendar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DateTimePicker } from '@/components/ui/date-time-picker';
import { DurationWheelPicker, formatDuration } from '@/components/ui/duration-wheel-picker';
import { Trash2, X, StickyNote } from 'lucide-react';
import { format, addMinutes } from 'date-fns';
import { EventMemoPopup } from './event-memo-popup';

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
  description?: string; // メモ（Google Calendar description と同期）
}

const BASE_REMINDER_OPTIONS = [
  { label: 'なし', value: -1 },
  { label: '予定の時刻', value: 0 },
  { label: '1分前', value: 1 },
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
  const [priority, setPriority] = useState<'high' | 'medium' | 'low'>('medium');
  const [reminder, setReminder] = useState<number>(-1);
  const [calendarId, setCalendarId] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [isMemoOpen, setIsMemoOpen] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const isTaskLinked = !!event?.task_id;

  // 終了時刻の計算（プレビュー用）
  const endTime = useMemo(() => {
    if (!startDate) return null;
    return addMinutes(startDate, duration || 60);
  }, [startDate, duration]);

  const reminderOptions = useMemo(() => {
    if (BASE_REMINDER_OPTIONS.some(opt => opt.value === reminder)) {
      return BASE_REMINDER_OPTIONS;
    }
    if (reminder < 0) {
      return BASE_REMINDER_OPTIONS;
    }
    return [...BASE_REMINDER_OPTIONS, { label: `${reminder}分前`, value: reminder }];
  }, [reminder]);

  // イベントが変更されたらフォームを初期化
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (event && isOpen) {
      setTitle(event.title);
      setStartDate(new Date(event.start_time));
      setPriority(event.priority || 'medium');
      setCalendarId(event.calendar_id);
      setDescription(event.description || '');
      // Googleイベント: 未設定は「なし」、設定済みはその値を表示
      if (event.reminders && event.reminders.length > 0) {
        setReminder(event.reminders[0]); // 最初のリマインダー値を使用（0=予定の時刻）
      } else {
        setReminder(-1);
      }
      setError(null);

      // 所要時間: estimated_time > イベントの実際のduration
      const eventDuration = Math.round(
        (new Date(event.end_time).getTime() - new Date(event.start_time).getTime()) / 60000
      );
      const dur = event.estimated_time || eventDuration || 60;
      setDuration(dur);
    }
  }, [event, isOpen]);
  /* eslint-enable react-hooks/set-state-in-effect */

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

    const saveDuration = Math.max(5, duration || 5);

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
      description,
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
              <DurationWheelPicker
                duration={duration}
                onDurationChange={setDuration}
                trigger={
                  <Button variant="outline" className="w-full justify-start text-left font-normal h-8 text-xs px-2">
                    {formatDuration(duration)}
                  </Button>
                }
              />
            </div>
          </div>

          {/* 終了時刻プレビュー */}
          {endTime && (
            <div className="text-xs text-muted-foreground -mt-2 pl-1">
              終了: {format(endTime, 'MM/dd HH:mm')}
            </div>
          )}

          {/* メモ（description）— ボタン押下でポップアップ */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">メモ</Label>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsMemoOpen(true)}
              className="w-full justify-start text-left font-normal h-8 text-xs px-2 gap-2 text-muted-foreground hover:text-foreground"
            >
              <StickyNote className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">
                {description.trim()
                  ? description.replace(/\s+/g, ' ').slice(0, 40) + (description.length > 40 ? '…' : '')
                  : 'メモを追加'}
              </span>
            </Button>
          </div>

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
                {reminderOptions.map((opt) => (
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

      {/* メモポップアップ（モーダルに重ねて表示） */}
      <EventMemoPopup
        initialValue={description}
        isOpen={isMemoOpen}
        onClose={() => setIsMemoOpen(false)}
        onSave={(memo) => setDescription(memo)}
      />
    </div>
  );
}
