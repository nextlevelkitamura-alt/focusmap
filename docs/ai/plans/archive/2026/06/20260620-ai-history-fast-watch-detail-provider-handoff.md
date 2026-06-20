# AI History Fast Watch / Detail Hydrate / Provider Adapter Handoff

- Task ID: TASK-20260620-005
- Status: completed
- Created: 2026-06-20
- Completed: 2026-06-20
- Board: `docs/ai/task-board.md`
- Parent plan: `docs/ai/plans/archive/2026/06/20260620-ai-history-sync-foundation.md`
- Routing decision: HYBRID_PLAN_THEN_PARALLEL

## Goal

AI履歴同期基盤の次フェーズとして、以下を実装できる状態にする。

- 古いCodexチャットを再開した時も、直近/表示中の履歴はローカル2秒以内、cloud/UI 3-4秒以内で `running` / `awaiting_approval` / `needs_input` へ反映する。
- `linked_ai_task_id` が無い未配置履歴でも、ユーザーpromptとCodexの表示用回答/結論を detail open 時に表示できるようにする。
- raw rollout / full messages / command output をcloudへ常時保存せず、表示用にsanitizeしたdetail cacheだけを差分保存する。
- Codex.app固定の監視を、Claude Code / Antigravity / 将来IDE agentへ広げられる provider adapter 境界へ段階移行する。
- Macアプリ再インストールを減らすため、agent capability / version / source をheartbeatで可視化し、将来の外部agent self-updateへつなげる。

## Current Facts

### CPU修正後の再開検知

- 既に監視対象の `ai_task` に紐づくCodex threadは、Codex SQLite rowのfingerprintが変われば次のmonitor tickでrolloutを再読込する。既存tasks配列内なら概ね1秒、監視対象一覧の再取得が必要なら最大3秒程度。
- rowが変わらずrollout JSONLだけが更新された場合、現行fingerprintでは検知できない。古い/stale running や awaiting_approval は次のrollout再読込まで最大30秒になり得る。
- 現行コードでは `threadRolloutFingerprint()` がDB row由来で、rollout file statを含まない。
- 手元のCodex DBサンプルでは rollout mtime が `threads.updated_at_ms` より最大約9.9秒新しい行があり、DB rowだけに頼る設計は弱い。

### `linked_ai_task_id` が無い履歴

これはCodex側に履歴が無い状態ではなく、Focusmapの `ai_tasks` に未接続なだけ。

主なケース:

- Codex.appで直接始めたチャット。
- Focusmap manual handoffだが、cwd / prompt / 時刻照合が合わなかったチャット。
- metadata-only import済みだが、既存 `ai_tasks.codex_thread_id` と未照合のチャット。
- 旧 import / backfill 由来で `ai_history_items.linked_ai_task_id` が埋まっていないチャット。

現行 `/api/ai-history/[id]/activity` は、未リンク時に `202 hydrate_required` と空messagesを返すだけで、実際のhydrate実装はまだ無い。UIはsnippet fallbackを表示するため、prompt/回答/結論の表示は保証されない。

### Multi-provider readiness

強い点:

- `ai_history_items` は `provider + external_thread_id + repo_path` でuniqueになっており、Codex以外の履歴も同じ表へ載せられる。
- `project_repo_scopes` も `provider` と `settings_json` を持つ。
- metadata-only payloadの禁止キーにより、raw log / full messages / screenshot body の混入を抑制できる。

弱い点:

- `batch-upsert` のrunner executor allowlist、`ai_tasks.codex_thread_id` 照合、heartbeat metadata、UI名、agent monitorがCodex固定。
- `scripts/focusmap-agent/src/codex-thread-monitor.ts` がCodex SQLite / rollout JSONL / `codex_*` resultを全て抱えている。
- providerごとに1秒loopを増やすとCPU/Turso writeが膨らむ。共通schedulerで制御する必要がある。

## Non-goals

- full chat body / raw rollout / raw command output のcloud常時保存。
- 未配置履歴を自動で `tasks` ノード化すること。
- Provider adapter導入と同時にClaude / Antigravity executionまで完成させること。
- Macアプリ自体の配布/署名/notarization刷新。
- すべての過去履歴を1秒監視すること。

