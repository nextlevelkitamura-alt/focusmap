# メモビュー + AI自然言語インテーク

## 目的

スマホ音声入力やCodex/Claude Codeスキルから投げられる自然文を、すぐ実行せずに「タイトル案・メモ・リンク・所要時間・時間候補」に整理する。

例:

- これを勉強したい
- これを調べないといけない
- 長期的にこういうことをやってみたい

## 原則

- プランを立てるだけで、タスク作成・カレンダー登録・外部実行はしない
- 内容が濃い場合は、背景・論点・次に調べることをメモに厚めに残す
- メモ内URLはクリック可能にし、Google DocsやWeb資料へ遷移できるようにする
- 独立したリンク追加欄は作らず、メモ本文内のURLを自動リンク化する
- サブタスク候補は必要な場合だけ出し、初期状態では実行タスクを作らない
- PCは看板ボード、スマホは看板ではなく状態/タグフィルタ付きの1列リストにする
- スマホの生成結果は下からシートで表示し、メモの見出しがあれば保存できる
- 時間候補は「最初の一歩」を少数だけ出す
- 承認や実行は別フェーズに分ける
- APIキーは環境変数で管理し、UI・コード・ログに保存しない

## 現在の実装

### UI

- `src/components/long-term/long-term-planner-view.tsx`
- ダッシュボードの `メモ` タブとして表示する予定
- 入力文を `/api/ai/long-term-planner` に送り、結果を表示する
- 結果は `ai_suggestions` に `long_term_planning` として保存される
- 保存されるのは提案のみで、`tasks` や Google Calendar は変更しない

### API

- `POST /api/ai/long-term-planner`
- 認証済みユーザーのみ
- Googleカレンダー連携がある場合は空き時間コンテキストを参照して時間候補を作る
- AIキー未設定時は簡易フォールバックでプランを返す

返却形式:

```json
{
  "plan": {
    "title": "全体タイトル",
    "tags": ["学習", "調査"],
    "memo_status": "time_candidates",
    "horizon": "2週間",
    "summary": "概要",
    "memo": "保存用メモ。参考: https://docs.google.com/...",
    "detected_links": [
      {
        "label": "関連資料",
        "url": "https://docs.google.com/document/d/..."
      }
    ],
    "subtask_suggestions": [
      {
        "title": "サブタスク候補",
        "estimated_minutes": 45,
        "reason": "理由"
      }
    ],
    "schedule_proposals": [
      {
        "title": "予定名",
        "scheduled_at": "2026-05-11T10:00:00+09:00",
        "estimated_time": 60,
        "calendar_id": "primary",
        "reason": "この時間に置く理由"
      }
    ]
  },
  "suggestionId": "uuid",
  "provider": "gemini",
  "calendarConnected": true
}
```

## 今後の接続方針

Codex/Claude Codeスキルから入れる場合も、まずはこのAPIに自然文を送って `ai_suggestions` に提案を積む。

次フェーズで追加するなら:

- `GET /api/ai/long-term-planner/suggestions` で未処理提案を一覧
- `POST /api/ai/long-term-planner/[id]/accept` でメモカード化
- `POST /api/ai/long-term-planner/[id]/schedule` でカレンダー登録

この分離により、サブスク実行系のCodex/Claude Codeと、内蔵AI APIのどちらから入っても「提案までは自動、実行は承認後」に揃えられる。
