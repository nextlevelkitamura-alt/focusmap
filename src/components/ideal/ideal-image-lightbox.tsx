"use client"

import { useState, useEffect, useCallback } from "react"
import { X, ChevronLeft, ChevronRight } from "lucide-react"
import { IdealItemImage } from "@/types/database"

interface IdealImageLightboxProps {
    images: IdealItemImage[]
    initialIndex: number
    onClose: () => void
}

export function IdealImageLightbox({ images, initialIndex, onClose }: IdealImageLightboxProps) {
    const [currentIndex, setCurrentIndex] = useState(initialIndex)

    const goNext = useCallback(() => {
        setCurrentIndex(i => (i + 1) % images.length)
    }, [images.length])

    const goPrev = useCallback(() => {
        setCurrentIndex(i => (i - 1 + images.length) % images.length)
    }, [images.length])

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose()
            if (e.key === 'ArrowRight') goNext()
            if (e.key === 'ArrowLeft') goPrev()
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [onClose, goNext, goPrev])

    const current = images[currentIndex]
    if (!current) return null

    return (
        <div
            className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center"
            onClick={onClose}
        >
            {/* 閉じるボタン */}
            <button
                onClick={onClose}
                className="absolute top-4 right-4 z-10 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
                <X className="w-6 h-6" />
            </button>

            {/* メイン画像 */}
            <div
                className="relative flex-1 flex items-center justify-center w-full px-16"
                onClick={e => e.stopPropagation()}
            >
                {/* 前へ */}
                {images.length > 1 && (
                    <button
                        onClick={goPrev}
                        className="absolute left-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
                    >
                        <ChevronLeft className="w-6 h-6" />
                    </button>
                )}

                <img
                    src={current.image_url}
                    alt={current.caption || ''}
                    className="max-w-full max-h-[80vh] object-contain rounded-lg select-none"
                    draggable={false}
                />

                {/* 次へ */}
                {images.length > 1 && (
                    <button
                        onClick={goNext}
                        className="absolute right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
                    >
                        <ChevronRight className="w-6 h-6" />
                    </button>
                )}
            </div>

            {/* キャプション + ページ番号 */}
            <div className="py-4 text-center text-white" onClick={e => e.stopPropagation()}>
                {current.caption && (
                    <p className="text-sm mb-1">{current.caption}</p>
                )}
                {images.length > 1 && (
                    <p className="text-xs text-white/60">{currentIndex + 1} / {images.length}</p>
                )}
            </div>
        </div>
    )
}
