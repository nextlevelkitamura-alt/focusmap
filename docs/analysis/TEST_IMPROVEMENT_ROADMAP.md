# 🧪 テスト改善ロードマップ

**目標**: テストカバレッジ 6.9% → 60%（業界標準水準）

---

## Phase 1: Hooks テスト完成（1-2週間）

### 現状

| Hook | 行数 | テスト | 進捗 |
|------|------|--------|------|
| useMindMapSync | 931 | ✅ 790行 | 完了 |
| useTaskCalendarSync | 235 | ✅ 477行 | 完了 |
| useCalendarEvents | 200+ | ✅ 374行 | 完了 |
| useMindMapSync.test | - | ✅ 790行 | 完了 |
| useMultiTaskCalendarSync | 297 | ❌ | 未実施 |
| useHabits | 235 | ❌ | 未実施 |
| useOutlineNavigation | 228 | ❌ | 未実施 |
| useCalendars | 150+ | ❌ | 未実施 |
| useEventCompletions | 150+ | ❌ | 未実施 |
| useNotificationScheduler | 150+ | ❌ | 未実施 |
| その他 Hook (12個) | 1500+ | ❌ | 未実施 |

**Phase 1 目標**: 残り 5 Hook のテスト追加 (推定 500-600行)

### アクション

```bash
# Phase 1 追加テスト対象
1. useMultiTaskCalendarSync.test.ts (推定 150行)
   - 複数タスク同期のテスト

2. useHabits.test.ts (推定 100行)
   - 習慣データ取得・更新

3. useOutlineNavigation.test.ts (推定 80行)
   - アウトライン操作

4. useCalendars.test.ts (推定 100行)
   - カレンダー選択・管理

5. useEventCompletions.test.ts (推定 80行)
   - イベント完了フラグ

目標: テストカバレッジ 6.9% → 12-15%
```

---

## Phase 2: コンポーネント統合テスト（2-4週間）

### テスト対象（優先度順）

#### Tier 1: 最重要コンポーネント

| コンポーネント | 行数 | 複雑度 | テスト戦略 |
|--------------|------|--------|-----------|
| `mind-map.tsx` | 2,328 | 高 | Snapshot + 単体テスト分割後 |
| `center-pane.tsx` | 1,230 | 高 | 統合テスト (マインドマップ+タスク) |
| `dashboard-client.tsx` | 688 | 中 | 統合テスト |
| `today-view.tsx` | 777 | 中 | 統合テスト |

#### Tier 2: 重要コンポーネント

| コンポーネント | 行数 | テスト |
|--------------|------|--------|
| `calendar-week-view.tsx` | 275 | ユニット |
| `calendar-day-view.tsx` | 182 | ユニット |
| `calendar-selector.tsx` | 258 | ユニット |
| `task-calendar-select.tsx` | 135 | ユニット |

**Tier 1 目標**: 推定 400-500行のテストコード

```javascript
// 例: calendar-week-view.test.tsx
describe('CalendarWeekView', () => {
  it('renders week events correctly', () => {
    // テスト
  });

  it('allows drag-drop time change', () => {
    // D&Dテスト
  });

  it('highlights current day', () => {
    // UIテスト
  });
});
```

**目標**: テストカバレッジ 12-15% → 25-30%

---

## Phase 3: APIエンドポイントテスト（1-2週間）

### テスト対象

