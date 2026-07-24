import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient, type Client } from '@libsql/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const { mockGetClient } = vi.hoisted(() => ({ mockGetClient: vi.fn() }))

vi.mock('./client', () => ({
  getPersonalOsInboxClient: mockGetClient,
}))

import {
  ensureThemeDay,
  getThemePlanLink,
  getThemesForDate,
  insertThemeForDate,
  movePlanToTheme,
  setThemeDayState,
} from './themes'

let db: Client

const baseMigration = readFileSync(
  resolve(process.cwd(), 'db/turso/migrations/20260719000000_themes_and_carryover.sql'),
  'utf8',
)
const normalizedMigration = readFileSync(
  resolve(process.cwd(), 'db/turso/migrations/20260724000000_theme_days_plan_links.sql'),
  'utf8',
)

beforeEach(async () => {
  db = createClient({ url: 'file::memory:' })
  mockGetClient.mockReturnValue(db)
  await db.executeMultiple(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE repos (
      slug TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO repos (slug, name, sort_order) VALUES
      ('focusmap', 'Focusmap', 1),
      ('private', 'Private', 2);
    CREATE TABLE todos (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      do_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open'
    );
    CREATE TABLE todo_steps (
      id TEXT PRIMARY KEY,
      todo_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
    );
    ${baseMigration}
  `)
  await db.batch([
    {
      sql: `
        INSERT INTO themes
          (id, name, purpose, done_criteria, plan_refs, sort_order, status, created_at, updated_at)
        VALUES ('theme-1', 'Theme 1', '目的1', '完了1', '["plan-a","shared"]', 1, 'active', :now, :now)
      `,
      args: { now: '2026-07-23T00:00:00.000Z' },
    },
    {
      sql: `
        INSERT INTO themes
          (id, name, purpose, done_criteria, plan_refs, sort_order, status, created_at, updated_at)
        VALUES ('theme-2', 'Theme 2', '目的2', '完了2', '["shared","plan-b"]', 2, 'active', :now, :now)
      `,
      args: { now: '2026-07-23T00:00:01.000Z' },
    },
  ], 'write')
  await db.executeMultiple(normalizedMigration)
})

afterEach(() => {
  db.close()
  vi.clearAllMocks()
})

describe('Theme日次継承と正規化', () => {
  test('plan_refsを一Theme所属のtheme_plan_linksへ決定的にbackfillする', async () => {
    expect(await getThemePlanLink('plan-a')).toMatchObject({ themeId: 'theme-1', version: 1 })
    expect(await getThemePlanLink('shared')).toMatchObject({ themeId: 'theme-1', version: 1 })
    expect(await getThemePlanLink('plan-b')).toMatchObject({ themeId: 'theme-2', version: 1 })
  })

  test('初日はactive Themeをbootstrapし、翌日は未完了Themeだけを冪等継承する', async () => {
    const first = await ensureThemeDay('2026-07-23')
    expect(first.inserted).toBe(2)
    expect(first.themes.map((theme) => theme.id)).toEqual(['theme-1', 'theme-2'])

    const duplicate = await ensureThemeDay('2026-07-23')
    expect(duplicate.inserted).toBe(0)

    const completed = await setThemeDayState({
      themeId: 'theme-2',
      day: '2026-07-23',
      state: 'completed',
      expectedVersion: 1,
    })
    expect(completed.ok).toBe(true)

    const next = await ensureThemeDay('2026-07-24')
    expect(next.inserted).toBe(1)
    expect(next.themes).toHaveLength(1)
    expect(next.themes[0]).toMatchObject({
      id: 'theme-1',
      carriedFromDay: '2026-07-23',
      dayState: 'active',
    })
  })

  test('指定日取得はTheme本体を複製せず正規化Planとrepoをreadbackする', async () => {
    await db.execute({
      sql: `INSERT INTO theme_repos (theme_id, repo_slug) VALUES ('theme-1', 'focusmap')`,
      args: {},
    })
    await ensureThemeDay('2026-07-23')

    const themes = await getThemesForDate('2026-07-23')
    expect(themes[0]).toMatchObject({
      id: 'theme-1',
      planRefs: ['plan-a', 'shared'],
      planLinks: [
        { planSlug: 'plan-a', themeId: 'theme-1', version: 1 },
        { planSlug: 'shared', themeId: 'theme-1', version: 1 },
      ],
      repoSlugs: ['focusmap'],
      dayVersion: 1,
    })
  })

  test('Plan移動はexpected theme/version一致時だけ成功し、競合時は現在値を返す', async () => {
    const moved = await movePlanToTheme({
      planSlug: 'plan-b',
      themeId: 'theme-1',
      expected: { themeId: 'theme-2', version: 1 },
      repoSlug: 'focusmap',
    })
    expect(moved).toMatchObject({ ok: true, value: { themeId: 'theme-1', version: 2 } })

    const stale = await movePlanToTheme({
      planSlug: 'plan-b',
      themeId: 'theme-2',
      expected: { themeId: 'theme-2', version: 1 },
    })
    expect(stale).toMatchObject({
      ok: false,
      conflict: true,
      current: { themeId: 'theme-1', version: 2 },
    })
  })

  test('日次状態もversion不一致なら上書きせず現在値を返す', async () => {
    await ensureThemeDay('2026-07-23')
    const updated = await setThemeDayState({
      themeId: 'theme-1',
      day: '2026-07-23',
      state: 'completed',
      expectedVersion: 1,
    })
    expect(updated).toMatchObject({ ok: true, value: { state: 'completed', version: 2 } })

    const stale = await setThemeDayState({
      themeId: 'theme-1',
      day: '2026-07-23',
      state: 'active',
      expectedVersion: 1,
    })
    expect(stale).toMatchObject({
      ok: false,
      conflict: true,
      current: { state: 'completed', version: 2 },
    })
  })

  test('Dailyからの追加はTheme定義・当日行・repo所属を同時に作る', async () => {
    const created = await insertThemeForDate({
      day: '2026-07-24',
      name: '今日思いついたTheme',
      purpose: '今日から整理する',
      repoSlugs: ['focusmap'],
    })
    expect(created).toMatchObject({
      name: '今日思いついたTheme',
      day: '2026-07-24',
      dayState: 'active',
      carriedFromDay: null,
      repoSlugs: ['focusmap'],
    })
  })
})
