# 外部AI操作APIとAPI設定画面プラン

- Task ID: TASK-20260617-002
- Status: in_progress
- Created: 2026-06-17
- Completed:
- Board: `docs/ai/task-board.md`

## Goal

Codexなどの外部AIが、Focusmapの主要データを安全に読み書きできるAPIを揃える。対象はマインドマップ、メモ/ノート、プロジェクト概要・進捗、カレンダー予定の作成・移動・編集・削除。

同時に、設定画面でAPIキー発行、権限選択、接続手順、AIへ渡すプロンプトをコピーできる状態にする。ユーザー確認後、実装、確認、local mainへの取り込み、明示承認後のpush/本番反映まで進める。

## Current State

- APIキー基盤は既にある。`/api/v1/api-keys` がCookie認証でキーを発行し、`api_keys.key_hash` にSHA-256 hashだけを保存する。
- 既存のAPIキーprefixは `sk_shikumika_`。設定画面やMCPガイドにもShikimika表記が残っている。
- `/api/v1/tasks`、`/api/v1/projects`、`/api/v1/notes`、`/api/v1/calendar/events` はあるが、カレンダーv1は読み取りのみ。
- Cookie認証側には、プロジェクト更新、メモ作成、マインドマップ下書き/確定、カレンダー予定更新・移動の実装が既にある。
- 内部AIツールには `updateProject`、`bulkAddMemos`、`saveMindmapDraft`、`updateMindmapNode`、`moveMindmapNode`、`addMindmapTask`、`updateCalendarEvent` などが揃っている。
- 現行仕様では、AIによる大きなマップ変更は本番 `tasks` 直書きではなく、`mindmap_drafts` に保存して `apply` で確定するのが正。
- メモUIの正本は主に `ideal_goals` と `memo_items`。既存 `/api/v1/notes` は旧 `notes` テーブル向けなので、現行メモ画面へ即時に出したい用途には不足する。

## Current Verification 2026-06-17

ユーザーの期待は「APIキーと接続promptを外部AIへ渡すと、AIがスペース/プロジェクト/メモ/マップ概要を読み、マインドマップを整理し、必要なノード・メモ・予定を書き込める」状態。現時点の実装はそこまで到達していない。

HTTP smoke は `npm run dev:desktop` で `http://localhost:3001` を起動して実行した。

- `GET /api/v1/projects?limit=1` は認証なしで401、旧prefixの偽キーで401 `Invalid API key`。v1の認証routeとservice role DB照会には到達している。
- `GET /api/v1/projects?limit=1` に新prefix `sk_focusmap_...` を渡すと401 `Invalid API key format`。新prefix発行/認証は未実装。
- `GET /api/v1/calendar/events?limit=1` は旧prefixの偽キーで401 `Invalid API key`。読み取りrouteは存在する。
- `GET /api/v1/capabilities` と `GET /api/v1/bootstrap` は404。AI向けdiscover/bootstrapは未実装。
- `GET /api/v1/mindmap/overview?project_id=...`、`POST /api/v1/memos`、`POST /api/v1/ai/actions` は404。マップ/現行メモ/batch actionのv1入口は未実装。
- `POST /api/v1/calendar/events` は405、`PATCH /api/v1/calendar/events/{id}` は404。v1カレンダー書き込み口は未実装。
- `npm run test:run -- 'src/app/api/calendar/events/[eventId]/route.test.ts' 'src/app/api/wishlist/[id]/calendar/route.test.ts'` は4 tests passed。Cookie認証側のカレンダー移動・メモ予定化ロジックは通っているが、APIキー認証のv1へはまだ露出していない。

結論: 現行v1 APIは、旧APIキーprefixで限定的に `tasks/projects/spaces/notes/calendar read` を使うための土台に留まる。外部AIへ渡してすぐに「プロジェクト理解 -> マインドマップ整理 -> draft保存/確定 -> メモ追加 -> 予定移動」まで任せるには、この計画のBackend API、scope、設定UI、promptを実装する必要がある。

## Implementation Progress 2026-06-17

同一チャットで直列実装した。大きなマップ整理は `draft-first` を正とし、単発ノード操作だけdirect APIを許可する。

