export interface TodayTimelineLayoutInput {
  id: string
  source: string
  startTime: Date
  endTime: Date
}

export interface TodayTimelineLayoutOptions {
  totalHeight: number
  minHeight: number
}

export interface TodayTimelineLayoutPosition {
  top: number
  height: number
  column: number
  totalColumns: number
}

interface PositionedItem<T extends TodayTimelineLayoutInput> {
  item: T
  index: number
  startMs: number
  endMs: number
  top: number
  height: number
}

function minutesFromMidnight(date: Date): number {
  return date.getHours() * 60 + date.getMinutes()
}

function overlaps(
  a: Pick<PositionedItem<TodayTimelineLayoutInput>, 'startMs' | 'endMs'>,
  b: Pick<PositionedItem<TodayTimelineLayoutInput>, 'startMs' | 'endMs'>
): boolean {
  return a.startMs < b.endMs && a.endMs > b.startMs
}

function firstAvailableColumn<T extends TodayTimelineLayoutInput>(
  item: PositionedItem<T>,
  columns: PositionedItem<T>[][]
): number {
  for (let column = 0; column < columns.length; column += 1) {
    if (!columns[column].some(existing => overlaps(item, existing))) {
      return column
    }
  }
  return columns.length
}

export function calculateTodayTimelineLayout<T extends TodayTimelineLayoutInput>(
  items: T[],
  options: TodayTimelineLayoutOptions
): Array<T & TodayTimelineLayoutPosition> {
  if (items.length === 0) return []

  const positioned = items.map((item, index) => {
    const startMs = item.startTime.getTime()
    const endMs = item.endTime.getTime()
    const top = (minutesFromMidnight(item.startTime) / (24 * 60)) * options.totalHeight
    const rawHeight = ((endMs - startMs) / (24 * 60 * 60 * 1000)) * options.totalHeight
    const height = Math.max(
      Math.min(rawHeight, options.totalHeight - top),
      options.minHeight
    )

    return { item, index, startMs, endMs, top, height }
  })

  const sorted = [...positioned].sort((a, b) => {
    const startDiff = a.startMs - b.startMs
    if (startDiff !== 0) return startDiff

    const durationDiff = (b.endMs - b.startMs) - (a.endMs - a.startMs)
    if (durationDiff !== 0) return durationDiff

    return a.index - b.index
  })

  const clusters: Array<PositionedItem<T>[]> = []
  let currentCluster: PositionedItem<T>[] = []
  let currentClusterEnd = Number.NEGATIVE_INFINITY

  for (const item of sorted) {
    if (currentCluster.length === 0 || item.startMs < currentClusterEnd) {
      currentCluster.push(item)
      currentClusterEnd = Math.max(currentClusterEnd, item.endMs)
      continue
    }

    clusters.push(currentCluster)
    currentCluster = [item]
    currentClusterEnd = item.endMs
  }

  if (currentCluster.length > 0) {
    clusters.push(currentCluster)
  }

  const layoutByIndex = new Map<number, TodayTimelineLayoutPosition>()

  for (const cluster of clusters) {
    const columns: PositionedItem<T>[][] = []

    for (const item of cluster) {
      const column = firstAvailableColumn(item, columns)
      if (!columns[column]) columns[column] = []
      columns[column].push(item)
      layoutByIndex.set(item.index, {
        top: item.top,
        height: item.height,
        column,
        totalColumns: 1,
      })
    }

    const totalColumns = columns.length
    for (const item of cluster) {
      const layout = layoutByIndex.get(item.index)
      if (layout) layout.totalColumns = totalColumns
    }
  }

  return positioned.map(({ item, index }) => ({
    ...item,
    ...layoutByIndex.get(index)!,
  }))
}
