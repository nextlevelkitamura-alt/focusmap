import { getPersonalOsInboxClient } from './client'
import type { TodoStep } from './todo-steps'

// 子02「計画接続」: todos.plan_slug（slug#NN 形式・単発は slug）と plan_docs（計画ミラー）の橋渡し読み取り。
// - やること行の計画チップ（解決可否でリンク/グレー非リンクを切替）
// - 計画詳細「ライブ進行」タブ（plan_slug で todo_steps を引く）
// - 解決lint（plan_slug が plan_docs に解決しない todo の検知）
// ここは読み取り専用（DB→md の書き戻し経路は持たない・憲法1）。plan_slug 列は
// migration 20260721_todos_plan_slug 適用後にのみ値を持つ。

type Row = Record<string, unknown>

function asString(value: unknown): string {
  return value === null || value === undefined ? '' : String(value)
}

function asNumber(value: unknown): number {
  if (typeof value === 'bigint') return Number(value)
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

// plan_slug のベース slug（`slug#NN` → `slug`）。plan_docs.program_slug と突き合わせる単位。
export function planSlugBase(planSlug: string): string {
  const raw = (planSlug || '').trim()
  const hash = raw.indexOf('#')
  return hash >= 0 ? raw.slice(0, hash) : raw
}

// 指定日の todos の {todoId -> plan_slug}（plan_slug 非NULLのみ）。計画チップの元データ。
export async function getPlanSlugsForDate(date: string): Promise<Map<string, string>> {
  const result = await getPersonalOsInboxClient().execute({
    sql: `SELECT id, plan_slug FROM todos WHERE do_date = :date AND plan_slug IS NOT NULL AND plan_slug != ''`,
    args: { date },
  })
  const map = new Map<string, string>()
  for (const row of result.rows) {
    const id = asString(row.id)
    const slug = asString(row.plan_slug)
    if (id && slug) map.set(id, slug)
  }
  return map
}

// plan_docs に存在する計画（program/single 代表文書）の program_slug 集合＝「解決できる計画」。
// 計画チップのリンク可否と解決lintの判定に使う。
export async function getResolvablePlanSlugs(): Promise<Set<string>> {
  const result = await getPersonalOsInboxClient().execute({
    sql: `SELECT DISTINCT program_slug FROM plan_docs WHERE kind IN ('program', 'single')`,
    args: {},
  })
  const set = new Set<string>()
  for (const row of result.rows) {
    const slug = asString(row.program_slug)
    if (slug) set.add(slug)
  }
  return set
}

export type UnresolvedPlanLink = {
  todoId: string
  title: string
  planSlug: string
}

// 解決lint: 指定日の todos のうち plan_slug のベースが plan_docs に解決しないものを返す（沈黙故障の検知）。
// UIはこれをグレー非リンクのチップ＋警告バナーで可視化する（黙って空にしない）。
export async function getUnresolvedPlanLinksForDate(date: string): Promise<UnresolvedPlanLink[]> {
  const [links, resolvable] = await Promise.all([
    getPlanSlugsForDate(date),
    getResolvablePlanSlugs(),
  ])
  const out: UnresolvedPlanLink[] = []
  if (links.size === 0) return out
  const result = await getPersonalOsInboxClient().execute({
    sql: `SELECT id, title FROM todos WHERE do_date = :date AND plan_slug IS NOT NULL AND plan_slug != ''`,
    args: { date },
  })
  const titleById = new Map<string, string>()
  for (const row of result.rows) titleById.set(asString(row.id), asString(row.title))
  for (const [todoId, planSlug] of links) {
    if (!resolvable.has(planSlugBase(planSlug))) {
      out.push({ todoId, title: titleById.get(todoId) ?? '', planSlug })
    }
  }
  return out
}

export type PlanLiveStep = TodoStep & {
  todoTitle: string
  todoDoDate: string
  todoStatus: string
}

// 計画詳細「ライブ進行」タブ: この計画slug（program子/単発）にリンクする todos の全ステップを時系列で返す。
// plan_slug は `slug` または `slug#NN` を許容（program子は #NN 付き）。elapsed_min は todo-steps.ts と同じ
// SQL導出（started_at→直前done_at→created_at を開始点に done=所要／doing=経過）。全工程（未来含む）が並ぶ。
export async function getPlanLiveStepsBySlug(slug: string): Promise<PlanLiveStep[]> {
  const result = await getPersonalOsInboxClient().execute({
    sql: `
      WITH linked AS (
        SELECT id, title, do_date, status FROM todos
        WHERE plan_slug = :slug OR plan_slug LIKE :prefix
      ), steps AS (
        SELECT s.id, s.todo_id, s.seq, s.title, s.kind, s.status, s.done_at,
               l.title AS todo_title, l.do_date AS todo_do_date, l.status AS todo_status,
               COALESCE(
                 s.started_at,
                 LAG(s.done_at) OVER (PARTITION BY s.todo_id ORDER BY s.seq),
                 s.created_at
               ) AS start_at
        FROM todo_steps s
        JOIN linked l ON l.id = s.todo_id
      )
      SELECT id, todo_id, seq, title, kind, status, done_at,
        todo_title, todo_do_date, todo_status,
        CASE
          WHEN status = 'done' AND done_at IS NOT NULL AND start_at IS NOT NULL
            THEN CAST(ROUND(MAX(0, (JULIANDAY(done_at) - JULIANDAY(start_at)) * 1440)) AS INTEGER)
          WHEN status = 'doing' AND start_at IS NOT NULL
            THEN CAST(ROUND(MAX(0, (JULIANDAY(DATETIME('now', '+9 hours')) - JULIANDAY(start_at)) * 1440)) AS INTEGER)
          ELSE NULL
        END AS elapsed_min
      FROM steps
      ORDER BY todo_do_date, todo_id, seq
    `,
    args: { slug, prefix: `${slug}#%` },
  })
  return result.rows.map((row: Row) => {
    const kind = asString(row.kind)
    const status = asString(row.status)
    return {
      id: asString(row.id),
      todoId: asString(row.todo_id),
      seq: asNumber(row.seq),
      title: asString(row.title),
      kind: (kind === 'review' || kind === 'fix' ? kind : 'step') as TodoStep['kind'],
      status: (['todo', 'doing', 'done', 'skipped'].includes(status) ? status : 'todo') as TodoStep['status'],
      doneAt: asString(row.done_at),
      elapsedMin: row.elapsed_min === null || row.elapsed_min === undefined ? null : asNumber(row.elapsed_min),
      todoTitle: asString(row.todo_title),
      todoDoDate: asString(row.todo_do_date),
      todoStatus: asString(row.todo_status),
    }
  })
}