- APIキーprefixを `sk_focusmap_` へ変更し、旧 `sk_shikumika_` は認証互換として継続した。
- scope/presetを追加した。既定は `AI整理用` で、`AI実行用` はプロジェクト文脈、メモ、マップ確定/単発ノード、カレンダー書き込みまで許可する。
- `GET /api/v1/capabilities` と `GET /api/v1/bootstrap` を追加した。
- `GET/PATCH /api/v1/projects/[id]` と `GET/PUT /api/v1/projects/[id]/context` を追加し、`GET /api/v1/projects` は検索と `context_summary` 付き取得に拡張した。
- `GET/POST/PATCH/DELETE /api/v1/memos` を追加し、現行メモ画面の正本である `ideal_goals` と `memo_items` を対象にした。
- `GET /api/v1/mindmap/overview`、`POST/GET /api/v1/mindmap/drafts`、`POST /api/v1/mindmap/drafts/[draftId]/nodes`、`apply`、`undo/redo` を追加し、既存 `mindmap_drafts` サービスへ接続した。
- `POST /api/v1/mindmap/nodes` と `PATCH/DELETE /api/v1/mindmap/nodes/[id]` を追加した。大きな再編では使わず、単発の小さな追加・修正用に限定する。
- `GET /api/v1/calendar/events` は `google_event_id` を返すようにし、`POST /api/v1/calendar/events`、`PATCH/DELETE /api/v1/calendar/events/[eventId]`、`POST /api/v1/calendar/events/[eventId]/move` を追加した。Google Calendar更新、`calendar_events` cache、関連 `tasks` / `ideal_goals` を同期する。
- `POST /api/v1/ai/actions` を追加した。最大10件のv1 subrequestを同じAPIキーで順番に実行するbatch gatewayで、各subrequestの既存scopeチェックをそのまま使う。
- 設定画面のAPIキー発行にpreset選択を追加し、作成後dialogと外部AI連携ガイドにコピー用prompt、主要endpoint、予定移動例を追加した。
- `docs/CONTEXT.md` へ外部AI/APIキー経由の正本routeとdraft-first方針を追記した。

残る改善:

- `X-Focusmap-Idempotency-Key` はmetadata/batch転送として受け取るが、全write APIで厳密な replay 防止をする専用テーブルはまだ無い。
- `memo_items` の専用作成routeと `memos/[id]/link-task` wrapper は未追加。現時点では `POST /api/v1/memos` の `subtask_suggestions` と既存マップdraftの `source_links` を使う。
- `/api/v1/openapi.json` は未追加。現時点の外部AI向けdiscoverは `/api/v1/capabilities` と設定画面ガイドを正にする。

## Scope

### In

- API scope追加と既存scopeの整理。
- APIキーprefixのFocusmap化。旧 `sk_shikumika_` は互換として認証だけ継続する。
- AI向けbootstrap/capabilities API。
- プロジェクト読み書きとプロジェクトcontext読み書きAPI。
- 現行メモUIに反映されるメモAPI。
- マインドマップoverview、draft保存、draft node更新、apply、undo/redo、簡易direct node操作API。
- カレンダー予定の作成、更新、移動、削除API。
- AIが複数操作を少ない往復で実行するためのbatch action API。
- 設定画面のAPIキー発行UI、scope preset、コピー可能なAIプロンプト、curl/OpenAPI導線。
- 仕様変更に伴う `docs/CONTEXT.md` と関連spec更新。

### Out

- 本番DBへ手動で直接変更する作業。
- AIプロバイダ課金やBYOK課金の設計変更。
- Windows/PWA配布やMac agentの常駐方式変更。
- MCPサーバーパッケージの公開。今回はまずREST APIとプロンプト/設定ガイドを正にする。

## Acceptance Criteria

- APIキーだけで、外部AIが次を実行できる。
  - プロジェクト一覧取得、対象プロジェクト解決、概要/進捗更新。
  - メモ追加、メモ更新、メモをマップ候補に紐づけ。
  - マップoverview取得、AI案draft保存、draft確定、undo/redo。
  - 小さなノード追加・移動・メモ更新をdirect APIで実行。
  - カレンダー予定の作成・時刻変更・カレンダー間移動・削除。
