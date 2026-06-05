---
status: active
category: feature
priority: high
created: 2026-06-05
updated: 2026-06-05
related:
  - docs/CONTEXT.md
  - docs/plans/focusmap-lite-mac-agent.md
  - docs/plans/active/codex-relay-flow.md
  - docs/specs/memo-codex-execution/requirements.md
---

# Codex監視・Auth軽量化・Turso/R2段階移行計画

## 概要

Supabase egress上限到達を受け、FocusmapのCodex監視とMac/iPhone/Web同期を、軽い状態同期中心へ移行する。

最初からSupabaseを全面撤去しない。まずSupabase Authを残しつつ、API側でJWTをオフライン検証して高頻度のAuth往復を減らす。その後、`ai_tasks` / progress / heartbeat / screenshot metadata のような高頻度・軽量データだけをTursoへ段階移行する。スクショ画像は原本をMacローカルに置き、クラウドには圧縮したthumbnail/previewだけを送る。R2は本命候補だが、既存添付画像を即移行する前提にはしない。

## 現状判断

- Supabaseプロジェクトが `exceed_egress_quota` で制限されると、Auth / REST / Storage が同時に使えなくなる。
- Supabase Authを残す限り、現在のログイン不可は構成変更だけでは即時復旧しない。即時復旧はSupabase側の制限解除、課金設定変更、spend cap解除、プラン変更、サポート対応が必要。
- DB統計上は、画像より先に `auth.getUser()` 相当、`ai_tasks` select/update、Realtime、設定系selectが多い。
- `select('*')`、3秒/5秒/15秒周期のpolling、Realtimeとpollingの二重実行、idle heartbeatの高頻度化がegressを押し上げる。
- iPhoneは常時5秒監視に向かない。iPhoneは通知で呼び戻し、画面表示中だけ短周期取得する。
- Macは観測・実行側、iPhone/Web/PCは閲覧・承認側として分ける。

## 要件

- [x] Supabase Authは残す。
- [x] 高頻度APIはSupabase `auth.getUser()` を毎回呼ばず、Supabase JWTをAPI側でオフライン検証する。
- [x] `user_id` はクライアント申告値ではなくJWTの `sub` から取得する。
- [x] Turso token、R2 secret、Supabase service role keyをクライアントに出さない。
- [x] Mac app / Mac agentはCodex実行状態を軽量progress JSONとして送る。
- [ ] iPhone / Web / PCはタスク画面で従来に近い体験で進捗とスクショpreviewを見られる。
- [x] スクショ原本はMacローカル保存を正とする。
- [x] クラウドに保存するスクショはthumbnail/previewだけにする。
- [x] 5秒ごとの画像アップロードは禁止する。
- [x] R2はスクショpreview用途から試験導入し、既存Supabase Storage添付はすぐ移行しない。
- [x] 旧Supabase Storage/DBデータは後方互換を保つ。

## 非目標

- [ ] Supabase Authの即時撤去。
- [ ] 全アプリDBのTurso全面移行。
- [ ] 既存 `task-attachments` / `ideal-attachments` の即R2移行。
- [ ] Codex全生ログ、全コマンド出力、巨大raw JSONのクラウド保存。
- [ ] iPhoneバックグラウンドでの常時5秒polling。
- [ ] R2を絶対正解として扱うこと。

## 推奨アーキテクチャ

```text
Mac app / Mac agent
  - Codex監視
  - progress JSON生成
  - 原本スクショをローカル保存
  - thumbnail / preview生成
  - local outbox / retry queue
        |
        v
Focusmap API
  - Supabase JWTオフライン検証
  - user_id境界の強制
  - Turso/R2 secretをサーバー側だけで保持
        |
        +--> Turso
        |     - ai_tasks
        |     - ai_task_progress
        |     - ai_task_events
        |     - runner_heartbeats
        |     - screenshots metadata
        |
        +--> Cloudflare R2
              - thumbnail
              - preview

iPhone / Web / PC
  - 起動/復帰時にsnapshot取得
  - 実行中画面だけ短周期pollingまたはSSE
  - 承認待ち/失敗/完了はpush通知
  - 画像は表示時だけ署名付きURLで取得
```

