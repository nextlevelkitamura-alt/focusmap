'use client'

import dynamic from 'next/dynamic'

/**
 * DateTimePicker を SSR なしで動的インポート
 * 複数の場所で使用されるため、ここで一元化
 */
export const DateTimePicker = dynamic(
    () => import("@/components/ui/date-time-picker").then((mod) => ({ default: mod.DateTimePicker })),
    {
        ssr: false,
        loading: () => <div className="w-6 h-6 animate-spin border-2 border-zinc-600 border-t-transparent rounded-full" />,
    }
)
