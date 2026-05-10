# メモビュー + AI自然言語インテーク 計画

## Context

1日のタスク一覧とは別に、長期的にやりたいこと、学びたいこと、調べたいことを溜めておく場所を作る。

スマホの文字起こしや、Codex/Claude Codeスキルから雑に投げた文章を、AIが次の形に整える。

- タイトル案
- メモ本文
- メモ内リンク
- カテゴリ
- サブタスク候補（必要な場合のみ）
- 所要時間の推定
- カスタム所要時間
- 時間候補

重要: 初期実装では「プラン作成」と「提案保存」までに留める。タスク作成、Google Calendar登録、外部実行はユーザー承認後の別フェーズに分離する。

## Product Direction

メモビューは「Today Boardの外側」にある長期インボックス。

Todayは今日やることを見る場所。メモビューは、まだ今日に落ちていない願望、学習、調査、アイデアを眺めて、必要なものだけ予定候補に変える場所。

今後の実装はCodex側で進める前提にする。Claude Code/Codex比較用の旧 `Wishlist` ハンドオフ文は参照情報に留め、ユーザーに見える名前と仕様はこの `メモ` 設計を正とする。

## View

View key は既存の `long-term` を使う。メニュー表示名は `メモ` に固定する。

推奨ラベル:

- PC: `メモ`
- モバイル: `メモ`

画面見出しは `メモ` だけだと用途が広すぎるので、以下から選ぶ。

| 候補 | 印象 |
| --- | --- |
| `思考メモ` | 雑に投げた考えを整理する場所として分かりやすい |
| `あとで考える` | Todayに入れる前の保留場所として自然 |
| `育てるメモ` | 学習・調査・アイデアを長期で育てる感じが出る |
| `アイデアメモ` | アイデア寄り。調査や学習まで含めるには少し軽い |
| `ストック` | 短くてUIに収まりやすいが、意味が少し抽象的 |
| `ナレッジメモ` | リンクや資料が多い用途に合う |
| `保留メモ` | 実行前の置き場として正確。ただし少し事務的 |

現時点の推奨は `思考メモ`。メニューは `メモ`、画面見出しは `思考メモ` にする。

## Navigation

### Desktop

`src/components/layout/header.tsx`

タブ順:

1. Today
2. メモ
3. マップ
4. 習慣
5. 理想

### Mobile

`src/components/mobile/bottom-nav.tsx`

推奨は4列:

1. Today
2. メモ
3. 習慣
4. AI

`More` は削除または後回し。AIインテークはメモ画面内の上部入力と、右下FABの両方から開ける。

## UI Design

### Layout

PCは看板ボードを主軸にする。スマホは看板ではなく、単一リスト + フィルタで見る。

- PC: 看板ボード。列は横並び、カードはドラッグ&ドロップ。
- スマホ: 1列リスト。状態フィルタとタグフィルタで絞り込む。

構成:

```text
[メモビュー]
┌─────────────────────────────────────────┐
│ 自然言語インテーク入力欄        [送信]   │
├─────────────────────────────────────────┤
│ フィルタ: 状態 / タグ / 予定候補          │
├─────────────────────────────────────────┤
│ PC: 看板ボード                           │
│ ┌ 未整理 ┐ ┌ 整理済み ┐ ┌ 時間候補あり ┐ │
│ │カード  │ │カード     │ │カード         │ │
│ └────────┘ └───────────┘ └──────────────┘ │
├─────────────────────────────────────────┤
│ ▼ 完了済み（アーカイブ）                 │
│  ✓ 〇〇を調べた                          │
└─────────────────────────────────────────┘
```

### Card Elements

メモカードには以下を持たせる。

- カバー画像（任意）
- タイトル
- カテゴリタグ: `学習` / `調査` / `目標` / `アイデア`
- メモ本文（折りたたみ）
- メモ内リンク（Google Docs、Notion、Web記事など）
- 日付
- 開始時間
- 所要時間
- カスタム所要時間コントロール
- 時間候補
- カレンダー登録ボタン
- 完了チェック
- サブタスク候補（必要な場合のみ）

### Card Summary

カードの下部は、開かなくても判断できる情報だけに絞る。

