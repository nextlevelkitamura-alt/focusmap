# Mobile Map Codex Import Implementation

Task: `TASK-20260612-001`
Status: Completed
Date: 2026-06-12

## Goal

モバイルの `マップ` 画面で、前回決めたCodex取り込みUIを実際の操作に反映する。

## Scope

- `マップ` 見出しを外し、`SpaceProjectSwitcher` を左詰めにする。
- 右上は文字なしのBotアイコンとSparklesアイコンにし、`AI` ラベルや `すること` ラベルは出さない。
- 右上BotアイコンからCodexシートを開き、`取り込み` / `看板` を切り替える。
- マップ上の下部 `Codex online` フローティングボタンは出さない。
- `取り込み` は `Codex Inbox` 配下の `codex_app_thread` のうち、repo一致かつ未送信ではないものだけを表示する。
- `配置先を選ぶ` 後はマップ上のノードをタップして、取り込みノードをその配下へ移動する。

## Verification

- `npm run lint -- src/components/ai/mobile-ai-map-view.tsx src/components/mobile/mobile-mind-map.tsx src/components/task-progress/task-progress-kanban.tsx src/components/task-progress/task-progress-kanban.test.tsx src/components/mindmap/custom-mind-map-view.tsx src/components/mindmap/custom-mind-map-view.test.tsx`
- `npx vitest run src/components/task-progress/task-progress-kanban.test.tsx src/components/mindmap/custom-mind-map-view.test.tsx --test-timeout=20000`
- `npx tsc --noEmit --pretty false`
- `git diff --check`

## Notes

モバイル配置モード中はノードタップでインライン編集を開始しない。配置後は対象親ノードを展開し、移動した取り込みノードを選択状態にする。
