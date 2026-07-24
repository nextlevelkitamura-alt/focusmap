import { randomUUID } from 'node:crypto'
import { getPersonalOsInboxClient } from './client'

type Row = Record<string, unknown>

export type ThemeStatus = 'active' | 'archived'
export type ThemeDayState = 'active' | 'completed' | 'skipped'

export type Theme = {
  id: string
  name: string
  purpose: string
  doneCriteria: string
  goalRef: string
  planRefs: string[]
  planLinks?: ThemePlanLink[]
  repoSlugs?: string[]
  sortOrder: number
  status: ThemeStatus
  createdAt: string
  updatedAt: string
}

export type DailyTheme = Theme & {
  day: string
  dayState: ThemeDayState
  daySortOrder: number
  carriedFromDay: string | null
  dayVersion: number
  dayUpdatedAt: string
}

export type ThemePlanLink = {
  planSlug: string
  themeId: string
  sortOrder: number
  version: number
  createdAt: string
  updatedAt: string
}

export type ThemeDay = {
  themeId: string
  day: string
  state: ThemeDayState
  sortOrder: number
  carriedFromDay: string | null
  version: number
  createdAt: string
  updatedAt: string
}

export type MutationResult<T> =
  | { ok: true; value: T }
  | { ok: false; conflict: true; current: T | null }

// テーマ配下タスクの完了割合（SQL集計で導出・主観値を保存しない＝子05の%契約と同型）。
export type ThemeProgress = {
  themeId: string
  total: number
  done: number
  pct: number | null
}

export type NewThemeInput = {
  name: string
  purpose?: string | null
  doneCriteria?: string | null
  goalRef?: string | null
  planRefs?: string[] | null
}

export type NewDailyThemeInput = NewThemeInput & {
  day: string
  repoSlugs?: string[] | null
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

function nullableString(value: unknown): string | null {
  const string = asString(value)
  return string || null
}

function uniqueSlugs(values: string[] | null | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))]
}

function toTheme(
  row: Row,
  planRefsByTheme: Map<string, string[]> = new Map(),
  reposByTheme: Map<string, string[]> = new Map(),
  planLinksByTheme: Map<string, ThemePlanLink[]> = new Map(),
): Theme {
  const id = asString(row.id)
  return {
    id,
    name: asString(row.name),
    purpose: asString(row.purpose),
    doneCriteria: asString(row.done_criteria),
    goalRef: asString(row.goal_ref),
    planRefs: planRefsByTheme.get(id) ?? [],
    planLinks: planLinksByTheme.get(id) ?? [],
    repoSlugs: reposByTheme.get(id) ?? [],
    sortOrder: asNumber(row.sort_order),
    status: (asString(row.status) || 'active') as ThemeStatus,
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
  }
}

function toThemePlanLink(row: Row): ThemePlanLink {
  return {
    planSlug: asString(row.plan_slug),
    themeId: asString(row.theme_id),
    sortOrder: asNumber(row.sort_order),
    version: asNumber(row.version),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
  }
}

function toThemeDay(row: Row): ThemeDay {
  return {
    themeId: asString(row.theme_id),
    day: asString(row.day),
    state: asString(row.state) as ThemeDayState,
    sortOrder: asNumber(row.sort_order),
    carriedFromDay: nullableString(row.carried_from_day),
    version: asNumber(row.version),
    createdAt: asString(row.day_created_at ?? row.created_at),
    updatedAt: asString(row.day_updated_at ?? row.updated_at),
  }
}