## Parallelization

判定: HYBRID_PLAN_THEN_PARALLEL

理由:

- DB/API schemaはAgentとFrontendの共通契約なので、最初にBackend/APIを直列で固める。
- Backend契約が固まった後、Agent fast-watch/hydrate と Frontend detail UI は編集範囲が分かれるため並列可。
- Provider adapter foundationは `codex-thread-monitor.ts` の中核を触るため、fast-watch/hydrateと同時並列にしない。
- Mac agent self-updateは `desktop/focusmap-mac/**` と配布導線を触る別リスクなので、provider capability heartbeat後の別フェーズにする。

推奨順:

1. Backend/API Contract: detail cache schema/APIを実装してcontractを固定。
2. Agent Fast Watch + Hydrate: local stat fast-watchとdetail hydrate POSTを実装。
3. Frontend Detail UX: cache表示、更新中状態、hydrate pollingを実装。
4. Integration: 1-3を統合し、latency/write budget/detail表示を検証。
5. Provider Adapter Foundation: 共通scheduler/adapter registryへ挙動不変で分割。
6. Mac Agent Update Strategy: heartbeat capability/version/sourceと外部agent更新計画を実装/文書化。

## Progress

| Area | Owner | Status | Branch / Worktree | Done when | Notes |
|---|---|---|---|---|---|
| Backend/API detail cache | Backend Codex | completed | `feat/ai-history-detail-cache-backend` | detail cache migration/API/test committed | `a3bda68e` / `dabbf232` をlocal mainへ統合 |
| Agent fast-watch + hydrate | Agent Codex | completed | `feat/ai-history-fast-watch-agent` | top-N resume <=2s local設計/test committed | `0fcb9f43` をlocal mainへ統合 |
| Frontend detail UX | Frontend Codex | completed | `feat/ai-history-detail-frontend` | 未リンクdetailでもprompt/回答表示、更新中UI/test committed | `1d143627` をlocal mainへ統合 |
| Integration | Integration Codex | completed | `main` | 全commit統合、検証、docs更新 | `20260620-1410-ai-history-fast-watch-detail-integration` runで完了 |
| Provider adapter foundation | Agent/Architecture Codex | follow_up | separate phase | 挙動不変でCodex adapter分離 | 今回の4commit統合には含めない |
| Mac agent update strategy | Desktop/Agent Codex | follow_up | separate phase | heartbeat capability/version/source、self-update計画 | 今回の4commit統合には含めない |

## Contracts

### Fast-watch contract

目的はCPUを戻さず、使う可能性が高い履歴だけ高速化すること。

対象:

- 現在開いているdetail item。
- 各enabled repoの直近8-10件。
- `running` / `awaiting_approval` / `needs_input` の履歴。
- 直近5分以内にクリック/開封された履歴。
- 既存 `ai_tasks` に紐づくactive monitor対象。

動作:

- fast-watch対象はrollout fileの `mtime/size` を1秒ごとにstatする。
- mtime/sizeが変わった時だけrollout本文を読み、status/activity差分をparseする。
- 既存の30秒TTL cacheに阻まれないよう、cacheへ `watchTier` または `lastInspectAt` を持たせる。
- cloud writeは既存hash/dedupeを通す。状態変化、archive変化、title/snippet/status、meaningful activityだけPOSTする。
- durationだけの時計進行や同一hashはcloudへ送らない。

Acceptance:

- top 8-10 / detail表示中の古いCodex threadへpromptを追加した時、rollout mtimeが動けばlocal状態検知は2秒以内。
- cloud/UI反映は通常3-4秒以内。
- top外の古い履歴は既存30秒/巡回fallbackでよい。
- fast-watch有効時もTursoへ毎秒writeしない。

### Detail hydrate contract

一覧はmetadata-onlyのままにする。本文表示はdetail openとfast-watch差分に限定する。

推奨DB:

```text
ai_history_detail_messages
- id
- user_id
- history_item_id
- provider
- external_thread_id
- repo_path
- sequence
- role                  user | assistant | system
- kind                  user_prompt | assistant_answer | assistant_question | status | summary
- body                  sanitized display body, capped
- body_hash
- occurred_at nullable
- metadata_json nullable
- created_at
- updated_at

unique(user_id, history_item_id, sequence, body_hash)
index(user_id, history_item_id, sequence)
index(user_id, provider, external_thread_id, repo_path)
```

