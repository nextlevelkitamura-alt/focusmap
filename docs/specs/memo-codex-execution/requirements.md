# Memo Codex Execution Requirements

## Status

Proposed.

## Goal

スマホのメモを、思いついた瞬間に本文だけで保存できる入力面にしつつ、必要な時だけ Codex へ即実行、またはマインドマップ候補として整理できるようにする。

## Principles

- メモ本文を主役にする。タイトルは本文の要約であり、最初から必須入力にしない。
- `今すぐ実行` は速さを優先し、本文を最小テンプレートで包んで Codex に渡す。
- `整理する` は分類と候補提示までに留める。予定作成、既存予定変更、マップ接続、Codex実行はユーザー承認後に行う。
- マインドマップには自動追加しない。AIは候補場所まで出し、ユーザーが `ここに接続` または `変更` で確定する。
- Focusmap内AIで重いリサーチはしない。リサーチ相当は `external_ai_handoff` として Codex へ渡す導線に寄せる。
- Codex実行中だけ3秒単位で追跡する。確認待ち、完了、失敗は3秒監視しない。
- 確認待ち中にCodex側へ追加プロンプトが送られた場合は再開を検知し、`running` に戻して3秒監視を再開する。
- DBに詳細な生ログは保存しない。DBは現在状態、通常ログ、チャット風活動メッセージだけを持つ。

## Memo UI

### Primary Input

- 新規/編集シートは本文入力を最優先にする。
- タイトル欄は常時主役にしない。本文が入ったら `タイトル生成` を表示し、生成後は小さく編集可能にする。
- 画像は本文の補助素材として扱う。
- メモ一覧の入力行は、入力欄の右に音声ボタン、その右端に追加ボタンを置く。

### Primary Actions

本文がある時の主導線は2つに絞る。

- `整理する`
- `今すぐ実行`

`今すぐ実行` の通常タップは、本文を以下の最小テンプレートで Codex に渡す。

```text
以下のメモをもとに、すぐ実行してください。
原文のニュアンスを優先し、不明点があれば最小限だけ確認してください。

[メモ]
{body}
```

サブ操作として `整えて送る` / `タスク化して送る` を後から追加できるようにするが、初期導線では通常タップを最短にする。

## Organize Result

`整理する` は最大2提案まで返す。

```ts
type MemoIntent =
  | "map_candidate"
  | "external_ai_handoff"
  | "schedule_create"
  | "schedule_update"
  | "keep_note"
```

`execute_now` は分類結果ではなく、別ボタンの即実行導線として扱う。

整理結果には以下を含める。

- 要約タイトル
- intent
- 第一候補の推奨アクション
- 第二候補の推奨アクション
- Codexへ渡す場合のプロンプト案
- マップ候補の場合のプロジェクト/ノード候補
- 予定候補の場合の新規予定または既存予定変更案

## Project And Mindmap Context

API料金を抑えるため、段階的にコンテキストを読む。

### Stage 1: Light Classification

全プロジェクトを読むが、各プロジェクトは短くする。

- `projects.title`
- `projects.description` または `projects.purpose`
- `project_contexts.heading`
- `project_contexts.details` の先頭200-300字
- `project_contexts.progress_status`
- `project_contexts.progress` の先頭100-150字

この段階では、intent と関連プロジェクト候補1-3件だけを判定する。

### Stage 2: Map Placement

`map_candidate` の場合だけ、候補プロジェクト1-3件のマインドマップ構造を読む。

- プロジェクトタイトル
- プロジェクト説明/文脈の短縮版
- マインドマップツリー
- node id
- title
- parent
- is_group
- status

ノードの長いメモ、画像、関係ないプロジェクトのマップは入れない。

## Map Placement UX

AIは候補場所まで提示する。

```text
Focusmap > モバイルUI改善 > メモ編集UI
に追加するのがよさそうです

[ここに接続] [変更] [マップに入れない]
```

`変更` はスマホでは下部シートで出す。

