# Codexチャット作業時間と履歴表示の安定化

## 背景

Codexチャット履歴の `作業時間` が、1回の会話ラリーではなく過去ラリーを含むtask全体時間のように見えることがあった。加えて、一覧上部の表示順・時刻ラベルが短周期で変わり、ユーザーには「2秒ごとに一番上の内容が異なる」ように見えていた。

## 方針

- AI履歴カード・詳細・スマホ取り込みで使う `作業時間` は、`codex_turn_started_at` から `codex_turn_completed_at` / `awaiting_approval_at` までの1ラリーだけに統一する。
- `ai_tasks.started_at` / `ai_tasks.created_at` / `result.last_activity_at` へ作業時間をfallbackしない。過去ラリーや一覧同期時刻を混ぜない。
- 一覧カードの `updatedLabel` は取り込み済みの表示値をそのまま使い、背景activity同期で短周期に差し替えない。
- 選択中詳細の5秒再同期は `running` 中だけに限定する。確認待ち/完了後は、開いた時点の表示を安定させる。
- スマホ版もPC版と同じく、リポ未選択時は取り込み候補を全件表示し、リポ選択時だけフィルタする。

## 変更範囲

- `src/lib/codex-thread-import-display.ts`
- `src/components/dashboard/mind-map.tsx`
- `src/components/mobile/mobile-mind-map.tsx`
- `src/components/dashboard/codex-chat-import-sidebar.tsx`
- `src/components/task-progress/task-progress-kanban.tsx`
- 関連テスト
- `docs/CONTEXT.md`

## 検証

- `npm run test:run -- src/lib/codex-thread-import-display.test.ts src/components/dashboard/codex-chat-import-sidebar.test.tsx --test-timeout=30000`
- `npm run test:run -- src/components/task-progress/task-progress-kanban.test.tsx --test-timeout=30000`
- `npm run test:run -- src/lib/codex-thread-import-display.test.ts src/components/dashboard/codex-chat-import-sidebar.test.tsx src/components/task-progress/task-progress-kanban.test.tsx --test-timeout=30000`

