import { createHash } from 'crypto'
import { z } from 'zod'

export const MemoSourceTypeSchema = z.enum(['wishlist', 'note'])
export type MemoSourceType = z.infer<typeof MemoSourceTypeSchema>

export const MemoStructureModeSchema = z.enum(['quick', 'deep']).default('quick')
export type MemoStructureMode = z.infer<typeof MemoStructureModeSchema>

export const MemoItemKindSchema = z.enum([
  'summary',
  'theme',
  'task_candidate',
  'idea',
  'question',
  'reference',
  'decision',
])

export const MemoItemStatusSchema = z.enum([
  'inbox',
  'organized',
  'task_candidate',
  'task',
  'scheduled',
  'done',
  'dismissed',
  'archived',
])

export const MemoActionTypeSchema = z.enum(['execution', 'research', 'decision'])

export const MemoStructureItemSchema = z.object({
  client_id: z.string().min(1).max(80),
  parent_client_id: z.string().min(1).max(80).nullable().optional(),
  parent_existing_item_id: z.string().min(1).max(120).nullable().optional(),
  title: z.string().min(1).max(120),
  body: z.string().max(1000).nullable().optional(),
  kind: MemoItemKindSchema.default('task_candidate'),
  action_type: MemoActionTypeSchema.default('execution'),
  status: MemoItemStatusSchema.default('organized'),
  suggested_project_id: z.string().min(1).max(120).nullable().optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),
  source_quote: z.string().max(500).nullable().optional(),
  reason: z.string().max(500).nullable().optional(),
})

export const MemoStructureResultSchema = z.object({
  summary: z.string().max(1000).optional(),
  memory: z.object({
    accepted_rules: z.array(z.string()).default([]),
    rejected_interpretations: z.array(z.string()).default([]),
    next_questions: z.array(z.string()).default([]),
  }).default({ accepted_rules: [], rejected_interpretations: [], next_questions: [] }),
  items: z.array(MemoStructureItemSchema).max(30),
})

export type MemoStructureItem = z.infer<typeof MemoStructureItemSchema>
export type MemoStructureResult = z.infer<typeof MemoStructureResultSchema>

export function normalizeForHash(value: string) {
  return value
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

export function stableHash(value: unknown) {
  return createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(value))
    .digest('hex')
}

export function memoItemContentHash(input: {
  title: string
  body?: string | null
  kind?: string | null
}) {
  return stableHash({
    title: normalizeForHash(input.title),
    body: normalizeForHash(input.body ?? ''),
    kind: input.kind ?? 'task_candidate',
  })
}

export function extractJsonObject(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  const raw = fenced?.[1] ?? text
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end < start) {
    throw new Error('AI response did not contain a JSON object')
  }
  return raw.slice(start, end + 1)
}

export function parseMemoStructureResult(text: string): MemoStructureResult {
  const json = JSON.parse(extractJsonObject(text))
  return MemoStructureResultSchema.parse(json)
}