- プロジェクト候補
- AI候補ノード
- ノード名検索
- ツリーリスト
- 配置方法: `この下に追加` / `同じ階層に追加` / `新しい枝にする`

大きいマップを直接触らせず、検索と候補選択で素早く変更できるようにする。

## Codex Execution Status

メモ一覧とメモ詳細の両方にAI実行状態を出す。

### List Badge Priority

1. 確認待ち
2. 実行中
3. プロンプト待ち
4. 失敗
5. 今日完了
6. 予定化
7. マップ接続
8. 整理済み

完了バッジは今日中だけ一覧に表示し、翌日以降は詳細の履歴にだけ残す。

### Detail Panel

メモ詳細はログビューではなくチャット風にする。

- 実行中: 活動メッセージを表示する
- 確認待ち: 最新の確認内容を最も目立つ位置に出す
- 完了: 今日中は結果を表示し、それ以降は折りたたみでよい

## Codex Monitoring

### Polling

- `running`: 3秒ごとにCodex状態を確認する
- `awaiting_approval`: 3秒監視しない
- `completed` / `failed`: 3秒監視しない
- 確認待ち中は再開検知だけ軽く行う。メモ詳細を開いている時は3秒で再開検知してよい。

確認待ち後、Codex側に追加プロンプトが送られたら以下を検知して再開する。

- rollout JSONLに新しい `user_message`
- rollout JSONLに新しい `task_started`
- thread `updated_at_ms` が確認待ち後に進んでいる

再開時は `running` に戻し、3秒監視と活動メッセージ追加を再開する。

### DB Storage

DBに保存するもの。

- `ai_tasks.status`
- `ai_tasks.executor`
- `ai_tasks.prompt`
- source memo id
- `codex_thread_id`
- `started_at`
- `completed_at`
- `result.codex_run_state`
- `result.current_step`
- `result.live_log` の最新tail
- `result.last_activity_at`
- `result.codex_thread_snapshot`

DBに保存しないもの。

- Codexの全生ログ
- 5秒/3秒ごとの全履歴
- 全コマンド出力
- 巨大raw JSON

## Activity Messages

チャット風に表示する活動記録を、1実行最大50件まで保存する。

```ts
type AiTaskActivityMessage = {
  id: string
  task_id: string
  user_id: string
  role: "system" | "codex" | "user" | "status"
  kind:
    | "sent"
    | "progress"
    | "question"
    | "approval"
    | "resumed"
    | "completed"
    | "failed"
  body: string
  importance: "normal" | "important"
  created_at: string
}
```

追加タイミング。

- Codexへ送信した
- threadを検出した
- `prompt_waiting` から `running` へ変わった
- `running` から `awaiting_approval` へ変わった
- `running` から `completed` / `failed` へ変わった
- Codexが質問/確認を出した
- 確認待ちから再開した
- `current_step` が大きく変わった
- 実行中に2分以上同じ作業が続いた

50件を超えた場合は、古い通常進捗から削除する。以下の重要イベントは優先して残す。

- 送信
- 質問
- 確認待ち
- 再開
- 完了
- 失敗
- ユーザー回答

## Retention

初期実装ではAI要約による自動圧縮はしない。

- `live_log` は最大文字数を超えたら機械的に最新tailだけ残す
- 古い詳細ログはDBにそもそも保存しない
- 要約はユーザーが明示的に `この実行を要約` を押した時だけ将来追加する

## Acceptance Criteria

- メモ本文だけで保存できる。
- 本文入力後にタイトル生成導線が出る。
- メモから `今すぐ実行` でCodexへ渡せる。
- 実行中メモは一覧と詳細に状態バッジが出る。
- 実行中だけ3秒更新される。
- 確認待ちでは活動メッセージを増やさず、最新の確認内容を表示する。
- 確認待ち後にCodex側で追加プロンプトが送られたら `running` に戻る。
- 活動メッセージは最大50件で、重要イベントを優先保持する。
- `整理する` は最大2提案を返し、マップ候補なら候補場所まで出す。
- マップ接続は自動追加せず、ユーザー承認後に保存する。