## Authオフライン検証方針

### 方針

- 高頻度APIではSupabase `auth.getUser()` を呼ばない。
- APIは `Authorization: Bearer <supabase_access_token>` またはSSR cookieからaccess tokenを取得する。
- Supabase JWTの署名、`iss`、`aud`、`exp`、`sub` を検証する。
- `sub` をFocusmap内の `user_id` として使う。
- JWKSはサーバー側でキャッシュする。
- key rotation / revocationのため、キャッシュTTLと強制再取得経路を用意する。

### 確認事項

- Supabaseプロジェクトが非対称署名キー/JWKS運用か、legacy JWT secret運用かを確認する。
- legacy JWT secretの場合、JWKSだけでは検証できない可能性があるため、署名キー移行またはサーバー側secret検証の扱いを決める。
- セキュリティ事故時は、JWKSキャッシュにより短時間だけ古いkeyを信頼する可能性があるため、cache bustingを実装候補に入れる。

## プラットフォーム別データ取得設計

### Mac app / Mac agent

Macは実行・観測側。短周期で見てもよいが、クラウドへ送るデータは軽くする。

| 用途 | 推奨頻度 | クラウド送信 |
|---|---:|---|
| Codex実行状態 | 3〜5秒 | 小さいprogress JSON |
| runner heartbeat active | 15〜30秒 | upsert |
| runner heartbeat idle | 1〜5分 | upsert |
| 状態イベント | 状態変化時 | event insert |
| スクショ原本 | 必要なら短周期 | Macローカルのみ |
| スクショpreview | 最大1分ごと、または状態変化時 | R2へ圧縮版だけ |

Mac側にはlocal outboxを持つ。

- local SQLite
- local screenshot folder
- upload queue
- retry with backoff
- `last_synced_event_id`
- 送信前のprogress集約

### iPhone

iPhoneは閲覧・承認側。常時監視端末にしない。

| 状態 | 取得方法 | 推奨頻度 |
|---|---|---:|
| アプリ起動/復帰 | snapshot API | 1回 |
| タスク一覧 | REST polling | 15〜30秒 |
| 実行中タスク詳細 | REST polling または SSE | 3〜5秒 |
| 承認待ち/失敗/完了 | APNs push | イベント時 |
| スクショ表示 | metadata取得後に署名付きURL | 表示時だけ |
| バックグラウンド | APNs中心 | 常時pollしない |

初期MVPではSSE/WebSocketを必須にしない。画面を開いている時だけ3〜5秒pollingで十分とする。

### Web / PC

- Webは既存UIを維持する。
- 起動時にsnapshotを取得する。
- 実行中タスクがある時だけ短周期更新する。
- `awaiting_approval` / `completed` / `failed` は短周期更新しない。
- 画像はmetadataだけ先に取り、表示されるタイミングで署名付きURLを取得する。

## データモデル案

### `ai_tasks`

- `id`
- `user_id`
- `title`
- `status`
- `executor`
- `dispatch_mode`
- `source_type`
- `source_id`
- `codex_thread_id`
- `current_step`
- `progress_percent`
- `summary`
- `error_message`
- `created_at`
- `updated_at`
- `started_at`
- `completed_at`

Index:

- `(user_id, status, updated_at)`
- `(user_id, created_at)`
- `(codex_thread_id)`

### `ai_task_progress`

- `id`
- `task_id`
- `user_id`
- `phase`
- `message`
- `progress_json`
- `created_at`

Index:

- `(task_id, created_at desc)`
- `(user_id, created_at desc)`

### `ai_task_events`

- `id`
- `task_id`
- `user_id`
- `event_type`
- `payload_json`
- `created_at`

Index:

- `(task_id, created_at)`
- `(user_id, event_type, created_at)`

### `runner_heartbeats`

- `runner_id`
- `user_id`
- `device_id`
- `status`
- `last_seen_at`
- `current_task_id`
- `version`
- `metadata_json`

Index:

- `(user_id, last_seen_at)`
- `(runner_id)`

