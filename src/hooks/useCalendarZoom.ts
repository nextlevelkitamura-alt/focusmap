import { useState, useCallback, useRef, useEffect, RefObject } from 'react'
import { ZOOM_CONFIG, HOUR_HEIGHT } from '@/lib/calendar-constants'

interface UseCalendarZoomOptions {
  gridRef: RefObject<HTMLDivElement | null>
  initialHourHeight?: number
}

export function useCalendarZoom({
  gridRef,
  initialHourHeight = HOUR_HEIGHT
}: UseCalendarZoomOptions) {
  const [hourHeight, setHourHeight] = useState(initialHourHeight)
  const lastPinchDistanceRef = useRef<number | null>(null)

  // ホイールズーム (Ctrl/Cmd + Wheel)
  const handleWheel = useCallback((e: WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return
    e.preventDefault()

    const grid = gridRef.current
    if (!grid) return

    // 現在のスクロール位置と表示中心を計算
    const scrollTop = grid.scrollTop
    const viewportHeight = grid.clientHeight
    const scrollCenter = scrollTop + viewportHeight / 2
    const scrollCenterRatio = grid.scrollHeight > 0 ? scrollCenter / grid.scrollHeight : 0.5

    const delta = e.deltaY > 0 ? -ZOOM_CONFIG.WHEEL_ZOOM_DELTA : ZOOM_CONFIG.WHEEL_ZOOM_DELTA

    setHourHeight(prev => {
      const next = Math.max(
        ZOOM_CONFIG.MIN_HOUR_HEIGHT,
        Math.min(ZOOM_CONFIG.MAX_HOUR_HEIGHT, prev + delta)
      )

      // 新しい高さでスクロール位置を調整（次のrAFで）
      requestAnimationFrame(() => {
        if (grid.scrollHeight > 0) {
          grid.scrollTop = scrollCenterRatio * grid.scrollHeight - viewportHeight / 2
        }
      })

      return next
    })
  }, [gridRef])

  // ピンチズーム
  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (e.touches.length === 2) {
      const distance = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      )
      lastPinchDistanceRef.current = distance
    }
  }, [])

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (e.touches.length === 2 && lastPinchDistanceRef.current !== null) {
      e.preventDefault()
      const distance = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      )
      const delta = (distance - lastPinchDistanceRef.current) * ZOOM_CONFIG.PINCH_ZOOM_SENSITIVITY
      lastPinchDistanceRef.current = distance

      setHourHeight(prev => {
        const next = prev + delta
        return Math.max(
          ZOOM_CONFIG.MIN_HOUR_HEIGHT,
          Math.min(ZOOM_CONFIG.MAX_HOUR_HEIGHT, next)
        )
      })
    }
  }, [])

  const handleTouchEnd = useCallback(() => {
    lastPinchDistanceRef.current = null
  }, [])

  // イベントリスナー登録
  useEffect(() => {
    const grid = gridRef.current
    if (!grid) return

    grid.addEventListener('wheel', handleWheel, { passive: false })
    grid.addEventListener('touchstart', handleTouchStart)
    grid.addEventListener('touchmove', handleTouchMove, { passive: false })
    grid.addEventListener('touchend', handleTouchEnd)

    return () => {
      grid.removeEventListener('wheel', handleWheel)
      grid.removeEventListener('touchstart', handleTouchStart)
      grid.removeEventListener('touchmove', handleTouchMove)
      grid.removeEventListener('touchend', handleTouchEnd)
    }
  }, [gridRef, handleWheel, handleTouchStart, handleTouchMove, handleTouchEnd])

  const zoomLevel = Math.round((hourHeight / HOUR_HEIGHT) * 100)

  return {
    hourHeight,
    zoomLevel,
    setHourHeight // 手動リセット用
  }
}
