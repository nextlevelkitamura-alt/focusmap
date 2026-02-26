'use client'

import { useState } from 'react'
import { Brain, ChevronRight } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { ContextManager } from './context-manager'

export function AiContextSettings() {
  const [showManager, setShowManager] = useState(false)

  if (showManager) {
    return (
      <div className="fixed inset-0 z-50 bg-background md:static md:z-auto md:rounded-xl md:border md:shadow-sm md:h-[600px]">
        <ContextManager onBack={() => setShowManager(false)} />
      </div>
    )
  }

  return (
    <Card
      className="cursor-pointer hover:bg-muted/30 transition-colors"
      onClick={() => setShowManager(true)}
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
