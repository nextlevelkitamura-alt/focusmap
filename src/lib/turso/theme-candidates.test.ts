import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient, type Client } from '@libsql/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const { mockGetClient } = vi.hoisted(() => ({ mockGetClient: vi.fn() }))
vi.mock('./client', () => ({ getPersonalOsInboxClient: mockGetClient }))

import { adoptThemeCandidate, getProposedThemeCandidates, rejectThemeCandidate } from './theme-candidates'

let db: Client

beforeEach(async () => {
  db = createClient({ url: 'file::memory:' })
  mockGetClient.mockReturnValue(db)
  const base = readFileSync(resolve(process.cwd(), 'db/turso/migrations/20260719000000_themes_and_carryover.sql'), 'utf8')
  const normalized = readFileSync(resolve(process.cwd(), 'db/turso/migrations/20260724000000_theme_days_plan_links.sql'), 'utf8')
  const completionCriteria = readFileSync(resolve(process.cwd(), 'db/turso/migrations/20260724120000_theme_completion_criteria.sql'), 'utf8')
  const candidates = readFileSync(resolve(process.cwd(), 'db/turso/migrations/20260724010000_theme_candidates.sql'), 'utf8')
  await db.executeMultiple(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE repos (slug TEXT PRIMARY KEY, name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0);
    INSERT INTO repos (slug, name) VALUES ('focusmap', 'Focusmap');
    CREATE TABLE todos (id TEXT PRIMARY KEY, title TEXT NOT NULL, do_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open');
    CREATE TABLE todo_steps (id TEXT PRIMARY KEY, todo_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending');
    ${base}
    ${normalized}
    ${completionCriteria}
    ${candidates}
    INSERT INTO theme_candidates
      (id, name, purpose, done_criteria, repo_slug, source_session_key, source_turn_id)
    VALUES ('candidate-1', 'AI協業を整える', '迷わず判断できるようにする', 'Dailyで見える', 'focusmap', 's:one', 'turn-1');
  `)
})

afterEach(() => {
  db.close()
  vi.clearAllMocks()
})

describe('Theme候補の採用導線', () => {
  test('proposedだけを返し、見送りはThemeを作らない', async () => {
    expect(await getProposedThemeCandidates()).toHaveLength(1)
    expect(await rejectThemeCandidate('candidate-1')).toMatchObject({ status: 'rejected' })
    expect(await getProposedThemeCandidates()).toHaveLength(0)
    const themes = await db.execute('SELECT COUNT(*) AS count FROM themes')
    expect(Number(themes.rows[0].count)).toBe(0)
  })

  test('採用は候補・Theme・当日行・repo所属を一度に確定する', async () => {
    const adopted = await adoptThemeCandidate({ id: 'candidate-1', day: '2026-07-24' })
    expect(adopted).toMatchObject({
      candidate: { status: 'adopted' },
      theme: { name: 'AI協業を整える', day: '2026-07-24', repoSlugs: ['focusmap'] },
    })
    expect(await adoptThemeCandidate({ id: 'candidate-1', day: '2026-07-24' })).toBeNull()
  })
})
