import { addMinutes, differenceInMinutes, isSameDay, parseISO } from 'date-fns';

/**
 * 空き時間スロット
 */
export interface FreeSlot {
  start: Date;
  end: Date;
  duration: number; // 分単位
}

/**
 * 作業時間帯
 */
export interface WorkingHours {
  start: string; // "09:00"
  end: string;   // "18:00"
}

/**
 * 時間帯のアイテム（イベントやタスク）
 */
export interface TimeSlot {
  start: Date;
  end: Date;
}

/**
 * デフォルトの作業時間帯（9:00-18:00）
 */
export const DEFAULT_WORKING_HOURS: WorkingHours = {
  start: '09:00',
  end: '18:00'
};

/**
 * 時刻文字列をDateオブジェクトに変換（指定日の日付部分を使用）
 */
function timeStringToDate(date: Date, timeString: string): Date {
  const [hours, minutes] = timeString.split(':').map(Number);
  const result = new Date(date);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

/**
 * 指定された日の空き時間を検索
 *
 * @param date - 検索対象の日付
 * @param existingSlots - 既存の時間帯（イベント、タスクなど）
 * @param duration - 必要な時間（分）
 * @param workingHours - 作業時間帯（省略時は9:00-18:00）
 * @returns 空き時間スロットの配列
 */
export function findFreeSlots(
  date: Date,
  existingSlots: TimeSlot[],
  duration: number,
  workingHours: WorkingHours = DEFAULT_WORKING_HOURS
): FreeSlot[] {
  const freeSlots: FreeSlot[] = [];

  // 作業開始・終了時刻
  const workStart = timeStringToDate(date, workingHours.start);
  const workEnd = timeStringToDate(date, workingHours.end);

  // 既存のスロットをソート（開始時刻順）
  const sortedSlots = [...existingSlots]
    .filter(slot => isSameDay(slot.start, date))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  // 作業開始時刻から空き時間を探索
  let currentTime = workStart;

  for (const slot of sortedSlots) {
    // スロット開始前の隙間をチェック
    const gap = differenceInMinutes(slot.start, currentTime);

    if (gap >= duration) {
      freeSlots.push({
        start: new Date(currentTime),
        end: new Date(currentTime.getTime() + duration * 60 * 1000),
        duration
      });
    }

    // 現在時刻をスロット終了後に更新
    if (slot.end > currentTime) {
      currentTime = slot.end;
    }
  }

  // 最後のスロット後の空き時間をチェック
  const remainingGap = differenceInMinutes(workEnd, currentTime);
  if (remainingGap >= duration) {
    freeSlots.push({
      start: new Date(currentTime),
      end: new Date(currentTime.getTime() + duration * 60 * 1000),
      duration
    });
  }

  return freeSlots;
}

/**
 * 全ての空き時間を返す（指定時間以上のものだけでなく全て）
 *
 * @param date - 検索対象の日付
 * @param existingSlots - 既存の時間帯
 * @param workingHours - 作業時間帯
 * @returns 全ての空き時間スロット
 */
export function getAllFreeSlots(
  date: Date,
  existingSlots: TimeSlot[],
  workingHours: WorkingHours = DEFAULT_WORKING_HOURS
): FreeSlot[] {
  const freeSlots: FreeSlot[] = [];

  const workStart = timeStringToDate(date, workingHours.start);
  const workEnd = timeStringToDate(date, workingHours.end);

  const sortedSlots = [...existingSlots]
    .filter(slot => isSameDay(slot.start, date))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  let currentTime = workStart;

  for (const slot of sortedSlots) {
    const gap = differenceInMinutes(slot.start, currentTime);

    if (gap > 0) {
      freeSlots.push({
        start: new Date(currentTime),
        end: new Date(slot.start),
        duration: gap
      });
    }

    if (slot.end > currentTime) {
      currentTime = slot.end;
    }
  }

  const remainingGap = differenceInMinutes(workEnd, currentTime);
  if (remainingGap > 0) {
    freeSlots.push({
      start: new Date(currentTime),
      end: workEnd,
      duration: remainingGap
    });
  }

  return freeSlots;
}

/**
 * 時間の重複をチェック
 *
 * @param slot1 - 時間帯1
 * @param slot2 - 時間帯2
 * @returns 重複しているか
 */
export function isOverlapping(slot1: TimeSlot, slot2: TimeSlot): boolean {
  return slot1.start < slot2.end && slot1.end > slot2.start;
}

/**
 * 分単位の時間をフォーマット
 *
 * @param minutes - 分単位の時間
 * @returns フォーマットされた文字列（例: "1h 30m"）
 */
export function formatMinutes(minutes: number): string {
  if (minutes <= 0) return '0分';
  if (minutes < 60) return `${minutes}分`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (remainingMinutes === 0) return `${hours}時間`;
  return `${hours}時間${remainingMinutes}分`;
}
