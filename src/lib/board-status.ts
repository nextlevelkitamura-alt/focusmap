import type { Todo } from '@/lib/turso/todos'
import type { TodoStepAggregate } from '@/lib/turso/todo-steps'

// 見出しの状態ラベルは「常時1個」。%やレビュー待ちは保存せずステップ集計から導出する（設計契約）。
// 複数エージェントが同じ todo で動いていても「実行中」1個に集約される（集計は todo 単位のため自然に1個）。
export type BoardStatusTone = 'plan' | 'run' | 'question' | 'review'

export type BoardStatus = {
  label: '計画待ち' | '実行中' | '確認待ち' | 'レビュー待ち'
  tone: BoardStatusTone
}

export function deriveBoardStatus(todo: Todo, agg: TodoStepAggregate | undefined): BoardStatus {
  const total = agg?.total ?? 0
  const pending = agg?.pending ?? 0

  // 質問が出ていて未回答なら最優先で「確認待ち」（質問）。
  const hasOpenQuestion = Boolean(todo.question) && !todo.answer
  if (hasOpenQuestion) return { label: '確認待ち', tone: 'question' }

  // 全step done（total>0 かつ pending 0）はSQL導出の「レビュー待ち」。
  if (total > 0 && pending === 0) return { label: 'レビュー待ち', tone: 'review' }

  // ステップが1つでもあれば実行中（一部未完了）。
  if (total > 0) return { label: '実行中', tone: 'run' }

  // 0件は計画待ち。
  return { label: '計画待ち', tone: 'plan' }
}

export function boardStatusClassName(tone: BoardStatusTone): string {
  switch (tone) {
    case 'question':
      return 'border-transparent bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300'
    case 'review':
      return 'border-transparent bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
    case 'run':
      return 'border-transparent bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
    default:
      return 'border-transparent bg-muted text-muted-foreground'
  }
}