- 大きなマップ再編はdraft-firstがデフォルトで、本番 `tasks` 直書きは明示的なdirect endpointだけに限定される。
- 空メモ/空ノートは作れない。`title` または `body` のどちらかが必須で、`title` 未指定なら本文先頭からサーバー側で短いtitleを作る。
- カレンダー書き込みは書き込み可能カレンダーだけに限定され、閲覧専用カレンダーは403を返す。
- mutating APIは `X-Focusmap-Idempotency-Key` に対応し、AIのリトライで重複作成しにくい。
- 設定画面から「Codexに渡すプロンプト」をコピーすると、AIが迷わず `projects -> mindmap overview -> draft save -> apply` の順で実行できる。
- 実装後の完了報告では `local main / origin/main / production` の反映状態を分けて報告する。

## API Contract

### Auth / Scopes

- 認証: `Authorization: Bearer <api_key>`。
- 新規発行prefix: `sk_focusmap_`。
- 互換: 既存 `sk_shikumika_` は引き続き受け付ける。
- 追加scope:
  - `mindmap:read`
  - `mindmap:write`
  - `mindmap:drafts`
  - `memos:read`
  - `memos:write`
  - `calendar:write`
  - `project:context:read`
  - `project:context:write`
  - `ai:actions`
- 互換scope:
  - `notes:read` は `memos:read` のaliasとして扱う。
  - `notes:write` は `memos:write` のaliasとして扱う。
  - 既存 `projects:read/write` はプロジェクト本体に使い、contextは新scopeまたは `projects:write` のany-ofで段階移行する。

### Common Response

```json
{
  "success": true,
  "data": {},
  "meta": {
    "request_id": "uuid",
    "changed_resources": ["tasks", "mindmap_drafts"],
    "idempotent_replay": false
  }
}
```

エラーは既存 `apiError(code, message, status)` に揃える。AIが復旧判断しやすいように `VALIDATION_ERROR`、`NOT_FOUND`、`READ_ONLY_CALENDAR`、`MISSING_SCOPE`、`CONFLICT` を明示する。

### Discovery

- `GET /api/v1/capabilities`
  - 利用可能endpoint、必要scope、推奨操作順、バージョンを返す。
- `GET /api/v1/bootstrap`
  - user timezone、spaces、recent projects、selected calendars、default calendar、API prompt snippetsを返す。

### Projects

- `GET /api/v1/projects`
  - 既存routeを拡張し、`description`、`repo_path`、`context_summary` を返す。
- `GET /api/v1/projects/[id]`
- `PATCH /api/v1/projects/[id]`
  - `title`、`description`、`status`、`priority`、`category_tag`、`color_theme`、`repo_path`。
- `GET /api/v1/projects/[id]/context`
- `PUT /api/v1/projects/[id]/context`
  - `project_contexts.heading/details/progress/progress_status` と `projects.description` を更新可能にする。

### Memos / Notes

- `GET /api/v1/memos`
  - `ideal_goals` と `memo_items` をAI向けに統一して返す。
  - query: `project_id`、`status`、`q`、`include_completed`、`include_mapped`、`limit`。
- `POST /api/v1/memos`
  - 保存先は現行メモ画面の正本である `ideal_goals`。
  - body: `title?`、`body?`、`project_id?`、`duration_minutes?`、`tags?`、`scheduled_at?`、`subtask_suggestions?`、`source_context?`。
  - `title` と `body` が両方空なら400。
  - `title` が空なら `body` 先頭から最大80字のtitleを生成する。
- `PATCH /api/v1/memos/[id]`
- `DELETE /api/v1/memos/[id]`
- `POST /api/v1/memos/[id]/link-task`
  - 既存 `memo_items/[id]/link-task` 相当をAPIキー認証で使えるようにする。
- `POST /api/v1/memo-items`
  - 構造化済みの小項目を追加する。AIがメモを「見出し/作業候補/質問/決定」に分けた時に使う。

