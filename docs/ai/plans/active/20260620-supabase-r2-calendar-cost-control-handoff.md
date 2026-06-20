# Supabase / R2 / Calendar Cost Control Handoff

- Task ID: TASK-20260620-006
- Status: planned
- Created: 2026-06-20
- Completed:
- Board: `docs/ai/task-board.md`

## Goal

Supabase Free枠を確実に守りつつ、カレンダー画面の体感を軽くする。特に、Google Calendar由来の履歴タスク読み取り、画像保存先、DB保持ルール、検証/レビュー手順を実装担当チャットへ安全に引き継げる状態にする。

成功条件:

- カレンダー表示/同期時に `tasks` のGoogle連携全履歴を読まない。
- 現在の実データで `/api/tasks/import-events` の既存タスク読み取り見積もりを約22MB級から1MB未満へ落とす。
- Supabaseの正本は重要構造データに限定し、細かいAI activity/snapshotはTurso、バイナリはR2へ寄せる。
- メモ/タスク添付画像が本当にR2へ移ったか、または残っているSupabase Storage経路を明確に扱う。
- 実装後に親チャットが差分レビューと必要な確認コマンドを実行できる報告形式にする。

## Non-goals

- 本番DBへの手動削除やVACUUMをこの計画だけで実行しない。
- Supabase/Turso/R2のsecret値を表示しない。
- Google Calendar同期方式を最初から全面的に`syncToken`へ置換しない。
- マインドマップ本体の表示/編集ロジックをこのタスクで再設計しない。
- Cloud Runデプロイやpushは、ユーザー明示なしに行わない。

## Current Findings

### Supabase quota / external facts

- Supabase Freeの主な枠はDB 500MB、egress 5GB、Storage 1GB。公式Billing docsとPricingで確認済み。
- Supabase egressは、Database/Auth/StorageなどSupabase外へ出るデータ量。Cloud RunのNext.js APIがSupabaseから読むデータも対象になる。
- Cloudflare R2はStandardで10GB-month、Class A 100万/月、Class B 1000万/月がFree枠で、egress feesなし。
- Google Calendar APIはincremental syncに`syncToken`を使えるが、token失効時は410でfull syncが必要。`syncToken`運用は制約があるため、最初の修正は「既存の過剰DB読み取り削減」に絞る。

Reference:

- https://supabase.com/docs/guides/platform/billing-on-supabase
- https://supabase.com/docs/guides/platform/manage-your-usage/egress
- https://supabase.com/docs/guides/platform/database-size
- https://www.cloudflare.com/products/r2/
- https://developers.cloudflare.com/r2/
- https://developers.google.com/workspace/calendar/api/guides/sync
- https://developers.google.com/workspace/calendar/api/v3/reference/events/list

### Actual production data checked 2026-06-20

- Supabase DB size: 85MB / Free 500MB.
- `public.tasks`: table 39MB + index 16MB = total 55MB, estimated 86,783 rows.
- `source='google_event'` and soft-deleted: 84,787 rows.
- `calendar_events`: total about 1.1MB, 394 rows.
- `mindmap_drafts` / `mindmap_draft_nodes` / `mindmap_draft_history`: tiny compared to `tasks`.
- Realtime publication includes `agent_chat_sessions`, `ai_task_observations`, `ai_tasks`, `mindmap_draft_nodes`, `mindmap_drafts`; it does not include `tasks`.
- Current `/api/tasks/import-events` full existing Google task select estimate:
  - 86,488 rows
  - about 22MB selected payload
- Same selected columns limited to current Today fetch window:
  - 2,405 rows
  - about 628KB selected payload
- Supabase Storage currently still has objects:
  - `task-attachments`: 11 objects, about 1.4MB
  - `ideal-attachments`: 7 objects, about 6.5MB
  - attachment metadata tables currently have 0 rows, so these are likely orphan objects or old rows already deleted.

### Critical code paths

- `src/hooks/useTodayViewLogic.ts`
  - fetch window is currently -7 days to +30 days.
  - `allFetchedEvents` changes trigger `importEvents(allFetchedEvents)`.
