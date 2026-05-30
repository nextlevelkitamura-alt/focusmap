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
- **Claude Code は作業完了時に必ずコミットする**。コード変更・設定変更・ドキュメント変更を行ったら、検証後にその作業分をコミットしてから完了報告する
- Stop フックで自動コミットできない環境でも、Claude Code は `git status --short` で差分を確認し、自分が触ったファイルだけを `git add` してコミットする
- 既存の未コミット変更がある場合は、勝手に混ぜない。ユーザーが明示した場合を除き、自分の作業範囲だけをコミットし、残っている差分を報告する
- push はユーザーが明示的に依頼したときだけ行う
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

### マインドマップ移行方針
- React Flow版は本番導線として維持し、自作マップは並走表示で育てる
- マップの状態・階層・レイアウト計算は `src/lib/mindmap-model.ts` / `src/lib/mindmap-geometry.ts` を起点にする
- desktop/mobileで別々にロジックを増やさない。新しい判断、完了、メモ連携、リサーチ状態は先に共通モデルへ追加する
- 自作マップは段階移行する。順番は「表示 → 選択/完了/関連メモ → 折りたたみ → 作成/編集 → ドラッグ/複数選択 → React Flow置換」
- 自作マップで未実装の操作はReact Flow版を残して逃がす。React Flow版を壊して置き換えない
- メモ由来ノード、完了ノード、履歴表示の意味はdesktop/mobileで同じにする
- UIはFocusmap基準で、左上から重要な判断項目を置き、操作は小さく密度高く保つ

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