保存するもの:

- ユーザーが送ったprompt。
- Codexの表示用回答、質問、確認待ち内容、完了要約。
- 1件あたり上限8,000文字程度。
- appshot、AGENTS/system/developer文脈、tool raw output、file pathの大量列挙はsanitizeする。

保存しないもの:

- raw rollout JSONL全文。
- full thread historyの常時同期。
- command output、screenshots/base64、secrets/env。

API:

- `GET /api/ai-history/[id]`: `detail.hydrateRequired`、`detail.detailSyncedAt`、`detail.messageCount` を返す。
- `GET /api/ai-history/[id]/activity`: linked itemなら既存 `/api/ai-tasks/[id]/activity` へredirect。未リンクならdetail cacheを返す。cacheが空/古い場合は `hydrate.required=true` を返す。
- `POST /api/agents/ai-history/[id]/activity` または batch endpoint: agentがsanitize済みdetail messagesを差分upsertする。

UI:

- cacheがあれば即表示する。
- cacheが古い/空なら「更新中」状態を表示し、open detailだけ短周期pollする。
- Mac/agentがofflineなら過去cacheを表示し、更新不能であることを小さく示す。

### Provider adapter contract

最初は挙動不変の分割を優先する。

```ts
type AgentProviderId = 'codex_app' | 'claude_code' | 'antigravity' | string

interface AgentProviderAdapter {
  id: AgentProviderId
  label: string
  detect(): Promise<ProviderCapability>
  listScopes(ctx): Promise<ProviderScope[]>
  hotSync(ctx): Promise<NormalizedHistoryItem[]>
  reconcile(ctx, scope: ProviderScope): Promise<NormalizedHistoryItem[]>
  hydrateDetail?(ctx, item): Promise<ProviderActivityMessage[]>
  startExecution?(ctx, task): Promise<ExecutionResult>
  openExternalThread?(item): string | null
}
```

責務:

- 共通scheduler: interval、backoff、hash dedupe、batch upsert、heartbeat、write budget、scope queue。
- provider adapter: ローカル履歴発見、独自DB/log/RPC parse、status変換、title/snippet、detail hydrate、外部URL。
- server API: provider-agnostic metadata保存、scope保存、detail hydrate、runner権限。
- Codex互換層: `codex_thread_id`、`codexOpenUrl`、`codex_*` resultは当面残し、Codex adapter内へ閉じる。

Claude Code:

- 公式hooks/monitoringが使える場合は、private file scrapeよりlifecycle event/usage eventを優先する。
- 最初はmetadata-only importから開始し、execution/detail hydrateは後段。

Antigravity:

- 公式docs/SDKはintegration候補。ローカル履歴/event sourceはadapter実装前に確認する。
- 最初からCodexと同じローカルDB/rolloutがある前提にしない。

### Mac agent update strategy

- Web UI/API/provider表示名/scope設定はCloud Run deployで反映できる。
- 新provider adapter、ローカルparser、monitor loop、capability検出、executor追加はMac agent更新が必要。
- Electron bridgeや起動権限を変える場合だけMac app更新が必要。
- heartbeatに `agentVersion`、`adapterVersions`、`capabilities`、`agentSource=bundled|external`、`agentHash` を載せる。
- 将来は `~/.focusmap/agent` の外部agentを優先起動し、signed manifest / version / hash でself-updateする。同梱agentはfallback。

### Turso budget guard

- local scanは高頻度でよいが、Turso writeはhash変化/状態変化だけ。
- running durationだけの更新は最大60秒に1回程度。
- heartbeatはactive 5秒、idle 30秒程度。
- detail messagesは開いた履歴/fast-watchで変化した履歴だけ保存。
- counts aggregateはrows readを増やすため、履歴が増えたらmaterialized countersまたは低頻度再取得を検討する。

## Worktree Plan

他チャットで並列実装する場合は、原則 `1チャット = 1 worktree = 1 branch` にする。同じ `main` worktreeを複数実装チャットで共有しない。

