import { useCallback, useRef, RefObject } from "react"

/** Synchronize scroll positions between two elements */
export function useScrollSync(refA: RefObject<HTMLDivElement | null>, refB: RefObject<HTMLDivElement | null>) {
  const isSyncingRef = useRef(false)

  const handleScrollA = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (isSyncingRef.current) return
    isSyncingRef.current = true
    if (refB.current) {
      refB.current.scrollTop = e.currentTarget.scrollTop
    }
    requestAnimationFrame(() => { isSyncingRef.current = false })
  }, [refB])

  const handleScrollB = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (isSyncingRef.current) return
    isSyncingRef.current = true
    if (refA.current) {
      refA.current.scrollTop = e.currentTarget.scrollTop
    }
    requestAnimationFrame(() => { isSyncingRef.current = false })
  }, [refA])

  return { handleScrollA, handleScrollB }
}
