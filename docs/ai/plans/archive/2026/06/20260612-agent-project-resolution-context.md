# Agent Project Resolution And Context Shape

- Task ID: TASK-20260612-011
- Status: completed
- Created: 2026-06-12
- Completed: 2026-06-12
- Board: `docs/ai/task-board.md`

## Goal

通常チャットでユーザーが Focusmap / フォーカスマップ / フォークスマップ のプロジェクトを明示した時に、AIが候補確認だけで止まらず、該当プロジェクトを解決して `getProjectContext` まで読む。

併せて、プロジェクトごとの状況整理を `projects.description` / `project_contexts.details` / `project_contexts.progress` に分け、マインドマップ整理で使いやすい記録型にする。

## Scope

- `src/lib/ai/project-search.ts`
- `src/lib/ai/tools/index.ts`
- `src/app/api/ai/agent/route.ts`
- `src/lib/ai/agent-chat-background.ts`
- `src/components/projects/project-context-dialog.tsx`
- `docs/CONTEXT.md`

## Non-goals

- DB migration は行わない。
- `project_contexts` の既存データ移行は行わない。
- プロジェクトチャット履歴のスコープ設計は変えない。

## Plan

1. プロジェクト検索をかな表記・英字表記・repo_path込みで正規化する。
2. `listProjects` に `resolved_project` を返し、一意強一致なら聞き返さず次ツールへ進ませる。
3. 通常/永続チャットのsystem promptに「一意なら聞き返さず読む」を明記する。
4. プロジェクト状況欄を既存 `project_contexts.progress` としてUIから保存できるようにする。
5. docsとテストを更新する。

## Parallelization

SINGLE_CHAT。AIプロジェクト解決、ツール出力、prompt、UI、docsが同じ契約に依存するため分割しない。

## Verification

- `npm run test:run -- src/lib/ai/project-search.test.ts`
- `npx eslint ...`
- `npx tsc --noEmit --pretty false`

## Result

- `listProjects` がプロジェクト名・説明・purpose・repo_pathを正規化検索し、Focusmap系の日本語/英字別表記から一意候補を `resolved_project` として返すようにした。
- 通常/永続チャットのsystem promptに、一意に解決できたプロジェクトは聞き返さず `getProjectContext` を読むルールを追加した。
- `saveProjectContext` の保存先の役割を、安定概要 / 背景メモ / 状況メモに分けた。
- `ProjectContextDialog` に `状況` と `progress_status` を追加し、既存 `project_contexts.progress` へ保存できるようにした。
- `docs/CONTEXT.md` を更新した。

## Links

- `docs/CONTEXT.md`