推奨branch/worktree:

| Chat | Branch | Worktree | Base | Merge order |
|---|---|---|---|---|
| Backend | `feat/ai-history-detail-cache-backend` | `/Users/kitamuranaohiro/Private/focusmap-ai-history-detail-backend` | `origin/main` | 1 |
| Agent | `feat/ai-history-fast-watch-agent` | `/Users/kitamuranaohiro/Private/focusmap-ai-history-fast-watch-agent` | Backend merged or shared contract commit | 2 |
| Frontend | `feat/ai-history-detail-frontend` | `/Users/kitamuranaohiro/Private/focusmap-ai-history-detail-frontend` | Backend merged or shared contract commit | 3 |
| Integration | `main` or `feat/ai-history-detail-integration` | existing main or temp integration worktree | latest main + worker commits | 4 |
| Provider foundation | `feat/ai-history-provider-adapter` | separate later worktree | after Integration | 5 |
| Mac update | `feat/focusmap-agent-self-update-foundation` | separate later worktree | after provider foundation | 6 |

Lifecycle:

- worker完了時は自分の変更だけcommitし、pushしない。
- Integrationがcommit内容を確認し、local mainへmerge/cherry-pick/再実装で取り込む。
- local mainへ入ったものだけ `integrated`。取り込まないものは理由付きで `abandoned`。
- workerは `docs/ai/task-board.md`、`docs/ai/task-runs.jsonl`、`docs/ai/task-archive/**` を触らない。記録はIntegrationが担当。

## Worker Prompts

### Backend/API

```md
あなたは AI履歴 Detail Cache の Backend/API 実装チャットです。

Repo:
/Users/kitamuranaohiro/Private/focusmap-codex-reconcile-main

目的:
`linked_ai_task_id` が無いAI履歴でも、sanitize済みのユーザーpromptとCodex表示用回答を detail open 時に返せるようにする。listはmetadata-onlyのままにし、raw rollout/full messagesは保存しない。

まず読む:
- AGENTS.md
- docs/CONTEXT.md
- docs/ai/plans/active/20260620-ai-history-fast-watch-detail-provider-handoff.md
- docs/specs/codex-app-handoff-monitoring/01-overview-and-flow.md
- docs/specs/codex-app-handoff-monitoring/03-backyard-sync-and-turso.md
- src/app/api/ai-history/[id]/route.ts
- src/app/api/ai-history/[id]/activity/route.ts
- src/app/api/agents/ai-history/batch-upsert/route.ts
- src/lib/turso/ai-history.ts
- src/types/ai-history.ts

編集してよい範囲:
- db/turso/migrations/**
- src/lib/turso/ai-history.ts
- src/types/ai-history.ts
- src/app/api/ai-history/**
- src/app/api/agents/ai-history/**
- 関連route/libテスト
- docs/CONTEXT.md と docs/specs/codex-app-handoff-monitoring/03-backyard-sync-and-turso.md（契約変更がある場合のみ）

編集してはいけない範囲:
- src/components/**
- scripts/focusmap-agent/**
- desktop/**
- package-lock.json
- secrets / .env*
- docs/ai/task-board.md / task-runs / archive / mistakes

やること:
1. `ai_history_detail_messages` 相当のTurso migrationを追加する。
2. detail cacheのlist/upsert helperを `src/lib/turso/ai-history.ts` に追加する。
3. 未リンク `/api/ai-history/[id]/activity` が detail cache を返すようにする。cacheが空/古い場合は `hydrate.required=true` を返す。
4. agent専用のdetail activity upsert endpointを追加する。単体POSTでもbatchでもよいが、Agent側が差分upsertしやすいschemaにする。
5. linked itemは既存 `/api/ai-tasks/[id]/activity` redirectを維持する。
6. full body / rollout / command output / screenshot body を受け取らないsanitize/validationを入れる。
7. route/libテストを追加・更新する。

確認コマンド:
- npm run test:run -- <追加/更新したroute/libテスト>
- npx eslint <編集したts/tsxファイル>
- git diff --check

完了条件:
- API response schemaがhandoff contractと一致する。
- 未リンク履歴でcacheありならmessagesを返す。
- cacheなしなら202または200で `hydrate.required=true` を明示する。
- 生ログ禁止がvalidationで守られている。
- 自分の変更だけcommitし、pushしない。

最後に返す:
- changed files
- API schema
- migration名
- test commands and results
- commit hash
- contract deviations
- Agent / Frontend / Integrationへの引き継ぎ
```