### Mindmap

- `GET /api/v1/mindmap/overview?project_id=...`
  - 内部 `getMindmapOverview` 相当。
- `POST /api/v1/mindmap/drafts`
  - 内部 `replaceActiveMindmapDraft` 相当。
  - 大きな整理、複数ノード追加、既存ノード移動はここを使う。
- `POST /api/v1/mindmap/drafts/[draftId]/nodes`
  - draft上の手動/AI追加調整。
- `POST /api/v1/mindmap/drafts/[draftId]/apply`
- `POST /api/v1/mindmap/draft-history/[historyId]/undo`
- `POST /api/v1/mindmap/draft-history/[historyId]/redo`
- `POST /api/v1/mindmap/nodes`
  - 小さなdirect追加用。body: `project_id`、`parent_task_id?`、`title`、`memo?`、`is_group?`、`order_index?`、`source_links?`。
- `PATCH /api/v1/mindmap/nodes/[id]`
  - `title`、`memo`、`status`、`stage`、`priority`、`scheduled_at`、`estimated_time`、`calendar_id`、`parent_task_id`、`project_id`、`order_index`。
- `DELETE /api/v1/mindmap/nodes/[id]`
  - soft delete。子ノード削除範囲は既存仕様に合わせ、危険なら `delete_children=true` を必須にする。

### Calendar

- `GET /api/v1/calendar/events`
  - 既存route。
- `POST /api/v1/calendar/events`
  - Google Calendar作成と `calendar_events` cache保存。
- `PATCH /api/v1/calendar/events/[googleEventId]`
  - title/description/location/start/end/duration/reminders更新。
  - `destination_calendar_id` 指定でカレンダー間move。
  - 関連 `tasks` と `ideal_goals` も更新する。
- `DELETE /api/v1/calendar/events/[googleEventId]`
  - Google Calendar削除、cache削除、関連task/memo状態更新。
- `POST /api/v1/calendar/events/[googleEventId]/move`
  - `PATCH` の薄いalias。AIが「移動」だけを意図した時の明快な入口。

### Batch Action

- `POST /api/v1/ai/actions`
  - scope: `ai:actions`。
  - body: `{ stop_on_error?: boolean, actions: [{ method, path, body?, idempotency_key? }] }`。
  - path は `/api/v1/` 配下だけ許可し、`/api/v1/ai/actions` 自身の再帰呼び出しは拒否する。
  - 1リクエスト最大10操作。
  - 失敗時は全体transactionにしない。`results[]` に各operationの成功/失敗を返し、AIが再試行しやすい形にする。

## Settings UI

対象: `src/components/settings/api-key-settings.tsx`、`api-key-create-dialog.tsx`、`api-key-mcp-guide.tsx`。

- 表記をFocusmapへ更新する。
- APIキー作成時にpresetを選べるようにする。
  - `読み取りのみ`
  - `AI整理用`。read + memos write + mindmap drafts。
  - `AI実行用`。AI整理用 + direct mindmap write + project context write。
  - `フル操作`。AI実行用 + calendar write + ai actions。
- scope一覧はカテゴリ別にまとめ、危険度が高いものは説明文を付ける。
- 作成後の表示dialogに次を出す。
  - API key。
  - base URL。
  - Codex/Claude/Geminiに渡すプロンプト。
  - 主要endpointと最短操作例。
- `ApiKeyMcpGuide` は「MCP連携ガイド」から「外部AI連携ガイド」へ広げる。
- API referenceは最初は画面内の主要endpoint表でよい。余裕があれば `/api/v1/openapi.json` を追加してリンクする。

## AI Prompt Design

設定画面にコピー用として置く推奨プロンプト。

