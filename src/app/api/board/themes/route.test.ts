import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const {
  mockGetUser,
  mockGetThemesForDate,
  mockInsertThemeForDate,
  mockEnsureThemeDay,
  mockSetThemeDayState,
  mockMovePlanToTheme,
  mockUnlinkPlanFromTheme,
  mockGetProposedThemeCandidates,
  mockAdoptThemeCandidate,
  mockRejectThemeCandidate,
} = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockGetThemesForDate: vi.fn(),
  mockInsertThemeForDate: vi.fn(),
  mockEnsureThemeDay: vi.fn(),
  mockSetThemeDayState: vi.fn(),
  mockMovePlanToTheme: vi.fn(),
  mockUnlinkPlanFromTheme: vi.fn(),
  mockGetProposedThemeCandidates: vi.fn(),
  mockAdoptThemeCandidate: vi.fn(),
  mockRejectThemeCandidate: vi.fn(),
}))

vi.mock('@/utils/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: mockGetUser } })),
}))

vi.mock('@/lib/turso/themes', () => ({
  getThemesForDate: mockGetThemesForDate,
  insertThemeForDate: mockInsertThemeForDate,
  ensureThemeDay: mockEnsureThemeDay,
  setThemeDayState: mockSetThemeDayState,
  movePlanToTheme: mockMovePlanToTheme,
  unlinkPlanFromTheme: mockUnlinkPlanFromTheme,
}))

vi.mock('@/lib/turso/theme-candidates', () => ({
  getProposedThemeCandidates: mockGetProposedThemeCandidates,
  adoptThemeCandidate: mockAdoptThemeCandidate,
  rejectThemeCandidate: mockRejectThemeCandidate,
}))

import { GET as getThemes, POST as createTheme } from './route'
import { POST as ensureThemes } from './ensure/route'
import { PATCH as patchThemeDay } from './[id]/day/route'
import { POST as linkPlan } from './[id]/plans/route'
import { GET as getCandidates } from '../theme-candidates/route'
import { PATCH as decideCandidate } from '../theme-candidates/[id]/route'

const context = { params: Promise.resolve({ id: 'theme-1' }) }

beforeEach(() => {
  vi.clearAllMocks()
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
})

describe('Daily Theme API', () => {
  test('GETは認証必須で、日次ensureを暗黙実行しない', async () => {
    mockGetThemesForDate.mockResolvedValue([{ id: 'theme-1', day: '2026-07-24' }])
    const response = await getThemes(new NextRequest('http://localhost/api/board/themes?date=2026-07-24'))
    expect(response.status).toBe(200)
    expect((await response.json()).themes).toHaveLength(1)
    expect(mockEnsureThemeDay).not.toHaveBeenCalled()
  })

  test('未認証は401', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null })
    const response = await getThemes(new NextRequest('http://localhost/api/board/themes?date=2026-07-24'))
    expect(response.status).toBe(401)
  })

  test('ensureは明示POSTでreadbackを返す', async () => {
    mockEnsureThemeDay.mockResolvedValue({
      day: '2026-07-24',
      sourceDay: '2026-07-23',
      inserted: 1,
      themes: [{ id: 'theme-1' }],
    })
    const response = await ensureThemes(new NextRequest('http://localhost/api/board/themes/ensure', {
      method: 'POST',
      body: JSON.stringify({ date: '2026-07-24' }),
    }))
    const json = await response.json()
    expect(response.status).toBe(200)
    expect(json).toMatchObject({ success: true, inserted: 1, themes: [{ id: 'theme-1' }] })
  })

  test('人が追加したThemeは選択日とrepoをserviceへ渡して即採用する', async () => {
    mockInsertThemeForDate.mockResolvedValue({ id: 'theme-new', day: '2026-07-24', name: '新Theme' })
    const response = await createTheme(new NextRequest('http://localhost/api/board/themes', {
      method: 'POST',
      body: JSON.stringify({ date: '2026-07-24', name: ' 新Theme ', purpose: '目的', repoSlugs: ['focusmap'] }),
    }))
    expect(response.status).toBe(201)
    expect(mockInsertThemeForDate).toHaveBeenCalledWith(expect.objectContaining({
      day: '2026-07-24', name: '新Theme', repoSlugs: ['focusmap'],
    }))
  })

  test('AI候補を取得し、採用時は選択日のDaily Themeへ昇格する', async () => {
    mockGetProposedThemeCandidates.mockResolvedValue([{ id: 'candidate-1', name: '候補' }])
    const listResponse = await getCandidates()
    expect((await listResponse.json()).candidates).toHaveLength(1)

    mockAdoptThemeCandidate.mockResolvedValue({
      candidate: { id: 'candidate-1', status: 'adopted' },
      theme: { id: 'theme-new', day: '2026-07-24' },
    })
    const response = await decideCandidate(new NextRequest('http://localhost/api/board/theme-candidates/candidate-1', {
      method: 'PATCH',
      body: JSON.stringify({ action: 'adopt', date: '2026-07-24' }),
    }), { params: Promise.resolve({ id: 'candidate-1' }) })
    expect(response.status).toBe(200)
    expect(mockAdoptThemeCandidate).toHaveBeenCalledWith({ id: 'candidate-1', day: '2026-07-24' })
  })

  test('日次状態のversion競合は409と現在値を返す', async () => {
    mockSetThemeDayState.mockResolvedValue({
      ok: false,
      conflict: true,
      current: { themeId: 'theme-1', state: 'completed', version: 2 },
    })
    const response = await patchThemeDay(new NextRequest('http://localhost/api/board/themes/theme-1/day', {
      method: 'PATCH',
      body: JSON.stringify({ date: '2026-07-24', state: 'active', expectedVersion: 1 }),
    }), context)
    expect(response.status).toBe(409)
    expect((await response.json()).current).toMatchObject({ state: 'completed', version: 2 })
  })

  test('Plan D&Dは既存linkのexpected theme/versionをserviceへ渡す', async () => {
    mockMovePlanToTheme.mockResolvedValue({
      ok: true,
      value: { planSlug: 'plan-a', themeId: 'theme-1', version: 3 },
    })
    const response = await linkPlan(new NextRequest('http://localhost/api/board/themes/theme-1/plans', {
      method: 'POST',
      body: JSON.stringify({
        planSlug: 'plan-a',
        expected: { themeId: 'theme-2', version: 2 },
        repoSlug: 'focusmap',
      }),
    }), context)
    expect(response.status).toBe(200)
    expect(mockMovePlanToTheme).toHaveBeenCalledWith({
      planSlug: 'plan-a',
      themeId: 'theme-1',
      expected: { themeId: 'theme-2', version: 2 },
      sortOrder: undefined,
      repoSlug: 'focusmap',
    })
  })
})
