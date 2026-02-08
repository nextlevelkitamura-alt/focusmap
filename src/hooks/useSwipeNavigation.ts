import { useCallback, useRef, useState, RefObject, useEffect } from 'react'

interface UseSwipeNavigationOptions {
  containerRef: RefObject<HTMLDivElement | null>
  onSwipeLeft: () => void  // 次の期間
  onSwipeRight: () => void // 前の期間
  threshold?: number       // スワイプと判定する最小距離（px）
}

export function useSwipeNavigation({
  containerRef,
  onSwipeLeft,
  onSwipeRight,
  threshold = 50
}: UseSwipeNavigationOptions) {
  const startXRef = useRef<number | null>(null)
  const startYRef = useRef<number | null>(null)
  const isDraggingRef = useRef(false)
  const [swipeDirection, setSwipeDirection] = useState<'left' | 'right' | null>(null)

  const handleTouchStart = useCallback((e: TouchEvent) => {
    // 1本指のみ（2本指はピンチズーム用）
    if (e.touches.length !== 1) return

    startXRef.current = e.touches[0].clientX
    startYRef.current = e.touches[0].clientY
    isDraggingRef.current = false
  }, [])

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (e.touches.length !== 1) return
    if (startXRef.current === null || startYRef.current === null) return

    const currentX = e.touches[0].clientX
    const currentY = e.touches[0].clientY
    const deltaX = currentX - startXRef.current
    const deltaY = currentY - startYRef.current

    // 縦スクロールを優先（縦方向の移動が大きい場合は横スワイプしない）
    if (Math.abs(deltaY) > Math.abs(deltaX) * 2) {
      return
    }

    // 横方向の移動が閾値を超えたらスワイプ開始
    if (Math.abs(deltaX) > threshold) {
      isDraggingRef.current = true
      setSwipeDirection(deltaX > 0 ? 'right' : 'left')
    }
  }, [threshold])

  const handleTouchEnd = useCallback(() => {
    if (!isDraggingRef.current || startXRef.current === null) {
      startXRef.current = null
      startYRef.current = null
      setSwipeDirection(null)
      return
    }

    if (swipeDirection === 'left') {
      onSwipeLeft()
    } else if (swipeDirection === 'right') {
      onSwipeRight()
    }

    startXRef.current = null
    startYRef.current = null
    isDraggingRef.current = false
    setSwipeDirection(null)
  }, [swipeDirection, onSwipeLeft, onSwipeRight])

  // マウスドラッグ対応（オプション）
  const handleMouseDown = useCallback((e: MouseEvent) => {
    startXRef.current = e.clientX
    startYRef.current = e.clientY
    isDraggingRef.current = false
  }, [])

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (startXRef.current === null) return

    const deltaX = e.clientX - startXRef.current
    const deltaY = e.clientY - startYRef.current!

    // 縦スクロールを優先
    if (Math.abs(deltaY) > Math.abs(deltaX) * 2) {
      return
    }

    if (Math.abs(deltaX) > threshold) {
      isDraggingRef.current = true
      setSwipeDirection(deltaX > 0 ? 'right' : 'left')
    }
  }, [threshold])

  const handleMouseUp = useCallback(() => {
    if (!isDraggingRef.current) {
      startXRef.current = null
      startYRef.current = null
      setSwipeDirection(null)
      return
    }

    if (swipeDirection === 'left') {
      onSwipeLeft()
    } else if (swipeDirection === 'right') {
      onSwipeRight()
    }

    startXRef.current = null
    startYRef.current = null
    isDraggingRef.current = false
    setSwipeDirection(null)
  }, [swipeDirection, onSwipeLeft, onSwipeRight])

  // イベントリスナー登録
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    container.addEventListener('touchstart', handleTouchStart, { passive: true })
    container.addEventListener('touchmove', handleTouchMove, { passive: true })
    container.addEventListener('touchend', handleTouchEnd)
    container.addEventListener('mousedown', handleMouseDown)
    container.addEventListener('mousemove', handleMouseMove)
    container.addEventListener('mouseup', handleMouseUp)

    return () => {
      container.removeEventListener('touchstart', handleTouchStart)
      container.removeEventListener('touchmove', handleTouchMove)
      container.removeEventListener('touchend', handleTouchEnd)
      container.removeEventListener('mousedown', handleMouseDown)
      container.removeEventListener('mousemove', handleMouseMove)
      container.removeEventListener('mouseup', handleMouseUp)
    }
  }, [containerRef, handleTouchStart, handleTouchMove, handleTouchEnd, handleMouseDown, handleMouseMove, handleMouseUp])

  return { swipeDirection }
}
