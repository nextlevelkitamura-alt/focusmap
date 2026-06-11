# Repo-scoped Codex Chat Import

Date: 2026-06-11
Status: completed
Task: TASK-20260611-013

## Goal

Codex.appで直接開始されたチャットを、プロジェクト単位ではなくリポジトリ単位の未配置Inboxとして見られるようにする。ユーザーは対象リポを切り替え、未配置チャットを現在のマインドマップへドラッグして配置する。配置後は未配置一覧から消える。

## Scope

- マップ右のチャット取り込みサイドバーを「対象リポ」中心に整理する。
- リポフォルダの生パス入力を通常UIから外し、Codex/Focusmap agentが検出したリポ候補とFinder選択を主導線にする。
- 現在プロジェクト外に取り込まれた同一リポの未配置チャットも、選択リポの一覧に表示する。
- チャットを現在マップへdropしたら、既存taskを現在プロジェクトへ移して対象ノード配下へ置く。
- 未配置チャットはサイドバーから削除でき、Undoで戻せる。
- `docs/CONTEXT.md` に新しいリポ単位取り込み仕様を反映する。

## Non-goals

- 新しいDBテーブルやマイグレーションは作らない。
- Codex.appの内部リポ設定を直接読む新連携は今回作らない。
- 既存取り込み済みチャットを自動で複製しない。
- 配置済みチャットを複数プロジェクトへ同時表示する参照リンク機能は今回作らない。

## Acceptance

- 同じ `codex_work_dir` の未配置 `source='codex_app_thread'` task が、現在プロジェクト外のものでもリポ単位サイドバーに出る。
- チャット行を現在マップのノードへdropすると、taskの `project_id` と `parent_task_id` が現在マップへ更新され、一覧から消える。
- チャット行の削除ボタンで一覧から消え、`Cmd+Z` / `Ctrl+Z` の既存Undo経路で復元できる。
- サイドバー通常表示に長いリポパス入力欄を出さない。
- リポ監視ON/OFFは選択リポ単位の表示に寄せる。
- 通常表示ではリポ候補リストと `チャット取り込み` 見出しを出さず、サイドバーを右端へ隙間なく接地してチャット一覧領域を広く使う。

## Verification Plan

- `npm run test:run -- src/components/dashboard/codex-chat-import-sidebar.test.tsx src/components/dashboard/mind-map.test.tsx src/components/mindmap/custom-mind-map-view.test.tsx --test-timeout=30000`
- `npx eslint src/components/dashboard/codex-chat-import-sidebar.tsx src/components/dashboard/codex-chat-import-sidebar.test.tsx src/components/dashboard/mind-map.tsx src/components/dashboard/mind-map.test.tsx src/hooks/useMindMapSync.ts`
- `npx tsc --noEmit --pretty false`
- `git diff --check`
- ローカル `http://localhost:3001/dashboard` のマップ画面でチャット取り込みサイドバーを確認する。
