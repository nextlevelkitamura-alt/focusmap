import { describe, expect, test } from 'vitest'
import { resolveCalendarEventColor } from './calendar-color'

describe('resolveCalendarEventColor', () => {
  test('event.colorId がある場合は event 色を優先する', () => {
    const eventColorPalette = new Map<string, string>([
      ['11', '#DC2127'],
    ])

    const color = resolveCalendarEventColor({
      eventColor: '11',
      calendarBackgroundColor: '#7CB342',
      eventBackgroundColor: '#039BE5',
      eventColorPalette,
    })

    expect(color).toBe('#DC2127')
  })

  test('event.colorId がない場合は calendar 色を使う', () => {
    const color = resolveCalendarEventColor({
      calendarBackgroundColor: '#4285F4',
      eventBackgroundColor: '#039BE5',
      eventColorPalette: new Map(),
    })

    expect(color).toBe('#4285F4')
  })

  test('色情報が無い場合はデフォルト色になる', () => {
    const color = resolveCalendarEventColor({
      eventColor: 'unknown',
      eventColorPalette: new Map(),
    })

    expect(color).toBe('#039BE5')
  })
})

