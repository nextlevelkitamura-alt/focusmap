# 01. 全体原則と標準導線

## 目的

Focusmap の Codex.app handoff + monitoring は、Codex.appで行われる作業をFocusmap上で俯瞰・確認できるようにするための仕組みです。

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
4. Focusmap が prompt をクリップボードへコピーする。
5. 可能なら prompt本文をURLに含めず、`codex://?path=...&originUrl=...` などで Codex.app composer を開く。
6. 人間が Codex.app で送信する。
7. Mac local agent が Codex.app の状態をローカルで観測し、軽量snapshot/eventをFocusmapへ送る。
8. Focusmap はマップ、看板、詳細で `未送信` / `実行中` / `確認待ち` / `接続失敗` を表示する。

Codex app-server 経由の `thread/start` / `turn/start` 自動実行は標準導線ではありません。これは `dispatch_mode='auto'` を明示した専用導線だけで使います。

## 絶対に守る不変条件

- manual handoff の追跡taskは、Codex.appを開く前、または開く処理と同時に必ず作る。
- Codex.appを開いたのにFocusmap側に追跡taskが無い状態はバグとして扱う。
- 追跡task作成に失敗した場合は、外部アプリを開かないか、明確な復旧・再登録導線を出す。
- prompt本文は文字化けやURL長制限を避けるため deep link query に載せない。本文はクリップボードを正とし、deep link はCodex.app/ChatGPT Codex入口を開く補助にする。
- 画像添付が deep link で自動添付されると決め打ちしない。
- `未送信` / `prompt_waiting` / thread未検出 / 外部アプリ起動失敗の間は、詳細UIにprompt再コピー導線を残す。
- Macローカル確認は1秒単位でもよいが、クラウド書き込みは軽量・差分・hash抑制を守る。
- Codexの全文ログ、生コマンド出力、full thread history、image body、スクショ原本をTursoへ通常保存しない。
- Codex側の `completed` は Focusmapノードの完了ではない。人間の確認が必要です。
- 既存API契約を壊してUIだけ簡単に見せる修正は禁止。

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
