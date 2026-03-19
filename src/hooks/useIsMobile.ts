"use client"

import { useState, useEffect } from "react"

/**
 * タッチデバイス（スマホ・タブレット）かどうかを判定するフック
 * pointer: coarse でタッチ入力を検出
 */
export function useIsMobile(): boolean {
    const [isMobile, setIsMobile] = useState(false)

    useEffect(() => {
        const mql = window.matchMedia("(pointer: coarse)")
        setIsMobile(mql.matches)

        const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
        mql.addEventListener("change", handler)
        return () => mql.removeEventListener("change", handler)
    }, [])

    return isMobile
}