### `screenshots`

- `id`
- `task_id`
- `user_id`
- `thumbnail_key`
- `preview_key`
- `width`
- `height`
- `thumbnail_size_bytes`
- `preview_size_bytes`
- `captured_at`
- `created_at`
- `deleted_at`
- `local_original_path_hash`

Index:

- `(user_id, task_id, captured_at desc)`
- `(user_id, created_at desc)`
- `(preview_key)`

## 画像保存ルール

- thumbnail: 40〜100KB
- preview通常: 150〜300KB
- text-heavy preview: 300〜600KB
- hard max: 800KB
- original: Macローカルのみ
- active中の進捗: 5秒JSONのみ
- 画像upload: 状態変化、エラー、確認待ち、ユーザー閲覧時、または最大1分ごと
- 期限切れ: MVPでは30〜90日保持を候補にする。原本はMacローカル保持期間を別設定にする。

## R2採用判断

### R2に向いているもの

- スクショthumbnail
- スクショpreview
- 一時確認用画像
- 表示回数が増えるとSupabase Storage egressを押し上げる画像

### R2に今すぐ移さないもの

- 既存task attachments
- wishlist / ideal attachments
- 画像量が少ない通常添付
- 旧Supabase Storageデータ

### 採用条件

- 画像previewを1分以下の頻度に制限できる。
- R2 bucketをprivateにできる。
- API経由で短時間署名付きURLを発行できる。
- R2 secretをクライアントに置かない。
- 削除、期限切れ、ユーザー境界のテストを用意できる。
- 1〜2週間の試験導入でstorage / Class A / Class Bの使用量が見える。

### 不採用または延期条件

- スクショpreviewをまだ本格運用しない。
- 画像表示量が少なく、Supabase Storage最適化で十分。
- 既存Storage互換の実装負荷が大きく、Phase 1の止血を遅らせる。
- Cloudflare運用、CORS、署名URL、lifecycleの管理コストが現在の開発リソースに合わない。

## 実装フェーズ

### Phase 1: Supabase止血とAuthオフライン検証

- [ ] Supabase JWT署名方式を実プロジェクト設定で確認する。
- [x] API用のJWT検証ユーティリティを作る。
  - `src/lib/auth/verify-supabase-jwt.ts` を追加。JWKS検証を優先し、legacy HS256はサーバー環境変数がある場合だけfallbackする。
- [x] 高頻度APIで `auth.getUser()` を毎回呼ばないようにする。
  - `ai_tasks` / `ai-runners` / Codex同期の主要APIは `Authorization: Bearer` またはSSR cookie tokenをオフライン検証する。古いcookie互換のfallbackだけ残す。
- [x] `select('*')` を最小カラム取得へ置換する。
  - `/api/ai-tasks` は一覧に必要な通常カラムと `result` JSON pathのみ取得する。
- [x] `result` / `live_log` / 巨大JSONを一覧取得から外す。
  - 一覧では `live_log` tailを短くし、巨大な `result` 全体とCodex thread snapshotを返さない。
- [x] `running` だけ短周期更新する。
  - `running` は3〜5秒、`pending` は30秒、確認待ち/完了/失敗/手動貼り付け待ちは低頻度または手動更新にする。
- [x] Realtimeとpollingの二重実行を整理する。
  - `useAiTasks` / `useMemoAiTasks` / `useNoteAiTasks` の広域 `ai_tasks` Realtime購読を外し、Bearer付きREST snapshot取得へ寄せる。
- [x] idle heartbeatを1〜5分へ変更する。
  - `focusmap-agent` heartbeatは60秒、runner状態UIは30秒polling、オンライン判定窓は5分にする。
- [x] Supabase制限時はrunnerがpause/backoffする。
  - `task-runner` は制限エラーでpause fileを作り、`focusmap-agent` のheartbeat/claim/command loopは通信失敗時にbackoffする。

### Phase 2: Tursoへ軽量状態を移す

- [x] Turso schema/migrationを作る。
  - `db/turso/migrations/20260605000000_codex_monitoring.sql` に `ai_tasks` / `ai_task_progress` / `ai_task_events` / `runner_heartbeats` / `screenshots` metadataを追加。