推奨表示:

- 1行メモ要約
- 時間候補: `火 21:00 / 60分`
- 所要時間: `75分`
- サブタスク候補数: `候補 3`
- 添付画像数: `画像 2`

カードに本文を長く出しすぎない。本文、画像、時間編集は詳細ポップアップで扱う。リンクは独立セクションを作らず、メモ本文内のURLを自動リンク化する。

### Board Mode

PCでは看板モードを標準表示にする。

列:

1. `未整理`: 入力直後、AI整理前
2. `整理済み`: タイトル/メモ/リンクが整った状態
3. `時間候補あり`: AIが時間候補を出した状態
4. `予定済み`: ユーザーが明示的にカレンダー登録した状態
5. `完了`: アーカイブ相当

操作:

- ドラッグ&ドロップで列移動
- PCでは3〜5列の横並び
- 列名を編集できる
- 列を追加/並び替え/非表示にできる
- 列ごとの説明文や色を編集できる
- カードのタグを複数付けられる
- PCでは状態列とタグでフィルタできる
- 列移動だけではGoogle Calendar登録しない
- `予定済み` 列へ直接ドロップした場合も、登録確認モーダルを出す

初期実装からPCは看板を優先する。

### Mobile Filter Mode

スマホでは看板ボードを表示しない。表示範囲が狭いため、カードは1列リストにしてフィルタで切り替える。

フィルタ:

- 状態: `すべて` / `未整理` / `整理済み` / `時間候補あり` / `予定済み` / `完了`
- タグ: `学習` / `調査` / `目標` / `アイデア` / ユーザー追加タグ
- 時間: `時間候補あり` / `今日以降` / `未設定`

UI:

- 上部に横スクロールの状態チップ
- その下にタグチップ
- `フィルタ` ボタンから詳細条件を開く
- 1列カードリスト
- カードを開くと下から詳細シートが出る

## Detail Popup

カードを開いた時は、中央に編集できる詳細モーダルを出す。モバイルでは下からのシート、PCでは中央モーダル + 必要なら右側プレビュー。

### Popup Layout

```text
┌──────────────────────────────────────────────┐
│ タイトル                                      │
│ [AIと税制の調査________________________]      │
├──────────────────────────────────────────────┤
│ カバー画像 / 添付画像                         │
│ [ + 画像を追加 ] [画像サムネイル] [画像...]    │
├──────────────────────────────────────────────┤
│ メモ                                          │
│ [本文エディタ。URLはクリック可能]              │
├──────────────────────────────────────────────┤
│ 時間                                          │
│ 日付 [____] 開始 [____] 所要時間 [-]75分[+]   │
│ [候補を再提案]                                │
├──────────────────────────────────────────────┤
│ サブタスク候補（折りたたみ）                  │
│ □ 経費扱いを調べる 45分                       │
│ □ 会計ソフト分類を確認 30分                   │
├──────────────────────────────────────────────┤
│ [保存] [予定に入れる] [Todayへ送る] [削除]     │
└──────────────────────────────────────────────┘
```

### Editable Fields

- タイトル
- カテゴリ
- メモ本文
- カバー画像
- 添付画像
- 日付
- 開始時間
- 所要時間
- サブタスク候補

### Images

画像は2種類に分ける。

- カバー画像: カード一覧で見える代表画像
- 添付画像: 詳細モーダル内で見る参考画像、スクショ、資料画像

既存の `ideal_goals.cover_image_url` / `cover_image_path` と `ideal_item_images` が使える。メモ本文に貼られた画像URLは添付画像として抽出できるとよい。

### Popup Actions

- `保存`: メモカードの内容だけ保存
- `予定に入れる`: Google Calendar登録。確認後に実行
- `Todayへ送る`: `tasks` に昇格。必要ならサブタスクも `parent_task_id` 付きで作る
- `候補を再提案`: 時間候補だけAIに再提案させる
- `削除`: 確認ダイアログを出す

### Mobile Generate Sheet

スマホでは、まず `思考メモ` の簡易入力にメモを貼り、`生成` を押す。生成結果は下からシートで出す。

