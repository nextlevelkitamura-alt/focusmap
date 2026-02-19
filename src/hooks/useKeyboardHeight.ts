"use client"

import { useState, useEffect, useCallback, useRef } from 'react'

interface KeyboardState {
    keyboardHeight: number
    isKeyboardOpen: boolean
    /** 可視領域の下端位置（CSS top 座標）。アクセサリーバーの配置に使用 */
    viewportBottom: number
}

export function useKeyboardHeight(): KeyboardState {
    const [state, setState] = useState<KeyboardState>({
        keyboardHeight: 0,
        isKeyboardOpen: false,
        viewportBottom: 0,
    })
    const rafRef = useRef<number>(0)

    const updateHeight = useCallback(() => {
        // rAF でバッチング: 1フレームに1回だけ更新して安定化
        if (rafRef.current) cancelAnimationFrame(rafRef.current)
        rafRef.current = requestAnimationFrame(() => {
            if (typeof window === 'undefined' || !window.visualViewport) return

            const vv = window.visualViewport
            // キーボードの高さ = ウィンドウ全体の高さ - visualViewport の高さ - offsetTop
            const height = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
            const isOpen = height > 50
            // 可視領域の下端 = offsetTop + height（CSS top 座標系で確実な位置）
            const bottom = Math.round(vv.offsetTop + vv.height)

            setState({
                keyboardHeight: isOpen ? Math.round(height) : 0,
                isKeyboardOpen: isOpen,
                viewportBottom: bottom,
            })
        })
    }, [])

    useEffect(() => {
        if (typeof window === 'undefined' || !window.visualViewport) return

        const vv = window.visualViewport
        vv.addEventListener('resize', updateHeight)
        vv.addEventListener('scroll', updateHeight)
        // 初期値を設定
        updateHeight()

        return () => {
            vv.removeEventListener('resize', updateHeight)
            vv.removeEventListener('scroll', updateHeight)
            if (rafRef.current) cancelAnimationFrame(rafRef.current)
        }
    }, [updateHeight])

    return state
}
