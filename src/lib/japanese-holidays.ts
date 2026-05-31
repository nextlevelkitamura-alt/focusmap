function keyOf(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

function dateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

function fromKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number)
  return new Date(year, month - 1, day)
}

function addDays(date: Date, amount: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + amount)
  d.setHours(0, 0, 0, 0)
  return d
}

function nthMonday(year: number, month: number, nth: number): number {
  const first = new Date(year, month - 1, 1)
  const offset = (8 - first.getDay()) % 7
  return 1 + offset + (nth - 1) * 7
}

function vernalEquinoxDay(year: number): number {
  return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4))
}

function autumnalEquinoxDay(year: number): number {
  return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4))
}

function buildBaseHolidayKeys(year: number): Set<string> {
  const keys = new Set<string>()

  keys.add(dateKey(year, 1, 1))
  keys.add(dateKey(year, 1, nthMonday(year, 1, 2)))
  keys.add(dateKey(year, 2, 11))
  if (year >= 2020) keys.add(dateKey(year, 2, 23))
  keys.add(dateKey(year, 3, vernalEquinoxDay(year)))
  keys.add(dateKey(year, 4, 29))
  keys.add(dateKey(year, 5, 3))
  keys.add(dateKey(year, 5, 4))
  keys.add(dateKey(year, 5, 5))
  keys.add(dateKey(year, 7, nthMonday(year, 7, 3)))
  keys.add(dateKey(year, 8, 11))
  keys.add(dateKey(year, 9, nthMonday(year, 9, 3)))
  keys.add(dateKey(year, 9, autumnalEquinoxDay(year)))
  keys.add(dateKey(year, 10, nthMonday(year, 10, 2)))
  keys.add(dateKey(year, 11, 3))
  keys.add(dateKey(year, 11, 23))

  return keys
}

const holidayCache = new Map<number, Set<string>>()

export function getJapaneseHolidayKeys(year: number): Set<string> {
  const cached = holidayCache.get(year)
  if (cached) return cached

  const keys = buildBaseHolidayKeys(year)

  for (const key of Array.from(keys).sort()) {
    const holiday = fromKey(key)
    if (holiday.getDay() !== 0) continue

    let substitute = addDays(holiday, 1)
    while (keys.has(keyOf(substitute))) {
      substitute = addDays(substitute, 1)
    }
    if (substitute.getFullYear() === year) keys.add(keyOf(substitute))
  }

  let cursor = new Date(year, 0, 2)
  const end = new Date(year, 11, 30)
  while (cursor <= end) {
    const prevKey = keyOf(addDays(cursor, -1))
    const nextKey = keyOf(addDays(cursor, 1))
    const cursorKey = keyOf(cursor)
    if (!keys.has(cursorKey) && keys.has(prevKey) && keys.has(nextKey)) {
      keys.add(cursorKey)
    }
    cursor = addDays(cursor, 1)
  }

  holidayCache.set(year, keys)
  return keys
}

export function isJapaneseHoliday(date: Date): boolean {
  return getJapaneseHolidayKeys(date.getFullYear()).has(keyOf(date))
}