| エンドポイント | ファイル | 行数 | テスト | 状態 |
|--------------|---------|------|--------|------|
| POST /api/calendar/sync-task | sync-task/route.ts | 150+ | ❌ | 未実施 |
| PATCH /api/calendar/sync-task | (同上) | - | ❌ | 未実施 |
| DELETE /api/calendar/sync-task | (同上) | - | ❌ | 未実施 |
| GET /api/calendar/events/list | events/list/route.ts | 100+ | ❌ | 未実施 |
| GET /api/calendars | calendars/route.ts | 80+ | ❌ | 未実施 |
| PATCH /api/calendars/[id] | calendars/[id]/route.ts | 80+ | ❌ | 未実施 |
| POST /api/notifications/* | notifications/* | 400+ | ❌ | 部分的 |
| POST /api/habits* | habits/* | 150+ | ❌ | 未実施 |
| GET /api/calendar/find-free-time | find-free-time/route.ts | 100+ | ❌ | 未実施 |

**目標**: 推定 300-400行のテストコード追加

**目標**: テストカバレッジ 25-30% → 40-45%

---

## Phase 4: E2Eテスト導入 (Playwright)（1-2週間）

### テストシナリオ（優先度順）

```gherkin
# 1. ユーザー認証フロー
Scenario: User logs in with Google
  Given User is on login page
  When User clicks "Sign in with Google"
  Then User should be redirected to dashboard

# 2. タスク作成フロー
Scenario: Create and schedule a task
  Given User is on dashboard
  When User creates a new task "Study Math"
  And User schedules it for tomorrow 14:00
  Then Task should appear in timeline
  And Google Calendar event should be created

# 3. Google Calendar 同期フロー
Scenario: Task syncs with Google Calendar
  Given User has a scheduled task
  When Google Calendar event is updated externally
  Then Task details update automatically

# 4. カレンダー表示切り替え
Scenario: Switch calendar views
  Given User is viewing month calendar
  When User clicks "Week" tab
  Then Calendar switches to week view
  And Events are displayed correctly

# 5. マインドマップ操作
Scenario: Drag task in mindmap
  Given User is on dashboard
  When User drags task to different group
  Then Task parent changes
  And Task order updates
```

**推定テストコード**: 200-300行 (Playwright spec)

**目標**: テストカバレッジ 40-45% → 60%（業界標準達成）

---

## テスト実装パターン

### Hook テスト（参考: useMindMapSync.test.ts）

```typescript
import { renderHook, act } from '@testing-library/react';
import { useMindMapSync } from '@/hooks/useMindMapSync';

describe('useMindMapSync', () => {
  it('fetches tasks on mount', async () => {
    const { result } = renderHook(() => useMindMapSync());

    await act(async () => {
      // Supabase読み込み待機
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    expect(result.current.tasks).toBeDefined();
  });

  it('creates a new task', async () => {
    const { result } = renderHook(() => useMindMapSync());

    await act(async () => {
      await result.current.createTask({
        title: 'New Task',
        projectId: '123',
      });
    });

    expect(result.current.tasks).toHaveLength(1);
  });
});
```

### コンポーネントテスト（参考: calendar-day-view.test.tsx）

```typescript
import { render, screen } from '@testing-library/react';
import { CalendarDayView } from '@/components/calendar/calendar-day-view';

describe('CalendarDayView', () => {
  it('renders day with correct events', () => {
    const mockEvents = [
      { id: '1', title: 'Meeting', startTime: '10:00', endTime: '11:00' },
    ];

    render(<CalendarDayView date={new Date()} events={mockEvents} />);

    expect(screen.getByText('Meeting')).toBeInTheDocument();
  });
});
```

### E2E テスト（参考: Playwright）

```typescript
import { test, expect } from '@playwright/test';

test('Create and schedule a task', async ({ page }) => {
  await page.goto('http://localhost:3001/dashboard');

  // ログイン
  await page.click('button:has-text("Sign in")');
  // ...ログイン処理

  // タスク作成
  await page.click('button:has-text("New Task")');
  await page.fill('input[placeholder="Task title"]', 'Study Math');

  // スケジュール設定
  await page.click('button:has-text("Schedule")');
  await page.fill('input[type="date"]', '2026-02-20');

  // 保存
  await page.click('button:has-text("Save")');

  // 確認
  expect(await page.textContent('text="Study Math"')).toBeTruthy();
});
```

---

## テスト設定と実行

### Vitest 設定 (vitest.config.ts)

```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

### 実行コマンド

```bash
# ユニットテスト実行
npm run test

# カバレッジレポート生成
npm run test -- --coverage

# E2Eテスト実行（Phase 4）
npx playwright test

# CI/CDパイプライン（GitHub Actions）
- lint
- type-check
- test (unit)
- test:coverage
- build
- test:e2e (optional)
```

---

## リソース・工数見積もり

| Phase | 期間 | Hook | Component | API | E2E | 合計 |
|-------|------|------|-----------|-----|-----|------|
| 1 | 1-2w | 600行 | - | - | - | 600行 |
| 2 | 2-4w | - | 800行 | - | - | 800行 |
| 3 | 1-2w | - | - | 500行 | - | 500行 |
| 4 | 1-2w | - | - | - | 300行 | 300行 |
| **合計** | **5-10w** | **600** | **800** | **500** | **300** | **2,200行** |

**結果**: テストコード 3,141行 + 既存 1,941行 = 5,082行（業界標準基準）

**カバレッジ向上**:
- 6.9% → 12% (Phase 1)
- 12% → 30% (Phase 2)
- 30% → 45% (Phase 3)
- 45% → 60% (Phase 4) ✅ 達成

---

## チェックリスト

### Phase 1: Hooks テスト
- [ ] useMultiTaskCalendarSync.test.ts
- [ ] useHabits.test.ts
- [ ] useOutlineNavigation.test.ts
- [ ] useCalendars.test.ts
- [ ] useEventCompletions.test.ts
- [ ] `npm run test:run` で全テスト 合格
- [ ] カバレッジ 12% 達成確認

### Phase 2: Component テスト
- [ ] calendar-week-view.test.tsx
- [ ] calendar-day-view.test.tsx
- [ ] calendar-selector.test.tsx
- [ ] task-calendar-select.test.tsx
- [ ] center-pane.test.tsx (integration)
- [ ] カバレッジ 30% 達成確認

### Phase 3: API テスト
- [ ] sync-task route test
- [ ] calendar events test
- [ ] notification routes test
- [ ] habits routes test
- [ ] カバレッジ 45% 達成確認

### Phase 4: E2E テスト
- [ ] Playwright セットアップ
- [ ] 認証フロー テスト
- [ ] タスク作成・スケジュール テスト
- [ ] Calendar 同期 テスト
- [ ] カレンダー表示切り替え テスト
- [ ] マインドマップ操作 テスト
- [ ] カバレッジ 60% 達成確認 ✅

---

参考資料:
- [project-scope-analysis.md](PROJECT_SCOPE_ANALYSIS.md)
- [ROADMAP.md](../ROADMAP.md) - Phase 1 品質基盤整備
- Vitest: https://vitest.dev/
- Playwright: https://playwright.dev/
