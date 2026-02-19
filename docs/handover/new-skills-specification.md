# 新スキル開発用 引き継ぎ仕様書

> **対象**: スキル開発AI（別プロジェクト）
> **作成日**: 2026-02-17
> **目的**: shikumika-app の品質向上のための新スキル開発

---

## 📋 **背景・目的**

### **現状の課題**
shikumika-app は1ヶ月で24,433行に達した高速成長プロジェクトだが、以下の品質課題がある：

| 課題 | 影響 | 緊急度 |
|---|---|---|
| テストコード0行 | リグレッション検出不可、本番バグ多発リスク | 🔥 最高 |
| 巨大コンポーネント（2,328行） | 保守困難、変更時のバグ混入リスク | ⚡ 高 |
| エラーハンドリング不統一 | ユーザー体験の低下、デバッグ困難 | ⚡ 高 |
| CI/CDが部分的 | 手動テスト依存、品質保証なし | ⚡ 高 |

### **既存スキルとの関係**

| 既存スキル | 役割 | 新スキルとの違い |
|---|---|---|
| `/tdd` | テスト駆動開発（新機能） | Red→Green→Refactor | `/test` は**既存コード**にテスト追加 |
| `/refactor` | コードベース分析・リファクタ | メタデータ分析中心 | `/quality` は**具体的な品質改善**を実行 |
| `/impl` | UI・スタイル修正 | テストなしで実装 | `/test` でカバレッジ向上 |
| `/fix` | エラー・バグ修正 | 修正に特化 | `/quality` は予防的改善 |

---

## 🎯 **開発すべき新スキル**

### **1. `/test` スキル**

#### **目的**
既存のコードに対して、後からテストを追加する（後付けテスト）

#### **ユースケース**
```bash
# 使用例1: 特定ファイルにテスト追加
/test src/hooks/useMindMapSync.ts

# 使用例2: E2Eテスト生成
/test --e2e "ログイン→タスク作成→カレンダー同期"

# 使用例3: カバレッジ向上
/test --coverage 70
```

#### **動作フロー**

```
Phase 1: 分析
  ├─ 対象ファイルの読み込み
  ├─ 依存関係の特定
  ├─ テスト可能な関数・Hook の抽出
  └─ 既存テストの有無確認

Phase 2: テスト設計
  ├─ テストケース設計（正常系・異常系）
  ├─ モック戦略（Supabase、Google API など）
  └─ テストファイル構造決定

Phase 3: 実装
  ├─ Vitest（Unit）または Playwright（E2E）でテスト作成
  ├─ 必要な場合、テスタビリティ向上のためのリファクタ
  │  （例: data-testid 追加、依存注入対応）
  └─ テスト実行・検証

Phase 4: ドキュメント更新
  ├─ README にテストコマンド追加
  ├─ package.json にスクリプト追加
  └─ 完了報告
```

#### **制約条件**
- ✅ **既存コードの動作を変更してはならない**（振る舞い保証）
- ✅ テストカバレッジは最低60%を目指す
- ✅ E2Eテストは主要5フロー（ログイン、タスク作成、カレンダー同期、タイマー、設定）を優先
- ✅ モックは最小限（実際のAPIは使わない）
- ❌ テストのためだけの大幅なリファクタは避ける

#### **成果物**
```
tests/
  ├─ unit/
  │   ├─ useMindMapSync.test.ts
  │   ├─ useTaskCalendarSync.test.ts
  │   └─ useCalendarEvents.test.ts
  ├─ e2e/
  │   ├─ login.spec.ts
  │   ├─ task-creation.spec.ts
  │   ├─ calendar-sync.spec.ts
  │   ├─ timer.spec.ts
  │   └─ settings.spec.ts
  └─ setup/
      ├─ vitest.config.ts
      └─ playwright.config.ts
```

#### **技術スタック**
- **Unit Testing**: Vitest + @testing-library/react
- **E2E Testing**: Playwright
- **モック**: MSW (Mock Service Worker) または vi.mock()

---

### **2. `/quality` スキル**

#### **目的**
コード品質を総合的に改善する（エラーハンドリング統一、パフォーマンス最適化、巨大ファイル分割など）

#### **ユースケース**
```bash
# 使用例1: エラーハンドリング統一
/quality --error-handling

# 使用例2: 巨大コンポーネント分割
/quality --split src/components/dashboard/mind-map.tsx

# 使用例3: パフォーマンス最適化
/quality --performance

# 使用例4: 全体品質チェック
/quality --audit
```

