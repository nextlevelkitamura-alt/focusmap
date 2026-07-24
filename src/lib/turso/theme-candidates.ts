import { randomUUID } from 'node:crypto'
import { getPersonalOsInboxClient } from './client'
import { getThemesForDate, type DailyTheme } from './themes'

type Row = Record<string, unknown>

export type ThemeCandidateStatus = 'proposed' | 'adopted' | 'rejected'

export type ThemeCandidate = {
  id: string
  name: string
  purpose: string
  doneCriteria: string
  goalRef: string
  repoSlug: string
  sourceSessionKey: string
  sourceTurnId: string
  proposedBy: 'ai' | 'human'
  status: ThemeCandidateStatus
  adoptedThemeId: string
  createdAt: string
  updatedAt: string
}

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value)
}

function toCandidate(row: Row): ThemeCandidate {
  return {
    id: text(row.id),
    name: text(row.name),
    purpose: text(row.purpose),
    doneCriteria: text(row.done_criteria),
    goalRef: text(row.goal_ref),
    repoSlug: text(row.repo_slug),
    sourceSessionKey: text(row.source_session_key),
    sourceTurnId: text(row.source_turn_id),
    proposedBy: (text(row.proposed_by) || 'ai') as ThemeCandidate['proposedBy'],
    status: (text(row.status) || 'proposed') as ThemeCandidateStatus,
    adoptedThemeId: text(row.adopted_theme_id),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  }
}

function assertDate(day: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('INVALID_THEME_DAY')
  const parsed = new Date(`${day}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) throw new Error('INVALID_THEME_DAY')
}

export async function getProposedThemeCandidates(limit = 20): Promise<ThemeCandidate[]> {
  const result = await getPersonalOsInboxClient().execute({
    sql: `
      SELECT id, name, purpose, done_criteria, goal_ref, repo_slug,
             source_session_key, source_turn_id, proposed_by, status,
             adopted_theme_id, created_at, updated_at
      FROM theme_candidates
      WHERE status = 'proposed'
      ORDER BY created_at DESC
      LIMIT :limit
    `,
    args: { limit: Math.max(1, Math.min(50, limit)) },
  })
  return result.rows.map(toCandidate)
}

export async function rejectThemeCandidate(id: string): Promise<ThemeCandidate | null> {
  const now = new Date().toISOString()
  const client = getPersonalOsInboxClient()
  const result = await client.execute({
    sql: `UPDATE theme_candidates SET status = 'rejected', updated_at = :now WHERE id = :id AND status = 'proposed'`,
    args: { id, now },
  })
  if (result.rowsAffected === 0) return null
  const readback = await client.execute({
    sql: `SELECT * FROM theme_candidates WHERE id = :id`,
    args: { id },
  })
  return readback.rows[0] ? toCandidate(readback.rows[0]) : null
}

// AI候補を採用する瞬間だけThemeへ昇格する。候補・Theme・当日行・repo所属は同一transaction。
export async function adoptThemeCandidate(input: { id: string; day: string }): Promise<{
  candidate: ThemeCandidate
  theme: DailyTheme
} | null> {
  assertDate(input.day)
  const client = getPersonalOsInboxClient()
  const themeId = randomUUID()
  const now = new Date().toISOString()
  const found = await client.execute({
    sql: `SELECT * FROM theme_candidates WHERE id = :id AND status = 'proposed'`,
    args: { id: input.id },
  })
  if (!found.rows[0]) return null
  const candidate = toCandidate(found.rows[0])
  // write batchはlibSQL側のtransaction。先に別採用された場合は最初のINSERTが0件となり、
  // 後続のtheme_days FKでbatch全体がrollbackするため二重昇格しない。
  await client.batch([
      {
        sql: `
          INSERT INTO themes
            (id, name, purpose, done_criteria, goal_ref, plan_refs, sort_order, status, created_at, updated_at)
          SELECT
            :themeId, name, purpose, done_criteria, goal_ref, NULL,
            (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM themes WHERE status = 'active'),
            'active', :now, :now
          FROM theme_candidates WHERE id = :candidateId AND status = 'proposed'
        `,
        args: { themeId, candidateId: input.id, now },
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
        args: { themeId, day: input.day, now },
      },
      ...(candidate.repoSlug ? [{
        sql: `INSERT INTO theme_repos (theme_id, repo_slug) VALUES (:themeId, :repoSlug)`,
        args: { themeId, repoSlug: candidate.repoSlug },
      }] : []),
      {
        sql: `
          UPDATE theme_candidates
          SET status = 'adopted', adopted_theme_id = :themeId, updated_at = :now
          WHERE id = :id AND status = 'proposed'
        `,
        args: { id: input.id, themeId, now },
      },
  ], 'write')
  const theme = (await getThemesForDate(input.day)).find((item) => item.id === themeId)
  if (!candidate || !theme) throw new Error('THEME_CANDIDATE_ADOPT_READBACK_FAILED')
  return {
    candidate: { ...candidate, status: 'adopted', adoptedThemeId: themeId, updatedAt: now },
    theme,
  }
}
