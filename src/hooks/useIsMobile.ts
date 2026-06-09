"use client"

import { useState, useEffect } from "react"

const COARSE_POINTER_QUERY = "(pointer: coarse)"
const MOBILE_WIDTH_QUERY = "(max-width: 767px)"

function readIsMobile() {
    return typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        (
            window.matchMedia(COARSE_POINTER_QUERY).matches ||
            window.matchMedia(MOBILE_WIDTH_QUERY).matches
        )
}

/**
 * モバイル向けUIに切り替えるかどうかを判定するフック。
 * タッチ入力だけでなく、デスクトップブラウザの狭幅確認もモバイル扱いにする。
 */
export function useIsMobile(): boolean {
    const [isMobile, setIsMobile] = useState(readIsMobile)

    useEffect(() => {
        if (typeof window === "undefined" || typeof window.matchMedia !== "function") return

        const queries = [
            window.matchMedia(COARSE_POINTER_QUERY),
            window.matchMedia(MOBILE_WIDTH_QUERY),
        ]
        const update = () => {
            setIsMobile(queries.some(query => query.matches))
        }

        update()
        queries.forEach(query => query.addEventListener("change", update))
        return () => {
            queries.forEach(query => query.removeEventListener("change", update))
        }
    }, [])

    return isMobile
}
