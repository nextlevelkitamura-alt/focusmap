'use client'

import { useMemo, useState } from 'react'
import { FOCUSMAP_SKILLS } from '@/lib/skills/definitions'
import type { ModelTier, SkillExecution } from '@/types/skill'
import { SkillCard } from './skill-card'
import { cn } from '@/lib/utils'

type TierFilter = 'all' | ModelTier

interface SkillCardListProps {
  executions?: Record<string, SkillExecution>
  onRun?: (skillId: string) => void
  onApprove?: (skillId: string) => void
}

const FILTERS: Array<{ value: TierFilter; label: string }> = [
  { value: 'all', label: 'すべて' },
  { value: 'simple', label: 'シンプル' },
  { value: 'agent', label: 'エージェント' },
  { value: 'mixed', label: 'ハイブリッド' },
]

export function SkillCardList({ executions = {}, onRun, onApprove }: SkillCardListProps) {
  const [filter, setFilter] = useState<TierFilter>('all')

  const filtered = useMemo(() => {
    if (filter === 'all') return FOCUSMAP_SKILLS
    return FOCUSMAP_SKILLS.filter((skill) => {
      const tier = skill.model_tier ?? 'simple'
      return tier === filter
    })
  }, [filter])

  // 確認待ちスキルを先頭に表示
  const sorted = useMemo(
    () =>
      [...filtered].sort((a, b) => {
        const execA = executions[a.id]
        const execB = executions[b.id]
        const aWaiting = execA?.status === 'awaiting_approval' ? 0 : 1
        const bWaiting = execB?.status === 'awaiting_approval' ? 0 : 1
        return aWaiting - bWaiting
      }),
    [filtered, executions],
  )

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              filter === f.value
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background text-muted-foreground border-border hover:bg-muted/60',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {sorted.map((skill) => (
          <SkillCard
            key={skill.id}
            skill={skill}
            execution={executions[skill.id]}
            onRun={onRun}
            onApprove={onApprove}
          />
        ))}
      </div>

      {sorted.length === 0 && (
        <div className="rounded-md border border-dashed border-border/60 bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
          このカテゴリのスキルはまだありません
        </div>
      )}
    </div>
  )
}