- `src/hooks/useCalendarEvents.ts`
  - memory/session/localStorage calendar event cache.
  - cache display TTL 12h, revalidate after 60s.
  - auto-sync while visible defaults to 120s with jitter.
- `src/app/api/calendar/events/list/route.ts`
  - first loads DB cached `calendar_events`.
  - if cache exists and `forceSync=false`, returns cache with `needsRefresh=true`.
  - force sync fetches Google Calendar, upserts `calendar_events`, deletes old cached events older than 30 days.
- `src/app/api/tasks/import-events/route.ts`
  - currently selects all user tasks with non-null `google_event_id`, including deleted rows.
  - then filters in memory to active scope and resurrection candidates.
  - upsert currently uses `.select()` without explicit columns.
- `src/app/api/tasks/[id]/attachments/route.ts` and `src/app/api/wishlist/[id]/attachments/route.ts`
  - still use Supabase Storage buckets `task-attachments` / `ideal-attachments`.
  - max file size is 300KB for current task/wishlist attachment routes.
- `src/app/api/screenshots/route.ts`
  - screenshots use R2 object upload and Turso metadata.
  - original screenshots are rejected; preview max 800KB and thumbnail max 120KB.

## Data Ownership Model

| Data | System of record | Reason | Retention |
|---|---|---|---|
| Google Calendar event title/time/location | Google Calendar | Calendar source of truth | Do not duplicate all history into tasks |
| Visible calendar cache | Supabase `calendar_events` | Fast first paint, server cache | Rolling window, delete old cache |
| User-managed task / mindmap node | Supabase `tasks` | Important product graph and RLS-backed app state | Long-lived until user deletes |
| Calendar event marked as Focusmap task | Supabase `tasks` linked by `google_event_id` | User intent exists | Keep while active; deleted auto-import rows expire |
| Event completion sidecar | Supabase `event_completions` | Focusmap-specific status | Keep compact rows only |
| AI task queue / final state | Supabase `ai_tasks` | Queue, approval, Realtime state | Keep compact final state |
| AI activity / progress / screenshots metadata | Turso | High-frequency details | Retention by Turso policy |
| Screenshots / binary previews | Cloudflare R2 | Cheap object storage, no egress fees | R2 lifecycle/retention |
| Memo/task attachment binaries | Target: R2 | Avoid Supabase Storage growth | Metadata in Supabase, binary in R2 |
| Browser optimistic state/cache | Browser memory/session/localStorage | UI speed only | Not a source of truth |

## Recommended Architecture

### Phase 1: Calendar egress and slowness fix

Keep the current request/response shape of `/api/tasks/import-events`, but change the server-side data access contract.

Required behavior:

1. Do not select all Google-linked tasks for the user.
2. Select active imported tasks only in the import scope:
   - `user_id = user.id`
   - `source = 'google_event'`
   - `deleted_at is null`
   - `calendar_id in incomingCalendarIds`
   - `scheduled_at >= importScopeStart`
   - `scheduled_at < importScopeEnd`
3. Select deleted resurrection candidates only for incoming event keys:
   - `source = 'google_event'`
   - `deleted_at is not null`
   - `calendar_id in incomingCalendarIds`
   - `google_event_id in incomingGoogleEventIds`
4. Keep duplicate cleanup only around incoming IDs and scoped active rows.
5. Use explicit selected columns after upsert instead of `.select()` all columns.
6. Preserve existing response shape:
   - `inserted`
   - `updated`
   - `softDeleted`
   - `skipped`
   - `tasks`
7. Add regression tests proving out-of-window deleted rows are not loaded/reconciled.

Do not add indexes first unless query review shows a real need. Current scale is only about 86k rows. If a composite index is needed later, prefer one targeted index over several speculative indexes.

Candidate index if needed after review:

```sql
CREATE INDEX IF NOT EXISTS idx_tasks_google_event_import_scope
  ON tasks (user_id, calendar_id, scheduled_at)
  WHERE source = 'google_event'
    AND google_event_id IS NOT NULL
    AND deleted_at IS NULL;
```

