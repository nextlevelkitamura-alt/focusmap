---
status: active
category: refactor
priority: high
created: 2026-02-17
updated: 2026-02-17
related: []
---

# コード品質改善計画

## 概要

shikumika-app は1ヶ月で24,433行に達した高速成長プロジェクト。機能開発を継続するため、品質基盤を整備する必要がある。

**現在の問題点**:
- ❌ テストコード0行（24,433行に対して）
- ❌ CI/CDが部分的（テスト自動化なし）
- ❌ 巨大コンポーネント（mind-map.tsx: 2,328行）
- ❌ エラーハンドリング不統一（701箇所）

**目標**: 2〜3年後のエンタープライズ級成長に備えた品質基盤の構築

---

## 要件

### 機能要件
- [ ] E2Eテストで主要5フロー（ログイン、タスク作成、カレンダー同期、タイマー、設定）をカバー
- [ ] Unitテストで主要3 Hooks（useMindMapSync、useTaskCalendarSync、useCalendarEvents）をカバー
- [ ] テストカバレッジ60%以上
- [ ] CI/CDでテスト・Lint・ビルドの自動実行
- [ ] 500行超のファイルを適切に分割
- [ ] エラーハンドリングを全APIルートで統一

### 非機能要件
- [ ] 既存機能の動作を保証（後退なし）
- [ ] ビルド成功を保証
- [ ] 型安全性を保証（tsc --noEmit エラーなし）

---

## 実装対象ファイル

### Phase 1: テスト基盤整備
- [ ] **作成するファイル**:
  - `playwright.config.ts` - Playwright設定
  - `vitest.config.ts` - Vitest設定
  - `tests/e2e/login.spec.ts` - ログインE2E
  - `tests/e2e/task-creation.spec.ts` - タスク作成E2E
  - `tests/e2e/calendar-sync.spec.ts` - カレンダー同期E2E
  - `tests/e2e/timer.spec.ts` - タイマーE2E
  - `tests/e2e/settings.spec.ts` - 設定E2E
  - `tests/unit/useMindMapSync.test.ts` - MindMap Hook Unit
  - `tests/unit/useTaskCalendarSync.test.ts` - Calendar Sync Hook Unit
  - `tests/unit/useCalendarEvents.test.ts` - Calendar Events Hook Unit
  - `tests/setup/test-utils.tsx` - テストユーティリティ
- [ ] **変更するファイル**:
  - `package.json` - テストスクリプト追加
  - `tsconfig.json` - テスト用パス設定

### Phase 2: CI/CD強化
- [ ] **作成するファイル**:
  - `.github/workflows/ci.yml` - CI/CDパイプライン
  - `.github/workflows/pr-check.yml` - PRチェック
- [ ] **変更するファイル**:
  - `.github/workflows/deploy-cloudrun.yml` - テスト追加
  - `README.md` - テストコマンド説明追加

### Phase 3: エラーハンドリング統一
- [ ] **作成するファイル**:
  - `src/lib/error-handler.ts` - 共通エラーハンドラー
  - `src/lib/logger.ts` - ロガー（オプション）
  - `src/types/errors.ts` - エラー型定義
  - `docs/architecture/error-handling.md` - エラーハンドリング設計書
- [ ] **変更するファイル**:
  - `src/app/api/**/*.ts` - 全APIルート（28ファイル）
  - `src/hooks/*.ts` - 全Hooks（16ファイル）

### Phase 4: 巨大コンポーネント分割
- [ ] **作成するファイル**:
  - `src/components/dashboard/mind-map/index.tsx` - メインコンテナ
  - `src/components/dashboard/mind-map/nodes/ProjectNode.tsx` - プロジェクトノード
  - `src/components/dashboard/mind-map/nodes/TaskNode.tsx` - タスクノード
  - `src/components/dashboard/mind-map/layout/dagreLayout.ts` - レイアウト計算
  - `src/components/dashboard/mind-map/layout/nodeHeight.ts` - 高さ計算
  - `src/components/dashboard/mind-map/hooks/useNodeDrag.ts` - ドラッグ処理
  - `src/components/dashboard/mind-map/hooks/useNodeSelection.ts` - 選択処理
  - `src/components/dashboard/mind-map/components/NodePriorityBadge.tsx` - 優先度バッジ
  - `src/components/dashboard/mind-map/components/NodeEstimatedTime.tsx` - 見積もり時間
  - `src/components/dashboard/mind-map/components/NodeCalendarSelect.tsx` - カレンダー選択
- [ ] **削除するファイル**:
  - `src/components/dashboard/mind-map.tsx` (2,328行)

---

## 実装フェーズ

### Phase 1: テスト基盤整備（3〜5日）

