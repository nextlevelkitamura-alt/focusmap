# マップ整理モード選択と実行時間表示

- Task ID: TASK-20260616-005
- Status: completed
- Created: 2026-06-16
- Completed: 2026-06-16
- Board: `docs/ai/task-board.md`

## Goal

`マインドマップを整理する` 実行で、既存の `スピード` / `考える` モデルモード選択を尊重し、実行中・完了後に経過時間を見えるようにする。整理ワークフローは、構造変更を必ず作るのではなく、整理不要判定、追加候補、深掘り質問を返せる診断型へ変更する。

## Scope

- `UnifiedChat` のスターター/追加メニュー文言、run表示、経過時間UI
- 永続チャットrunの `modelMode` / timing metadata
- マインドマップ整理system prompt / harness / tool hints
- `docs/CONTEXT.md` の現行仕様更新

## Non-goals

- DB列追加や集計専用テーブル作成
- ブラウザ/Playwright/ビルド/テストの自動実行
- マップ描画UIの大改修

## Plan

1. runごとの `modelMode`、開始時刻、完了時刻、durationをmessage metadataに残す。
2. 実行中は選択モードと経過秒数を表示し、完了後はassistant返答にモードと所要時間を表示する。
3. `マインドマップを整理する` のユーザー表示文を短くし、詳細ルールはsystem prompt / harnessへ移す。
4. 整理ワークフローを `整理不要` / `軽い整理` / `構造見直し` に分け、整理不要時はAI案を保存しない。
5. 追加候補は自動でAI案に入れず、チャット提案として返す。

## Parallelization

SEQUENTIAL。チャットUI、run API、system prompt、harness、docsが同じ契約を共有するため、分割せず直列で実装する。

## Verification

ユーザー明示がないため自動検証コマンドは実行しない。差分確認のみ行う。

## Result

- `UnifiedChat` のスターターと `+` メニューは、表示上の依頼文を `マインドマップを整理する` に統一した。
- `スピード` / `考える` の選択値をrun metadataへ保存し、実行中はモードと経過秒数、完了後はassistantメッセージに所要時間バッジを表示するようにした。
- `/api/ai/agent/runs` は完了/失敗メッセージへ `focusmapAgentRunResult` を保存し、ユーザーmessage側にもサーバー開始時刻つきの `focusmapAgentRun` を保存するようにした。
- マインドマップ整理のsystem prompt / harness / tool hintsを診断型へ変え、今の構造で十分ならAI案を作らず、追加候補と深掘り質問を返すようにした。
- 追加候補はユーザー承認前にAI案へ自動混入しないルールを `docs/CONTEXT.md` に固定した。