### Phase 2: Prevent repeated import calls per remount

Current `prevEventIdsRef` only dedupes within the mounted component. A remount can call import again for the same event set.

Recommended minimal approach:

- Add a session/local cache key for `importEvents` keyed by:
  - calendar IDs
  - import window start/end
  - event ID + start/end fingerprint hash
- If the same key was imported in the last 5-10 minutes, skip the POST.
- Manual force sync should bypass this guard.

Acceptance:

- Navigating away and back does not trigger `import-events` repeatedly for identical data.
- Actual changed event time/title/fingerprint still imports.

### Phase 3: Deleted Google-event task retention

Create an explicit dry-run cleanup plan before production deletion.

Suggested policy:

- Auto-imported `source='google_event'` tasks with `deleted_at < now() - interval '60 days'` can be hard-deleted.
- Protect any row that has user-owned content beyond import metadata:
  - attachments
  - linked `ai_tasks`
  - memo/node links, if any
  - non-import source
- First implement dry-run SQL/script that returns count and estimated bytes.
- Only after user approval, run deletion in small batches.
- After large deletion, run/analyze according to Supabase/Postgres safe maintenance practice. Do not run disruptive maintenance without explicit approval.

### Phase 4: R2 attachment migration / confirmation

Screenshots already use R2 + Turso. However task and memo attachments still use Supabase Storage.

Two acceptable implementation choices:

Option A: Explicit migration with provider column

- Add nullable/default metadata field such as `storage_provider`.
- Existing rows default to `supabase`.
- New uploads use `r2`.
- GET/delete branch by provider.
- More correct if historical attachment rows may exist in other environments.

Option B: Switch routes to R2 because production metadata rows are currently zero

- Use existing `storage_path` as R2 key.
- New uploads go to R2.
- GET returns signed R2 URL.
- DELETE removes R2 object and DB row.
- Clean orphan Supabase Storage objects after separate confirmation.
- Lower implementation cost but weaker backward compatibility.

Recommended: Option A if adding a small migration is acceptable; Option B only if the implementation chat confirms production/staging metadata rows are zero and the user wants minimum DB change.

New env proposal:

- `R2_ATTACHMENT_BUCKET`
- fallback to `R2_BUCKET` only for local dev if appropriate
- keep `R2_SCREENSHOT_BUCKET` separate

Do not print secret values. Updating Cloud Run/GitHub secrets is a deployment/config step and should be reported separately.

### Phase 5: Optional later calendar sync-token work

Do not start here unless Phase 1-3 still leave Google Calendar calls heavy.

Future model:

- Store per-calendar sync state.
- Use initial full sync and then `syncToken` for incremental changes.
- Handle `410 Gone` by clearing token and full resyncing that calendar.
- Keep visible-window cache for first paint.
- Continue treating Google Calendar as event truth and Supabase as product-state/cache.

## Parallelization

Decision: `HYBRID_PLAN_THEN_PARALLEL`

Reason:

- Calendar import scope, attachment storage, cleanup policy, and verification are separable, but they share cost/retention intent.
- The first implementation should be Phase 1 calendar import scope because it is highest risk and highest payoff.
- R2 attachment migration can follow after Phase 1 because it touches different routes and likely environment config.
- Production DB cleanup must remain separate and approval-gated.

Recommended execution:

1. Single implementation chat starts with Phase 1 + tests.
2. Return result to parent chat for review.
3. Parent chat reviews diff and runs agreed checks.
4. Then a second implementation chat or same chat continues Phase 2/3/4 depending on results.

Worktree:

- For Phase 1 only, existing `main` worktree is acceptable if clean.
- If implementation chat is not on `main`, it must use existing `main` worktree or create a temporary branch/worktree only if main is unavailable.
- Push is prohibited unless user explicitly requests.

## Implementation Prompt: Phase 1 Calendar

