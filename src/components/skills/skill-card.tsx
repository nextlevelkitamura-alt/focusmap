'use client'

import { Play, Loader2, CheckCircle2, AlertCircle, Clock, Sparkles, Brain, Layers } from 'lucide-react'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { FocusmapSkill, ModelTier, SkillExecution, StepStatus } from '@/types/skill'
import { cn } from '@/lib/utils'
import { formatCurrency } from '@/lib/format'

interface SkillCardProps {
  skill: FocusmapSkill
  execution?: SkillExecution
  onRun?: (skillId: string) => void
  onApprove?: (skillId: string) => void
}

function StepIndicator({ status }: { status: StepStatus }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="size-4 text-green-500 shrink-0" />
    case 'running':
      return <Loader2 className="size-4 text-blue-500 shrink-0 animate-spin" />
    case 'failed':
      return <AlertCircle className="size-4 text-red-500 shrink-0" />
    default:
      return <Clock className="size-4 text-muted-foreground shrink-0" />
  }
}

function formatLastRun(dateStr: string | null): string {
  if (!dateStr) return '未実行'
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'たった今'
  if (diffMin < 60) return `${diffMin}分前`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour}時間前`
  const diffDay = Math.floor(diffHour / 24)
  if (diffDay === 1) return '昨日'
  return `${diffDay}日前`
}

function approvalLabel(type: FocusmapSkill['approval_type']): string {
  switch (type) {
    case 'auto': return '自動完了'
    case 'confirm': return '確認待ち'
    case 'interactive': return '対話必須'
  }
}

function approvalVariant(type: FocusmapSkill['approval_type']): 'default' | 'secondary' | 'outline' {
  switch (type) {
    case 'auto': return 'secondary'
    case 'confirm': return 'default'
    case 'interactive': return 'outline'
  }
}

function tierMeta(tier: ModelTier | undefined): { label: string; Icon: typeof Sparkles; className: string } {
  switch (tier) {
    case 'agent':
      return {
        label: 'エージェント',
        Icon: Brain,
        className: 'bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-900',
      }
    case 'mixed':
      return {
        label: 'ハイブリッド',
        Icon: Layers,
        className: 'bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900',
      }
    default:
      return {
        label: 'シンプル',
        Icon: Sparkles,
        className: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900',
      }
  }
}

export function SkillCard({ skill, execution, onRun, onApprove }: SkillCardProps) {
  const isRunning = execution?.status === 'running'
  const isAwaitingApproval = execution?.status === 'awaiting_approval'
  const isFailed = execution?.status === 'failed'

  return (
    <Card className={cn(
      'gap-3 py-4 transition-all duration-200 hover:border-primary/30 hover:shadow-sm',
      isAwaitingApproval && 'border-amber-400 bg-amber-50/50 dark:bg-amber-950/20',
      isFailed && 'border-red-400 bg-red-50/50 dark:bg-red-950/20',
    )}>
      <CardHeader className="gap-1 px-4 pb-0">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <span className="text-xl">{skill.icon}</span>
            {skill.name}
          </CardTitle>
          <div className="flex items-center gap-1.5">
            {(() => {
              const tier = tierMeta(skill.model_tier)
              const Icon = tier.Icon
              return (
                <Badge variant="outline" className={cn('text-[10px] gap-0.5', tier.className)}>
                  <Icon className="h-2.5 w-2.5" />
                  {tier.label}
                </Badge>
              )
            })()}
            <Badge variant={approvalVariant(skill.approval_type)} className="text-[10px]">
              {approvalLabel(skill.approval_type)}
            </Badge>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">{skill.description}</p>
      </CardHeader>

      <CardContent className="px-4 py-0">
        <div className="space-y-1.5">
          {skill.steps.map((step, i) => {
            const stepStatus: StepStatus = execution
              ? execution.stepStatuses[i] ?? 'pending'
              : 'pending'
            const isCurrent = execution?.status === 'running' && i === execution.currentStep

            return (
              <div
                key={i}
                className={cn(
                  'flex items-center gap-2 text-sm rounded-md px-2 py-1',
                  isCurrent && 'bg-blue-50 dark:bg-blue-950/30 font-medium',
                )}
              >
                <StepIndicator status={stepStatus} />
                <span className={cn(
                  stepStatus === 'completed' && 'text-muted-foreground line-through',
                  stepStatus === 'failed' && 'text-red-600 dark:text-red-400',
                )}>
                  {step.label}
                </span>
                {isCurrent && (
                  <span className="text-xs text-blue-600 dark:text-blue-400 ml-auto whitespace-nowrap">
                    実行中
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </CardContent>

      <CardFooter className="px-4 pt-0 flex items-center justify-between">
        {isAwaitingApproval ? (
          <Button
            size="sm"
            className="min-h-[44px]"
            onClick={() => onApprove?.(skill.id)}
          >
            確認する
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="min-h-[44px]"
            disabled={isRunning}
            onClick={() => onRun?.(skill.id)}
          >
            {isRunning ? (
              <><Loader2 className="size-4 animate-spin" /> 実行中...</>
            ) : (
              <><Play className="size-4" /> 実行</>
            )}
          </Button>
        )}
        <div className="flex flex-col items-end text-right gap-0.5">
          <span className="text-xs text-muted-foreground">
            {execution?.lastRunAt
              ? `最終: ${formatLastRun(execution.lastRunAt)}`
              : '未実行'}
          </span>
          {skill.estimated_cost_usd !== undefined && skill.estimated_cost_usd > 0 && (
            <span className="text-[10px] text-muted-foreground/70">
              1回あたり {formatCurrency(skill.estimated_cost_usd, 'USD', true)}
            </span>
          )}
        </div>
      </CardFooter>
    </Card>
  )
}
