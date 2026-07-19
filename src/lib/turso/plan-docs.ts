import { getPersonalOsInboxClient } from './client'

// 子07: 計画スマホ表示。plan_docs / plan_progress は子06(plansync)が md→DB 一方向で
// 書き込む表示キャッシュ。ここは読み取り関数のみを持つ。書込みSQLは絶対に持たない。

type Row = Record<string, unknown>

export type PlanDocKind = 'program' | 'single' | 'child' | 'role' | 'eval'

export type PlanDoc = {
  path: string
  programSlug: string
  kind: PlanDocKind
  nn: string
  title: string
  bucket: string
  body: string
  contentHash: string
  gitCommit: string
  syncedAt: string
}

export type PlanProgress = {
  programSlug: string
  childDone: number
  childTotal: number
  condDone: number
  condTotal: number
  parseOk: boolean
  updatedAt: string
}

function asString(value: unknown): string {
  return value === null || value === undefined ? '' : String(value)
}

function asNumber(value: unknown): number {
  if (typeof value === 'bigint') return Number(value)
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function asBool(value: unknown): boolean {
  if (typeof value === 'bigint') return value !== 0n
  return Number(value) !== 0
}

function toKind(value: unknown): PlanDocKind {
  const raw = asString(value)
  if (raw === 'program' || raw === 'single' || raw === 'child' || raw === 'role' || raw === 'eval') return raw
  return 'single'
}

function toDoc(row: Row): PlanDoc {
  return {
    path: asString(row.path),
    programSlug: asString(row.program_slug),
    kind: toKind(row.kind),
    nn: asString(row.nn),
    title: asString(row.title),
    bucket: asString(row.bucket),
    body: asString(row.body),
    contentHash: asString(row.content_hash),
    gitCommit: asString(row.git_commit),
    syncedAt: asString(row.synced_at),
  }
}

function toProgress(row: Row): PlanProgress {
  return {
    programSlug: asString(row.program_slug),
    childDone: asNumber(row.child_done),
    childTotal: asNumber(row.child_total),
    condDone: asNumber(row.cond_done),
    condTotal: asNumber(row.cond_total),
    parseOk: asBool(row.parse_ok),
    updatedAt: asString(row.updated_at),
  }
}

// 一覧画面用: program/single（=計画の代表文書）だけを軽量に取得（body含む。メタ行/次の一手の解析に必要）。
export async function getActivePlanRootDocs(): Promise<PlanDoc[]> {
  const result = await getPersonalOsInboxClient().execute({
    sql: `
      SELECT path, program_slug, kind, nn, title, bucket, body, content_hash, git_commit, synced_at
      FROM plan_docs
      WHERE kind IN ('program', 'single')
      ORDER BY program_slug
    `,
    args: {},
  })
  return result.rows.map(toDoc)
}

// 一覧画面用: 全計画の進捗集計（子N/M・完了条件x/y・parse_ok）。
export async function getAllPlanProgress(): Promise<Map<string, PlanProgress>> {
  const result = await getPersonalOsInboxClient().execute({
    sql: `SELECT program_slug, child_done, child_total, cond_done, cond_total, parse_ok, updated_at FROM plan_progress`,
    args: {},
  })
  const map = new Map<string, PlanProgress>()
  for (const row of result.rows) {
    const progress = toProgress(row)
    map.set(progress.programSlug, progress)
  }
  return map
}

// program詳細・文書表示の両方が使う: 1計画（program_slug）配下の全文書（program/single・role・child・eval）。
export async function getPlanDocsBySlug(slug: string): Promise<PlanDoc[]> {
  const result = await getPersonalOsInboxClient().execute({
    sql: `
      SELECT path, program_slug, kind, nn, title, bucket, body, content_hash, git_commit, synced_at
      FROM plan_docs
      WHERE program_slug = :slug
      ORDER BY
        CASE kind WHEN 'program' THEN 0 WHEN 'single' THEN 0 WHEN 'role' THEN 1 WHEN 'child' THEN 2 WHEN 'eval' THEN 3 ELSE 9 END,
        nn, path
    `,
    args: { slug },
  })
  return result.rows.map(toDoc)
}

export async function getPlanProgressBySlug(slug: string): Promise<PlanProgress | null> {
  const result = await getPersonalOsInboxClient().execute({
    sql: `SELECT program_slug, child_done, child_total, cond_done, cond_total, parse_ok, updated_at FROM plan_progress WHERE program_slug = :slug`,
    args: { slug },
  })
  const row = result.rows[0]
  return row ? toProgress(row) : null
}