```md
あなたは Focusmap の Backend 実装チャットです。

目的:
Supabase無料枠を守るため、Google Calendarイベント取り込みで `tasks` の全履歴を読まないようにし、カレンダー表示/同期の体感とDB egressを軽くしてください。まず Phase 1 のみ実装します。R2移行や本番DB削除は実装しないでください。

まず読む:
- AGENTS.md
- docs/CONTEXT.md
- docs/ai/plans/active/20260620-supabase-r2-calendar-cost-control-handoff.md
- src/app/api/tasks/import-events/route.ts
- src/hooks/useEventImport.ts
- src/hooks/useTodayViewLogic.ts
- src/hooks/useCalendarEvents.ts
- src/app/api/calendar/events/list/route.ts
- 既存の import-events / calendar 関連テスト

編集してよい範囲:
- src/app/api/tasks/import-events/route.ts
- src/hooks/useEventImport.ts（必要最小限。Phase 2に踏み込むなら事前に理由を書く）
- import-eventsに直接関係するテストファイル
- docs/CONTEXT.md（同期方式・データフローを変えた場合のみ）

編集してはいけない範囲:
- R2 / attachment route
- Supabase migration / production DB cleanup SQL
- src/components/**
- package-lock.json
- secrets / .env*
- docs/ai/task-board.md / docs/ai/task-runs.jsonl / docs/ai/task-archive/** / docs/ai/plans/archive/**

実装制約:
- `/api/tasks/import-events` のrequest/response shapeは維持する。
- 既存Google連携taskの取得で、ユーザーの全履歴を読まない。
- active taskはimport scope内だけ読む。
- deleted resurrection candidateはincoming `calendar_id + google_event_id` に一致するものだけ読む。
- duplicate cleanupはincoming IDsとscope内active rowsに限定する。
- upsert後の `.select()` は必要列だけ明示する。
- 既存の「ユーザー操作直後5分は上書きしない」保護は維持する。
- 既存のstable ID生成とactive一意制約の意味を壊さない。

確認コマンド:
- git status --short --branch
- 関連テストを追加/更新し、可能なら実行する
- 実行したテスト/lint/build/diff checkをすべて報告する
- AGENTS.md上、自動検証はユーザー明示時のみだが、このプロンプトは検証実行を明示している

完了条件:
- 既存全履歴selectが消えている。
- out-of-window deleted google_event taskが通常importで読まれない/復活候補にならないことをテストで固定する。
- incoming IDに一致するdeleted taskは復活候補として扱える。
- response schemaが変わっていない。
- 自分の変更だけcommitする。pushは禁止。

最後に返すこと:
- changed files
- implemented behavior
- test commands and results
- commit hash
- before/afterの想定egress削減説明
- assumptions
- contract deviations
- risks / unresolved items
- staged / unstaged changes
- 親チャットにレビューしてほしい点
```

## Implementation Prompt: Phase 4 R2 Attachments

Phase 1のレビュー後に使う。

