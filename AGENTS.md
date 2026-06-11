# Focusmap（旧 shikumika）

## プロダクト概要
AIが管理・実行し、人間は俯瞰・承認するダッシュボード。
詳細: [docs/plans/focusmap-pivot.md](docs/plans/focusmap-pivot.md)

## まず読む
1. [docs/plans/focusmap-pivot.md](docs/plans/focusmap-pivot.md) — 方向転換計画（最重要）
2. [docs/CONTEXT.md](docs/CONTEXT.md) — 既存コードの全体像・現在の主要仕様
3. [docs/ROADMAP.md](docs/ROADMAP.md) — 既存機能の履歴

## 仕様更新ルール
- 実装方針・同期方式・主要UI・データフローを変えたら、同じ作業内で [docs/CONTEXT.md](docs/CONTEXT.md) の該当セクションも更新する
- Codex.app連携、ai_tasks、マインドマップ操作、runnerの巡回間隔はチャットに残さず `docs/CONTEXT.md` を正にする
- 新しい仕様書を増やす前に、既存の `docs/CONTEXT.md` / `docs/plans/*` / `docs/specs/*` に追記できないか確認する
- Web / Macアプリ / iOSアプリ / agent / Windows対応の境界は [docs/specs/platform-boundaries.md](docs/specs/platform-boundaries.md) を正にする
- Microsoft StoreやWindows対応を始める時は、PWA配布とWindowsローカル自動化を分けて扱い、Mac/iOS/Webの既存導線へ混ぜない

## 技術スタック
- Next.js (App Router) / React / TypeScript
- Supabase (PostgreSQL + Realtime)
- Tailwind CSS / Radix UI
- Cloud Run デプロイ（GitHub Actions）
- Codex -p（Mac常駐スクリプトから実行、Max契約内）

## Git ルール

### 基本方針
- **小さな修正・UI調整・ドキュメント変更は `main` に直接コミットしてよい**
- 小さな修正・UI調整・ドキュメント変更を始める時に現在ブランチが `main` 以外なら、そのまま進めず、まず `main` へ移る。未コミット差分で移動できない場合は `origin/main` から一時 worktree を作って作業し、`origin/main` へ push する。ユーザーが明示的にブランチ作業を求めた場合だけ現在ブランチで続ける
- Codex は毎回ブランチを切らない。今いるブランチで作業を始め、必要なときだけブランチを作る
- ブランチを切るのは、ユーザーが明示した場合、大きな機能、数日またぐ作業、破壊的変更、DBマイグレーション、本番にすぐ出したくない変更に限る
- 複数スレッドで同じリポジトリを触る場合も、最終的な正はGit履歴。Codexのスレッド分離だけで変更の整合性が保証されるとは考えない
- 作業開始時に `git fetch --prune origin` を実行してから `git status --short --branch` を確認し、`main` が `origin/main` より先行・遅延している場合は報告する

### コミットルール
- **こまめにコミットする**（1機能完成まで待たない）
- **Codex は作業完了時に必ずコミットする**。コード変更・設定変更・ドキュメント変更を行ったら、検証後にその作業分をコミットしてから完了報告する
- フックで自動コミットできない環境でも、Codex は `git status --short` で差分を確認し、自分が触ったファイルだけを `git add` してコミットする
- 既存の未コミット変更がある場合は、勝手に混ぜない。ユーザーが明示した場合を除き、自分の作業範囲だけをコミットし、残っている差分を報告する
- push はユーザーが明示的に依頼したときだけ行う
- 動く状態でコミット。壊れた状態でコミットしない
- コミットメッセージは日本語OK
- 例: `ダッシュボード: スキルカードコンポーネント追加`
- 例: `ai_tasks: Supabase Realtime連携`

### 開発の進め方
1. `git fetch --prune origin` でリモート追跡情報を更新
2. `git status --short --branch` で現在地と未コミット差分を確認
3. 小さな修正なら `main` で作る。現在地が `main` 以外の場合は、ブランチ名と理由を報告し、`main` へ移るか `origin/main` の一時 worktree で作る
4. 動作確認後、自分が触ったファイルだけを `git add` してコミット
5. 大きい/危険/本番保留の作業だけ `feat/*` / `fix/*` を作る
6. **迷ったらブランチではなく、小さくコミットして戻せる状態にする**

### AIエージェント並列作業
- 複数チャット・readonlyサブエージェント・Git worktree を使うか迷う依頼は `task-router` Skill を使う
- 詳細な判断基準・worktree安全策・プロンプト雛形は `task-router` の workflows を正とする
- 並列化は時間だけで判断しない。編集範囲、共通契約、衝突コスト、危険操作、統合条件を見て提案する

