import { describe, expect, test } from 'vitest'
import {
  defaultAiTaskActivityImportance,
  selectAiTaskActivityMessageIdsToDelete,
  type AiTaskActivityKind,
  type AiTaskActivityMessageForPrune,
} from './ai-task-activity'

function message(
  id: string,
  kind: AiTaskActivityKind,
  minute: number,
  importance = defaultAiTaskActivityImportance(kind),
): AiTaskActivityMessageForPrune {
  return {
    id,
    kind,
    importance,
    created_at: new Date(Date.UTC(2026, 5, 3, 9, minute)).toISOString(),
  }
}

describe('selectAiTaskActivityMessageIdsToDelete', () => {
  test('deletes old normal progress messages first', () => {
    const messages = [
      message('sent', 'sent', 0),
      message('progress-1', 'progress', 1),
      message('progress-2', 'progress', 2),
      message('question', 'question', 3),
      message('progress-3', 'progress', 4),
    ]

    expect(selectAiTaskActivityMessageIdsToDelete(messages, 3)).toEqual(['progress-1', 'progress-2'])
  })

  test('keeps protected activity kinds ahead of normal progress', () => {
    const protectedKinds: AiTaskActivityKind[] = [
      'sent',
      'question',
      'approval',
      'resumed',
      'completed',
      'failed',
      'user_answer',
    ]
    const messages = [
      ...protectedKinds.map((kind, index) => message(kind, kind, index)),
      ...Array.from({ length: 48 }, (_, index) => message(`progress-${index}`, 'progress', index + 10)),
    ]

    const deleteIds = selectAiTaskActivityMessageIdsToDelete(messages, 50)

    expect(deleteIds).toEqual(['progress-0', 'progress-1', 'progress-2', 'progress-3', 'progress-4'])
    for (const kind of protectedKinds) {
      expect(deleteIds).not.toContain(kind)
    }
  })
})
