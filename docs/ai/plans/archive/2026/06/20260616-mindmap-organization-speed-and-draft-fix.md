# Mindmap Organization Speed And Draft Fix

- Task ID: TASK-20260616-004
- Status: completed
- Created: 2026-06-16
- Completed: 2026-06-16
- Board: `docs/ai/task-board.md`

## Goal

マップチャットからの「マインドマップを整理」が遅い原因、AI案確定時のDBエラー、AI案中の操作/確定結果のチャット反映不足を調査し、明確な小修正を入れる。

## Scope

- マップ整理でAIへ渡しているコンテキストとプロンプト
- `saveMindmapDraft` と AI案保存/表示/確定API
- `node_width` などDBスキーマ不一致の原因
- AI案確定後のチャット完了メッセージ

## Non-goals

- 本番DBへの手動操作
- 大規模なAI実行基盤の作り直し
- 自動テスト/ブラウザ確認の実行（ユーザー明示時のみ）

## Plan

1. 現行のAI整理コンテキスト生成、下書き保存、確定APIを読む。
2. `node_width` エラーの発生箇所を特定し、存在しないtasks列へ書かないよう修正する。
3. 整理速度に効くコンテキスト/プロンプトの無駄を削り、チャット内で確定できる導線を確認する。
4. 仕様変更があれば `docs/CONTEXT.md` を更新する。
5. task-router記録を完了し、変更分だけコミットする。

## Parallelization

`SEQUENTIAL`。DB draft API、AI tool payload、マップUI、チャットsession更新が強く結合しているため、同一チャットで順に追った。

## Verification

未実行。AGENTS.mdの方針に従い、ユーザーが明示していないため自動テスト・lint・build・ブラウザ確認は実行していない。差分確認のみ実施。

## Result

- AI案確定時の新規 `tasks` insert payload から、確定に不要な `node_width` / `mindmap_collapsed` を除外し、production schema cache に `node_width` が無い場合でも確定できるようにした。
- プロジェクトチャット初期文脈と `proposeMindmapOrganization` の返却を軽量化し、ユーザーが明示していない時はノート/メモ見出し取得を省略するようにした。
- `saveMindmapDraft` 成功時の最終assistantメッセージへ `metadata.focusmapMindmapDraftReady` を付け、`UnifiedChat` に `AI案を確定` ボタンを表示するようにした。
- AI案保存後の返答を短くする指示へ更新し、追加の表や気づきはユーザーが求めた時だけ出す方針にした。

## Links

- `docs/CONTEXT.md`
