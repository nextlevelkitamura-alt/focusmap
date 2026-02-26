'use client'

import { useRouter } from 'next/navigation'
import { Brain, ChevronRight } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'

export function AiContextSettings() {
  const router = useRouter()

  return (
    <Card
      className="cursor-pointer hover:bg-muted/30 transition-colors"
      onClick={() => router.push('/dashboard/ai-context')}
    >
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Brain className="w-5 h-5 text-primary" />
            <div>
              <CardTitle>AIコンテキスト管理</CardTitle>
              <CardDescription>
                AIに伝えたい自分の情報やプロジェクト情報をフォルダで管理
              </CardDescription>
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-muted-foreground" />
        </div>
      </CardHeader>
    </Card>
  )
}