### Agent Fast-watch / Hydrate

```md
あなたは AI履歴 Fast-watch / Detail Hydrate の Agent 実装チャットです。

Repo:
/Users/kitamuranaohiro/Private/focusmap-codex-reconcile-main

目的:
直近/表示中/activeなCodex履歴は、古いthreadでもprompt再開をローカル2秒以内に検知する。未リンク履歴はdetail openやfast-watch差分でsanitize済みdetail messagesをBackend APIへ差分POSTする。

まず読む:
- AGENTS.md
- docs/CONTEXT.md
- docs/ai/plans/active/20260620-ai-history-fast-watch-detail-provider-handoff.md
- docs/specs/codex-app-handoff-monitoring/03-backyard-sync-and-turso.md
- scripts/focusmap-agent/src/codex-thread-monitor.ts
- scripts/focusmap-agent/src/api-client.ts
- scripts/focusmap-agent/src/types.ts
- scripts/focusmap-agent/codex-thread-monitor.test.ts
- Backend workerの完了報告とAPI schema

編集してよい範囲:
- scripts/focusmap-agent/src/**
- scripts/focusmap-agent/*.test.ts
- scripts/focusmap-agent/package.json（必要な場合のみ。lockfile更新は事前確認）
- docs/CONTEXT.md と docs/specs/codex-app-handoff-monitoring/03-backyard-sync-and-turso.md（監視契約変更がある場合のみ）

編集してはいけない範囲:
- src/components/**
- src/app/api/**（Backend契約変更が必要なら止めて報告）
- db/**
- package-lock.json
- desktop/**
- docs/ai/task-board.md / task-runs / archive / mistakes
- secrets / .env*

やること:
1. top 8-10 / detail表示中 / running-awaiting-needs_input / 直近クリック履歴をfast-watch対象にする設計を実装する。
2. fast-watch対象はrollout file `mtime/size` を1秒statし、変化時だけ本文を読む。
3. `shouldInspectTaskRollout` / `shouldInspectAiHistoryRollout` の30秒TTLがfast-watch対象をブロックしないようcacheへwatch tierを持たせる。
4. cloud writeは既存hash/dedupeを維持し、毎秒writeしない。
5. 未リンク履歴のrolloutからsanitize済みuser/assistant visible messagesを差分抽出し、Backendのagent detail endpointへPOSTする。
6. detail hydrateは1回最大件数を制限し、sequence/hashで冪等にする。
7. regression testsを追加する。

確認コマンド:
- npm run test:run -- scripts/focusmap-agent/codex-thread-monitor.test.ts --test-timeout=30000
- npx eslint scripts/focusmap-agent/src/codex-thread-monitor.ts scripts/focusmap-agent/src/api-client.ts scripts/focusmap-agent/src/types.ts scripts/focusmap-agent/codex-thread-monitor.test.ts
- git diff --check

完了条件:
- row fingerprintが変わらずrollout mtimeだけ動く古いthreadでも、fast-watch対象なら次tickでinspectされる。
- fast-watch有効時も同一hashのAI履歴metadataはcloudへ送られない。
- detail hydrate payloadはraw rollout/full messagesを含まない。
- 自分の変更だけcommitし、pushしない。

最後に返す:
- changed files
- implemented behavior
- test commands and results
- commit hash
- latency/write-volume assumptions
- contract deviations
- Frontend / Integrationへの引き継ぎ
```

### Frontend Detail UX