```md
あなたは Focusmap の Backend/Storage 実装チャットです。

目的:
メモ/タスク添付画像の新規保存先をSupabase StorageからCloudflare R2へ移し、Supabaseには添付メタデータだけを残す設計へ近づけてください。

まず読む:
- AGENTS.md
- docs/CONTEXT.md
- docs/ai/plans/active/20260620-supabase-r2-calendar-cost-control-handoff.md
- src/lib/r2/client.ts
- src/lib/r2/screenshots.ts
- src/app/api/screenshots/route.ts
- src/app/api/screenshots/[id]/route.ts
- src/app/api/screenshots/[id]/url/route.ts
- src/app/api/tasks/[id]/attachments/route.ts
- src/app/api/tasks/[id]/attachments/[attachmentId]/route.ts
- src/app/api/wishlist/[id]/attachments/route.ts
- src/app/api/wishlist/[id]/attachments/[attachmentId]/route.ts
- attachment route tests

編集してよい範囲:
- src/lib/r2/**
- src/app/api/tasks/[id]/attachments/**
- src/app/api/wishlist/[id]/attachments/**
- attachment route tests
- DB migration only if you choose provider-column design and explain why
- docs/CONTEXT.md if data flow changes

編集してはいけない範囲:
- calendar import logic
- screenshots behavior unless shared R2 helper extraction requires a minimal compatible edit
- unrelated UI components
- production DB cleanup
- secrets / .env*
- package-lock.json unless absolutely necessary and explained

実装制約:
- Secret valuesを表示しない。
- `R2_SCREENSHOT_BUCKET` と添付用bucketは混同しない。必要なら `R2_ATTACHMENT_BUCKET` を導入する。
- Existing prod attachment metadata rows are currently 0, but other envs may differ. Backward compatibility方針を明記する。
- 300KB制限は維持する。
- GETは短期signed URLを返す。1年signed URL保存のような長期URL正本化を避ける。
- DELETEはmetadataとobject削除を整合させる。

確認コマンド:
- attachment route tests
- typecheck/lint relevant files
- git diff --check

完了条件:
- 新規task/wishlist attachment uploadがR2へ行く。
- metadataはSupabaseに残る。
- Supabase Storageへの新規uploadが残っていない。
- 既存/空データケースのGET/DELETEテストがある。
- 自分の変更だけcommitする。pushは禁止。

最後に返すこと:
- changed files
- implemented behavior
- env/config changes needed
- test commands and results
- commit hash
- migration applied? yes/no
- backward compatibility assumptions
- risks / unresolved items
- staged / unstaged changes
```

## Parent Review / Test Workflow

実装チャットから結果が返ったら、親チャットは以下を行う。

1. `git fetch --prune origin`
2. `git status --short --branch`
3. `git worktree list`
4. 実装commit hashを確認する。
5. `git show --stat <hash>` と対象差分を読む。
6. allowed files外の変更、secret、lockfile、unrelated refactorがないか見る。
7. API contractに違反していないか見る。
8. ユーザーの明示依頼に基づいて確認コマンドを実行する。

Recommended Phase 1 checks:

- `npm run test:run -- src/hooks/useEventImport.test.ts <import-events route test if present>`
- `npx eslint src/app/api/tasks/import-events/route.ts <changed test files>`
- `git diff --check`
- Optional read-only Supabase query after implementation is running locally: estimate scoped payload remains under 1MB.

Recommended Phase 4 checks:

- `npm run test:run -- 'src/app/api/tasks/[id]/attachments/route.test.ts' 'src/app/api/wishlist/[id]/attachments/route.test.ts'`
- `npx eslint` on changed R2/attachment files
- `git diff --check`
- Optional local API smoke test only if dev server/auth state is available and user asks.

Completion criteria for parent:

- Worker commit is on local main or ready to integrate into local main.
- All user-approved checks pass or failures are clearly classified.
- `docs/CONTEXT.md` is updated if behavior/data flow changed.
- `docs/ai/task-board.md` and task-run/archive records are finalized by Integration if the implementation task is complete.

## Risks

- Reducing import scope could miss restoring a deleted event if the event moved from far outside the window into the window and only the old deleted row is outside the current scheduled range. Mitigation: resurrection query must key by incoming `calendar_id + google_event_id`, not by old `scheduled_at`.
- Google event IDs can collide across calendars. Use `calendar_id + google_event_id` as the effective key.
- R2 signed URLs do not prove the object exists. Attachment provider/version must be explicit or migration must rely on the fact production metadata rows are zero.
- Deleting soft-deleted Google-event tasks before protecting linked user content could remove meaningful task history. Cleanup must be dry-run and approval-gated.
- Adding indexes improves reads but consumes DB size. Avoid speculative index growth until query shape is fixed.

## Links

- `src/app/api/tasks/import-events/route.ts`
- `src/hooks/useEventImport.ts`
- `src/hooks/useTodayViewLogic.ts`
- `src/hooks/useCalendarEvents.ts`
- `src/app/api/calendar/events/list/route.ts`
- `src/app/api/tasks/[id]/attachments/route.ts`
- `src/app/api/wishlist/[id]/attachments/route.ts`
- `src/app/api/screenshots/route.ts`
- `src/lib/r2/client.ts`
- `src/lib/r2/screenshots.ts`
