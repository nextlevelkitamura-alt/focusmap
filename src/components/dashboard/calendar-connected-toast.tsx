"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams, usePathname } from "next/navigation"
import { CalendarToast } from "@/components/calendar/calendar-toast"

/**
 * Googleカレンダー連携完了の一時通知。
 *
 * `/api/calendar/callback` が連携成功後に `?calendar_connected=true` を付けて
 * ダッシュボードに戻してくれるので、それを検知して 3秒だけ Toast を表示する。
 * 表示直後にURLからクエリを削除するので、リロードしても再表示されない。
 */
export function CalendarConnectedToast() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (searchParams.get("calendar_connected") !== "true") return

    setShow(true)

    // URLからクエリパラメータを取り除く（リロード時の再表示を防ぐ）
    const next = new URLSearchParams(Array.from(searchParams.entries()))
    next.delete("calendar_connected")
    const query = next.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }, [searchParams, router, pathname])

  if (!show) return null

  return (
    <CalendarToast
      type="success"
      message="Googleカレンダーを連携しました"
      duration={3000}
      onClose={() => setShow(false)}
    />
  )
}
