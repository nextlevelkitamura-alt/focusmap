# スマホAI履歴D&D配置と履歴削除

- Task ID: TASK-20260617-005
- Status: completed
- Created: 2026-06-17
- Completed: 2026-06-17
- Board: `docs/ai/task-board.md`

## Goal

スマホのAIチャット履歴で `配置先を選ぶ` ボタンを廃止し、履歴カードを上へドラッグしてPC版と同じマップD&D配置にする。履歴カードにはPC版同様の削除ボタンを付ける。

## Scope

- `src/components/task-progress/task-progress-kanban.tsx`
- `src/components/mobile/mobile-mind-map.tsx`
- `src/components/mindmap/custom-mind-map-view.tsx`
- 関連テストの期待値更新
- `docs/CONTEXT.md`

## Non-goals

- 新規DBテーブルやAPI追加はしない
- PC版Codex履歴サイドバーの挙動は変えない
- 自動テスト・lint・ブラウザ確認はユーザー明示がない限り実行しない

## Plan

1. モバイル履歴カードから配置ボタンを外し、タッチドラッグ開始/移動/終了イベントを親へ通知する。
2. `MobileMindMap` でドラッグイベントを受け、`CustomMindMapView` に渡す。
3. `CustomMindMapView` の既存PCドロップ判定をタッチドラッグにも適用し、drop時に `onDropImportedChatNode` を呼ぶ。
4. モバイル配置処理をPC同様に `project-root` / `as-child` / `above` / `below` 対応にする。
5. モバイル履歴カードに削除ボタンを追加し、既存削除経路へつなぐ。

## Parallelization

SINGLE_CHAT。履歴カードUI、マップdrop判定、配置更新が同じ契約に依存するため分割しない。

## Verification

ユーザー明示がないため自動テスト・lint・build・ブラウザ確認は実行しない。差分確認のみ行う。

## Result

スマホ `AIチャット履歴` の `配置先を選ぶ` ボタンを削除し、履歴カードを上方向へドラッグするとCodexシートを閉じて、PC版と同じマップdrop候補へ入るようにした。中央dropは子ノード、上下端dropは兄弟挿入、空白dropはproject root直下として配置し、保存前からカード非表示と仮配置を即時反映する。履歴カードには削除アイコンボタンを追加し、既存task削除経路へ接続した。
