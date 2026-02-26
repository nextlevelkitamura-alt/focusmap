'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Brain, FolderOpen, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react'

interface UserContext {
  life_personality: string
  life_purpose: string
  current_situation: string
  updated_at?: string
}

interface ProjectContext {
  id: string
  project_id: string
  project_name: string
  purpose: string
  current_status: string
  key_insights: string
  updated_at: string
}

const CATEGORY_LABELS: Record<string, { label: string; description: string }> = {
  life_personality: { label: '性格・ライフスタイル', description: 'AIがあなたの性格や生活スタイルをどう理解しているか' },
  life_purpose: { label: '人生の目標・価値観', description: 'AIがあなたの目標や大切にしていることをどう理解しているか' },
  current_situation: { label: '今の状況', description: 'AIがあなたの最近の状況や課題をどう理解しているか' },
}

export function AiContextSettings() {
  const [userContext, setUserContext] = useState<UserContext | null>(null)
  const [projectContexts, setProjectContexts] = useState<ProjectContext[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set())

  const fetchContexts = useCallback(async () => {
    setLoading(true)
    try {
      const [userRes, projectRes] = await Promise.all([
        fetch('/api/ai/chat/context'),
        fetch('/api/ai/context/project'),
      ])

      if (userRes.ok) {
        const data = await userRes.json()
        setUserContext(data.context)
      }
      if (projectRes.ok) {
        const data = await projectRes.json()
        setProjectContexts(data.contexts || [])
      }
    } catch (error) {
      console.error('Failed to fetch contexts:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchContexts()
  }, [fetchContexts])

  const toggleProject = (projectId: string) => {
    setExpandedProjects(prev => {
      const next = new Set(prev)
      if (next.has(projectId)) {
        next.delete(projectId)
      } else {
        next.add(projectId)
      }
      return next
    })
  }

  const hasUserContext = userContext && (
    userContext.life_personality || userContext.life_purpose || userContext.current_situation
  )

  return (
    <div className="space-y-6">
      {/* ユーザーコンテキスト */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            AIが見ているあなた
          </CardTitle>
          <CardDescription>
            AIチャットであなたのことを話すと、ここに要約が保存されます
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <RefreshCw className="h-4 w-4 animate-spin" />
              読み込み中...
            </div>
          ) : hasUserContext ? (
            <div className="space-y-4">
              {Object.entries(CATEGORY_LABELS).map(([key, { label }]) => {
                const value = userContext?.[key as keyof UserContext]
                if (!value || typeof value !== 'string') return null
                return (
                  <div key={key} className="space-y-1">
                    <p className="text-sm font-medium text-muted-foreground">{label}</p>
                    <p className="text-sm leading-relaxed bg-muted/50 rounded-lg p-3">
                      {value}
                    </p>
                  </div>
                )
              })}
              {userContext?.updated_at && (
                <p className="text-xs text-muted-foreground">
                  最終更新: {new Date(userContext.updated_at).toLocaleDateString('ja-JP')}
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              まだ設定されていません。AIチャットで「自分のことを話したい」と伝えると、AIがあなたについて学びます。
            </p>
          )}
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={fetchContexts}
          >
            <RefreshCw className="h-4 w-4 mr-1" />
            更新
          </Button>
        </CardContent>
      </Card>

      {/* プロジェクトコンテキスト */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5" />
            プロジェクトのコンテキスト
          </CardTitle>
          <CardDescription>
            AIがプロジェクトについて理解していることの要約
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <RefreshCw className="h-4 w-4 animate-spin" />
              読み込み中...
            </div>
          ) : projectContexts.length > 0 ? (
            <div className="space-y-3">
              {projectContexts.map(ctx => (
                <div key={ctx.id} className="border rounded-lg">
                  <button
                    onClick={() => toggleProject(ctx.project_id)}
                    className="w-full flex items-center justify-between p-3 hover:bg-muted/50 rounded-lg transition-colors"
                  >
                    <span className="text-sm font-medium">{ctx.project_name}</span>
                    {expandedProjects.has(ctx.project_id) ? (
                      <ChevronUp className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    )}
                  </button>
                  {expandedProjects.has(ctx.project_id) && (
                    <div className="px-3 pb-3 space-y-2">
                      {ctx.purpose && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground">目的</p>
                          <p className="text-sm bg-muted/50 rounded p-2">{ctx.purpose}</p>
                        </div>
                      )}
                      {ctx.current_status && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground">現状</p>
                          <p className="text-sm bg-muted/50 rounded p-2">{ctx.current_status}</p>
                        </div>
                      )}
                      {ctx.key_insights && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground">重要な決定</p>
                          <p className="text-sm bg-muted/50 rounded p-2">{ctx.key_insights}</p>
                        </div>
                      )}
                      <p className="text-xs text-muted-foreground">
                        最終更新: {new Date(ctx.updated_at).toLocaleDateString('ja-JP')}
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              まだプロジェクトのコンテキストはありません。AIチャットでプロジェクトについて話すと自動的に保存されます。
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
