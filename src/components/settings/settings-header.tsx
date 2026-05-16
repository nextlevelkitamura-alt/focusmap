import Link from "next/link"
import { ChevronLeft } from "lucide-react"

interface SettingsHeaderProps {
  title: string
  /** 戻り先 URL（デフォルト /dashboard/settings）*/
  backHref?: string
  backLabel?: string
}

/**
 * iOS の設定アプリ風ヘッダー。
 *   左上: < 設定 （戻る）
 *   タイトル: 大きく中央 or 左寄せ
 */
export function SettingsHeader({ title, backHref = "/dashboard/settings", backLabel = "設定" }: SettingsHeaderProps) {
  return (
    <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b">
      <div className="relative flex items-center min-h-[52px] px-2">
        <Link
          href={backHref}
          className="flex items-center gap-0.5 min-h-[44px] px-2 text-primary text-base hover:opacity-80"
        >
          <ChevronLeft className="h-5 w-5" />
          <span>{backLabel}</span>
        </Link>
        <div className="flex-1" />
      </div>
      <div className="px-4 pb-3 pt-1">
        <h1 className="text-2xl font-bold">{title}</h1>
      </div>
    </div>
  )
}