function assertDate(day: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('INVALID_THEME_DAY')
  const parsed = new Date(`${day}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) {
    throw new Error('INVALID_THEME_DAY')
  }
}

function previousDay(day: string): string {
  assertDate(day)
  const parsed = new Date(`${day}T00:00:00Z`)
  parsed.setUTCDate(parsed.getUTCDate() - 1)
  return parsed.toISOString().slice(0, 10)
}

async function getThemeRelations(): Promise<{
  planRefsByTheme: Map<string, string[]>
  planLinksByTheme: Map<string, ThemePlanLink[]>
  reposByTheme: Map<string, string[]>
}> {
  const client = getPersonalOsInboxClient()
  const [linkResult, repoResult] = await Promise.all([
    client.execute({
      sql: `
        SELECT plan_slug, theme_id, sort_order, version, created_at, updated_at
        FROM theme_plan_links
        ORDER BY theme_id, sort_order, plan_slug
      `,
      args: {},
    }),
    client.execute({
      sql: `SELECT theme_id, repo_slug FROM theme_repos ORDER BY theme_id, repo_slug`,
      args: {},
    }),
  ])
  const planRefsByTheme = new Map<string, string[]>()
  const planLinksByTheme = new Map<string, ThemePlanLink[]>()
  const reposByTheme = new Map<string, string[]>()
  for (const row of linkResult.rows) {
    const themeId = asString(row.theme_id)
    const values = planRefsByTheme.get(themeId) ?? []
    values.push(asString(row.plan_slug))
    planRefsByTheme.set(themeId, values)
    const links = planLinksByTheme.get(themeId) ?? []
    links.push(toThemePlanLink(row))
    planLinksByTheme.set(themeId, links)
  }
  for (const row of repoResult.rows) {
    const themeId = asString(row.theme_id)
    const values = reposByTheme.get(themeId) ?? []
    values.push(asString(row.repo_slug))
    reposByTheme.set(themeId, values)
  }
  return { planRefsByTheme, planLinksByTheme, reposByTheme }
}

// Theme定義の一覧。日別Dailyでは getThemesForDate を使い、この関数は選択肢・管理画面用に限定する。
export async function getActiveThemes(): Promise<Theme[]> {
  const [result, relations] = await Promise.all([
    getPersonalOsInboxClient().execute({
      sql: `
        SELECT id, name, purpose, done_criteria, goal_ref, sort_order, status, created_at, updated_at
        FROM themes
        WHERE status = 'active'
        ORDER BY sort_order, created_at
      `,
      args: {},
    }),
    getThemeRelations(),
  ])
  return result.rows.map((row) => toTheme(
    row,
    relations.planRefsByTheme,
    relations.reposByTheme,
    relations.planLinksByTheme,
  ))
}

export async function getThemeById(id: string): Promise<Theme | null> {
  const [result, relations] = await Promise.all([
    getPersonalOsInboxClient().execute({
      sql: `
        SELECT id, name, purpose, done_criteria, goal_ref, sort_order, status, created_at, updated_at
        FROM themes WHERE id = :id
      `,
      args: { id },
    }),
    getThemeRelations(),
  ])
  const row = result.rows[0]
  return row ? toTheme(
    row,
    relations.planRefsByTheme,
    relations.reposByTheme,
    relations.planLinksByTheme,
  ) : null
}

// 指定日の採用Theme。過去日の履歴を保つため、Theme本体が後日archiveされても日次行は返す。
export async function getThemesForDate(day: string): Promise<DailyTheme[]> {
  assertDate(day)
  const [result, relations] = await Promise.all([
    getPersonalOsInboxClient().execute({
      sql: `
        SELECT
          t.id, t.name, t.purpose, t.done_criteria, t.goal_ref, t.sort_order, t.status,
          t.created_at, t.updated_at,
          d.day, d.state AS day_state, d.sort_order AS day_sort_order,
          d.carried_from_day, d.version AS day_version, d.updated_at AS day_updated_at
        FROM theme_days d
        JOIN themes t ON t.id = d.theme_id
        WHERE d.day = :day
        ORDER BY d.sort_order, d.created_at, t.created_at
      `,
      args: { day },
    }),
    getThemeRelations(),
  ])
  return result.rows.map((row) => ({
    ...toTheme(
      row,
      relations.planRefsByTheme,
      relations.reposByTheme,
      relations.planLinksByTheme,
    ),
    day: asString(row.day),
    dayState: asString(row.day_state) as ThemeDayState,
    daySortOrder: asNumber(row.day_sort_order),
    carriedFromDay: nullableString(row.carried_from_day),
    dayVersion: asNumber(row.day_version),
    dayUpdatedAt: asString(row.day_updated_at),
  }))
}

export type EnsureThemeDayResult = {
  day: string
  sourceDay: string
  inserted: number
  themes: DailyTheme[]
}

// Daily初回表示前に明示的に呼ぶ冪等処理。GET自体には副作用を持たせない。
// 前日に日次行がなければ移行直後とみなし、現在activeなThemeを一度だけbootstrapする。
export async function ensureThemeDay(day: string, sourceDay = previousDay(day)): Promise<EnsureThemeDayResult> {
  assertDate(day)
  assertDate(sourceDay)
  if (sourceDay >= day) throw new Error('INVALID_THEME_DAY_SOURCE')
  const now = new Date().toISOString()
  const result = await getPersonalOsInboxClient().execute({
    sql: `
      WITH source_themes AS (
        SELECT d.theme_id, d.sort_order, :sourceDay AS carried_from_day
        FROM theme_days d
        JOIN themes t ON t.id = d.theme_id
        WHERE d.day = :sourceDay AND d.state = 'active' AND t.status = 'active'

        UNION ALL

        SELECT t.id, t.sort_order, NULL AS carried_from_day
        FROM themes t
        WHERE t.status = 'active'
          AND NOT EXISTS (SELECT 1 FROM theme_days WHERE day = :sourceDay)
      )
      INSERT OR IGNORE INTO theme_days
        (theme_id, day, state, sort_order, carried_from_day, version, created_at, updated_at)
      SELECT theme_id, :day, 'active', sort_order, carried_from_day, 1, :now, :now
      FROM source_themes
    `,
    args: { day, sourceDay, now },
  })
  return {
    day,
    sourceDay,
    inserted: result.rowsAffected,
    themes: await getThemesForDate(day),
  }
}

export async function getThemeDay(themeId: string, day: string): Promise<ThemeDay | null> {
  assertDate(day)
  const result = await getPersonalOsInboxClient().execute({
    sql: `
      SELECT theme_id, day, state, sort_order, carried_from_day, version, created_at, updated_at
      FROM theme_days WHERE theme_id = :themeId AND day = :day
    `,
    args: { themeId, day },
  })
  return result.rows[0] ? toThemeDay(result.rows[0]) : null
}

// expectedVersion=null は新規採用、数値は既存行の更新。競合時は現在値を返す。
export async function setThemeDayState(input: {
  themeId: string
  day: string
  state: ThemeDayState
  expectedVersion: number | null
  sortOrder?: number
}): Promise<MutationResult<ThemeDay>> {
  assertDate(input.day)
  const now = new Date().toISOString()
  const client = getPersonalOsInboxClient()
  const result = input.expectedVersion === null
    ? await client.execute({
        sql: `
          INSERT OR IGNORE INTO theme_days
            (theme_id, day, state, sort_order, carried_from_day, version, created_at, updated_at)
          VALUES (:themeId, :day, :state, :sortOrder, NULL, 1, :now, :now)
        `,
        args: {
          themeId: input.themeId,
          day: input.day,
          state: input.state,
          sortOrder: input.sortOrder ?? 0,
          now,
        },
      })
    : await client.execute({
        sql: `
          UPDATE theme_days
          SET state = :state,
              sort_order = COALESCE(:sortOrder, sort_order),
              version = version + 1,
              updated_at = :now
          WHERE theme_id = :themeId AND day = :day AND version = :expectedVersion
        `,
        args: {
          themeId: input.themeId,
          day: input.day,
          state: input.state,
          sortOrder: input.sortOrder ?? null,
          expectedVersion: input.expectedVersion,
          now,
        },
      })
  const current = await getThemeDay(input.themeId, input.day)
  if (result.rowsAffected === 0 || !current) return { ok: false, conflict: true, current }
  return { ok: true, value: current }
}

export async function getThemePlanLink(planSlug: string): Promise<ThemePlanLink | null> {
  const result = await getPersonalOsInboxClient().execute({
    sql: `
      SELECT plan_slug, theme_id, sort_order, version, created_at, updated_at
      FROM theme_plan_links WHERE plan_slug = :planSlug
    `,
    args: { planSlug: planSlug.trim() },
  })
  return result.rows[0] ? toThemePlanLink(result.rows[0]) : null
}

// Plan本文・bucketを変更せず、Turso上のTheme所属だけを移す。
export async function movePlanToTheme(input: {
  planSlug: string
  themeId: string
  expected: { themeId: string; version: number } | null
  sortOrder?: number
  repoSlug?: string | null
}): Promise<MutationResult<ThemePlanLink>> {
  const planSlug = input.planSlug.trim()
  if (!planSlug) throw new Error('PLAN_SLUG_REQUIRED')
  const now = new Date().toISOString()
  const client = getPersonalOsInboxClient()
  const result = input.expected === null
    ? await client.execute({
        sql: `
          INSERT OR IGNORE INTO theme_plan_links
            (plan_slug, theme_id, sort_order, version, created_at, updated_at)
          VALUES (:planSlug, :themeId, :sortOrder, 1, :now, :now)
        `,
        args: {
          planSlug,
          themeId: input.themeId,
          sortOrder: input.sortOrder ?? 0,
          now,
        },
      })
    : await client.execute({
        sql: `
          UPDATE theme_plan_links
          SET theme_id = :themeId,
              sort_order = COALESCE(:sortOrder, sort_order),
              version = version + 1,
              updated_at = :now
          WHERE plan_slug = :planSlug
            AND theme_id = :expectedThemeId
            AND version = :expectedVersion
        `,
        args: {
          planSlug,
          themeId: input.themeId,
          sortOrder: input.sortOrder ?? null,
          expectedThemeId: input.expected.themeId,
          expectedVersion: input.expected.version,
          now,
        },
      })
  const current = await getThemePlanLink(planSlug)
  if (result.rowsAffected === 0 || !current) return { ok: false, conflict: true, current }
  if (input.repoSlug?.trim()) {
    await client.execute({
      sql: `INSERT OR IGNORE INTO theme_repos (theme_id, repo_slug) VALUES (:themeId, :repoSlug)`,
      args: { themeId: input.themeId, repoSlug: input.repoSlug.trim() },
    })
  }
  return { ok: true, value: current }
}

export async function unlinkPlanFromTheme(input: {
  planSlug: string
  expected: { themeId: string; version: number }
}): Promise<MutationResult<ThemePlanLink>> {
  const planSlug = input.planSlug.trim()
  const client = getPersonalOsInboxClient()
  const before = await getThemePlanLink(planSlug)
  const result = await client.execute({
    sql: `
      DELETE FROM theme_plan_links
      WHERE plan_slug = :planSlug AND theme_id = :themeId AND version = :version
    `,
    args: { planSlug, themeId: input.expected.themeId, version: input.expected.version },
  })
  if (result.rowsAffected === 0 || !before) {
    return { ok: false, conflict: true, current: await getThemePlanLink(planSlug) }
  }
  return { ok: true, value: before }
}

export async function replaceThemeRepos(themeId: string, repoSlugs: string[]): Promise<string[]> {
  const repos = uniqueSlugs(repoSlugs)
  const client = getPersonalOsInboxClient()
  await client.batch([
    { sql: `DELETE FROM theme_repos WHERE theme_id = :themeId`, args: { themeId } },
    ...repos.map((repoSlug) => ({
      sql: `INSERT INTO theme_repos (theme_id, repo_slug) VALUES (:themeId, :repoSlug)`,
      args: { themeId, repoSlug },
    })),
  ], 'write')
  return repos
}

// 指定日の todos を分母に、テーマごとの完了割合を1クエリで集計（アプリ層でMap化）。
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
  const planRefs = uniqueSlugs(input.planRefs)
  await getPersonalOsInboxClient().batch([
    {
      sql: `
        INSERT INTO themes
          (id, name, purpose, done_criteria, goal_ref, plan_refs, sort_order, status, created_at, updated_at)
        VALUES (
          :id, :name, :purpose, :doneCriteria, :goalRef, NULL,
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
        now,
      },
    },
    ...planRefs.map((planSlug, sortOrder) => ({
      sql: `
        INSERT OR IGNORE INTO theme_plan_links
          (plan_slug, theme_id, sort_order, version, created_at, updated_at)
        VALUES (:planSlug, :themeId, :sortOrder, 1, :now, :now)
      `,
      args: { planSlug, themeId: id, sortOrder, now },
    })),
  ], 'write')
  return id
}

