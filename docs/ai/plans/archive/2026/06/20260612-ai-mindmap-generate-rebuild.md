# AI生成マインドマップUIと処理ロジック再構築

- Task ID: TASK-20260612-004
- Status: completed
- Created: 2026-06-12
- Completed: 2026-06-12
- Board: `docs/ai/task-board.md`

## Goal

マインドマップ右上のSparkles生成を、単なる貼り付け整理ではなく、既存プロジェクトの目的・概要、既存ノード見出し、既存ノードのメモ冒頭を見ながら、新規ノード追加・既存ノード配下への接続・複数ノードの意味あるまとめを判断できる導線へ更新する。

## Scope

- `MemoToMindmapDialog` の設定/プレビューUI
- `/api/ai/memo-to-mindmap` のプロンプト入力
- `src/lib/ai/context/mindmap-context.ts`
- `src/lib/ai/memo-to-mindmap.ts`
- 関連テストと `docs/CONTEXT.md`

## Non-goals

- DB schema 変更
- 既存マップノードの自動削除や自動移動
- Codex看板/チャット取り込み導線の変更
- React Flow版の置換

## Plan

1. 既存マップコンテキストにプロジェクト概要・project_contexts・既存ノードのメモ冒頭を含める。
2. AI生成プロンプトを「複数メモをまとめる」「必要なら既存ノードへ接続する」「既存ノード名変更案は提案だけ」に寄せる。
3. UIで入力対象、整理方針、保存先、既存マップ参照の意味を明確にし、プレビューで新規追加/既存接続/元メモ数が読めるようにする。
4. テストでコンテキスト生成とdraft helperの回帰を押さえる。
5. 仕様ドキュメント、task-board、run logを更新してコミットする。

## Parallelization

`SEQUENTIAL`。UIとAPIプロンプト契約が密結合で、既存未コミット差分も同じダッシュボード周辺にあるため、単一チャットで順番に実装する。

## Verification

- `npm test -- --run src/lib/ai/memo-to-mindmap.test.ts src/lib/ai/context/mindmap-context.test.ts`
- `npm run lint -- src/components/memo/memo-to-mindmap-dialog.tsx src/app/api/ai/memo-to-mindmap/route.ts src/lib/ai/memo-to-mindmap.ts src/lib/ai/context/mindmap-context.ts src/lib/ai/context/mindmap-context.test.ts`
- `npx tsc --noEmit`
- Browser `http://localhost:3001/dashboard`: ログイン済みダッシュボード表示を確認。既存の `/api/task-progress/snapshot` fetch error は確認したが、今回の生成ダイアログとは別経路。モバイル幅reloadはBrowser URL policyでブロックされたため、迂回確認は未実施。

## Result

- 生成APIは、保存先プロジェクトの `projects.title/description/purpose`、最新 `project_contexts`、既存ノード見出し、`tasks.memo` 冒頭30文字をAIコンテキストへ渡す。
- 生成プロンプトに `自動整理` / `既存へ統合` / `実行へ分解` と任意の `AIへの指示` を追加した。
- ダイアログ設定UIに整理方針と追加指示を追加し、プレビューに新規ノード数、元メモ付き、まとめ、既存接続のカウントを表示する。
- 既存プロジェクトへの追記プレビューでは、ルート候補ごとに既存ノード接続先を手動調整できる。

## Links

- `docs/CONTEXT.md`
