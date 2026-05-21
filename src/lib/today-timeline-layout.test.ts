import { describe, expect, test } from 'vitest'
import { calculateTodayTimelineLayout, type TodayTimelineLayoutInput } from './today-timeline-layout'

const TOTAL_HEIGHT = 24 * 56
const MIN_HEIGHT = 56 * 0.4

function item(id: string, start: string, end: string): TodayTimelineLayoutInput {
  return {
    id,
    source: 'test',
    startTime: new Date(`2026-05-21T${start}:00+09:00`),
    endTime: new Date(`2026-05-21T${end}:00+09:00`),
  }
}

function layout(items: TodayTimelineLayoutInput[]) {
  return calculateTodayTimelineLayout(items, {
    totalHeight: TOTAL_HEIGHT,
    minHeight: MIN_HEIGHT,
  })
}

describe('calculateTodayTimelineLayout', () => {
  test('keeps a long event and shorter overlapping events in one stable two-column cluster', () => {
    const result = layout([
      item('long', '11:00', '17:00'),
      item('morning', '11:00', '12:00'),
      item('afternoon', '13:00', '16:00'),
      item('late', '16:00', '17:00'),
    ])

    expect(result.map(entry => entry.id)).toEqual(['long', 'morning', 'afternoon', 'late'])
    expect(result.map(entry => entry.totalColumns)).toEqual([2, 2, 2, 2])
    expect(result.find(entry => entry.id === 'long')?.column).toBe(0)
    expect(result.find(entry => entry.id === 'morning')?.column).toBe(1)
    expect(result.find(entry => entry.id === 'afternoon')?.column).toBe(1)
    expect(result.find(entry => entry.id === 'late')?.column).toBe(1)
  })

  test('assigns separate columns to events starting at the same time', () => {
    const result = layout([
      item('a', '09:00', '10:00'),
      item('b', '09:00', '10:00'),
      item('c', '09:00', '10:00'),
    ])

    expect(result.map(entry => entry.totalColumns)).toEqual([3, 3, 3])
    expect(new Set(result.map(entry => entry.column))).toEqual(new Set([0, 1, 2]))
  })

  test('uses the same width for transitively overlapping chains', () => {
    const result = layout([
      item('a', '09:00', '10:00'),
      item('b', '09:30', '10:30'),
      item('c', '10:00', '11:00'),
    ])

    expect(result.map(entry => entry.totalColumns)).toEqual([2, 2, 2])
    expect(result.find(entry => entry.id === 'a')?.column).toBe(0)
    expect(result.find(entry => entry.id === 'b')?.column).toBe(1)
    expect(result.find(entry => entry.id === 'c')?.column).toBe(0)
  })

  test('does not group events that only touch at their boundary', () => {
    const result = layout([
      item('a', '09:00', '10:00'),
      item('b', '10:00', '11:00'),
    ])

    expect(result.map(entry => entry.totalColumns)).toEqual([1, 1])
    expect(result.map(entry => entry.column)).toEqual([0, 0])
  })
})
