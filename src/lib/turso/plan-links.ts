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

// 子05「計画直結ボード」: ボードのカード軸に使う active 計画の一覧。
// plan_docs の代表文書（program/single）だけを軽量に返す（body は読まない・カードに計画本文は出さない）。
export type ActivePlan = {
  slug: string // program_slug（カードのキー・todos.plan_slug のベースと突き合わせる）
  title: string
  bucket: string
}

export async function getActivePlans(): Promise<ActivePlan[]> {
  const result = await getPersonalOsInboxClient().execute({
    sql: `
      SELECT program_slug, title, bucket FROM plan_docs
      WHERE kind IN ('program', 'single') AND bucket = 'active'
      ORDER BY program_slug
    `,
    args: {},
  })
  return result.rows.map((row: Row) => ({
    slug: asString(row.program_slug),
    title: asString(row.title) || asString(row.program_slug),
    bucket: asString(row.bucket),
  }))
}

// 子05: 計画単位の工程進捗（カードの済/総）。該当 plan_slug（完全一致 `slug` と前方一致 `slug#%`）に
// リンクする todos の todo_steps を全期間で集計する。分母は skipped 除外（todo-steps.ts の%契約と同型）。
// すべてSQL導出・保存しない。キーはベースslug。
export type PlanStepProgress = {
  planSlug: string
  total: number // skipped 除外後の総ステップ数
  done: number
  pct: number | null // total>0 の時だけ数値（0件は null＝計画待ち）
}

export async function getPlanStepProgress(): Promise<Map<string, PlanStepProgress>> {
  const result = await getPersonalOsInboxClient().execute({
    sql: `
      SELECT
        CASE WHEN INSTR(t.plan_slug, '#') > 0
          THEN SUBSTR(t.plan_slug, 1, INSTR(t.plan_slug, '#') - 1)
          ELSE t.plan_slug
        END AS base_slug,
        COUNT(s.id) - SUM(CASE WHEN s.status = 'skipped' THEN 1 ELSE 0 END) AS total,
        SUM(CASE WHEN s.status = 'done' THEN 1 ELSE 0 END) AS done
      FROM todos t
      JOIN todo_steps s ON s.todo_id = t.id
      WHERE t.plan_slug IS NOT NULL AND t.plan_slug != '' AND t.status != 'dropped'
      GROUP BY base_slug
    `,
    args: {},
  })
  const map = new Map<string, PlanStepProgress>()
  for (const row of result.rows) {
    const planSlug = asString(row.base_slug)
    if (!planSlug) continue
    const total = asNumber(row.total)
    const done = asNumber(row.done)
    map.set(planSlug, {
      planSlug,
      total,
      done,
      pct: total > 0 ? Math.round((100 * done) / total) : null,
    })
  }
  return map
}

// 子06「工程ごとの📄ビューア」: 工程行の📄から、その工程に対応する計画文書（plan_docs.body）を1本引く。
// 実装/修正工程 → 子計画md（kind='child'・NN一致）、レビュー工程 → 評価md（kind='eval'）。
// 厳密対応が難しい工程は program/single 代表文書へフォールバック（沈黙させない）。読み取り専用（DB→md書き戻し無し・憲法1）。
// plan_docs は plansync が md→DB 一方向で書く表示キャッシュ。ここは SELECT のみ。
export type PlanStepDoc = {
  path: string
  title: string
  body: string
  nn: string
  kind: string
  siblingPaths: string[] // 同一計画内の全docのpath（MarkdownDoc の相対リンク解決に使う）
}

// nn を数値比較用に正規化（'01' と '1' を同一視。非数値はそのまま）。
function normalizeNn(nn: string): string {
  const raw = (nn || '').trim()
  if (raw === '') return ''
  return /^\d+$/.test(raw) ? String(parseInt(raw, 10)) : raw
}

export async function getPlanStepDoc(slug: string, nn: string, kind: string): Promise<PlanStepDoc | null> {
  const base = planSlugBase(slug)
  if (!base) return null
  const result = await getPersonalOsInboxClient().execute({
    sql: `SELECT path, kind, nn, title, body FROM plan_docs WHERE program_slug = :slug`,
    args: { slug: base },
  })
  const docs = result.rows.map((row: Row) => ({
    path: asString(row.path),
    kind: asString(row.kind),
    nn: asString(row.nn),
    title: asString(row.title),
    body: asString(row.body),
  }))
  if (docs.length === 0) return null
  const siblingPaths = docs.map((d) => d.path)
  const wantNn = normalizeNn(nn)
  const nnMatch = (docNn: string) => wantNn !== '' && normalizeNn(docNn) === wantNn
  const root = docs.find((d) => d.kind === 'program' || d.kind === 'single')

  let target: (typeof docs)[number] | undefined
  if (kind === 'review') {
    // レビュー工程 → 評価md（NN一致優先・なければ最初のeval）。
    target = docs.find((d) => d.kind === 'eval' && nnMatch(d.nn)) ?? docs.find((d) => d.kind === 'eval')
  } else {
    // 実装/修正工程 → 子計画md（NN一致）。単発（NN無し）は代表文書。
    target = docs.find((d) => d.kind === 'child' && nnMatch(d.nn))
  }
  target = target ?? root ?? docs[0]
  if (!target) return null
  return {
    path: target.path,
    title: target.title,
    body: target.body,
    nn: target.nn,
    kind: target.kind,
    siblingPaths,
  }
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