#### Day 1: Playwright セットアップ + E2E基本テスト
- [ ] Playwright インストール (`npm install -D @playwright/test`)
- [ ] `playwright.config.ts` 作成
- [ ] `tests/e2e/login.spec.ts` 作成（ログインフロー）
- [ ] `tests/e2e/task-creation.spec.ts` 作成（タスク作成フロー）
- [ ] ローカル実行確認 (`npx playwright test`)

#### Day 2-3: E2E残り3テスト + data-testid追加
- [ ] `tests/e2e/calendar-sync.spec.ts` 作成
- [ ] `tests/e2e/timer.spec.ts` 作成
- [ ] `tests/e2e/settings.spec.ts` 作成
- [ ] 必要なコンポーネントに `data-testid` 属性追加
  - `src/components/dashboard/center-pane.tsx`
  - `src/components/dashboard/left-sidebar.tsx`
  - `src/components/calendar/calendar-view.tsx`
- [ ] 全E2Eテスト実行確認

#### Day 4-5: Vitest セットアップ + Unit テスト
- [ ] Vitest インストール (`npm install -D vitest @testing-library/react @testing-library/react-hooks`)
- [ ] `vitest.config.ts` 作成
- [ ] `tests/setup/test-utils.tsx` 作成（SupabaseモックなどSetup）
- [ ] `tests/unit/useMindMapSync.test.ts` 作成
  - `createTask` テスト
  - `updateTask` テスト
  - `deleteTask` テスト
  - Optimistic Update のテスト
- [ ] `tests/unit/useTaskCalendarSync.test.ts` 作成
  - カレンダー同期発火条件テスト
  - API呼び出しのモックテスト
- [ ] `tests/unit/useCalendarEvents.test.ts` 作成
  - イベント取得テスト
  - キャッシュロジックテスト
- [ ] `package.json` にスクリプト追加
  ```json
  {
    "scripts": {
      "test": "npm run test:unit && npm run test:e2e",
      "test:unit": "vitest run",
      "test:unit:watch": "vitest",
      "test:e2e": "playwright test",
      "test:e2e:ui": "playwright test --ui"
    }
  }
  ```
- [ ] 全テスト実行確認 (`npm test`)

**完了条件**:
- ✅ E2Eテスト5個が正常に実行できる
- ✅ Unitテスト（最低10個）が正常に実行できる
- ✅ カバレッジレポート生成できる
- ✅ `npm test` が成功する

---

### Phase 2: CI/CD強化（1〜2日）

#### Day 1: CI パイプライン作成
- [ ] `.github/workflows/ci.yml` 作成
  ```yaml
  jobs:
    - lint (ESLint + TypeScript型チェック)
    - unit-test (Vitest)
    - e2e-test (Playwright)
    - build (npm run build)
  ```