#### **動作フロー**

```
Phase 1: 診断
  ├─ コードベーススキャン
  ├─ 品質問題の特定
  │  ├─ 巨大ファイル（>500行）
  │  ├─ エラーハンドリングの不統一
  │  ├─ パフォーマンスボトルネック
  │  ├─ 重複コード
  │  └─ 型安全性の問題
  └─ 優先順位付け

Phase 2: 改善計画
  ├─ 改善項目のリスト化
  ├─ リスク評価（破壊的変更の有無）
  └─ ユーザー承認

Phase 3: 実装
  ├─ オプションに応じた改善実行
  │  ├─ --error-handling: 共通エラーハンドラー導入
  │  ├─ --split: コンポーネント分割
  │  ├─ --performance: useMemo/useCallback 追加、バンドルサイズ削減
  │  └─ --audit: レポート生成のみ
  └─ 改善後のテスト実行（/test と連携）

Phase 4: 検証
  ├─ ビルド確認
  ├─ 既存テスト実行
  └─ 変更内容のドキュメント化
```

#### **制約条件**
- ✅ **破壊的変更は事前にユーザー確認**
- ✅ 改善前に必ずテストを作成（/test スキルと連携）
- ✅ Git コミットは改善項目ごとに分ける
- ❌ 過度な最適化（YAGNI違反）は避ける
- ❌ ユーザー体験に影響する変更は慎重に

#### **成果物（例: エラーハンドリング統一）**
```
src/lib/error-handler.ts       # 新規作成
src/lib/logger.ts               # 新規作成（オプション）
src/app/api/*/route.ts          # 全APIルートに適用
src/hooks/*.ts                  # 全Hookに適用
docs/architecture/error-handling.md  # ドキュメント
```

#### **成果物（例: コンポーネント分割）**
```
Before:
  src/components/dashboard/mind-map.tsx (2,328行)

After:
  src/components/dashboard/mind-map/
    ├─ index.tsx (100行)
    ├─ nodes/
    │   ├─ ProjectNode.tsx
    │   └─ TaskNode.tsx
    ├─ layout/
    │   └─ dagreLayout.ts
    └─ hooks/
        ├─ useNodeDrag.ts
        └─ useNodeSelection.ts
```

---

## 🔧 **技術的要件**

### **共通要件**
- **言語**: TypeScript（型安全性必須）
- **フレームワーク**: Next.js 16.1.3 (App Router)
- **状態管理**: Context API + React Hooks
- **データベース**: Supabase (PostgreSQL)
- **外部API**: Google Calendar API

### **テスト要件**
- **Unit Test**: Vitest + React Testing Library
- **E2E Test**: Playwright
- **カバレッジ目標**: 60%以上（重要なロジックは80%以上）
- **モック戦略**:
  - Supabase: `vi.mock('@/utils/supabase/client')`
  - Google Calendar API: MSW (Mock Service Worker)

### **品質要件**
- **ESLint**: `npm run lint` エラーなし
- **TypeScript**: `tsc --noEmit` エラーなし
- **ビルド**: `npm run build` 成功
- **既存機能**: すべてのテストが通る（後退なし）

---

## 📊 **優先順位とスケジュール**

### **Phase 1: テスト基盤整備（Week 1-2）**
```
□ /test スキル開発
  ├─ Playwright セットアップ機能
  ├─ E2Eテスト生成（5つの主要フロー）
  ├─ Vitest セットアップ機能
  └─ Unitテスト生成（主要3 Hooks）
```

### **Phase 2: CI/CD統合（Week 2）**
```
□ GitHub Actions ワークフロー生成
  ├─ Lint + Type Check
  ├─ Unit Tests
  ├─ E2E Tests
  └─ Build Check
```

### **Phase 3: 品質改善（Week 3-4）**
```
□ /quality スキル開発
  ├─ エラーハンドリング統一機能
  ├─ 巨大コンポーネント分割機能
  ├─ パフォーマンス最適化機能
  └─ 品質監査レポート生成
```

---

## 📝 **インターフェース仕様**

### **/test スキルのコマンド引数**