```md
あなたは AI履歴 Detail UX の Frontend 実装チャットです。

Repo:
/Users/kitamuranaohiro/Private/focusmap-codex-reconcile-main

目的:
未リンクAI履歴を開いた時も、cache済みprompt/回答を即表示し、hydrate中は更新中として見せる。右上トグルなし、検索なし、上ヘッダー集約の既存AI履歴UI方針は維持する。

まず読む:
- AGENTS.md
- docs/CONTEXT.md
- docs/ai/plans/active/20260620-ai-history-fast-watch-detail-provider-handoff.md
- docs/specs/codex-app-handoff-monitoring/01-overview-and-flow.md
- docs/specs/codex-app-handoff-monitoring/03-backyard-sync-and-turso.md
- src/hooks/useAiHistory.ts
- src/components/dashboard/codex-chat-import-sidebar.tsx
- src/components/dashboard/codex-chat-import-sidebar.test.tsx
- Backend workerの完了報告とAPI schema

編集してよい範囲:
- src/hooks/useAiHistory.ts
- src/components/dashboard/codex-chat-import-sidebar.tsx
- src/components/dashboard/codex-chat-import-sidebar.test.tsx
- src/lib/ai-history-display.ts（必要な場合）
- src/types/ai-history.ts（Backend契約に合わせるだけ）

編集してはいけない範囲:
- src/app/api/**
- scripts/focusmap-agent/**
- db/**
- desktop/**
- package-lock.json
- docs/ai/task-board.md / task-runs / archive / mistakes
- secrets / .env*

やること:
1. `/api/ai-history/[id]/activity` のdetail cache responseを表示する。
2. `hydrate.required=true` なら既存cache/snippetを表示しつつ、detail open中だけ短周期pollする。
3. Mac/agent offline時は過去cacheを残し、更新不能を小さく表示する。
4. messagesが空の時に「詳細本文はまだ取得されていません」だけで終わらせず、hydrate状態に応じた表示へ変える。
5. list pollは既存の3秒/visibility制御を壊さない。
6. 右上トグル、検索欄、大きいrepo監視ブロックを復活させない。
7. testsを更新する。

確認コマンド:
- npm run test:run -- src/components/dashboard/codex-chat-import-sidebar.test.tsx --test-timeout=30000
- npx eslint src/hooks/useAiHistory.ts src/components/dashboard/codex-chat-import-sidebar.tsx src/components/dashboard/codex-chat-import-sidebar.test.tsx
- git diff --check

完了条件:
- linked履歴は既存activity表示を維持する。
- 未リンク履歴はcacheがあればprompt/回答を表示する。
- cacheが空なら更新中/hydrate requiredを自然に表示する。
- 自分の変更だけcommitし、pushしない。

最後に返す:
- changed files
- implemented behavior
- test commands and results
- commit hash
- contract deviations
- Integrationへの引き継ぎ
```

### Integration

```md
あなたは AI履歴 Fast-watch / Detail Hydrate Integration チャットです。

Repo:
/Users/kitamuranaohiro/Private/focusmap-codex-reconcile-main

目的:
Backend / Agent / Frontend のcommitを統合し、API contract、latency目標、write budget、UI acceptance、docs/board記録を揃えてlocal mainへ取り込む。

まず読む:
- AGENTS.md
- docs/CONTEXT.md
- docs/ai/task-board.md
- docs/ai/plans/active/20260620-ai-history-fast-watch-detail-provider-handoff.md
- docs/specs/codex-app-handoff-monitoring/01-overview-and-flow.md
- docs/specs/codex-app-handoff-monitoring/03-backyard-sync-and-turso.md
- Backend / Agent / Frontend workerの完了報告

編集してよい範囲:
- 統合に必要な最小範囲
- docs/CONTEXT.md
- docs/specs/codex-app-handoff-monitoring/01-overview-and-flow.md
- docs/specs/codex-app-handoff-monitoring/03-backyard-sync-and-turso.md
- docs/ai/task-board.md
- docs/ai/task-runs.jsonl
- docs/ai/task-archive/2026/06.md
- docs/ai/plans/archive/2026/06/**（完了時のみ）

編集してはいけない範囲:
- unrelated refactor
- force push / reset --hard / clean -fd
- secrets / .env*
- 本番DB/GCP/GCS操作

やること:
1. 各workerのchanged files、commit hash、contract deviationsを確認する。
2. allowed files外の変更がないか確認する。
3. merge/cherry-pick順は Backend -> Agent -> Frontend。
4. API schemaとFrontend/Agent payloadのズレを直す。
5. fast-watchがcloud every-second writeになっていないか確認する。
6. 未リンクdetailのcache/hydrate/offline表示を確認する。
7. docs/CONTEXT.md と 03-backyard-sync-and-turso.md を実装後の正仕様へ更新する。
8. task-board / task-runs / archive / active plan移動を最後に行う。
9. 必要なら `/kimi webbridge` またはPlaywrightでUIを見る。ただしログイン済みUI確認はユーザー指示/環境に従う。

確認コマンド:
- git status --short --branch
- git diff --name-status
- npm run test:run -- <Backend/Agent/Frontendの関連テスト>
- npx eslint <統合で触ったts/tsx>
- git diff --check
- UI確認（ユーザーが明示した場合。ログイン済み画面はkimi webbridge優先）

完了条件:
- local mainに統合済み。
- pushしていない。
- 未リンクAI履歴detailがprompt/回答を表示できる。
- top fast-watch対象の再開検知が設計通り。
- Turso write budgetを破っていない。
- docs/CONTEXT.md が正仕様になっている。

最後に返す:
- merged commits
- changed files
- test commands and results
- UI確認結果
- lifecycle状態
- local main / origin/main / 本番の反映状態
- unresolved risks
- commit hash
```

