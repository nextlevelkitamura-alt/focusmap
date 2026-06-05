# Codex.app handoff + monitoring 理想仕様

Status: living spec
Created: 2026-06-05
Updated: 2026-06-05
対象: Focusmap の Codex.app 連携、Mac agent、Turso監視、マップ内Codex UIを触る将来のエージェント

## この文書の目的

この文書は、Focusmap の Codex.app handoff + monitoring が目指す理想状態をまとめた正本です。

今後、バックエンド、Mac agent、Turso同期、マップUI、Codex看板、ノード詳細、task progress APIを修正するエージェントは、実装前にこの文書を読み、現在の差分がこの理想に近づいているかを確認してください。

Focusmap は Codex.app の代替ではありません。Focusmap は作業の準備、俯瞰、状態集計、確認導線を担います。Codex.app の thread 履歴が会話の正であり、Codex.app で最終送信するのは人間です。

## プロダクト原則

Focusmap は「AIが働き、人間が舵を取る」ダッシュボードです。

Codex.app 連携では、次を守ります。

- Focusmap は「今動いているもの」「確認が必要なもの」「接続に失敗したもの」「最近完了したもの」を分かりやすく表示する。
- Codex.app の thread 履歴を会話の正とする。
- Focusmap に保存するのは軽量な状態、短いsummary、current_step、activity message中心にする。
- Focusmap は通常導線で full raw log を保存・短周期pollしない。
- 標準導線では、人間が Codex.app で最終送信する。

## 標準導線

標準導線は manual handoff です。

1. ユーザーが Focusmap で `Codexに送る` などのCodex操作を押す。
2. Focusmap が `executor='codex_app'`、`dispatch_mode='manual'` の追跡用 `ai_tasks` を作る。
3. Focusmap が handoff package を作る。
   - prompt本文
   - handoff token または Focusmap sync marker
   - repo path
   - 画像参照
   - source task/memo id
4. Focusmap が prompt をクリップボードへコピーする。
5. 可能なら `codex://threads/new?prompt=...&path=...` などで Codex.app composer を開く。
6. 人間が Codex.app で送信する。
7. Mac local agent が Codex.app の状態をローカルで観測し、軽量snapshot/eventをFocusmapへ送る。
8. Focusmap はマップ、看板、詳細で `未送信` / `実行中` / `確認待ち` / `接続失敗` を表示する。

Codex app-server 経由の `thread/start` / `turn/start` 自動実行は標準導線ではありません。これは `dispatch_mode='auto'` を明示した専用導線だけで使います。

## 絶対に守る不変条件

- manual handoff の追跡taskは、Codex.appを開く前、または開く処理と同時に必ず作る。
- Codex.appを開いたのにFocusmap側に追跡taskが無い状態はバグとして扱う。
- 追跡task作成に失敗した場合は、外部アプリを開かないか、明確な復旧・再登録導線を出す。
- deep link は composer text をセットする用途であり、自動送信できると決め打ちしない。
- 画像添付が deep link で自動添付されると決め打ちしない。
- Macローカル確認は1秒単位でもよいが、クラウド書き込みは軽量・差分・hash抑制を守る。
- Codexの全文ログ、生コマンド出力、full thread history、image body、スクショ原本をTursoへ通常保存しない。
- Codex側の `completed` は Focusmapノードの完了ではない。人間の確認が必要です。
- 既存API契約を壊してUIだけ簡単に見せる修正は禁止。

## ユーザー向け状態モデル

内部状態は、ユーザー向けに次の4状態へ丸めます。

| 内部状態・条件 | 表示 | 意味 |
|---|---|---|
| `pending` または manual handoff でthread未検出 | `未送信` | Focusmapはpromptを準備済み。人間の送信待ち、またはthread未検出。 |
| `running` | `実行中` | Codexが実行中、または追加入力で再開済み。 |
| `awaiting_approval` / `needs_input` / Codex側完了後の人間確認前 | `確認待ち` | 人間がCodex出力を確認し、承認・追加入力・完了判断をする状態。 |
| `failed` / monitoring lost / thread検出失敗 | `接続失敗` | FocusmapがCodexセッションを確実に追跡できなかった状態。 |

重要なルール:

- 古い `result.codex_run_state='running'` だけで、新しい待機・失敗・完了系状態を上書きしない。
- Codex側で完了しても、人間がFocusmapノードを完了するまでは `確認待ち` として扱う。
- マップ上のノード完了は、Codex状態ではなくチェックボックスを正とする。

## 理想UI

### マップを主画面にする

ノード別Codex監視の主画面は `マップ` です。通常の `チャット` tab に逃がしません。

デスクトップ:

- マップ下にコンパクトな折りたたみ式 `Codex看板` を置く。
- マップを主役にし、看板が画面を支配しない。
- 初期状態では畳んで件数と緊急度だけ分かるようにする。

モバイル:

- 右下に `Codex` ボタンを置く。
- ボタンから下シートで `Codex看板` を開く。
- タップターゲットは44px以上を守る。
- 片手操作で「今見るべきもの」が分かるようにする。

看板レーン:

- `実行中`
- `確認待ち`
- `接続失敗`
- `完了`

`未送信` カードは `確認待ち` レーンに入れてよいですが、カード上で `未送信` と明確に分かるようにします。

`完了` レーンは一時表示です。恒久的なアーカイブにしないでください。

