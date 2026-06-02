"use client"

import { useState, useEffect } from "react"

function readIsMobile() {
    return typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(pointer: coarse)").matches
}

/**
 * タッチデバイス（スマホ・タブレット）かどうかを判定するフック
 * pointer: coarse でタッチ入力を検出
 */
export function useIsMobile(): boolean {
    const [isMobile, setIsMobile] = useState(readIsMobile)

    useEffect(() => {
        if (typeof window === "undefined" || typeof window.matchMedia !== "function") return

        const mql = window.matchMedia("(pointer: coarse)")
        const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
        mql.addEventListener("change", handler)
        return () => mql.removeEventListener("change", handler)
    }, [])

    return isMobile
}
