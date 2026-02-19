# Today TODO
> 日付: 2026-02-19

## タスク（テスト基盤強化）
- [x] **useCalendars.test.ts** — fetch モック、取得・トグル・楽観的更新・ロールバック（12テスト）
- [x] **useHabits.test.ts** — CRUD・ストリーク計算（15テスト）
- [x] **useEventCompletions.test.ts** — イベント完了フラグ（10テスト）
- [x] **useMultiTaskCalendarSync.test.ts** — 複数タスク同期（10テスト）
- [x] テスト実行 & 全 Pass 確認（109テスト / 9ファイル）
- [x] **sync-task/route.test.ts** — POST/PATCH/DELETE 認証・バリデーション・DBエラー・Google API エラー（28テスト）
- [x] **event-completions/route.test.ts** — GET/POST/DELETE（16テスト）
- [x] **habits/route.test.ts** — GET 習慣一覧・completions・child_tasks マッピング（9テスト）
- [x] **habits/completions/route.test.ts** — POST/GET/DELETE（16テスト）
- [x] **tasks/route.test.ts** — POST タスク作成（9テスト）
- [x] **tasks/[id]/route.test.ts** — GET/DELETE/PATCH（16テスト）
- [x] 全体テスト確認（203テスト / 15ファイル 全 Pass）

## 完了
- [x] モバイル編集モーダルに削除ボタン追加（楽観的UI、タスク/イベント両対応）
- [x] 【A】クイックタスク追加の設計・実装