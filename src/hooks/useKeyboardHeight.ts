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
            const layoutHeight = Math.max(
                window.innerHeight || 0,
                document.documentElement?.clientHeight || 0
            )
            // キーボードやブラウザ独自バーで隠れている下側の領域。
            // visualViewport の下端を基準にすると、Chrome のパスワードバー等で
            // キーボード直上が変動してもアクセサリーバーを可視領域内に置ける。
            const bottom = Math.round(vv.offsetTop + vv.height)
            const height = Math.max(0, layoutHeight - bottom)
            const isOpen = height > 50

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