```text
あなたはFocusmapを操作できます。Base URLは https://focusmap-official.com です。
Authorization: Bearer <FOCUSMAP_API_KEY> を付けて /api/v1 を呼びます。

最初に GET /api/v1/bootstrap を呼び、プロジェクト、カレンダー、利用可能scopeを確認してください。
プロジェクト名が曖昧なら GET /api/v1/projects?q=... で候補を確認してください。

マインドマップを大きく整理するときは、本番tasksを直接変更せず、必ず
POST /api/v1/mindmap/drafts でAI案を保存してください。
ユーザーが「確定して」と言ったときだけ POST /api/v1/mindmap/drafts/{draftId}/apply を呼びます。

小さな追加だけなら POST /api/v1/mindmap/nodes を使えます。
メモ追加は POST /api/v1/memos を使い、title/bodyの両方を空にしないでください。
カレンダー予定を動かす時は GET /api/v1/calendar/events で対象を確認してから
PATCH /api/v1/calendar/events/{googleEventId} を使ってください。
複数操作をまとめたい時は POST /api/v1/ai/actions を使えます。

各書き込みリクエストには、可能なら X-Focusmap-Idempotency-Key を付けてください。
削除や大きな変更は実行前にユーザーへ確認してください。
```

## Implementation Plan

### Phase 1: Contract / Shared Services

1. `docs/specs/external-ai-action-api/requirements.md` と `delivery-plan.md` を作る。
2. `src/lib/api-scopes.ts` に新scopeとpresetを追加する。
3. `src/lib/api-key.ts` を `sk_focusmap_` 発行に変え、認証は旧prefixも受ける。
4. カレンダー更新・削除・移動ロジックをCookie routeとv1 routeで共有できるserviceへ切り出す。
5. メモ作成・更新、マインドマップdraft保存、node direct操作のservice境界を決める。

### Phase 2: Backend API

1. `GET /api/v1/capabilities`、`GET /api/v1/bootstrap`。
2. `GET/PATCH /api/v1/projects/[id]` と `GET/PUT /api/v1/projects/[id]/context`。
3. `GET/POST/PATCH/DELETE /api/v1/memos` と `memo-items` wrapper。
4. `GET /api/v1/mindmap/overview`、draft/apply/undo/redo、direct node endpoints。
5. `POST/PATCH/DELETE /api/v1/calendar/events`。
6. `POST /api/v1/ai/actions` batch。

### Phase 3: Settings UI

1. APIキー画面のFocusmap表記・preset・scopeカテゴリ。
2. 作成後dialogに接続prompt、curl、base URLを表示。
3. 外部AI連携ガイドに「最短でマップにメモを追加する」「AI案を保存する」「予定を移動する」の3サンプルを追加。

### Phase 4: Realtime / Cache

1. API経由の `ideal_goals`、`memo_items`、`tasks`、`mindmap_drafts`、`calendar_events` 更新が、開いているUIに反映されるか確認する。
2. Realtimeで拾えない画面は、既存cache invalidationまたは軽量pollを追加する。
3. responseの `changed_resources` とUI側の再取得対象を揃える。

### Phase 5: Docs / Tests / Release

1. `docs/CONTEXT.md` に外部AI APIの正本を追記する。
2. API route/serviceのfocused testsを追加する。
3. ユーザーが明示した場合だけ `npm run test:run`、`npm run lint`、`npm run build`、curl、Browser確認を実行する。
4. ユーザー確認後にlocal mainへ取り込み、commitする。
5. pushと本番反映は別ゲート。`git push origin main` の明示承認後、GitHub Actions/Cloud Run反映を確認する。

## Parallelization

判断: `HYBRID_PLAN_THEN_PARALLEL`

理由:
- API contract、scope、メモ保存先、draft-first方針を先に固めないと、BackendとUIが別解釈で進みやすい。
- 契約後はBackend API、Settings UI、Docs/Testsを比較的分けられる。
- カレンダー更新serviceとマップdraft serviceは既存実装との結合が強いので、Backend内は順次実装が安全。

推奨worktree:
- Planner/Integration: current `main` worktree。記録ファイルとdocsを担当。
- Backend: `codex/external-ai-action-api-backend`。`src/app/api/v1/**`、`src/lib/api-*.ts`、shared services、route tests。
- Frontend: `codex/external-ai-action-api-settings`。`src/components/settings/**`、必要な型だけ。
- Docs/Review: 同一チャットまたはIntegrationが最後に担当。`docs/CONTEXT.md`、`docs/specs/external-ai-action-api/**`。