```typescript
interface TestSkillArgs {
  // テスト対象
  target?: string;           // ファイルパス（例: "src/hooks/useMindMapSync.ts"）

  // テストタイプ
  type?: 'unit' | 'e2e';     // デフォルト: 自動判定

  // E2Eテスト用
  scenario?: string;         // シナリオ記述（例: "ログイン→タスク作成"）

  // カバレッジ目標
  coverage?: number;         // 目標カバレッジ% (デフォルト: 60)

  // オプション
  watch?: boolean;           // watchモードで実行
  dry?: boolean;             // テスト生成のみ（実行しない）
}
```

### **/quality スキルのコマンド引数**

```typescript
interface QualitySkillArgs {
  // 改善タイプ
  action: 'error-handling' | 'split' | 'performance' | 'audit';

  // 分割対象（action='split'の場合）
  target?: string;           // ファイルパス

  // オプション
  fix?: boolean;             // 自動修正（デフォルト: false、確認あり）
  report?: boolean;          // レポート生成のみ
}
```

---

## 🎯 **成功基準**

### **/test スキル**
- ✅ E2Eテスト5個が正常に実行できる
- ✅ Unitテスト3個が正常に実行できる
- ✅ カバレッジが60%以上
- ✅ CI/CDで自動実行できる

### **/quality スキル**
- ✅ エラーハンドリングが全APIルートで統一されている
- ✅ 2,000行超のファイルが500行以下に分割されている
- ✅ `npm run build` が成功する
- ✅ 既存テストがすべて通る

---

## 📚 **参考情報**

### **プロジェクト構造**
```
shikumika-app/
├── src/
│   ├── app/
│   │   ├── api/              # APIルート（28ファイル）
│   │   └── dashboard/        # ダッシュボード
│   ├── components/
│   │   ├── dashboard/        # 8ファイル（mind-map.tsx: 2,328行）
│   │   ├── calendar/         # 11ファイル
│   │   └── tasks/            # 4ファイル
│   ├── hooks/                # 16 Hooks
│   ├── lib/                  # ユーティリティ
│   └── types/                # 型定義
├── supabase/
│   └── migrations/           # 14マイグレーション
└── docs/
    ├── CONTEXT.md            # プロジェクト全体像
    ├── ROADMAP.md            # ロードマップ
    └── plans/                # 計画書
```

### **重要なファイル**
| ファイル | 行数 | 優先度 | テスト必要度 |
|---|---|---|---|
| `src/components/dashboard/mind-map.tsx` | 2,328 | 🔥 最高 | E2E + Unit |
| `src/components/dashboard/center-pane.tsx` | 1,230 | 🔥 最高 | E2E |
| `src/hooks/useMindMapSync.ts` | 917 | 🔥 最高 | Unit（必須） |
| `src/hooks/useTaskCalendarSync.ts` | - | ⚡ 高 | Unit |
| `src/hooks/useCalendarEvents.ts` | - | ⚡ 高 | Unit |

### **既存のCI/CD**
```yaml
# .github/workflows/deploy-cloudrun.yml
- ✅ Cloud Run への自動デプロイ（mainブランチ）
- ❌ テスト実行なし
- ❌ Lintチェックなし
```

---

## 🚀 **実装開始時のアクション**

### **スキル開発AI がやるべきこと**

1. **このドキュメントを読む**
2. **/test スキルを開発**
   - `~/.claude/skills/test/` ディレクトリ作成
   - `skill.md` に仕様記述
   - プロンプトテンプレート作成
3. **/quality スキルを開発**
   - `~/.claude/skills/quality/` ディレクトリ作成
   - `skill.md` に仕様記述
   - プロンプトテンプレート作成
4. **テストスキル実行**
   - shikumika-app で `/test src/hooks/useMindMapSync.ts` を試す
   - 生成されたテストを確認
5. **品質スキル実行**
   - `/quality --audit` でレポート生成
   - `/quality --error-handling` で統一化を試す

---

## 💬 **質問・確認事項**

開発中に不明点があれば、以下を確認：

1. **既存スキルとの連携方法** → `/tdd` や `/refactor` との違いを明確に
2. **エラーハンドリングの既存実装** → `src/app/api/` を確認
3. **テスト戦略の詳細** → E2E vs Unit の境界線
4. **破壊的変更の許可範囲** → ユーザー確認が必要なケース

---

**このドキュメントを使って、スキル開発AI に新スキルの開発を依頼してください。**
