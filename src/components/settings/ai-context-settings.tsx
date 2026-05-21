'use client'

import Link from 'next/link'
import { Brain, ChevronRight, FileText, Pin, RefreshCw } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function AiContextSettings() {
  return (
    <Card
      className="h-full border-white/10 bg-[#202020] text-zinc-100 shadow-none"
    >
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-400/10 text-violet-200">
            <Brain className="h-5 w-5" />
          </div>
          <Link
            href="/dashboard/ai-context"
            className="inline-flex h-8 items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-2 text-xs text-zinc-200 transition hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          >
            開く
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <CardTitle className="pt-2">AIコンテキスト</CardTitle>
        <CardDescription className="text-zinc-500">
          AIに伝えたい自分の情報やプロジェクト情報を管理します。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {[
          { icon: FileText, label: '性格・目的・状況を整理' },
          { icon: Pin, label: '重要情報をピン留め' },
          { icon: RefreshCw, label: '古い情報を見直し' },
        ].map(item => (
          <div key={item.label} className="flex min-h-11 items-center gap-3 rounded-lg border border-white/10 bg-[#171717] px-3">
            <item.icon className="h-4 w-4 shrink-0 text-zinc-500" />
            <span className="text-sm text-zinc-300">{item.label}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