// 人間がDaily上で追加したThemeを、定義・当日表示・repo所属まで同時に確定する。
// Theme本体には日付を持たせず、翌日以降はensureThemeDayの継承規則へ合流する。
export async function insertThemeForDate(input: NewDailyThemeInput): Promise<DailyTheme> {
  assertDate(input.day)
  const name = input.name.trim()
  if (!name) throw new Error('THEME_NAME_REQUIRED')
  const id = randomUUID()
  const now = new Date().toISOString()
  const planRefs = uniqueSlugs(input.planRefs)
  const repoSlugs = uniqueSlugs(input.repoSlugs)
  const client = getPersonalOsInboxClient()
  await client.batch([
      {
        sql: `
          INSERT INTO themes
            (id, name, purpose, done_criteria, goal_ref, plan_refs, sort_order, status, created_at, updated_at)
          VALUES (
            :id, :name, :purpose, :doneCriteria, :goalRef, NULL,
            (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM themes WHERE status = 'active'),
            'active', :now, :now
          )
        `,
        args: {
          id,
          name,
          purpose: input.purpose?.trim() || null,
          doneCriteria: input.doneCriteria?.trim() || null,
          goalRef: input.goalRef?.trim() || null,
          now,
        },
      },
      {
        sql: `
          INSERT INTO theme_days
            (theme_id, day, state, sort_order, carried_from_day, version, created_at, updated_at)
          VALUES (
            :themeId, :day, 'active',
            (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM theme_days WHERE day = :day),
            NULL, 1, :now, :now
          )
        `,
        args: { themeId: id, day: input.day, now },
      },
      ...planRefs.map((planSlug, sortOrder) => ({
        sql: `
          INSERT INTO theme_plan_links
            (plan_slug, theme_id, sort_order, version, created_at, updated_at)
          VALUES (:planSlug, :themeId, :sortOrder, 1, :now, :now)
        `,
        args: { planSlug, themeId: id, sortOrder, now },
      })),
      ...repoSlugs.map((repoSlug) => ({
        sql: `INSERT INTO theme_repos (theme_id, repo_slug) VALUES (:themeId, :repoSlug)`,
        args: { themeId: id, repoSlug },
      })),
  ], 'write')
  const created = (await getThemesForDate(input.day)).find((theme) => theme.id === id)
  if (!created) throw new Error('THEME_CREATE_READBACK_FAILED')
  return created
}