このシートには画像入力は出さない。スマホの生成後編集は、保存に必要な最小項目に絞る。

表示/編集項目:

- メモの見出し: 編集可能。これが1文字以上あれば保存できる
- メモ本文: 編集可能。URLは自動リンク化
- 所要時間: AI推定 + カスタム入力
- 日付/開始時間: 任意入力
- 時間候補: AI提案候補を選べる。手動追加もできる
- サブタスク候補: 折りたたみ。必要な場合だけ開く

アクション:

- `メモに保存`: メモの見出しがあれば押せる
- `時間候補を使う`: 候補を日付/開始時間/所要時間に反映
- `カレンダーに入れる`: 日付/開始時間/所要時間が揃った場合だけ押せる。押した後に確認して登録
- `閉じる`

スマホでは画像追加は詳細編集の後続フェーズに回す。

### Visual States

| 状態 | 見た目 |
| --- | --- |
| 未定 | 通常カード。白/グレーまたはダークテーマでは黒背景 + グレー枠 |
| 予定候補あり | ティールの薄い枠 + `候補` バッジ |
| カレンダー登録済み | 青いボーダー + `予定済み` バッジ |
| 完了 | グレーアウトし、下部アーカイブへ移動 |

初期実装では `予定候補あり` まで。`カレンダー登録済み` は承認実行フェーズで追加する。

## AI Intake

### Input

メモビュー上部には簡易入力を置く。最初から巨大なフォームにせず、スマホで雑に貼れることを優先する。

例:

```text
最近AIの税制とか調べたいんだよね、確定申告前に絶対やらないと
```

スマホでは音声入力後の文章がそのまま入る前提。アプリ内音声録音はスコープ外。

推奨UI:

- 1〜3行のコンパクト入力
- 送信ボタン
- マイク/貼り付け導線は任意
- 詳細入力は提案レビュー側で編集する

### Output Schema

```json
{
  "title": "AIと税制の調査",
  "category": "調査",
  "tags": ["税制", "確定申告", "AI"],
  "memo_status": "time_candidates",
  "memo": "背景、調べる観点、次に確認する資料を整理した本文。参考: https://docs.google.com/...",
  "detected_links": [
    {
      "label": "関連Googleドキュメント",
      "url": "https://docs.google.com/document/d/..."
    }
  ],
  "subtask_suggestions": [
    {
      "title": "AI関連支出の経費扱いを調べる",
      "estimated_minutes": 45,
      "reason": "確定申告前の判断材料にするため"
    }
  ],
  "duration": {
    "estimated_minutes": 60,
    "custom_minutes": 75,
    "source": "ai_estimated"
  },
  "time_candidates": [
    {
      "label": "火 21:00",
      "scheduled_at": "2026-05-12T21:00:00+09:00",
      "duration_minutes": 60,
      "reason": "夜の空き時間で集中しやすい"
    }
  ]
}
```

### Memo Links

メモ本文内のURLはクリック可能にする。用途はGoogle Docs、Notion、Web記事、Drive資料など。

実装方針:

- メモ本文はURLを自動リンク化する
- UIに独立した `リンク` セクションは作らない
- AIがリンクを抽出できる場合は内部的に `detected_links[]` に持ってよいが、表示はメモ本文内リンクを主にする
- `ideal_items.reference_url` は既存フィールドなので、重要リンクをサブアイテムとして保存できる
- リンクは新規タブで開く
- `http://` / `https://` のみ許可し、`javascript:` などは無効化する

## Subtask Strategy

ユーザーの言う「タスク案」は、Focusmapの既存構造に合わせると2種類に分けるべき。

### 1. メモ内のサブタスク候補

メモカードの中に出す軽いチェックリスト。

用途:

- 学習や調査の分解
- まだToday Boardに出すほどではない細かい行動
- ユーザーが全体像を見るための補助

保存先:

- `ideal_items`
- `session_minutes` に推定時間
- `description` に理由やメモ
- `reference_url` に関連リンク
- `is_done` でチェック管理

### 2. Focusmap本体のタスク/サブタスク

実行段階に入ったものだけ `tasks` テーブルへ昇格する。

既存構造:

