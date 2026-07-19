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
  // 子09: 縦線ワークフロー右の時間表示（SQL導出のみ・主観値を保存しない）。
  // done=所要（実測分）／doing=経過分。todo/skipped は null。
  elapsedMin: number | null
}

// 子09: タスク見出し右の累計2値（実行N分・確認待ちN分）。すべてSQL導出。
export type TodoTimes = {
  todoId: string
  runMin: number
  waitMin: number
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
    elapsedMin: row.elapsed_min === null || row.elapsed_min === undefined ? null : asNumber(row.elapsed_min),
  }
}

// 各ステップの開始時刻: started_at（doing遷移時刻）> 直前stepのdone_at > 自身のcreated_at の順。
// board.py が書く時刻はすべてローカルJSTなので、現在時刻も DATETIME('now','+9 hours') で合わせる。
// started_at は未populate（子05の遷移ロジックは変更禁止）でも直前done_at/created_atで導出できる。
const STEP_START_AT = `COALESCE(
  s.started_at,
  LAG(s.done_at) OVER (PARTITION BY s.todo_id ORDER BY s.seq),
  s.created_at
)`
const JST_NOW = `DATETIME('now', '+9 hours')`

// 指定日の todos に紐づく全ステップを seq 昇順で取得（画面側で todo_id ごとにグルーピング）。
// done=所要（done_at-開始）／doing=経過（now-開始）を SQL 導出して elapsed_min に載せる。
export async function getStepsForDate(date: string): Promise<TodoStep[]> {
  const result = await getPersonalOsInboxClient().execute({
    sql: `
      WITH steps AS (
        SELECT s.id, s.todo_id, s.seq, s.title, s.kind, s.status, s.done_at,
               ${STEP_START_AT} AS start_at
        FROM todo_steps s
        JOIN todos t ON t.id = s.todo_id
        WHERE t.do_date = :date AND t.status != 'dropped'
      )
      SELECT id, todo_id, seq, title, kind, status, done_at,
        CASE
          WHEN status = 'done' AND done_at IS NOT NULL AND start_at IS NOT NULL
            THEN CAST(ROUND(MAX(0, (JULIANDAY(done_at) - JULIANDAY(start_at)) * 1440)) AS INTEGER)
          WHEN status = 'doing' AND start_at IS NOT NULL
            THEN CAST(ROUND(MAX(0, (JULIANDAY(${JST_NOW}) - JULIANDAY(start_at)) * 1440)) AS INTEGER)
          ELSE NULL
        END AS elapsed_min
      FROM steps
      ORDER BY todo_id, seq
    `,
    args: { date },
  })
  return result.rows.map(toStep)
}

// 子09: タスク別の累計時間。実行=各stepの所要(done)+経過(doing)の合算。
// 確認待ち=確認待ち開始からの経過（awaiting_since > question_asked_at のアンカーで導出）。
// すべて SQL 導出（主観値は保存しない=子05の%契約と同型）。
export async function getTodoTimesForDate(date: string): Promise<Map<string, TodoTimes>> {
  const result = await getPersonalOsInboxClient().execute({
    sql: `
      WITH steps AS (
        SELECT s.todo_id, s.status, s.done_at,
               ${STEP_START_AT} AS start_at
        FROM todo_steps s
        JOIN todos t ON t.id = s.todo_id
        WHERE t.do_date = :date AND t.status != 'dropped'
      ), run AS (
        SELECT todo_id, SUM(
          CASE
            WHEN status = 'done' AND done_at IS NOT NULL AND start_at IS NOT NULL
              THEN MAX(0, (JULIANDAY(done_at) - JULIANDAY(start_at)) * 1440)
            WHEN status = 'doing' AND start_at IS NOT NULL
              THEN MAX(0, (JULIANDAY(${JST_NOW}) - JULIANDAY(start_at)) * 1440)
            ELSE 0
          END
        ) AS run_min
        FROM steps
        GROUP BY todo_id
      )
      SELECT
        t.id AS todo_id,
        CAST(ROUND(COALESCE(run.run_min, 0)) AS INTEGER) AS run_min,
        CASE
          WHEN COALESCE(t.awaiting_since, t.question_asked_at) IS NOT NULL
            THEN CAST(ROUND(MAX(0,
              (JULIANDAY(${JST_NOW}) - JULIANDAY(COALESCE(t.awaiting_since, t.question_asked_at))) * 1440
            )) AS INTEGER)
          ELSE 0
        END AS wait_min
      FROM todos t
      LEFT JOIN run ON run.todo_id = t.id
      WHERE t.do_date = :date AND t.status != 'dropped'
    `,
    args: { date },
  })
  const map = new Map<string, TodoTimes>()
  for (const row of result.rows) {
    const todoId = asString(row.todo_id)
    map.set(todoId, { todoId, runMin: asNumber(row.run_min), waitMin: asNumber(row.wait_min) })
  }
  return map
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