### Task Router Board
- 現在のタスクボードは [docs/ai/task-board.md](docs/ai/task-board.md) を正とする
- task-router が新規に作る計画は `docs/ai/plans/active/` に置く
- 完了タスクは `docs/ai/task-archive/YYYY/MM.md`、完了計画は `docs/ai/plans/archive/YYYY/MM/` に月別で移す
- 非自明な作業を始める時・計画を立てた時・完了前には task-router がこのボードを更新する
- 作業実績は `docs/ai/task-runs.jsonl`、再発防止メモは `docs/ai/mistakes.md`、並列化判断の分析は `docs/ai/task-router-analysis.md` に置く
- 毎回守るべき重要ルールは task-router Skill / workflow へ昇格し、状況依存・観察中の知見は analysis に留める

### 本番デプロイ運用（重要）
- 本番 Cloud Run は **origin/main の内容だけ**を正とする
- feature ブランチや未コミット差分を本番に直接デプロイしない
- 本番反映は原則 `git push origin main` → GitHub Actions 自動デプロイで行う
- ローカル `main` が `origin/main` より先行している間、その変更は本番には出ていない
- 手動 `./deploy-cloudrun.sh` は、クリーンな `main` かつ `HEAD == origin/main` のときだけ通る
- 手動デプロイで先に出した変更は、必ず同じコミットを `main` に push する。push しないと次の main デプロイで機能が消える
- 詳細は [docs/DEPLOY_CLOUDRUN.md](docs/DEPLOY_CLOUDRUN.md) を参照

### ローカル・スマホ確認URL運用（重要）
- Focusmap のローカル開発サーバーは **必ず `http://localhost:3001` 固定**で使う。別ポートへ逃がさない
- `npm run dev` は `localhost:3001` を開く前提。既に3001が埋まっている場合は、別ポート起動ではなく、3001を使っている古いプロセスを確認・再起動する
- スマホ確認用の Cloudflare tunnel も **必ず `http://localhost:3001` をプロキシ**する。`scripts/phone-preview.sh` は3001固定なので、`npm run dev:phone` / `npm run dev:phone:bg` を使う
- スマホURLを確認するときは `npm run dev:phone:status` で現在の `https://*.trycloudflare.com/...` を確認し、同じURLが3001へ向いている前提で作業する
- UI修正後は、ローカル `http://localhost:3001/dashboard` だけでなく、必要に応じて Cloudflare のスマホURLもリロードして確認する
- UI修正完了時は、ローカル `http://localhost:3001/dashboard` を Arc ブラウザーで開いて確認できる状態にする
- 認証が必要なUIレビュー・本番/ローカル確認は、ユーザーのログイン済みセッションがある Arc ブラウザーを優先する。Playwright等の独立ブラウザーはArcのCookieを自動共有しないため、ログイン不要ページ、単体レイアウト、テスト補助に限定する
- Arcで確認する時は、既存作業への影響を避けるため、必要最小限の新規タブ/対象URLだけを開く。ヘッドレス確認が必要な場合でも、認証済みstorage stateを明示的に用意できない限りPlaywrightで認証前提のレビューを代替しない
- 「ローカルには反映されているがCloudflareに出ない」場合は、まず Cloudflare tunnel が3001を見ているか、Next dev serverが3001で起動しているかを確認する。必要ならNext dev serverを3001で再起動し、スマホ側は `?v=数字` を付けてキャッシュを避ける
- Cloudflare URLを本番反映と混同しない。Cloudflare はローカル3001のプレビュー、本番は `origin/main` / Cloud Run

## 実装の原則

### モバイルファースト
- スマホで片手操作できることが最優先
- タップターゲット最低 44px
- 一画面の情報量を絞る（スクロールより画面遷移）

### シンプルに作る
- 最小限の機能で動くものを先に作る
- 「あったら便利」は後回し
- コンポーネントは小さく分割

### UI即時反映
- ユーザー操作は原則として楽観的UIにする。追加・貼り付け・削除・並び替え・状態変更は、API完了を待たずに画面へ即時反映する
- 保存中は低透明度、仮表示、ローディング、未確定ラベルなどで「処理中だが操作は反映済み」と分かる状態にする
- API失敗時だけ元の状態へ戻し、操作した場所の近くにエラーを出す。成功するまで無反応に見えるUIは避ける

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

### プラットフォーム境界
- `src/**` と `public/**` はWeb/Cloud Run/PWA本体。`desktop/**`、`mobile/**`、`scripts/focusmap-agent/**` から直接importしない
- `desktop/focusmap-mac/**` は現時点ではMac専用Electron shell。Windows処理をここへ直接足す前にplatform adapterまたは別shellを検討する
- `mobile/focusmap-app/**` はiOS WebView shell。プロダクトUIは原則Web側へ置き、ネイティブ側は外部URL起動・クリップボード・復帰通知に絞る
- `scripts/focusmap-agent/**` はローカル実行agent。UIやElectron shellへ依存させず、Windows対応は `darwin` / `win32` のadapter境界を作ってから進める
- Microsoft Store PWA対応はWeb/PWA metadataの作業として扱い、Codex runnerやローカル巡回とは別タスクにする

## 安全策（最重要）
- `ANTHROPIC_API_KEY` が環境変数にないことを確認してからCodex -pを使う
- `--max-budget-usd 2.00` と `--max-turns 10` を必ず付ける
- 認証情報（auth.json, .env.local）はコミットしない