- [ ] `.github/workflows/pr-check.yml` 作成（PRチェック用）
- [ ] GitHub Secrets 設定確認
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`

#### Day 2: デプロイワークフロー統合
- [ ] `.github/workflows/deploy-cloudrun.yml` を更新
  - テスト成功後のみデプロイするように変更
  - `needs: [lint, unit-test, e2e-test, build]` 追加
- [ ] ダミーPR作成してワークフロー確認
- [ ] `README.md` にバッジ追加
  ```markdown
  ![CI Status](https://github.com/username/shikumika-app/workflows/CI/badge.svg)
  ```

**完了条件**:
- ✅ `git push` 時に自動でテストが実行される
- ✅ PRマージ前にテストが強制実行される
- ✅ テスト失敗時はデプロイがブロックされる
- ✅ GitHub Actions のステータスバッジが表示される

---

### Phase 3: エラーハンドリング統一（1〜2日）

#### Day 1: 共通エラーハンドラー作成
- [ ] `src/lib/error-handler.ts` 作成
  ```typescript
  export class AppError extends Error {
    constructor(
      public code: string,
      public message: string,
      public userMessage: string,
      public details?: unknown
    ) {
      super(message);
    }
  }

  export function handleError(error: unknown, context?: string) {
    // ログ送信 + ユーザーメッセージ生成
  }
  ```
- [ ] `src/types/errors.ts` 作成（エラーコード定義）
- [ ] `docs/architecture/error-handling.md` 作成（設計書）
- [ ] Unitテスト作成 (`tests/unit/error-handler.test.ts`)

#### Day 2: 全APIルート・Hook に適用
- [ ] API Routes に適用（28ファイル）
  - `src/app/api/tasks/route.ts`
  - `src/app/api/calendar/sync-task/route.ts`
  - `src/app/api/calendars/route.ts`
  - ... 他25ファイル
- [ ] Hooks に適用（16ファイル）
  - `src/hooks/useMindMapSync.ts`
  - `src/hooks/useTaskCalendarSync.ts`
  - `src/hooks/useCalendarEvents.ts`
  - ... 他13ファイル
- [ ] エラートースト表示の統一
  - `src/components/ui/toast.tsx` 確認
  - 全エラーで統一的なトースト表示

**完了条件**:
- ✅ 全APIルートで共通エラーハンドラーを使用
- ✅ ユーザー向けエラーメッセージが統一されている
- ✅ エラーログが構造化されている
- ✅ エラーハンドリング設計書が存在する

---

### Phase 4: 巨大コンポーネント分割（2〜3日）

#### Day 1: レイアウトロジック分離
- [ ] `src/components/dashboard/mind-map/layout/dagreLayout.ts` 作成
  - dagre レイアウト計算ロジックを移動
- [ ] `src/components/dashboard/mind-map/layout/nodeHeight.ts` 作成
  - ノード高さ計算ロジックを移動
- [ ] Unitテスト作成
  - `tests/unit/dagreLayout.test.ts`

#### Day 2: ノードコンポーネント分離
- [ ] `src/components/dashboard/mind-map/nodes/ProjectNode.tsx` 作成
- [ ] `src/components/dashboard/mind-map/nodes/TaskNode.tsx` 作成
- [ ] `src/components/dashboard/mind-map/components/NodePriorityBadge.tsx` 作成
- [ ] `src/components/dashboard/mind-map/components/NodeEstimatedTime.tsx` 作成
- [ ] `src/components/dashboard/mind-map/components/NodeCalendarSelect.tsx` 作成
- [ ] Storybook 作成（オプション）

#### Day 3: Hooks分離 + 統合
- [ ] `src/components/dashboard/mind-map/hooks/useNodeDrag.ts` 作成
- [ ] `src/components/dashboard/mind-map/hooks/useNodeSelection.ts` 作成
- [ ] `src/components/dashboard/mind-map/index.tsx` 作成（メインコンテナ）
  - 分割したコンポーネントを統合
- [ ] `src/components/dashboard/mind-map.tsx` 削除
- [ ] `src/components/dashboard/center-pane.tsx` の import 更新
  ```typescript
  // Before
  import { MindMap } from './mind-map';

  // After
  import { MindMap } from './mind-map/index';
  ```
- [ ] 全テスト実行（E2E + Unit）
- [ ] ビルド確認 (`npm run build`)

**完了条件**:
- ✅ mind-map.tsx（2,328行）が削除されている
- ✅ 新しい構造で10ファイル以下、各500行以下
- ✅ 既存のE2Eテストが通る
- ✅ ビルドが成功する
- ✅ マインドマップ機能が正常に動作する

---

## 完了条件（全Phase）

### 定量的指標
- [x] テストカバレッジ 60%以上
- [x] E2Eテスト 5個以上
- [x] Unitテスト 10個以上
- [x] 500行超のファイル 0個
- [x] CI/CD パイプライン稼働

### 定性的指標
- [x] `npm test` が成功する
- [x] `npm run build` が成功する
- [x] `npm run lint` がエラーなし
- [x] `tsc --noEmit` がエラーなし
- [x] 既存機能が正常に動作する

### ドキュメント
- [x] テストの実行方法が README に記載
- [x] エラーハンドリング設計書が存在
- [x] コンポーネント分割の経緯が記録

---

## メモ

### 実装時の注意事項

#### テスト作成時
- **data-testid の命名規則**: `{component}-{element}-{action}` (例: `task-create-button`)
- **モック戦略**: Supabase は完全モック、Google API は MSW（Mock Service Worker）
- **E2Eテストの実行環境**: headless mode（CI）と UI mode（ローカル開発）
- **テストデータ**: `tests/fixtures/` にサンプルデータを配置

#### エラーハンドリング統一時
- **既存のエラー処理**: 段階的に移行（一度にすべて変更しない）
- **ユーザーメッセージ**: 技術的詳細を含めず、対処方法を示す
- **ログレベル**: ERROR（即対応）/ WARN（監視）/ INFO（記録のみ）

#### コンポーネント分割時
- **import の更新**: 自動的に行われるか確認（TypeScript Language Server）
- **Props の型定義**: 各コンポーネントで明確に定義
- **パフォーマンス**: React.memo の適切な使用

### リスク管理

| リスク | 影響 | 対策 |
|---|---|---|
| テスト作成時に既存コードを壊す | 高 | テスト前にブランチ作成、PRレビュー |
| E2Eテストがflaky（不安定） | 中 | リトライロジック追加、wait戦略見直し |
| コンポーネント分割で動作不良 | 高 | 段階的分割、各ステップでテスト実行 |
| CI/CDがGitHub Actions制限超過 | 低 | 無料枠確認、必要に応じてキャッシュ戦略 |

### 参考リンク
- [Playwright Best Practices](https://playwright.dev/docs/best-practices)
- [Vitest Guide](https://vitest.dev/guide/)
- [Next.js Testing](https://nextjs.org/docs/app/building-your-application/testing)
- [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/)

---

**Phase 1から順次実装を開始してください。新しい `/test` スキルを使うと効率的です。**
