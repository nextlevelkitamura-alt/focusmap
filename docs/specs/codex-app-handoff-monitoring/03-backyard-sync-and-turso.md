# 03. バックヤード同期とTurso節約

## ローカル監視とクラウド同期の違い

Macローカル監視とTurso同期は別物です。

Macローカル:

- agent起動中はCodex.app状態を1秒ごとに読んでよい。
- 人間の追加入力をすばやく検知してよい。
- sqlite / rollout / app-server をローカルで読む。
- 必要ならローカルにraw detailを持ってよい。

クラウド同期:

- 内容hashが変わった時、または最短間隔を過ぎた時だけ小さいsnapshotを送る。
- state event は意味のある状態変化だけ送る。
- 短いdetail tailは必要な時だけ送る。
- full log を毎tick送らない。

推奨間隔:

| 状況 | Mac local check | Cloud write/read |
|---|---:|---:|
| runner生存 | local process loop | 10秒ごとheartbeat upsert |
| running、詳細未表示 | 1秒 | 5秒最短snapshot、hash変化時のみ |
| detail panel表示中 | 1秒 | active watch + 3秒detail poll |
| awaiting approval / needs input | 1秒可 | 追加入力・再開を5秒以内に反映 |
| runningなし | 通常background | 30から45秒、または手動更新 |
| 古いcompleted / failed | tight loop不要 | 低頻度、または手動 |

## Turso保存ルール

Tursoは軽量monitoring state用です。ログ保管庫ではありません。

対象テーブル:

- `ai_tasks`: 最新表示snapshot
- `ai_task_progress`: 短いtail/history
- `ai_task_events`: 状態変化event
- `runner_heartbeats`: runner生存
- `task_progress_watches`: detail open中のboost hint
- `screenshots`: metadataのみ。原本ではない。

保存してよいもの:

- task id / user id / space id
- source type / source id
- status
- `codex_thread_id`
- 文字数上限つき `current_step`
- 文字数上限つき `summary`
- compact progress metadata
- event type と小さいpayload
- heartbeat metadata

通常保存してはいけないもの:

- full `live_log`
- full `output`
- raw command output
- full thread history
- full rollout JSON
- image body / base64
- screenshot original
- 上限なしの巨大JSON

Mac agent側で圧縮する前提でも、API側で必ず防御的にsanitizeします。

## Turso無料枠に収める規律

通常の個人利用では、Turso Freeに余裕を持って収めることを目標にします。

write budgetの考え方:

- runner heartbeat 10秒は許容。
- running snapshot 5秒は、hash dedupe前提なら許容。
- detail open中だけ3秒boostを許容。
- 毎tick progress insertは禁止。
- 毎tick event insertは禁止。
- raw log の繰り返し保存は禁止。

概算:

| ケース | 月間write概算 | 備考 |
|---|---:|---|
| 1 runner heartbeat 10秒 | 259k | 1 row upsert |
| 1 running task 5秒、常に変化、24h/day | 518k | 通常snapshotの重めケース |
| 5 running tasks 5秒、常に変化、24h/day | 2.59M | progress/eventを増やさなければ許容 |
| 5 tasks detail-open 3秒、常に変化、24h/day | 4.32M | 重いが他writeが小さければ10M未満 |
| 全taskが3秒ごとにprogress/event insert | 危険 | 禁止 |

read budgetの考え方:

- `(updated_at, id)` cursor と `limit` を使う。
- 短周期APIで `select('*')` しない。
- hot pathで `count` しない。
- full scanを避ける。
- user path / space path のcursor indexを維持する。

必要なindex:

- `(user_id, updated_at, id)`
- space取得を使う場合は `(space_id, updated_at, id)`
- progressは `(task_id, created_at)`
- eventsは `(task_id, created_at)`
- heartbeatは `(user_id, last_seen_at)`
- watchesは `(user_id, expires_at)` と必要に応じて `(task_id, expires_at)`

`task_progress_watches` は掃除が必要です。TTLでactive判定するだけでは不十分です。期限切れから24時間以上経過したwatchは、open/listなどで軽く削除します。

## Backend acceptance

backend修正は、次を満たす場合だけ理想に近づいています。

- manual handoff時、Codex.appを開く前、または同時にtracking taskを作る。
- `dispatch_mode='manual'` を通常runnerが勝手に `turn/start` しない。
- `dispatch_mode='auto'` は明示的な別モードとして残す。
- `snapshot_only=true` の通常POSTは最新snapshotだけ更新し、履歴insertしない。
- event insert は意味のある状態変化だけ。
- progress history は短く、上限つき。
- watch open/ping/close でdetail boostを制御する。
- expired watch が無限に増えない。
- 複数ユーザー/spaceを想定するrunnerでは監視対象をuser/spaceで絞る。
- Turso dual-write失敗で既存Supabase互換導線を壊さない。ただしTurso専用endpointは例外。
