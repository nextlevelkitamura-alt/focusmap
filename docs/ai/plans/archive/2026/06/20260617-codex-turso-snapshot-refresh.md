# Codex Turso Snapshot Refresh

- Task ID: TASK-20260617-001
- Status: completed
- Created: 2026-06-17
- Completed: 2026-06-17
- Board: `docs/ai/task-board.md`

## Goal

Codex.appで新しいthreadが開始・取り込み済みになった時、Supabase RealtimeのINSERT取りこぼしに依存せず、Turso task-progress snapshotを起点に3秒以内でチャット取り込み一覧へ反映する。

## Scope

- マップ画面のCodexチャット取り込み一覧
- Turso `task-progress/snapshot` とSupabase `tasks` stateの補完
- 必要最小限のSupabase再取得
- 関連仕様docs

## Non-goals

- Supabase Authの置き換え
- `tasks` 本体のTurso全面移行
- DB schema追加
- Codex監視writerの全面再設計
- push / 本番デプロイ

## Plan

1. Turso snapshotに存在する `source_type='mindmap'` / `source_id` のうち、現在の `allTasks` に無いsource taskを検出する。
2. 欠落source taskがある時だけ、Supabase task再取得をsilentに発火する。
3. UI一覧は既存の `source='codex_app_thread'` taskを正とし、Realtime取りこぼし時はsnapshot差分で補完する。
4. Supabase全件3秒pollへは寄せず、Tursoの3秒snapshot pollをトリガーにする。
5. focused unit testを追加/更新し、仕様docsを更新する。

## Parallelization

SEQUENTIAL。`mind-map.tsx` / `useMindMapSync.ts` / Codex監視仕様docsが同じ表示契約を共有するため、単一チャットで直列実装する。

## Verification

- `npm run test:run -- src/lib/task-progress-source-refresh.test.ts src/components/dashboard/mind-map.test.tsx`

## Result

Turso `task-progress/snapshot` に最近のactiveな `source_type='mindmap'` / `source_id` があり、現在のマップtask stateにそのsource taskが無い場合だけ、マップ画面から `refreshFromServer({ staleMs: 3000, silent: true })` を発火する補完経路を追加した。Supabase Realtime INSERT取りこぼしや直接開始threadの初回取り込み直後でも、Tursoの3秒snapshot pollを起点にチャット取り込み一覧へ反映できる。欠落sourceが無い時はSupabase全件3秒pollへ戻さない。

## Links

- `docs/specs/codex-app-handoff-monitoring/03-backyard-sync-and-turso.md`
- `docs/CONTEXT.md`
