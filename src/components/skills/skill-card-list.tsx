'use client'

import { FOCUSMAP_SKILLS } from '@/lib/skills/definitions'
import type { SkillExecution } from '@/types/skill'
import { SkillCard } from './skill-card'

interface SkillCardListProps {
  executions?: Record<string, SkillExecution>
  onRun?: (skillId: string) => void
  onApprove?: (skillId: string) => void
}

export function SkillCardList({ executions = {}, onRun, onApprove }: SkillCardListProps) {
  // 確認待ちスキルを先頭に表示
  const sorted = [...FOCUSMAP_SKILLS].sort((a, b) => {
    const execA = executions[a.id]
    const execB = executions[b.id]
    const aWaiting = execA?.status === 'awaiting_approval' ? 0 : 1
    const bWaiting = execB?.status === 'awaiting_approval' ? 0 : 1
    return aWaiting - bWaiting
  })

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {sorted.map(skill => (
        <SkillCard
          key={skill.id}
          skill={skill}
          execution={executions[skill.id]}
          onRun={onRun}
          onApprove={onApprove}
        />
      ))}
    </div>
  )
}
