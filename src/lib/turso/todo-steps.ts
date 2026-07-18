import { getPersonalOsInboxClient } from './client'

type Row = Record<string, unknown>

export type TodoStepKind = 'step' | 'review' | 'fix'
export type TodoStepStatus = 'todo' | 'doing' | 'done' | 'skipped'

export type TodoStep = {
  id: string
  todoId: string
  seq: number
  title: string
  kind: TodoStepKind
  status: TodoStepStatus
  doneAt: string
}

// 進捗集計はSQLでのみ算出する（設計契約: %は主観値を保存せずSQL導出）。
export type TodoStepAggregate = {
  todoId: string
  total: number
  done: number
  skipped: number
  pending: number
  // pct は total>0（=計画済み）の時だけ数値。0件は null（＝計画待ち）。
  pct: number | null
}

function asString(value: unknown): string {
  return value === null || value === undefined ? '' : String(value)
}

function asNumber(value: unknown): number {
  if (typeof value === 'bigint') return Number(value)
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function toStep(row: Row): TodoStep {
  const kind = asString(row.kind)
  const status = asString(row.status)
  return {
    id: asString(row.id),
    todoId: asString(row.todo_id),
    seq: asNumber(row.seq),
    title: asString(row.title),
    kind: (kind === 'review' || kind === 'fix' ? kind : 'step') as TodoStepKind,
    status: (['todo', 'doing', 'done', 'skipped'].includes(status) ? status : 'todo') as TodoStepStatus,
    doneAt: asString(row.done_at),
  }
}

// 指定日の todos に紐づく全ステップを seq 昇順で取得（画面側で todo_id ごとにグルーピング）。
export async function getStepsForDate(date: string): Promise<TodoStep[]> {
  const result = await getPersonalOsInboxClient().execute({
    sql: `
      SELECT s.id, s.todo_id, s.seq, s.title, s.kind, s.status, s.done_at
      FROM todo_steps s
      JOIN todos t ON t.id = s.todo_id
      WHERE t.do_date = :date AND t.status != 'dropped'
      ORDER BY s.todo_id, s.seq
    `,
    args: { date },
  })
  return result.rows.map(toStep)
}

// 進捗率はSQL集計のみ。分母は skipped を除外。total=0 は pct=NULL（計画待ち）。
export async function getStepAggregatesForDate(date: string): Promise<Map<string, TodoStepAggregate>> {
  const result = await getPersonalOsInboxClient().execute({
    sql: `
      SELECT
        t.id AS todo_id,
        COUNT(s.id) AS total,
        SUM(CASE WHEN s.status = 'done' THEN 1 ELSE 0 END) AS done,
        SUM(CASE WHEN s.status = 'skipped' THEN 1 ELSE 0 END) AS skipped,
        SUM(CASE WHEN s.status IN ('todo', 'doing') THEN 1 ELSE 0 END) AS pending,
        CAST(ROUND(
          100.0 * SUM(CASE WHEN s.status = 'done' THEN 1 ELSE 0 END)
          / NULLIF(COUNT(s.id) - SUM(CASE WHEN s.status = 'skipped' THEN 1 ELSE 0 END), 0)
        ) AS INTEGER) AS pct
      FROM todos t
      LEFT JOIN todo_steps s ON s.todo_id = t.id
      WHERE t.do_date = :date AND t.status != 'dropped'
      GROUP BY t.id
    `,
    args: { date },
  })
  const map = new Map<string, TodoStepAggregate>()
  for (const row of result.rows) {
    const total = asNumber(row.total)
    map.set(asString(row.todo_id), {
      todoId: asString(row.todo_id),
      total,
      done: asNumber(row.done),
      skipped: asNumber(row.skipped),
      pending: asNumber(row.pending),
      pct: total > 0 && row.pct !== null && row.pct !== undefined ? asNumber(row.pct) : null,
    })
  }
  return map
}