## Worker Prompts

### Backend Codex

目的: 外部AI操作APIのBackendを実装する。

まず読む:
- `AGENTS.md`
- `docs/CONTEXT.md`
- `docs/ai/plans/active/20260617-external-ai-action-api.md`
- `src/app/api/v1/_lib/auth.ts`
- `src/lib/api-scopes.ts`
- `src/lib/mindmap-draft-service.ts`
- `src/lib/ai/tools/index.ts`

編集してよい範囲:
- `src/app/api/v1/**`
- `src/lib/api-*.ts`
- 新規shared service
- route/service tests
- 必要な `src/types/**`

編集してはいけない範囲:
- `src/components/**`
- `desktop/**`
- `mobile/**`
- secrets / `.env*`
- docs/ai記録ファイル

完了条件:
- v1 APIが計画の主要操作を満たす。
- scopeチェックとuser_id境界がある。
- 空メモ拒否、read-only calendar拒否、draft-first導線がある。
- 明示された確認コマンドを実行した場合は結果を報告し、pushしない。

### Frontend Codex

目的: APIキー設定画面に外部AI連携の実用導線を追加する。

まず読む:
- `AGENTS.md`
- `docs/CONTEXT.md`
- `docs/ai/plans/active/20260617-external-ai-action-api.md`
- `src/components/settings/api-key-settings.tsx`
- `src/components/settings/api-key-create-dialog.tsx`
- `src/components/settings/api-key-mcp-guide.tsx`
- `src/lib/api-scopes.ts`

編集してよい範囲:
- `src/components/settings/**`
- `src/types/api-key.ts`
- 設定UIに必要な小さなhelper

編集してはいけない範囲:
- `src/app/api/**`
- DB migrations
- docs/ai記録ファイル

完了条件:
- Focusmap表記になっている。
- presetでscopeを選べる。
- APIキー作成後に接続prompt/curl/base URLをコピーできる。
- モバイルでもdialog内テキストが破綻しない。

### Integration Codex

目的: Backend/UI/Docsを統合し、リリース判断できる状態にする。

まず読む:
- Backend/Frontendの完了報告
- `docs/ai/plans/active/20260617-external-ai-action-api.md`
- `docs/CONTEXT.md`

やること:
1. allowed files外の変更がないか確認する。
2. API contractと設定画面promptが一致しているか確認する。
3. `docs/CONTEXT.md` と `docs/specs/external-ai-action-api/**` を最終更新する。
4. 明示された確認だけ実行する。
5. local main取り込み前にユーザー確認を取る。

## Verification Plan

自動検証はユーザー明示後だけ実行する。

必要なら実行する確認:
- `npm run test:run -- <追加したroute/service/UI tests>`
- `npm run lint -- <touched files>`
- `npm run build`
- `curl` で `/api/v1/capabilities`、`/api/v1/bootstrap`、代表write APIをローカル3001に対して確認。
- 設定画面は `http://localhost:3001/dashboard/settings` をBrowserで確認。

## Release Plan

1. このプランをユーザー確認。
2. 契約ファイル作成。
3. Backend実装。
4. Settings UI実装。
5. Integrationで差分確認。
6. ユーザー確認後、local mainへ取り込み・commit。
7. push承認があれば `git push origin main`。
8. GitHub ActionsのCloud Run deploy確認。
9. 本番で設定画面、APIキー発行、代表APIを確認。

反映状態の報告形式:

```text
local main: 取り込み済み / origin/main: 未push / production: 未反映
```

## Open Questions

1. 外部AIに本番マップdirect writeをどこまで許可するか。
   - 推奨: 大きい整理はdraft-only。小さい追加/単一ノード更新だけdirect許可。
2. APIキーの既定preset。
   - 推奨: 新規作成の初期値は `AI整理用`。calendar writeとdirect writeは明示ON。
3. `notes:*` scopeを残す期間。
   - 推奨: 互換のため残す。UI表示は `メモ/ノート` に変える。
4. batch APIを初回に入れるか。
   - 推奨: 入れる。AIの往復回数を減らし、idempotencyを1か所で扱えるため。
