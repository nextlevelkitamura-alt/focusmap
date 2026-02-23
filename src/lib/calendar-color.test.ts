import { describe, expect, test } from 'vitest'
import { resolveCalendarEventColor } from './calendar-color'

describe('resolveCalendarEventColor', () => {
  test('event個別色は無視し、calendar色のみを使う', () => {
    const color = resolveCalendarEventColor({
      calendarBackgroundColor: '#7CB342',
    })

    expect(color).toBe('#7CB342')
  })

  test('calendar色が3桁HEXでも正規化して返す', () => {
    const color = resolveCalendarEventColor({
      calendarBackgroundColor: '#abc',
    })

    expect(color).toBe('#AABBCC')
  })

  test('calendar色が無い場合は undefined を返す', () => {
    const color = resolveCalendarEventColor({
    })

    expect(color).toBeUndefined()
  })
})
