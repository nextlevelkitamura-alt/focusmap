# スマホCodex切替と取り込みD&D

## 目的

スマホのマップ画面で、右上の文字なしBotアイコンから `取り込み` / `看板` を切り替え、取り込んだCodexチャットをノードへ配置するUI方針を固定する。同時に、`未送信` はAI実行対象とは限らないため看板・取り込み一覧・サマリーから除外する。

## スコープ

- `TaskProgressKanban` の `未送信` レーンと未送信合成カードを廃止する。
- Codexチャット取り込み一覧から `pending` / `prompt_waiting` を除外する。
- `docs/CONTEXT.md` にスマホCodexシート、下部トレイD&D、ノード化後の表示仕様を記録する。
- 新規Codex thread取り込み時、`tasks.memo` にThread ID、Repository、最終更新、初回依頼、最新プレビューをMarkdownで保存する。
- スマホの押す前/押した後モックアップ画像を作る。

## 非スコープ

- タッチ長押しD&D本実装。
- 新しいDB migration。
- 本番push/deploy。

## 検証

- `npx vitest run src/components/task-progress/task-progress-kanban.test.tsx src/components/mindmap/custom-mind-map-view.test.tsx`
- `npx eslint src/components/task-progress/task-progress-kanban.tsx src/components/task-progress/task-progress-kanban.test.tsx src/components/dashboard/mind-map.tsx src/components/mobile/mobile-mind-map.tsx src/components/mindmap/custom-mind-map-view.tsx src/components/mindmap/custom-mind-map-view.test.tsx`
- `npx tsc --noEmit --pretty false`
- `git diff --check`
- Browser `http://localhost:3001/dashboard?view=map&taskProgressFixture=1&v=mobile-ai-unsent` をスマホ幅で表示し、title `ダッシュボード | Focusmap`、console error 0、画面内に `未送信` が出ないことを確認
- モックアップ: `docs/ai/mockups/20260611-mobile-codex-chat-import-v2.png`
