# Focusmap（旧 shikumika）

## プロダクト概要
AIが管理・実行し、人間は俯瞰・承認するダッシュボード。
詳細: [docs/plans/focusmap-pivot.md](docs/plans/focusmap-pivot.md)

## まず読む
1. [docs/plans/focusmap-pivot.md](docs/plans/focusmap-pivot.md) — 方向転換計画（最重要）
2. [docs/CONTEXT.md](docs/CONTEXT.md) — 既存コードの全体像
3. [docs/ROADMAP.md](docs/ROADMAP.md) — 既存機能の履歴

## 技術スタック
- Next.js (App Router) / React / TypeScript
- Supabase (PostgreSQL + Realtime)
- Tailwind CSS / Radix UI
- Cloud Run デプロイ（GitHub Actions）
- claude -p（Mac常駐スクリプトから実行、Max契約内）

## Git ルール

### ブランチ戦略
```
main              ← 本番（Cloud Run自動デプロイ）
  └── feat/*      ← 機能開発（1機能1ブランチ）
  └── fix/*       ← バグ修正
```

### コミットルール
- **こまめにコミットする**（1機能完成まで待たない）
- 動く状態でコミット。壊れた状態でコミットしない
- コミットメッセージは日本語OK
- 例: `ダッシュボード: スキルカードコンポーネント追加`
- 例: `ai_tasks: Supabase Realtime連携`

### 開発の進め方
1. `git checkout -b feat/xxx` でブランチ作成
2. 小さく作って、動いたらコミット
3. 1つの機能が完成したら main にマージ
4. **迷ったらコミットしておく**（後で戻せるから）

## 実装の原則

### モバイルファースト
- スマホで片手操作できることが最優先
- タップターゲット最低 44px
- 一画面の情報量を絞る（スクロールより画面遷移）

### シンプルに作る
- 最小限の機能で動くものを先に作る
- 「あったら便利」は後回し
- コンポーネントは小さく分割

### AI実行との連携
- ai_tasks テーブルが全ての起点
- status の遷移: pending → running → awaiting_approval / completed / failed
- Supabase Realtime で画面自動更新

## ディレクトリ構造（主要）
```
src/
  app/              ← ページ（App Router）
  components/
    dashboard/      ← ダッシュボード関連（メイン画面）
    skills/         ← スキルカード関連（新規）
    ui/             ← 共通UIコンポーネント
  hooks/            ← カスタムフック
  types/            ← 型定義
  lib/              ← ユーティリティ
docs/
  plans/            ← 計画書
  specs/            ← 仕様書
scripts/
  task-runner.ts    ← Mac常駐スクリプト（Phase 2）
```

## 安全策（最重要）
- `ANTHROPIC_API_KEY` が環境変数にないことを確認してからclaude -pを使う
- `--max-budget-usd 2.00` と `--max-turns 10` を必ず付ける
- 認証情報（auth.json, .env.local）はコミットしない