- `tasks.parent_task_id` でサブタスクを表現
- `tasks.is_group` でルート/グループ的なタスクを表現
- Today Boardやカレンダーに出る

推奨:

- AIインテーク直後は `tasks` を作らない
- まずメモカード + `ideal_items` のサブタスク候補として保存
- ユーザーが「今週やる」「Todayに送る」「予定化する」を押した時だけ `tasks` に昇格

理由:

- 長期の願望を入れただけでToday Boardが散らからない
- AIの過剰分解で実行タスクが増えすぎない
- Focusmapの「人間が承認する」方針に合う

UI上の扱い:

- 初期表示ではサブタスク候補を折りたたみ
- `サブタスク候補 3件` のように件数だけ見せる
- 展開するとチェックリスト
- 各行に `Todayへ送る` / `予定候補を出す` の小アクションを置く

### Proposal Review

AI解析後、すぐDBやカレンダーへ書き込まず、提案レビューを表示する。

レビューUIの操作:

- `メモに保存`: メモカードとして保存
- `時間だけ変更`: カスタム所要時間を調整
- `候補を再提案`: 時間候補だけ再生成
- `サブタスク候補を見る`: 必要な場合だけ展開
- `破棄`: 何も保存しない

## Duration UX

所要時間はAIが推定するが、ユーザーが必ず変更できる。

推奨UI:

- クイックチップ: `15分` / `30分` / `45分` / `60分` / `90分`
- カスタム: `-` `75分` `+`
- 詳細モーダルではホイールピッカーまたは数値入力

保存時は `duration_minutes` に確定値を入れる。

## Data Design

新規テーブルは作らず、既存の `ideal_goals` / `ideal_items` を活用する。

### ideal_goals

メモカード本体。

追加候補:

- `category text`
- `tags text[]`
- `scheduled_at timestamptz`
- `duration_minutes integer`
- `google_event_id text`
- `is_completed boolean default false`
- `memo_status text default 'unsorted'`
- `ai_source_payload jsonb`

`memo_status` は看板列とスマホフィルタの共通キーとして使う。

初期値:

- `unsorted`
- `organized`
- `time_candidates`
- `scheduled`
- `completed`

ユーザーが列名を変えてもDB上の安定キーは残す。表示名、色、並び順、表示/非表示はユーザー設定に持つ。

### Board Column Settings

看板列の編集設定は新規テーブルを作らず、まず `ai_user_context.preferences` または同等のユーザー設定JSONに保存する。

例:

```json
{
  "memo_board_columns": [
    { "key": "unsorted", "label": "未整理", "color": "gray", "visible": true, "order": 0 },
    { "key": "organized", "label": "整理済み", "color": "blue", "visible": true, "order": 1 },
    { "key": "time_candidates", "label": "時間候補あり", "color": "teal", "visible": true, "order": 2 },
    { "key": "scheduled", "label": "予定済み", "color": "indigo", "visible": true, "order": 3 },
    { "key": "completed", "label": "完了", "color": "gray", "visible": true, "order": 4 }
  ]
}
```

列追加を許可する場合も、内部キーは `custom_<uuid>` にする。`scheduled` と `completed` は動作に意味があるため削除不可、非表示のみ可。

### ideal_items

サブタスク候補、チェックリスト、重要リンク。

既存フィールドでかなり足りる。

- `title`: サブタスク名
- `description`: 理由、補足、短いメモ
- `session_minutes`: 推定所要時間
- `is_done`: チェック状態
- `reference_url`: Google Docs等へのリンク
- `parent_item_id`: サブタスク候補の階層化

追加が必要なら後回し:

- `source text`
- `ai_confidence numeric`

## API Design

### `POST /api/ai-ingest`

自然文を受け取り、提案JSONを返す。

初期実装:

- 提案を返すだけ
- 必要なら `ai_suggestions` に `memo_ingest` として保存
- `ideal_goals` にはまだ書き込まない

### `POST /api/memos`

承認済み提案を `ideal_goals` / `ideal_items` に保存する。

### `POST /api/memos/[id]/schedule`

承認後にGoogle Calendarへ登録する。

このAPIは初期実装では作っても呼ばない、またはPhase 3まで保留。