export async function updateTheme(input: UpdateThemeInput): Promise<boolean> {
  const now = new Date().toISOString()
  const result = await getPersonalOsInboxClient().execute({
    sql: `
      UPDATE themes
      SET name = :name, purpose = :purpose, done_criteria = :doneCriteria,
          goal_ref = :goalRef, updated_at = :now
      WHERE id = :id AND status = 'active'
    `,
    args: {
      id: input.id,
      name: input.name,
      purpose: input.purpose ?? null,
      doneCriteria: input.doneCriteria ?? null,
      goalRef: input.goalRef ?? null,
      now,
    },
  })
  if (result.rowsAffected === 0) return false
  if (input.planRefs !== undefined) {
    const refs = uniqueSlugs(input.planRefs)
    await getPersonalOsInboxClient().batch([
      { sql: `DELETE FROM theme_plan_links WHERE theme_id = :themeId`, args: { themeId: input.id } },
      ...refs.map((planSlug, sortOrder) => ({
        sql: `
          INSERT OR IGNORE INTO theme_plan_links
            (plan_slug, theme_id, sort_order, version, created_at, updated_at)
          VALUES (:planSlug, :themeId, :sortOrder, 1, :now, :now)
        `,
        args: { planSlug, themeId: input.id, sortOrder, now },
      })),
    ], 'write')
  }
  return true
}

// アーカイブ（論理削除）。過去の theme_days / todo.theme_id は履歴として温存する。
export async function archiveTheme(id: string): Promise<boolean> {
  const now = new Date().toISOString()
  const result = await getPersonalOsInboxClient().execute({
    sql: `UPDATE themes SET status = 'archived', updated_at = :now WHERE id = :id AND status = 'active'`,
    args: { id, now },
  })
  return result.rowsAffected > 0
}
