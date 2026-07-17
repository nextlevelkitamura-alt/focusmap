import { randomUUID } from 'node:crypto'
import { getPersonalOsInboxClient } from './client'

type Row = Record<string, unknown>

export type Repo = {
  slug: string
  name: string
  sortOrder: number
}

export type TodoAssignee = 'self' | 'ai'
export type TodoStatus = 'open' | 'done' | 'dropped'
export type TodoAiStatus = '未検知' | '検知' | '立案中' | '実行中' | '確認待ち' | '完了'

export type Todo = {
  id: string
  title: string
  note: string
  doDate: string
  dueDate: string
  repo: string
  assignee: TodoAssignee
  status: TodoStatus
  aiStatus: TodoAiStatus
  source: string
  goalRef: string
  createdAt: string
  updatedAt: string
  completedAt: string
}

export type NewTodoInput = {
  title: string
  note?: string | null
  doDate: string
  dueDate?: string | null
  repo: string
  assignee: TodoAssignee
  goalRef?: string | null
}

function asString(value: unknown): string {
  return value === null || value === undefined ? '' : String(value)
}

function asNumber(value: unknown): number {
  if (typeof value === 'bigint') return Number(value)
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function toTodo(row: Row): Todo {
  return {
    id: asString(row.id),
    title: asString(row.title),
    note: asString(row.note),
    doDate: asString(row.do_date),
    dueDate: asString(row.due_date),
    repo: asString(row.repo),
    assignee: asString(row.assignee) === 'ai' ? 'ai' : 'self',
    status: (asString(row.status) || 'open') as TodoStatus,
    aiStatus: (asString(row.ai_status) || '未検知') as TodoAiStatus,
    source: asString(row.source),
    goalRef: asString(row.goal_ref),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
    completedAt: asString(row.completed_at),
  }
}

export async function getRepos(): Promise<Repo[]> {
  const result = await getPersonalOsInboxClient().execute({
    sql: `SELECT slug, name, sort_order FROM repos ORDER BY sort_order, slug`,
    args: {},
  })
  return result.rows.map((row) => ({
    slug: asString(row.slug),
    name: asString(row.name),
    sortOrder: asNumber(row.sort_order),
  }))
}

export async function getTodosForDate(date: string): Promise<Todo[]> {
  const result = await getPersonalOsInboxClient().execute({
    sql: `
      SELECT id, title, note, do_date, due_date, repo, assignee, status, ai_status, source, goal_ref, created_at, updated_at, completed_at
      FROM todos
      WHERE do_date = :date AND status != 'dropped'
      ORDER BY created_at
    `,
    args: { date },
  })
  return result.rows.map(toTodo)
}

export async function insertTodo(input: NewTodoInput): Promise<string> {
  const id = randomUUID()
  const now = new Date().toISOString()
  await getPersonalOsInboxClient().execute({
    sql: `
      INSERT INTO todos (id, title, note, do_date, due_date, repo, assignee, status, ai_status, source, goal_ref, created_at, updated_at)
      VALUES (:id, :title, :note, :doDate, :dueDate, :repo, :assignee, 'open', '未検知', 'web', :goalRef, :now, :now)
    `,
    args: {
      id,
      title: input.title,
      note: input.note ?? null,
      doDate: input.doDate,
      dueDate: input.dueDate ?? null,
      repo: input.repo,
      assignee: input.assignee,
      goalRef: input.goalRef ?? null,
      now,
    },
  })
  return id
}

export async function approveTodo(id: string): Promise<boolean> {
  const now = new Date().toISOString()
  const result = await getPersonalOsInboxClient().execute({
    sql: `
      UPDATE todos
      SET status = 'done', ai_status = '完了', completed_at = :now, updated_at = :now
      WHERE id = :id AND ai_status = '確認待ち'
    `,
    args: { id, now },
  })
  return result.rowsAffected > 0
}

export async function toggleSelfTodoStatus(id: string, nextStatus: 'open' | 'done'): Promise<boolean> {
  const now = new Date().toISOString()
  const completedAt = nextStatus === 'done' ? now : null
  const result = await getPersonalOsInboxClient().execute({
    sql: `
      UPDATE todos
      SET status = :nextStatus, completed_at = :completedAt, updated_at = :now
      WHERE id = :id AND assignee = 'self'
    `,
    args: { id, nextStatus, completedAt, now },
  })
  return result.rowsAffected > 0
}