- [x] server-only Turso clientを作る。
  - `src/lib/turso/client.ts`。`TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` または `LIBSQL_*` をサーバーだけで読む。
- [x] `ai_tasks` のdual-writeまたは新APIを作る。
  - `/api/ai-tasks` 作成時にTursoへ軽量mirror。既存タスクは `/api/task-progress` 初回アクセスでSupabase最小selectからseedする。
- [x] `ai_task_progress` / `ai_task_events` を追加する。
  - `/api/task-progress` GET/POST。POSTはTurso必須、GETはTurso未設定時だけSupabase fallback。
- [x] `runner_heartbeats` をTursoへ移す。
  - `/api/task-progress/runner-heartbeats` を追加し、既存 `/api/agents/heartbeat` / `/api/ai-runners/heartbeat` もTurso dual-writeする。
- [x] iPhone/Webの進捗取得を新APIへ切り替える。
  - 既存UIの `/api/ai-tasks/[id]/live-log` / `activity` はTurso優先に切替。URL互換を保つ。
- [x] 旧Supabase読み取り互換を残す。
  - Turso未設定または古いタスクのprogress未作成時はSupabaseの最小JSON path / activity messagesへfallbackする。
- [x] Codex監視の軽量backfillスクリプトを追加する。
  - `scripts/backfill-codex-monitoring-to-turso.mjs`。`.env.monitoring.local` / `.env.local` からSupabase service role keyとTurso envを読み、`--dry-run` または `--apply` の明示を必須にする。
  - Supabase側は `select('*')` を使わず、Codex系 `ai_tasks` の軽量カラムと `result` JSON pathだけを読む。`result.live_log` はtail/summary用途に圧縮し、Supabase Storage画像やraw resultは移行しない。
  - `ai_tasks` はTursoへupsert、snapshot/activity/observation progressとstatus eventsは `backfill:*` の deterministic ID で重複を抑制する。activity/observationは直近件数だけを対象にする。

### Backfill運用

まず必ずdry-runする。

```bash
npm run codex-monitoring:backfill -- --days 30 --dry-run
```

確認するもの:

- `targets.ai_tasks` / `targets.snapshot_progress` / `targets.observation_progress` / `targets.status_events`
- `estimated_turso_writes.total_statements`
- `existing_in_turso` と `skip_candidates`
- `ai_task_activity_messages` が無い環境では警告付きでスキップされること

実投入はdry-runのwrite数が小さいことを確認した後だけ行う。

```bash
npm run codex-monitoring:backfill -- --days 30 --apply
```

2026-06-05の初回投入は直近30日だけに限定し、`ai_tasks` 79件、progress 82件、events 79件をTurso側で検証した。再dry-runでは同じprogress/eventsが既存行として検出されるため、再実行しても履歴が重複しない。

### 無料枠化ロードマップ

Supabase Free / Turso Free / R2 Freeを前提に、データの役割を分けて進める。

```text
Supabase: Auth、spaces/projects/tasks/notes/wishlistの正本、Google OAuth token、共有権限
Turso: Codex監視、runner/agent状態、表示用snapshot、短期イベント履歴、カレンダーcache
R2: 新規スクショpreview/thumbnail、新規メモ添付画像、AI生成画像
```

優先順:

- P0: Codex監視をTurso主導にする。`ai_task_progress` / `ai_task_events` / `runner_heartbeats` / screenshot metadataはTursoを正にする。
- P1: activity/observation履歴のSupabase insertを止める。`FOCUSMAP_TURSO_ACTIVITY_PRIMARY=1` と `FOCUSMAP_TURSO_OBSERVATIONS_PRIMARY=1` をCloud Runに入れると、Turso保存成功後はSupabaseの `ai_task_activity_messages` / `ai_task_observations` への履歴insertを省略する。`ai_tasks.result.progress_summary` は互換表示のため当面Supabaseに残す。
- P2: runner/agent command queueをTurso中心へ移す。claim/command/heartbeatの短周期APIはSupabase token lookupとDB writeを最小化し、Supabase側は互換fallbackだけにする。
- P3: Today / AI実行タイムライン / runner状態のread modelをTursoへ作る。Web/iPhoneはsnapshot APIでTursoを読み、Supabase本体の一覧selectを減らす。
- P4: 新規画像添付をR2へ切り替える。既存Supabase Storage画像は読み取り互換で残し、過去画像の一括移行は容量が無料枠を圧迫し始めた時だけdry-run付きで行う。
- P5: Google Calendar event cacheをTursoへ置く。OAuth tokenと設定はSupabaseに残し、日/週/月表示用の取得済み予定snapshotだけTursoで読む。

