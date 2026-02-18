"use client"

import { useState, useEffect, useCallback, useRef } from 'react'

interface UseKeyboardHeightReturn {
    keyboardHeight: number
    isKeyboardOpen: boolean
}

export function useKeyboardHeight(): UseKeyboardHeightReturn {
    const [keyboardHeight, setKeyboardHeight] = useState(0)
    const rafRef = useRef<number>(0)

    const updateHeight = useCallback(() => {
        // rAF でバッチング: 1フレームに1回だけ更新して安定化
        if (rafRef.current) cancelAnimationFrame(rafRef.current)
        rafRef.current = requestAnimationFrame(() => {
            if (typeof window === 'undefined' || !window.visualViewport) return

            const vv = window.visualViewport
            // キーボードの高さ = ウィンドウ全体の高さ - visualViewport の高さ - offsetTop
            const height = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
            // 小さい差分はキーボードではない（アドレスバー等の変動）
            setKeyboardHeight(height > 50 ? Math.round(height) : 0)
        })
    }, [])

    useEffect(() => {
        if (typeof window === 'undefined' || !window.visualViewport) return

        const vv = window.visualViewport
        vv.addEventListener('resize', updateHeight)
        vv.addEventListener('scroll', updateHeight)

        return () => {
            vv.removeEventListener('resize', updateHeight)
            vv.removeEventListener('scroll', updateHeight)
            if (rafRef.current) cancelAnimationFrame(rafRef.current)
        }
    }, [updateHeight])

    return {
        keyboardHeight,
        isKeyboardOpen: keyboardHeight > 50,
    }
}