### Provider Adapter Foundation

```md
あなたは AI History Provider Adapter Foundation チャットです。

目的:
Codex.app固定のmonitorを、将来Claude Code / Antigravityを追加できる provider adapter 境界へ挙動不変で分割する。fast-watch/detail hydrate統合後に実施する。

まず読む:
- AGENTS.md
- docs/CONTEXT.md
- docs/specs/platform-boundaries.md
- docs/ai/plans/active/20260620-ai-history-fast-watch-detail-provider-handoff.md
- scripts/focusmap-agent/src/codex-thread-monitor.ts
- scripts/focusmap-agent/src/capabilities.ts
- scripts/focusmap-agent/src/executor.ts
- src/app/api/agents/ai-history/batch-upsert/route.ts

編集してよい範囲:
- scripts/focusmap-agent/src/**
- scripts/focusmap-agent/*.test.ts
- src/types/ai-history.ts（必要最小）
- src/app/api/agents/ai-history/batch-upsert/route.ts（provider allowlist/capability境界のみ）
- docs/CONTEXT.md
- docs/specs/platform-boundaries.md
- docs/specs/codex-app-handoff-monitoring/03-backyard-sync-and-turso.md

編集してはいけない範囲:
- UI大規模変更
- detail hydrateの再設計
- db migration（必要なら止めて相談）
- desktop packaging
- package-lock.json
- secrets / .env*
- docs/ai/task-board.md / task-runs / archive / mistakes

やること:
1. provider adapter interfaceとregistryを追加する。
2. 既存Codex monitorの履歴発見/status/detail hydrate/open URL生成をCodex adapterへ寄せる。
3. 共通schedulerとCodex固有parseを分離する。ただし挙動は変えない。
4. `claude_code` / `antigravity` はstub capabilityまで。metadata import実装は別タスクでよい。
5. heartbeatにprovider capabilitiesを出す準備をする。
6. testsでCodex挙動不変を確認する。

完了条件:
- Codexの既存監視挙動が変わらない。
- provider追加時に触る場所がregistry/adapterに限定される。
- 自分の変更だけcommitし、pushしない。
```

### Review

```md
あなたは readonly reviewer です。実装担当ではありません。

対象:
AI履歴 fast-watch / detail hydrate / provider adapter の統合後差分。

観点:
- fast-watchがCPU高負荷やTurso毎秒writeへ戻していないか。
- 未リンクdetail hydrateがraw rollout/full messages/secret/pathをcloud保存していないか。
- API schemaとFrontend/Agent payloadが一致しているか。
- `linked_ai_task_id` ありの既存activity redirectが壊れていないか。
- archive完全非表示/復元、repo表示filter、未配置/マインドマップ分類が壊れていないか。
- provider adapterがCodex挙動を変えていないか。
- tests不足、UI確認不足、Mac agent再インストール要否の説明不足。

Rules:
- ファイルは変更しない。
- findingsは重大度順。
- file/line、理由、推奨修正、担当チャットを出す。
```

