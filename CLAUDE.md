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

### 基本方針
- **小さな修正・UI調整・ドキュメント変更は `main` に直接コミットしてよい**
- Claude Code は毎回ブランチを切らない。今いるブランチで作業を始め、必要なときだけブランチを作る
- ブランチを切るのは、ユーザーが明示した場合、大きな機能、数日またぐ作業、破壊的変更、DBマイグレーション、本番にすぐ出したくない変更に限る
- 複数スレッドで同じリポジトリを触る場合も、最終的な正はGit履歴。Claude/Codexのスレッド分離だけで変更の整合性が保証されるとは考えない
- 作業開始時に `git fetch --prune origin` を実行してから `git status --short --branch` を確認し、`main` が `origin/main` より先行・遅延している場合は報告する

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
1. `git fetch --prune origin` でリモート追跡情報を更新
2. `git status --short --branch` で現在地と未コミット差分を確認
3. 通常は `main` のまま小さく作る
4. 動作確認後、自分が触ったファイルだけを `git add` してコミット
5. 大きい/危険/本番保留の作業だけ `feat/*` / `fix/*` を作る
6. **迷ったらブランチではなく、小さくコミットして戻せる状態にする**

### 本番デプロイ運用（重要）
- 本番 Cloud Run は **origin/main の内容だけ**を正とする
- feature ブランチや未コミット差分を本番に直接デプロイしない
- 本番反映は原則 `git push origin main` → GitHub Actions 自動デプロイで行う
- ローカル `main` が `origin/main` より先行している間、その変更は本番には出ていない
- 手動 `./deploy-cloudrun.sh` は、クリーンな `main` かつ `HEAD == origin/main` のときだけ通る
- 手動デプロイで先に出した変更は、必ず同じコミットを `main` に push する。push しないと次の main デプロイで機能が消える
- 詳細は [docs/DEPLOY_CLOUDRUN.md](docs/DEPLOY_CLOUDRUN.md) を参照

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
