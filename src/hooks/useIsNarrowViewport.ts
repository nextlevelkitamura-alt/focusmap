"use client"

import { useState, useEffect } from "react"

/**
 * 画面幅が breakpointPx 以下かを判定するフック。
 * DevTools のレスポンシブモードや実機サイズに追随する。
 */
export function useIsNarrowViewport(breakpointPx = 767): boolean {
    const [isNarrow, setIsNarrow] = useState<boolean>(() => {
        if (typeof window === "undefined") return false
        return window.matchMedia(`(max-width: ${breakpointPx}px)`).matches
    })

    useEffect(() => {
        if (typeof window === "undefined") return
        const mql = window.matchMedia(`(max-width: ${breakpointPx}px)`)
        const handler = (e: MediaQueryListEvent) => setIsNarrow(e.matches)
        mql.addEventListener("change", handler)
        return () => mql.removeEventListener("change", handler)
    }, [breakpointPx])

    return isNarrow
}
