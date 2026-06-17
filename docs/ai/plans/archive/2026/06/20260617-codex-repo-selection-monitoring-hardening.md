# Codex Repo Selection And Monitoring Hardening

- Task ID: TASK-20260617-013
- Status: completed
- Created: 2026-06-17
- Completed: 2026-06-17
- Board: `docs/ai/task-board.md`

## Goal

Codexチャット取り込みで、Focusmap側の選択リポとCodexが実際に使っているプロジェクト/フォルダー/worktreeがズレないようにする。

ユーザーが見る画面では、選択中リポ、監視ON/OFF、Mac agentのオンライン状態、agentがそのリポを監視scopeとして取得できているか、最後にCodex履歴を照合した時刻を同じ場所で確認できるようにする。

## Scope

- `src/hooks/useAvailableRepos.ts`
- `src/components/dashboard/codex-chat-import-sidebar.tsx`
- `src/components/dashboard/codex-chat-import-sidebar.test.tsx`
- `src/components/dashboard/mind-map.tsx`
- `src/components/mobile/mobile-mind-map.tsx`
- `src/hooks/useCodexRunnerStatus.ts`
- `src/app/api/task-progress/runner-heartbeats/route.ts`
- `scripts/focusmap-agent/src/heartbeat.ts`
- `scripts/focusmap-agent/src/codex-thread-monitor.ts`
- `docs/CONTEXT.md`

## Non-goals

- 任意のローカルフォルダーを通常導線から自由選択させること。
- Codex Desktop自体のプロジェクト一覧UIを変更すること。
- DB schema migrationを前提にした重い監視テーブル追加。
- 本番DBの手動操作。

## Plan

### 1. リポ選択候補をCodexプロジェクト中心へ寄せる

- 通常のリポ選択候補は `source: "codex"` のみを優先表示する。
- `source: "agent"` は通常候補から外し、既存保存済みパスがCodex候補外だった場合の表示・解除用にだけ扱う。
- ボタン文言は `既存リポ選択` から `Codexプロジェクトから選択` へ変更する。
- Finderボタンは通常の「新規選択」ではなく、選択中リポをFinderで開く導線へ寄せる。任意フォルダー選択は詳細/フォールバック扱いにする。

### 2. 選択中リポを常時見えるUIへ刷新する

- `選択中: focusmap` をボタン列の近くに常時表示する。
- 2行目に絶対パスを省略表示し、titleでフルパスを確認できるようにする。
- 状態チップを並べる。
  - `Codexプロジェクト`
  - `監視ON` / `監視OFF`
  - `Mac online` / `Mac offline`
  - `agent反映待ち` / `agent反映済み`
  - `最終照合: 12秒前`
- 未選択時は空の四角に見せず、`Codexプロジェクト未選択` と明示する。

### 3. agent監視scopeの証拠をUIへ出す

- focusmap-agentのheartbeat metadataに、Codex監視の最新状態を載せる。
  - `codex_import_scopes_count`
  - `codex_import_scope_repo_paths`
  - `codex_last_scope_refresh_at`
  - `codex_last_reconcile_at`
  - `codex_last_reconcile_imported`
  - `codex_monitor_db_available`
- UIは `selectedRepoPath` とheartbeat metadataを照合し、このリポがagentに見えているかを判定する。
- scope取得前は `agent反映待ち`、一致済みなら `agent反映済み` と表示する。

### 4. worktree照合の見える化

- 既存のagentは `git worktree list --porcelain` でrepo pathとworktree pathを照合対象に含めている。
- UI表示では少なくとも「worktree含む照合対象」かどうかが分かる文言を出す。
- 将来の詳細表示では、`focusmap-codex-reconcile-main` のようなworktree pathも確認できるようにする。

### 5. 監視開始直後の取りこぼしを減らす

- リポ選択時は `repo_path` と `codex_thread_import_enabled: true` を同時保存する現行方針を維持する。
- scope signatureが変わった時点でreconcileを即時実行する現行方針を維持し、UIに反映待ちを出す。
- ローカルagentのビルド/再起動が必要な変更は、完了報告で明確に分ける。

## Parallelization

Initial mode: `HYBRID_PLAN_THEN_PARALLEL`

- readonly explorer 1: リポ候補/UIの既存経路を調査。
- readonly explorer 2: agent/import scopes/heartbeat/worktree照合の既存経路を調査。
- 実装は共有契約が強いため、調査結果を統合してから単一チャットで順次実装する。
- 実装を別チャットへ渡す場合も、UI workerとagent/API workerを分ける前にheartbeat metadata contractを固定する。

## Acceptance

- リポ選択候補の通常表示で、Codexに登録済みのプロジェクト/フォルダーだけを選べる。
- `focusmap` を選んだ時、選択中リポ名と絶対パスがサイドバー上部で常時確認できる。
- 保存済みリポがCodex候補外の場合、勝手に消さず `Codex候補外` と表示して解除できる。
- 監視ONでもagent未反映なら `agent反映待ち` と分かる。
- agentがscope取得済みなら `agent反映済み` と分かる。
- 最終scope refresh / reconcile時刻が画面上で分かる。
- 同一Gitリポのworktreeで開始したCodex threadも監視対象として説明できる。
- `docs/CONTEXT.md` に、Codexリポ選択と監視状態表示の正本仕様を更新する。

## Verification

ユーザーが明示した場合だけ実行する。

- `npm run test:run -- src/components/dashboard/codex-chat-import-sidebar.test.tsx scripts/focusmap-agent/codex-thread-monitor.test.ts`
- `npm run lint`
- `npm run build`
- `http://localhost:3001/dashboard` の実画面確認
- Focusmap Mac agentの再ビルド/再起動後のheartbeat metadata確認

## Result

実装済み。

- 通常のリポ選択候補をCodex SQLite `threads.cwd` 由来の `source: "codex"` に限定した。
- 既存保存済みpathがCodex候補外の場合は自動削除せず、`Codex候補外` と表示し、既存ONのOFF/解除だけできるようにした。
- サイドバー上部へ選択中リポ、絶対path、監視ON/OFF、Codex候補状態、agent scope反映状態、scope refresh/reconcile時刻、worktree有無、agent errorをまとめて表示するようにした。
- Mac bridgeのFinder導線は任意フォルダー選択ではなく、選択中リポを開く `openPath` に寄せた。
- focusmap-agentのheartbeat metadataへCodex監視scope/reconcile状態を載せ、Web UIが選択中リポとagentの実監視scopeを照合できるようにした。
- モバイルの取り込みリポ候補もCodex候補中心へ揃えた。
- `docs/CONTEXT.md` とCodex monitoring specへ、リポ選択・監視状態表示・heartbeat metadata contractを追記した。

注意: 現時点のCodex候補はCodex Desktopの正式プロジェクトregistryではなく、Codex SQLite `threads.cwd` 履歴からGit rootへ正規化した候補である。Codex履歴が無い新規repoは候補に出ない可能性がある。

## Verification Result

- `git diff --check`
- テスト/lint/build/Browser確認は未実行。ユーザー明示なしのため、AGENTS.mdの自動検証ポリシーに従った。

## Links

- Parent board: `docs/ai/task-board.md`
- Related completed task: `TASK-20260617-012`
- Related completed task: `TASK-20260617-011`
