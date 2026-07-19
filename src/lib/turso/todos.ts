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
export type TodoRoute = 'plan' | 'routine' | 'single'

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
  route: TodoRoute
  completedBy: string
  // 子09: 大課題テーマ階層と繰越し。theme_id 未設定は「未分類」。
  themeId: string
  carriedFrom: string
  awaitingSince: string
  // 段階4: AIの質問（選択肢＋自由入力）。question が空なら質問なし。
  question: string
  questionChoices: string[]
  questionAllowFree: boolean
  questionGate: boolean
  answer: string
  answeredAt: string
  answerConsumedAt: string
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
  themeId?: string | null
}

function asString(value: unknown): string {
  return value === null || value === undefined ? '' : String(value)
}

function asNumber(value: unknown): number {
  if (typeof value === 'bigint') return Number(value)
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function asBool(value: unknown): boolean {
  if (typeof value === 'bigint') return value !== 0n
  return Number(value) !== 0
}

function parseChoices(value: unknown): string[] {
  const raw = asString(value)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) return parsed.map((v) => String(v)).filter(Boolean).slice(0, 3)
  } catch {
    // 不正JSONは選択肢なし扱い（自由入力へフォールバック）
  }
  return []
}

function toTodo(row: Row): Todo {
  const route = asString(row.route)
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
    route: (route === 'routine' || route === 'single' ? route : 'plan') as TodoRoute,
    completedBy: asString(row.completed_by),
    themeId: asString(row.theme_id),
    carriedFrom: asString(row.carried_from),
    awaitingSince: asString(row.awaiting_since),
    question: asString(row.question),
    questionChoices: parseChoices(row.question_choices),
    questionAllowFree: row.question_allow_free === null || row.question_allow_free === undefined ? true : asBool(row.question_allow_free),
    questionGate: asBool(row.question_gate),
    answer: asString(row.answer),
    answeredAt: asString(row.answered_at),
    answerConsumedAt: asString(row.answer_consumed_at),
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
      SELECT id, title, note, do_date, due_date, repo, assignee, status, ai_status, source, goal_ref,
             route, completed_by, question, question_choices, question_allow_free, question_gate,
             answer, answered_at, answer_consumed_at, created_at, updated_at, completed_at,
             theme_id, carried_from, awaiting_since
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
      INSERT INTO todos (id, title, note, do_date, due_date, repo, assignee, status, ai_status, source, goal_ref, theme_id, created_at, updated_at)
      VALUES (:id, :title, :note, :doDate, :dueDate, :repo, :assignee, 'open', '未検知', 'web', :goalRef, :themeId, :now, :now)
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
      themeId: input.themeId ?? null,
      now,
    },
  })
  return id
}

// 子09 繰越し: 未完了(open)タスクを翌日へ1タップ移動。do_date+1・carried_from は初回のみ記録
// （COALESCE で再繰越しでも最初の元日付を保つ）。繰越しは人間タップのみ・AIが勝手に日付を動かさない。
export async function carryOverTodo(id: string): Promise<boolean> {
  const now = new Date().toISOString()
  const result = await getPersonalOsInboxClient().execute({
    sql: `
      UPDATE todos
      SET carried_from = COALESCE(carried_from, do_date),
          do_date = DATE(do_date, '+1 day'),
          updated_at = :now
      WHERE id = :id AND status = 'open'
    `,
    args: { id, now },
  })
  return result.rowsAffected > 0
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

// 段階2: 見出しの完了は人間のタップのみ。全step doneのAI todo（=レビュー待ち）だけ確定できる。
// pending step があるうちは完了させない（NOT EXISTSで機械保証。AIは見出しを完了できない）。
export async function completeAiTodoHeading(id: string): Promise<boolean> {
  const now = new Date().toISOString()
  const result = await getPersonalOsInboxClient().execute({
    sql: `
      UPDATE todos
      SET status = 'done', ai_status = '完了', completed_by = 'human', completed_at = :now, updated_at = :now
      WHERE id = :id AND assignee = 'ai' AND status = 'open'
        AND NOT EXISTS (
          SELECT 1 FROM todo_steps s WHERE s.todo_id = todos.id AND s.status IN ('todo', 'doing')
        )
    `,
    args: { id, now },
  })
  return result.rowsAffected > 0
}

// 段階2: 5秒取り消し = DBへの正式undo遷移。人間が確定した完了だけを開き直す（定型自動完了は戻さない）。
export async function undoCompleteAiTodoHeading(id: string): Promise<boolean> {
  const now = new Date().toISOString()
  const result = await getPersonalOsInboxClient().execute({
    sql: `
      UPDATE todos
      SET status = 'open', ai_status = '確認待ち', completed_by = NULL, completed_at = NULL, updated_at = :now
      WHERE id = :id AND assignee = 'ai' AND status = 'done' AND completed_by = 'human'
    `,
    args: { id, now },
  })
  return result.rowsAffected > 0
}

// 段階4: スマホからの回答を保存。answer_consumed_at=NULL（未消費）にし、セッション再開時にhookが渡す。
// 人間ゲート承認質問（question_gate=1）はボードから回答できない（セッション誘導のみ）。
export async function answerTodoQuestion(id: string, answer: string): Promise<boolean> {
  const trimmed = answer.trim()
  if (!trimmed) return false
  const now = new Date().toISOString()
  const result = await getPersonalOsInboxClient().execute({
    sql: `
      UPDATE todos
      SET answer = :answer, answered_at = :now, answer_consumed_at = NULL, updated_at = :now
      WHERE id = :id AND question IS NOT NULL AND question != '' AND question_gate = 0
    `,
    args: { id, answer: trimmed, now },
  })
  return result.rowsAffected > 0
}

// 段階3: 手直し(fix)行の付け替えは1タップ。fix行のみ・todo_idとseqだけ動かす（履歴・内容は書き換えない）。
export async function reattachFixStep(stepId: string, targetTodoId: string): Promise<boolean> {
  const result = await getPersonalOsInboxClient().execute({
    sql: `
      UPDATE todo_steps
      SET todo_id = :target,
          seq = (SELECT COALESCE(MAX(seq), 0) + 1 FROM todo_steps WHERE todo_id = :target)
      WHERE id = :stepId AND kind = 'fix'
    `,
    args: { stepId, target: targetTodoId },
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
