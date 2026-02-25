# AIチャット タスク追加プランナー v1 仕様書

> 対話しながら自由文から予定を確定するための、選択式 + テキスト併用フロー

## 目的

- ユーザーが自由文で「やりたいこと/やるべきこと」を入力するだけで、短い対話で予定登録まで到達できるようにする。
- 必要情報が不足している場合は、テキスト質問ではなく**選択UI（プルダウン/候補ボタン）**を優先する。
- ただし、常に自由入力で上書き可能にする（例: 6時間）。
- 予定が詰まっている場合は、代替案を段階的に提示してユーザーが選べるようにする。

---

## UX原則

1. 入力は最初に自由文1回。
2. 2手目以降は「選択で早く進める」が基本。
3. すべてのステップで自由入力（テキスト補足）を許可。
4. 提案には短い理由を添える（なぜその順か/時間か）。
5. 1画面内で完結し、操作は2〜4タップを目標。

---

## 収集する情報（必須/任意）

### 必須

- 追加時期（期限ではなく、いつ入れるか）
  - `今日`
  - `3日以内`
  - `今週`
  - `今月`
- 所要時間
  - プリセット: `5分 / 15分 / 30分 / 1時間 / 2時間`
  - 自由入力: 例 `45分`, `6時間`
- カレンダー
  - 既存カレンダーから選択

### 任意（文脈から補完）

- 重要度（高/中/低）
- 固定時刻の有無（例: 16:00固定）
- 分割可否（分割しても良いか）

---

## 会話ステート遷移

### State A: `capture_intent`

- ユーザー自由文を受け取る。
- AIが候補タスクを抽出（1〜3件）し、要約表示。

出力例:

- タスク候補: `請求書処理`, `筋トレ`
- 解釈: `今週中に進めたい`

### State B: `fill_required_slots`

不足情報を選択UIで埋める。

- 追加時期セレクト
- 所要時間セレクト（+ 自由入力）
- カレンダーセレクト

不足がある場合は、AI応答末尾に `ui_controls` を返す。

### State C: `propose_slots`

空き枠探索 + 文脈重みづけで候補を提示（2〜3件）。

- 例: `木 19:00-19:30`, `金 08:00-08:30`, `土 10:00-10:30`
- 各候補に理由を表示。

### State D: `resolve_conflict`（空きなし/条件不一致時）

ユーザーに第1段選択を提示:

1. 既存予定をずらす
2. 別日に入れる
3. タスクを分割する
4. 今回は見送る

選択後、第2段の具体案を2〜3件提示。

### State E: `confirm_and_execute`

- 最終案を確認表示
- `追加する` / `調整する`
- 追加成功時に結果メッセージ

---

## 予定が入らないときの詳細分岐

### 1) `reschedule_existing`

- 既存イベントを動かす候補案を作成
- 例: `A会議を30分後ろに移動して19:00枠を作る`

### 2) `change_window`

- 期間を緩和した候補
- 例: `3日以内 -> 今週`

### 3) `split_task`

- 所要時間を分割
- 例: `60分 -> 30分 + 30分`

### 4) `defer`

- 今回は追加しない
- 再提案リマインドのみ設定

---

## 提案スコアリング（v1）

候補枠スコア `S`:

`S = 0.35 * urgency + 0.25 * context_importance + 0.20 * fit + 0.20 * user_preference`

- `urgency`: 追加時期が短いほど高い
- `context_importance`: 文中の強調語（必須/急ぎ/今日中）で加点
- `fit`: 必要時間に対し枠が適切か
- `user_preference`: 過去に選ばれやすい時間帯/曜日

同点時の優先:

1. より早い日付
2. タスク分割なしで入る枠
3. 直近で疲労が少ない時間帯（夜遅すぎを回避）

---

## API拡張仕様（既存 `/api/ai/chat` を拡張）

### Request（追加フィールド）

```ts
interface PlannerContext {
  mode?: 'task_planner'
  draftPlan?: {
    tasks?: Array<{ title: string }>
    scheduleWindow?: 'today' | 'within_3_days' | 'this_week' | 'this_month'
    durationMinutes?: number
    durationText?: string
    calendarId?: string
    importance?: 'high' | 'medium' | 'low'
    splitAllowed?: boolean
  }
}
```

### Response（追加フィールド）

```ts
interface ChatResponse {
  reply: string
  action?: Action
  options?: Array<{ label: string; value: string }>
  uiControls?: UiControl[]
  plannerState?:
    | 'capture_intent'
    | 'fill_required_slots'
    | 'propose_slots'
    | 'resolve_conflict'
    | 'confirm_and_execute'
  proposalCards?: ProposalCard[]
}

interface UiControl {
  type: 'select' | 'text'
  key: 'scheduleWindow' | 'duration' | 'calendarId' | 'freeText'
  label: string
  required?: boolean
  options?: Array<{ label: string; value: string }>
  placeholder?: string
  allowCustom?: boolean
}

interface ProposalCard {
  id: string
  title: string
  startAt: string
  endAt: string
  calendarId: string
  reason: string
  impact?: string
}
```

---

## フロント実装方針

対象: `src/components/ai/ai-chat-panel.tsx`

### 追加状態

- `plannerState`
- `draftPlan`
- `uiControls`
- `proposalCards`
- `conflictMode`

### 追加UI

- メッセージバブル下に「選択カード領域」
- セレクト + カスタム入力のハイブリッド行
- 候補枠カード（理由つき）
- 詰まり時の2段分岐カード

---

## 受け入れ条件（v1）

1. 自由文から開始し、最短2〜4操作で予定追加できる。
2. 必須情報（追加時期/所要時間/カレンダー）が不足したら選択UIが表示される。
3. 所要時間はプリセット選択と自由入力を両立できる。
4. `3日以内` 指定時は具体候補枠を2〜3件提示できる。
5. 空きがない場合に「ずらす/別日に入れる/分割/見送り」の分岐が出る。
6. 各提案に1行理由が表示される。

---

## 実装フェーズ

### Phase 1（最小導入）

- `plannerState` と `uiControls` の導入
- 必須情報3点の収集
- 候補枠2〜3件提示
- 予定追加確定

### Phase 2（詰まり時の強化）

- `resolve_conflict` 2段分岐
- 既存予定移動提案
- 分割提案

### Phase 3（精度改善）

- ユーザー選好の学習
- 提案スコア最適化
- 理由生成の改善

---

## 未決定項目（次回）

1. カレンダー移動提案の上限（何件まで変更候補を出すか）
2. 既存予定を動かす際の保護ルール（固定イベント/重要イベント）
3. 学習データ保持期間（選好の保存期間）

---

## 更新履歴

- 2026-02-25: v1 初版（対話設計 + 状態遷移 + API仕様）