### 看板カード

カードには次のような、次の判断に必要な情報だけを出します。

- status label
- ノード・メモのタイトル
- `current_step` または短いfallback
- 短い `summary`
- 必要な場合だけ Mac agent online/offline
- 最終更新時刻
- 最小限の操作

カードに raw JSON、長いtool log、full thread dump を出さないでください。

### 詳細panel / drawer

詳細はユーザーが開いた時だけ読みます。

開いた時:

- すぐに現在の task progress を取得する。
- そのtaskの active watch を開く。
- detail tail はboost間隔でpollする。
- summary/current_step/activity を先に見せる。
- raw event/progress tail は必要なら詳細表示の奥に置く。

安全に表示できる操作:

- `Codexで開く`
- `再コピー`
- `更新`
- 将来: `送信済みにする`
- 将来: `確認待ちにする`
- 将来: `手動thread紐付け`

backendがない操作を、動くように見せかけて実装しないでください。必要だが未実装の操作は、未解決課題として残します。

### ノード詳細の優先順位

Codex活動があるノードでは、Codex実行ブロックを長いメモ本文より上に出します。今いちばん重要なのは「Codexがどうなっているか」だからです。

ただし、メモ本文へのアクセスは残します。ノード詳細を別のチャットページにしてはいけません。

## Handoff package 要件

handoff package は、人間や将来のエージェントが流れを復旧できる情報を持つ必要があります。

必須:

- `handoff_id` または検証済みhandoff token
- `ai_task_id`
- prompt本文
- source type / source id
- repo path
- 作成時刻

任意:

- workspace path
- 画像参照
- 画像local path
- 署名URL
- 手動添付の案内

画像処理の前提:

- clipboard paste は使える場合があるが、常に使えるとは限らない。
- 署名URLはCodex.app/ChatGPT側から到達できる場合だけ有効。
- local path は同じMac上でCodex.appが参照できる場合だけ有効。
- 手動attachは現実的なfallbackとして残す。

## Thread検出

`handoff_id` / `ai_task_id` / `codex_thread_id` は次の流れで紐付けます。

1. Codex.appを開く前に追跡taskが存在する。
2. promptに短いFocusmap markerまたはhandoff tokenを含める。
3. Mac local monitor が Codex.app sqlite / rollout / app-server state を読む。
4. 次の情報で新規・更新threadを照合する。
   - 明示marker
   - prompt先頭・本文match
   - repo path / cwd
   - created/updated time window
5. matchしたら `codex_thread_id` を軽量snapshotと互換用 `ai_tasks` fieldへ書く。
6. fast window内に検出できなければ、明確な復旧導線つきで `接続失敗` または `確認待ち` にする。

何も表示が変わっていないのに、`codex_last_checked_at` だけを繰り返し書く監視は避けます。

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

## Frontend acceptance

frontend修正は、次を満たす場合だけ理想に近づいています。

- マップがCodex監視の主画面のまま。
- 看板/card UIがコンパクトで実務向け。
- モバイルは常時表示の密な看板ではなく、下シートを使う。
- detail tail はdetail open時だけ読む。
- `未送信` / `実行中` / `確認待ち` / `接続失敗` の表示が一貫している。
- CodexのcompletedでFocusmapノードを自動完了にしない。
- backend未実装の操作を動くボタンとして出さない。
- モバイル/デスクトップでテキストがボタンやカードからはみ出さない。
- モバイルのタップターゲットが44px以上。
- UIは装飾的ではなく、静かで密度のある運用画面にする。

## 検証チェックリスト

関連作業の完了前に、実行するか、実行できない理由を明記します。

- `git fetch --prune origin`
- `git status --short --branch`
- 既存未コミット差分を確認し、混ぜない
- touched file lint
- Codex状態丸めとマップUIの関連unit test
- `git diff --check`
- `npx tsc --noEmit --pretty false`
- desktop: `http://localhost:3001/dashboard?taskProgressFixture=1`
- mobile幅: Codexボタンと下シート

既存の型エラーがある場合は、今回変更由来か既存由来かを具体的に書きます。

## 将来エージェントへ渡す短いプロンプト

```md
編集前に `docs/specs/codex-app-handoff-monitoring-ideal.md` を読んでください。
目的は、現在の実装をこの理想仕様へ近づけることです。API契約を壊さず、関係ない差分を混ぜないでください。

優先順位:
1. manual handoff の tracking task を失わない
2. Turso write は snapshot/hash/event ベースにする
3. detail tail は detail open時だけ読む
4. UI表示は 未送信 / 実行中 / 確認待ち / 接続失敗 に揃える
5. マップをCodex監視の主画面にする

禁止:
- 標準manual handoffをCodex.appへ自動送信する
- Tursoへ全文ログを保存する
- deep linkで画像自動添付できると決め打ちする
- backend未実装の操作を動くように見せる
- 関係ないファイルを編集する
```

## 未決定事項

この理想仕様では、次はまだ確定しません。

- `送信済みにする` 専用APIを作るか。
- `codex_thread_id` 手動紐付けUIを作るか。
- active detail viewにSSEを導入するか。
- スクショpreviewを最初のCodex監視リリースに含めるか。
- multi-user runner scopingを公開前必須にするか、shared-space rollout前必須にするか。

未決定事項は、上の保守的な挙動を守ったまま別途判断します。
