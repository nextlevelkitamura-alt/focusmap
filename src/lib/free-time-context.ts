import { getAllFreeSlots, type WorkingHours, type TimeSlot } from '@/lib/time-utils'
import { addDays } from 'date-fns'
import type { SupabaseClient } from '@supabase/supabase-js'

const DEFAULT_WORKING_HOURS: WorkingHours = { start: '09:00', end: '20:00' }

function toJstDate(date: Date): Date {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000)
}

function formatDateLabel(date: Date): string {
  const days = ['日', '月', '火', '水', '木', '金', '土']
  return `${date.getMonth() + 1}月${date.getDate()}日(${days[date.getDay()]})`
}

/**
 * ユーザーのカレンダーとタスクから空き時間コンテキストを取得する
 * /api/ai/chat と /api/ai/scheduling の両方で使用
 */
export async function getFreeTimeContext(
  userId: string,
  calendarIds: string[],
  supabase: SupabaseClient,
  daysAhead: number = 7,
  workingHours: WorkingHours = DEFAULT_WORKING_HOURS,
): Promise<{ contextText: string; busySlots: TimeSlot[] }> {
  const { fetchMultipleCalendarEvents } = await import('@/lib/google-calendar')
  const nowJst = toJstDate(new Date())
  const endDate = addDays(nowJst, daysAhead)

  // Google Calendar イベントを取得
  const calendarEvents = await fetchMultipleCalendarEvents(userId, calendarIds, {
    timeMin: nowJst,
    timeMax: endDate,
  })

  // スケジュール済みタスクも取得
  const { data: scheduledTasks } = await supabase
    .from('tasks')
    .select('title, scheduled_at, estimated_time')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .not('scheduled_at', 'is', null)
    .gte('scheduled_at', nowJst.toISOString())
    .lte('scheduled_at', endDate.toISOString())

  // TimeSlot 形式に変換
  const busySlots: TimeSlot[] = [
    ...calendarEvents.map(e => ({
      start: new Date(e.start_time),
      end: new Date(e.end_time),
    })),
    ...(scheduledTasks || []).map(t => {
      const start = new Date(t.scheduled_at!)
      const end = new Date(start.getTime() + (t.estimated_time || 60) * 60 * 1000)
      return { start, end }
    }),
  ]

  // 日毎の空き時間テキストを生成
  const lines: string[] = []
  for (let i = 0; i < daysAhead; i++) {
    const targetDate = addDays(nowJst, i)
    const dateLabel = formatDateLabel(targetDate)
    const freeSlots = getAllFreeSlots(targetDate, busySlots, workingHours)

    if (freeSlots.length === 0) {
      lines.push(`${dateLabel}: 空き時間なし`)
    } else {
      const slotTexts = freeSlots.map(s => {
        const sh = String(s.start.getHours()).padStart(2, '0')
        const sm = String(s.start.getMinutes()).padStart(2, '0')
        const eh = String(s.end.getHours()).padStart(2, '0')
        const em = String(s.end.getMinutes()).padStart(2, '0')
        return `${sh}:${sm}-${eh}:${em}(${s.duration}分)`
      })
      lines.push(`${dateLabel}: ${slotTexts.join(', ')}`)
    }
  }

  const contextText = `\n## 今後${daysAhead}日間の空き時間（${workingHours.start}-${workingHours.end}の作業時間内）\n${lines.join('\n')}`

  return { contextText, busySlots }
}
