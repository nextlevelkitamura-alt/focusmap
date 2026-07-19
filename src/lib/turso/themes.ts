import { randomUUID } from 'node:crypto'
import { getPersonalOsInboxClient } from './client'

type Row = Record<string, unknown>

export type ThemeStatus = 'active' | 'archived'

export type Theme = {
  id: string
  name: string
  purpose: string
  doneCriteria: string
  goalRef: string
  planRefs: string[]
  sortOrder: number
  status: ThemeStatus
  createdAt: string
  updatedAt: string
}

// テーマ配下タスクの完了割合（SQL集計で導出・主観値を保存しない＝子05の%契約と同型）。
export type ThemeProgress = {
  themeId: string
  total: number
  done: number
  pct: number | null // total>0 の時だけ数値（0件は null）
}

export type NewThemeInput = {
  name: string
  purpose?: string | null
  doneCriteria?: string | null
  goalRef?: string | null
  planRefs?: string[] | null
}

export type UpdateThemeInput = {
  id: string
  name: string
  purpose?: string | null
  doneCriteria?: string | null
  goalRef?: string | null
  planRefs?: string[] | null
}

function asString(value: unknown): string {
  return value === null || value === undefined ? '' : String(value)
}

function asNumber(value: unknown): number {
  if (typeof value === 'bigint') return Number(value)
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function parsePlanRefs(value: unknown): string[] {
  const raw = asString(value)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) return parsed.map((v) => String(v)).filter(Boolean)
  } catch {
    // 不正JSONは参照なし扱い
  }
  return []
}

function toTheme(row: Row): Theme {
  return {
    id: asString(row.id),
    name: asString(row.name),
    purpose: asString(row.purpose),
    doneCriteria: asString(row.done_criteria),
    goalRef: asString(row.goal_ref),
    planRefs: parsePlanRefs(row.plan_refs),
    sortOrder: asNumber(row.sort_order),
    status: (asString(row.status) || 'active') as ThemeStatus,
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
  }
}

// アクティブなテーマ一覧（sort_order→作成順）。ボードのテーマ帯・起票フォームの選択肢に使う。
export async function getActiveThemes(): Promise<Theme[]> {
  const result = await getPersonalOsInboxClient().execute({
    sql: `
      SELECT id, name, purpose, done_criteria, goal_ref, plan_refs, sort_order, status, created_at, updated_at
      FROM themes
      WHERE status = 'active'
      ORDER BY sort_order, created_at
    `,
    args: {},
  })
  return result.rows.map(toTheme)
}

// 指定日の todos を分母に、テーマごとの完了割合を1クエリで集計（アプリ層でMap化）。
// 分母はその日そのテーマの todos（dropped除外）。%は保存せずここで導出する。
export async function getThemeProgressForDate(date: string): Promise<Map<string, ThemeProgress>> {
  const result = await getPersonalOsInboxClient().execute({
    sql: `
      SELECT
        theme_id,
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done,
        CAST(ROUND(
          100.0 * SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0)
        ) AS INTEGER) AS pct
      FROM todos
      WHERE do_date = :date AND status != 'dropped' AND theme_id IS NOT NULL
      GROUP BY theme_id
    `,
    args: { date },
  })
  const map = new Map<string, ThemeProgress>()
  for (const row of result.rows) {
    const themeId = asString(row.theme_id)
    const total = asNumber(row.total)
    map.set(themeId, {
      themeId,
      total,
      done: asNumber(row.done),
      pct: total > 0 && row.pct !== null && row.pct !== undefined ? asNumber(row.pct) : null,
    })
  }
  return map
}

export async function insertTheme(input: NewThemeInput): Promise<string> {
  const id = randomUUID()
  const now = new Date().toISOString()
  const planRefs = input.planRefs && input.planRefs.length > 0 ? JSON.stringify(input.planRefs) : null
  // sort_order は既存 active テーマの最後尾へ（MAX+1）。
  await getPersonalOsInboxClient().execute({
    sql: `
      INSERT INTO themes (id, name, purpose, done_criteria, goal_ref, plan_refs, sort_order, status, created_at, updated_at)
      VALUES (
        :id, :name, :purpose, :doneCriteria, :goalRef, :planRefs,
        (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM themes WHERE status = 'active'),
        'active', :now, :now
      )
    `,
    args: {
      id,
      name: input.name,
      purpose: input.purpose ?? null,
      doneCriteria: input.doneCriteria ?? null,
      goalRef: input.goalRef ?? null,
      planRefs,
      now,
    },
  })
  return id
}

export async function updateTheme(input: UpdateThemeInput): Promise<boolean> {
  const now = new Date().toISOString()
  // planRefs未指定（undefined）の編集では既存のplan_refsを保持する（鉛筆編集で計画チップが消えないように）
  const planRefsProvided = input.planRefs !== undefined
  const planRefs = planRefsProvided && input.planRefs!.length > 0 ? JSON.stringify(input.planRefs) : null
  const result = await getPersonalOsInboxClient().execute({
    sql: `
      UPDATE themes
      SET name = :name, purpose = :purpose, done_criteria = :doneCriteria,
          goal_ref = :goalRef,
          plan_refs = CASE WHEN :planRefsProvided = 1 THEN :planRefs ELSE plan_refs END,
          updated_at = :now
      WHERE id = :id AND status = 'active'
    `,
    args: {
      id: input.id,
      name: input.name,
      purpose: input.purpose ?? null,
      doneCriteria: input.doneCriteria ?? null,
      goalRef: input.goalRef ?? null,
      planRefs,
      planRefsProvided: planRefsProvided ? 1 : 0,
      now,
    },
  })
  return result.rowsAffected > 0
}

// アーカイブ（論理削除）。配下 todos の theme_id は温存し「未分類」に落ちる（DBで消さない）。
export async function archiveTheme(id: string): Promise<boolean> {
  const now = new Date().toISOString()
  const result = await getPersonalOsInboxClient().execute({
    sql: `UPDATE themes SET status = 'archived', updated_at = :now WHERE id = :id AND status = 'active'`,
    args: { id, now },
  })
  return result.rowsAffected > 0
}