無料枠維持の禁止事項:

- Supabaseの広域Realtime購読を戻さない。
- `select('*')` を短周期APIへ戻さない。
- Supabase StorageへスクショやAI生成画像を追加しない。
- iPhone/ブラウザバックグラウンドで常時pollingしない。
- Tursoに権限境界を委譲しない。Turso読み書きは必ずAPI側でJWT由来 `user_id` / `space_id` を検証する。

### Phase 3: スクショmetadataとR2 preview試験導入

- [x] `screenshots` metadataをTursoへ保存する。
- [ ] R2 bucketをprivateで作る。
  - リポ内実装は完了。Cloudflare側のbucket作成とenv投入は外部作業。
- [x] R2 server-only clientを作る。
  - `src/lib/r2/client.ts`。R2 secretはサーバー環境変数のみ。
- [x] preview/thumbnail upload APIを作る。
  - `/api/screenshots`。originalは拒否し、preview hard max 800KB、thumbnail hard max 120KB。
- [x] 署名付きURL発行APIを作る。
  - `/api/screenshots/[id]/url`。60〜900秒の短時間URLだけ返す。
- [x] Mac側でWebP圧縮、thumbnail/preview生成を行う。
  - `scripts/focusmap-agent/src/screenshot-preview.ts`。原本は `~/.focusmap/screenshots/`、クラウドはWebPだけ。
- [ ] UIは既存のまま画像取得先だけ差し替える。
  - metadata/sign APIは実装済み。実UIへのpreview表示導線は次作業。
- [ ] 使用量を1〜2週間モニタリングする。
  - R2/Turso env投入後に実使用量を見る。

### Phase 4: 旧Storage依存削減

- [ ] 旧Supabase Storage画像を読み取り互換で残す。
- [ ] 新規スクショはR2、通常添付はSupabase Storage継続を基本にする。
- [ ] 必要なものだけR2へ移行する。
- [ ] retention/lifecycleを適用する。
- [ ] 使用量ダッシュボードまたはログを追加する。

## 実装対象ファイル候補

### 作成候補

- `src/lib/auth/verify-supabase-jwt.ts`
- `src/lib/turso/client.ts`
- `src/lib/r2/client.ts`
- `src/app/api/task-progress/**`
- `src/app/api/screenshots/**`
- `supabase` または `db` 配下のTurso migration
- Mac agent側のlocal outbox / image compression module

### 変更候補

- `scripts/task-runner.ts`
- `scripts/focusmap-agent/src/cli.ts`
- `scripts/focusmap-agent/src/command-loop.ts`
- `src/hooks/useAiTasks.ts`
- `src/hooks/useMemoAiTasks.ts`
- `src/hooks/useNoteAiTasks.ts`
- `src/hooks/use-ai-task-stream.ts`
- `src/app/api/ai-tasks/**`
- `src/app/api/agents/**`
- `src/app/api/ai-runners/**`
- `src/app/api/codex/**`

### すぐ消さないもの

- Supabase Auth
- 既存 `task-attachments`
- 既存 `ideal-attachments`
- 通常タスク、カレンダー、メモ、wishlistのSupabase DB処理
- 旧Supabase Storage画像の読み取り導線

## task-router実行分割案

この計画は「詰めて一気に」案件として扱う。ただしPhase 1は止血のため、独立した小タスクに分けて進める。

