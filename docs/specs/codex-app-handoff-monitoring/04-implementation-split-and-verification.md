# 04. 実装分解と検証

## 実装分割の考え方

この領域は、UI・backend・Mac agent・Turso schema がつながるため、一気に雑に直すと壊れやすいです。

基本方針:

- まず共通契約を決める。
- その後、Backend/Mac agent、Frontend/UI、Integration/verification に分ける。
- 分ける場合でも、API契約・状態名・Turso保存方針は先に固定する。
- 複数チャットで触る場合、allowed files を重ねない。

## まず作るべき契約

必要に応じて、実装前に次を短く作ります。

- `API_CONTRACT`: task-progress snapshot/detail/watch/event の入力・出力・頻度。
- `UI_ACCEPTANCE`: マップ看板、モバイル下シート、ノード詳細の見え方。
- `TEST_PLAN`: 状態丸め、manual handoff、watch cleanup、Turso payload sanitizer。
- `OWNERSHIP`: Backend/Mac agent/UI/Integration の担当ファイル。

## Backend/Mac agent の担当

主な責務:

- manual handoff tracking task を失わない。
- `dispatch_mode='manual'` を自動turn/startしない。
- `dispatch_mode='auto'` は明示モードとして残す。
- Mac local 1秒確認と cloud write 5秒/3秒boost を分離する。
- `snapshot_only=true` の通常tickでprogress/event insertしない。
- state eventは意味ある状態変化だけにする。
- `task_progress_watches` のexpired cleanupを入れる。
- runnerの監視対象をuser/spaceで絞る。
- Turso payload sanitizerでraw log/image/full historyを落とす。

触る可能性が高い場所:

- `src/app/api/task-progress/**`
- `src/lib/turso/**`
- `scripts/focusmap-agent/**`
- `scripts/task-runner.ts`
- `db/turso/migrations/**`

## Frontend/UI の担当

主な責務:

- マップをCodex監視の主画面にする。
- デスクトップは折りたたみ式 `Codex看板`。
- モバイルは右下 `Codex` ボタン + 下シート。
- UI表示を `未送信` / `実行中` / `確認待ち` / `接続失敗` に揃える。
- detail tail はdetail open時だけ読む。
- backend未実装の操作を動くボタンとして出さない。
- CodexのcompletedでFocusmapノードを自動完了にしない。

触る可能性が高い場所:

- `src/components/task-progress/**`
- `src/components/mindmap/**`
- `src/components/mobile/**`
- `src/components/codex/**`
- `src/lib/codex-run-state.ts`
- `src/lib/task-progress-ui.ts`

## Integration/verification の担当

主な責務:

- BackendとFrontendの状態名・API契約・poll頻度が一致しているか確認する。
- Tursoに全文ログが入らないことを確認する。
- detail open時以外にtail APIを読んでいないか確認する。
- manual handoff標準導線がautoへ戻っていないか確認する。
- desktop/mobileで表示が破綻していないか確認する。

## 検証チェックリスト

関連作業の完了前に、実行するか、実行できない理由を明記します。

- `git fetch --prune origin`
- `git status --short --branch`
- 既存未コミット差分を確認し、混ぜない
- touched file lint
- Codex状態丸めとマップUIの関連unit test
- `git diff --check`
- `npx tsc --noEmit --pretty false`
- desktop: `http://localhost:3001/dashboard?taskProgressFixture=1`
- mobile幅: Codexボタンと下シート

既存の型エラーがある場合は、今回変更由来か既存由来かを具体的に書きます。

## 未決定事項

この理想仕様では、次はまだ確定しません。

- `送信済みにする` 専用APIを作るか。
- `codex_thread_id` 手動紐付けUIを作るか。
- active detail viewにSSEを導入するか。
- スクショpreviewを最初のCodex監視リリースに含めるか。
- multi-user runner scopingを公開前必須にするか、shared-space rollout前必須にするか。

未決定事項は、保守的な挙動を守ったまま別途判断します。