## Integration Acceptance

- `GET /api/ai-history` はmetadata-onlyのまま。
- `GET /api/ai-history/[id]/activity` はlinked itemなら既存activityへredirectし、未リンクならdetail cache/hydrate状態を返す。
- 未リンク履歴でも、hydrate済みならユーザーpromptとCodex表示用回答が読める。
- top fast-watch対象の古いthread再開はlocal 2秒以内、cloud/UI 3-4秒以内を満たす設計/テストがある。
- cloudへraw rollout/full messages/command outputを送らない。
- 同一hash・durationだけの更新でTurso writeしない。
- UIは右上トグルなし、検索なし、上ヘッダー集約を維持する。
- archiveは通常UIから完全非表示、archive解除で同一itemを復元する。
- provider adapter foundationを実施する場合、Codex挙動不変である。
- Macアプリ再インストールが必要な変更とCloud Run deployだけで反映される変更が報告されている。

## Integration Result

- Completed: 2026-06-20
- Merged worker commits: `a3bda68e90ab33a57da15efe49c06edb6a7e90e0`, `dabbf232f05089a22c2e9b6fa3a19e5d6be6fad5`, `0fcb9f43200ea2500312963bc76f94c7fbdaf33b`, `1d1436276111d1386dfe5150f75ea7ab9a2f9484`
- Local main commits after cherry-pick: `e37f5bb5`, `566d7f7c`, `9884f087`, `46d2c66e`
- Integration fixes: conflict-free cherry-pick onto latest local main `2e82c50e`; verified migration order `ai_history_metadata` -> `ai_history_detail_messages` -> `ai_history_detail_hydrate_requests`; confirmed Agent uses `historyItemId` for detail activity POST; confirmed Frontend only polls selected detail activity and does not call the agent hydrate request API; confirmed fast-watch uses rollout `mtime/size` stat and hash/dedupe so unchanged duration pulses do not write every second.
- Verification: `npm run test:run -- src/lib/turso/ai-history.test.ts 'src/app/api/ai-history/[id]/activity/route.test.ts' 'src/app/api/agents/ai-history/[id]/activity/route.test.ts' src/app/api/agents/ai-history/batch-upsert/route.test.ts src/app/api/agents/ai-history/detail-hydrate-requests/route.test.ts scripts/focusmap-agent/codex-thread-monitor.test.ts src/components/dashboard/codex-chat-import-sidebar.test.tsx --test-timeout=30000` passed 59 tests; `npx eslint ...` finished with 0 errors and 2 pre-existing warnings in `scripts/focusmap-agent/src/codex-thread-monitor.ts`; `git diff --check` passed.
- UI check: not run. The user did not explicitly request Mac/Arc/kimi webbridge/Browser UI confirmation.
- Follow-up: provider adapter foundation and Mac agent update strategy remain separate future phases; push/deploy not performed.

## Risks

- Codex SQLite rowが更新されないケースでは、rollout file statを見ない限り高速再開検知は保証できない。
- 未リンクdetailをTursoへ全量保存すると無料枠とプライバシーを壊す。表示用・差分・上限付きに限定する。
- `countAiHistoryBuckets()` の集計は履歴が増えるとrows readを増やす可能性がある。必要ならcounter化を別タスクにする。
- Provider adapter分割とfast-watch修正を同時に行うと `codex-thread-monitor.ts` の衝突が大きい。
- Mac app bundled agent と外部agentが混在すると、どちらが動いているか分からなくなる。heartbeatでsource/hashを出すまでUI判断を強めすぎない。

## Links

- `docs/ai/plans/archive/2026/06/20260620-ai-history-sync-foundation.md`
- `docs/specs/codex-app-handoff-monitoring/01-overview-and-flow.md`
- `docs/specs/codex-app-handoff-monitoring/03-backyard-sync-and-turso.md`
- `docs/specs/platform-boundaries.md`
- `scripts/focusmap-agent/src/codex-thread-monitor.ts`
- `src/app/api/ai-history/[id]/activity/route.ts`
- `src/components/dashboard/codex-chat-import-sidebar.tsx`