```text
[router 状態] 目的:Codex監視とDB/画像同期を軽量化
 詰め:✅  分解:5タスク案
 #1 auth-offline-verify  ✅ Phase 1実装済み  allowed: src/lib/auth/**, high-frequency API auth部分
 #2 polling-egress-stop   ✅ Phase 1実装済み  allowed: src/hooks/useAiTasks.ts, useMemoAiTasks.ts, useNoteAiTasks.ts, use-ai-task-stream.ts
 #3 runner-backoff        ✅ Phase 1実装済み  allowed: scripts/task-runner.ts, scripts/focusmap-agent/src/**
 #4 turso-progress-api    ✅ 実装済み  allowed: src/lib/turso/**, src/app/api/task-progress/**
 #5 r2-screenshot-spike   ✅ API/agent helper実装済み  allowed: src/lib/r2/**, src/app/api/screenshots/**
 検証:Web型チェック/agent build済み  mainマージ:main直コミット予定  デプロイ:未
```

並列化する場合は、allowed filesが重ならない単位にする。`auth-offline-verify` と既存API修正は重なりやすいため、最初は直列で進める。

## 完了条件

- [x] 高頻度APIがSupabase Authサーバーを毎回叩かない。
- [x] `running` 以外のCodex状態で3秒監視しない。
- [x] 一覧取得で巨大JSONを取らない。
- [x] idle時のrunner heartbeatが1〜5分に落ちている。
- [x] 実行中タスク詳細は3〜5秒で体感よく更新される。
- [x] iPhoneはバックグラウンド常時pollingではなく通知/復帰取得中心になっている。
- [x] Macは原本スクショをローカルに保存し、クラウドには圧縮previewだけを送る。
- [x] R2導入時もクライアントにsecretが出ていない。
- [x] 旧Supabase Storage画像が引き続き読める。
- [ ] Supabase / Turso / R2の使用量を確認できる。

## リスク

- Supabase JWT署名方式がlegacyの場合、JWKS前提のオフライン検証がそのまま使えない。
- JWKSキャッシュにより、緊急key revokeが短時間反映されない可能性がある。
- R2署名URLはbearer tokenなので、URL漏えい時は期限内に閲覧される。
- スクショにはAPIキー、個人情報、求人情報、候補者情報が映る可能性がある。
- Turso移行でSupabase RLSに頼れなくなるため、APIの `user_id` 条件漏れが重大事故になる。
- Realtimeを減らすと、UIの体感リアルタイム性が落ちる可能性がある。
- 既存Supabase Storage画像を消すと、過去データが壊れる。

## 実装前に確認する質問

- Supabase Authの署名方式はJWKS対応済みか。
- iPhoneで本当に必要なリアルタイム度は、実行中画面だけ3〜5秒で足りるか。
- 承認待ち/失敗/完了通知はAPNsまでMVPに含めるか。
- スクショpreviewの保持期間は30日、60日、90日のどれを初期値にするか。
- スクショに映る秘匿情報のredaction/local-only設定をMVPから入れるか。
- R2は個人開発用Cloudflare accountで始めるか、Focusmap用の独立accountにするか。
- TursoはFreeで開始するか、最初からDeveloper planにするか。

## 公式参照

- Supabase JWT: https://supabase.com/docs/guides/auth/jwts
- Supabase signing keys: https://supabase.com/docs/guides/auth/signing-keys
- Supabase egress usage: https://supabase.com/docs/guides/platform/manage-your-usage/egress
- Turso pricing: https://turso.tech/pricing
- Cloudflare R2 pricing: https://developers.cloudflare.com/r2/pricing/
- Cloudflare R2 presigned URLs: https://developers.cloudflare.com/r2/api/s3/presigned-urls/
- Cloudflare R2 limits: https://developers.cloudflare.com/r2/platform/limits/
- Apple Background Tasks: https://developer.apple.com/documentation/BackgroundTasks
- Apple remote notifications: https://developer.apple.com/documentation/usernotifications/generating-a-remote-notification
- Apple URLSession background transfers: https://developer.apple.com/documentation/foundation/urlsessionconfiguration/1407496-background
