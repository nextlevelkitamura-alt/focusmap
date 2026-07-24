import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Theme } from '@/lib/turso/themes';
import { ThemePlanBoard } from './theme-plan-board';
import type { PlanCardData, ThemeGroup } from './types';

function theme(id: string, name: string, repoSlugs: string[], planRefs: string[] = []): Theme {
  return {
    id,
    name,
    purpose: `${name}の目的`,
    doneCriteria: `${name}の完了条件`,
    goalRef: `goal-${id}`,
    planRefs,
    planLinks: planRefs.map((planSlug) => ({
      planSlug,
      themeId: id,
      sortOrder: 0,
      version: 4,
      createdAt: '',
      updatedAt: '',
    })),
    repoSlugs,
    sortOrder: 0,
    status: 'active',
    createdAt: '',
    updatedAt: '',
  };
}

function plan(planSlug: string, owner: Theme): PlanCardData {
  return {
    planSlug,
    planTitle: 'Daily Themeを改善',
    planResolved: true,
    bucket: 'active',
    repoPath: '/Users/example/focusmap/plans/active/plan.md',
    theme: owner,
    stepProgress: { done: 1, total: 2, pct: 50 },
    progress: null,
    tasks: [],
    cardSessions: [],
    finishedTodos: [],
    finishedLogs: [],
    liveCount: 0,
    waitCount: 0,
  };
}

function group(owner: Theme, plans: PlanCardData[] = []): ThemeGroup {
  return {
    key: owner.id,
    theme: owner,
    title: owner.name,
    plans,
    planCount: plans.length,
    stepDone: plans.length,
    stepTotal: plans.length * 2,
    stepPct: plans.length ? 50 : null,
    liveCount: 0,
    waitCount: 0,
    hasActivity: false,
    dayState: 'active',
    carriedFromDay: '2026-07-23',
    dayVersion: 1,
  };
}

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes('/api/board/theme-candidates')) {
      return new Response(JSON.stringify({ success: true, candidates: [] }), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
});

afterEach(() => vi.restoreAllMocks());

describe('ThemePlanBoard', () => {
  test('Planが0件でもTheme自身のrepo所属でカードを残す', () => {
    const focusmap = theme('theme-focusmap', 'FocusmapのTheme', ['focusmap']);
    render(
      <ThemePlanBoard
        groups={[group(focusmap)]}
        selectedDate="2026-07-24"
        aiTargets={[]}
        projectRepoPath="/Users/example/focusmap"
        selectedRepo="Focusmap"
      />,
    );

    expect(screen.getByText('FocusmapのTheme')).toBeInTheDocument();
    expect(screen.getByText('今日は動きなし')).toBeInTheDocument();
  });

  test('テーマ移動メニューはlink versionを渡し、楽観的に移動する', async () => {
    const source = theme('theme-source', '移動元Theme', ['focusmap'], ['plan-a']);
    const target = theme('theme-target', '移動先Theme', ['focusmap']);
    const fetchMock = vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/board/theme-candidates')) {
        return new Response(JSON.stringify({ success: true, candidates: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({
        success: true,
        link: { planSlug: 'plan-a', themeId: target.id, version: 5 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    render(
      <ThemePlanBoard
        groups={[group(source, [plan('plan-a', source)]), group(target)]}
        selectedDate="2026-07-24"
        aiTargets={[]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /テーマ 移動元Theme を展開する/ }));
    fireEvent.change(screen.getByLabelText('Daily Themeを改善を別のテーマへ移動'), {
      target: { value: target.id },
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [, init] = fetchMock.mock.calls.find(([input]) => String(input).includes('/plans')) ?? [];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      planSlug: 'plan-a',
      expected: { themeId: source.id, version: 4 },
    });
  });

  test('その場でThemeを追加し、保存結果を閉じたカードとして表示する', async () => {
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/board/theme-candidates')) {
        return new Response(JSON.stringify({ success: true, candidates: [] }), { status: 200 });
      }
      if (url.endsWith('/api/board/themes')) {
        return new Response(JSON.stringify({
          success: true,
          theme: {
            ...theme('theme-new', '今日思いついたTheme', ['focusmap']),
            day: '2026-07-24', dayState: 'active', daySortOrder: 1,
            carriedFromDay: null, dayVersion: 1, dayUpdatedAt: '',
          },
        }), { status: 201 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    render(<ThemePlanBoard groups={[]} selectedDate="2026-07-24" aiTargets={[]} selectedRepo="Focusmap" />);
    fireEvent.click(screen.getByRole('button', { name: 'Themeを追加' }));
    fireEvent.change(screen.getByLabelText('新しいTheme名'), { target: { value: '今日思いついたTheme' } });
    fireEvent.click(screen.getByRole('button', { name: '追加' }));
    expect(await screen.findByText('今日思いついたTheme')).toBeInTheDocument();
    expect(screen.getByText(/未完了なら明日へ自動で繰り越します/)).toBeInTheDocument();
  });

  test('AI候補は採用ボタンで当日のThemeへ昇格する', async () => {
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/board/theme-candidates')) {
        return new Response(JSON.stringify({ candidates: [{ id: 'candidate-1', name: 'AIが見つけたTheme', purpose: '整理する', repoSlug: 'focusmap' }] }), { status: 200 });
      }
      if (url.includes('/api/board/theme-candidates/candidate-1')) {
        return new Response(JSON.stringify({
          success: true,
          theme: {
            ...theme('theme-ai', 'AIが見つけたTheme', ['focusmap']),
            day: '2026-07-24', dayState: 'active', daySortOrder: 1,
            carriedFromDay: null, dayVersion: 1, dayUpdatedAt: '',
          },
        }), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    render(<ThemePlanBoard groups={[]} selectedDate="2026-07-24" aiTargets={[]} />);
    expect(await screen.findByText('AIが見つけたTheme')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'AIが見つけたThemeを採用' }));
    await waitFor(() => expect(screen.getByText('AI候補を今日のThemeへ採用しました。')).toBeInTheDocument());
  });
});
