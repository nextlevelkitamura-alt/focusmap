'use client'

import { useState } from 'react'
import { CheckSquare, Square, ChevronDown, ChevronRight, Trash2 } from 'lucide-react'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'
import { Task } from '@/types/database'

function formatScheduledTime(scheduledAt: string | null): string | null {
  if (!scheduledAt) return null
  return format(new Date(scheduledAt), 'H:mm')
}

interface YarukotoTaskRowProps {
  task: Task
  depth: number
  childTasksByParentId: Map<string, Task[]>
  projectNameMap?: Map<string, string>
  onToggle: (taskId: string) => void
  onDelete?: (taskId: string) => void
  variant: 'desktop' | 'mobile'
}

export function YarukotoTaskRow({
  task,
  depth,
  childTasksByParentId,
  projectNameMap,
  onToggle,
  onDelete,
  variant,
}: YarukotoTaskRowProps) {
  const [isExpanded, setIsExpanded] = useState(true)
  const children = childTasksByParentId.get(task.id) ?? []
  const hasChildren = children.length > 0
  const taskDone = task.status === 'done'
  const projectName = task.project_id ? projectNameMap?.get(task.project_id) : null
  const indentPx = depth * 16

  const doneChildrenCount = children.filter(c => c.status === 'done').length

  const childRows = hasChildren && isExpanded
    ? children.map(child => (
        <YarukotoTaskRow
          key={child.id}
          task={child}
          depth={depth + 1}
          childTasksByParentId={childTasksByParentId}
          projectNameMap={projectNameMap}
          onToggle={onToggle}
          onDelete={onDelete}
          variant={variant}
        />
      ))
    : null

  if (variant === 'desktop') {
    return (
      <>
        <div
          className="group flex items-center rounded-lg border border-border/60 bg-background hover:bg-muted/30 transition-colors"
          style={{ marginLeft: indentPx }}
        >
          {onDelete && (
            <button
              onClick={() => onDelete(task.id)}
              className="opacity-0 group-hover:opacity-100 pl-2 pr-1 py-1 text-muted-foreground hover:text-destructive transition-all shrink-0"
              aria-label="削除"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsExpanded(v => !v)}
            className={cn(
              'pl-1 pr-0.5 py-1 text-muted-foreground/60 hover:text-foreground shrink-0',
              !hasChildren && 'invisible pointer-events-none'
            )}
            aria-label={isExpanded ? 'サブタスクを折りたたむ' : 'サブタスクを展開'}
          >
            {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={() => onToggle(task.id)}
            className="flex items-center gap-3 py-2.5 px-3 flex-1 min-w-0 text-left"
          >
            {taskDone
              ? <CheckSquare className="w-4 h-4 text-primary shrink-0" />
              : <Square className="w-4 h-4 text-muted-foreground/40 shrink-0" />
            }
            {task.scheduled_at && (
              <span className="text-xs text-muted-foreground tabular-nums shrink-0 w-[90px]">
                {formatScheduledTime(task.scheduled_at)}
                {(task.estimated_time ?? 0) > 0 && <span className="text-muted-foreground/50 ml-1">{task.estimated_time}分</span>}
              </span>
            )}
            <span className={cn('text-sm truncate', taskDone && 'line-through text-muted-foreground')}>{task.title}</span>
            {hasChildren && (
              <span className="text-[10px] text-muted-foreground/60 tabular-nums shrink-0">
                {doneChildrenCount}/{children.length}
              </span>
            )}
            {projectName && (
              <span className="ml-2 text-[10px] text-muted-foreground/60 bg-muted rounded px-1.5 py-0.5">
                {projectName}
              </span>
            )}
          </button>
        </div>
        {childRows}
      </>
    )
  }

  return (
    <>
      <div
        className="flex items-stretch rounded-lg border border-border/60 bg-background active:bg-muted/50 transition-colors"
        style={{ marginLeft: indentPx }}
      >
        <button
          type="button"
          onClick={() => setIsExpanded(v => !v)}
          className={cn(
            'pl-2 pr-0.5 py-2 text-muted-foreground/60 shrink-0',
            !hasChildren && 'invisible pointer-events-none'
          )}
          aria-label={isExpanded ? 'サブタスクを折りたたむ' : 'サブタスクを展開'}
        >
          {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
        <button
          onClick={() => onToggle(task.id)}
          className="flex items-center gap-3 py-3 px-3 flex-1 min-w-0 text-left min-h-[44px]"
        >
          {taskDone
            ? <CheckSquare className="w-5 h-5 text-primary shrink-0" />
            : <Square className="w-5 h-5 text-muted-foreground/40 shrink-0" />
          }
          {task.scheduled_at && (
            <span className="text-xs text-muted-foreground tabular-nums shrink-0 w-[90px]">
              {formatScheduledTime(task.scheduled_at)}
            </span>
          )}
          <div className="flex-1 min-w-0 flex items-center gap-2">
            <span className={cn('text-sm', taskDone && 'line-through text-muted-foreground')}>{task.title}</span>
            {hasChildren && (
              <span className="text-[10px] text-muted-foreground/60 tabular-nums shrink-0">
                {doneChildrenCount}/{children.length}
              </span>
            )}
          </div>
        </button>
      </div>
      {childRows}
    </>
  )
}