## AI Execution Modes

### Mode A: Subscription Runner

`CLAUDE_CODE_AVAILABLE=true` の場合、既存の `ai_tasks` / `task-runner.ts` 経由で `claude -p` を使う。

安全策:

- `ANTHROPIC_API_KEY` が環境変数にないことを確認
- `--max-budget-usd 2.00`
- `--max-turns 10`

### Mode B: Built-in External API

サブスク実行が使えない場合のみ、サーバーサイドで外部AI APIを呼ぶ。

環境変数:

```env
EXTERNAL_AI_API_KEY=
EXTERNAL_AI_API_BASE_URL=
EXTERNAL_AI_MODEL=
```

注意:

- APIキーは絶対にコミットしない
- クライアントに露出しない
- ログに出さない
- 既にチャットへ貼られたキーは漏えい済みとして無効化・再発行する

新規ユーティリティ:

- `src/lib/ai-client.ts`

OpenAI互換の `chat/completions` を基本形にする。ただし既存の `src/lib/ai/providers` と重複しすぎる場合は、そこへ統合する。

## Implementation Phases

### Phase 1: Plan-only メモ

- `long-term` view をメモビューとして表示
- 簡易入力、提案レビュー、カードグリッドの静的UI
- AI提案は `ai_suggestions` に保存
- タスク作成/カレンダー登録はしない
- メモ内URLをクリック可能にする

### Phase 2: DB Fields + Card Persistence

- `ideal_goals` にメモ用フィールド追加
- `ideal_items` をサブタスク候補/リンクとして使用
- `メモに保存` でカード化
- 完了チェックでアーカイブへ移動
- タグ追加/編集/フィルタ
- PC看板列の表示名・色・並び順編集

### Phase 3: Duration and Time Candidate UX

- AI推定所要時間
- カスタム所要時間
- 時間候補の再提案
- カレンダー登録前のプレビュー
- スマホ生成シートから日付/開始時間/所要時間を手動入力

### Phase 4: Google Calendar Registration

- ユーザーが明示的に押した場合のみ登録
- `google_event_id` 保存
- カードを `予定済み` に変更

### Phase 5: Dual AI Mode

- `src/lib/ai-client.ts`
- Subscription Runner / External API の切り替え
- Codex/Claude Codeスキルから `/api/ai-ingest` に投稿できる状態にする

## Primary Files

- `src/components/dashboard/memo-board-view.tsx`
- `src/components/dashboard/memo-card.tsx`
- `src/components/dashboard/memo-card-detail.tsx`
- `src/components/dashboard/memo-filter-bar.tsx`
- `src/components/dashboard/memo-generate-sheet.tsx`
- `src/app/api/ai-ingest/route.ts`
- `src/app/api/memos/route.ts`
- `src/app/api/memos/[id]/schedule/route.ts`
- `src/lib/ai-client.ts`
- `supabase/migrations/20260510_add_memo_fields_to_ideal_goals.sql`
- `src/types/database.ts`

## Acceptance Criteria

- `long-term` view でメモビューが表示される
- PCは看板ボード、スマホは1列リスト + フィルタで破綻しない
- PCで看板列の表示名・色・並び順を変更できる
- PCで状態列とタグの両方でフィルタできる
- スマホで状態フィルタとタグフィルタを使ってカードを絞り込める
- 自然文入力から、タイトル案/メモ/リンク/所要時間/時間候補が出る
- サブタスク候補は必要な場合だけ折りたたみ表示される
- 独立したリンク追加欄はなく、メモ内リンクからGoogle Docs等へ遷移できる
- スマホでは生成後に下シートが出て、メモの見出し/本文/所要時間/時間候補/サブタスク候補を編集できる
- スマホではメモの見出しが1文字以上あれば保存できる
- 日付/開始時間/所要時間が揃った時だけ、明示操作でカレンダー登録できる
- 所要時間をチップとカスタム入力で変更できる
- 初期実装では、AI提案後に勝手にタスク作成・カレンダー登録されない
- 承認後の保存/登録は別操作として明確に分離される
- APIキーがコード、ログ、クライアントに露出しない
