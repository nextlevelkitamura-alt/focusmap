# カレンダー予定入力機能 設計書

## 現状の課題

### Phase 1 完了時点の状況
- ✅ Google Calendar OAuth認証
- ✅ タスク→カレンダー自動同期（scheduled_at + estimated_time設定時）
- ✅ 同期済みタスクの視覚的表示

### 課題
1. **予定入力のUXが不便**
   - scheduled_atとestimated_timeを別々に設定する必要がある
   - 空き時間を確認しながら予定を入れられない
   - 日付選択UIが小さく、時刻入力が面倒

2. **カレンダービューが静的**
   - 右サイドバーのカレンダーはモックアップのまま
   - 実際のGoogleカレンダーイベントが表示されない
   - タスクをドラッグ＆ドロップで予定に入れられない

3. **自動スケジューリング機能がない**
   - ユーザーが手動で時間を探さなければならない
   - 「このタスクに最適な時間を提案」機能がない

---

## 目標機能

### 1. スケジューリングUI改善

#### 1.1 クイックスケジューリングモーダル
**目的**: タスクに予定を素早く設定できるUI

**デザイン**:
```
┌─────────────────────────────────────────────────┐
│  「資料作成」タスクの予定を設定                  │
├─────────────────────────────────────────────────┤
│                                                 │
│  📅 日付時刻                                     │
│  ┌─────────────────────────────────┐            │
│  │ 2026年1月27日(月) 14:00        │            │
│  └─────────────────────────────────┘            │
│                                                 │
│  ⏱️ 所要時間                                     │
│  [ 30分 ] [ 1時間 ] [ 2時間 ] [ カスタム ]     │
│                                                 │
│  終了時刻: 16:00                                │
│                                                 │
│  ─────────────────────────────────────          │
│  この時間帯の予定:                               │
│  • 13:00-14:00  火曜MTG                         │
│  • 16:30-17:00  デイリー                        │
│  ─────────────────────────────────────          │
│                                                 │
│  [ キャンセル ]              [ 予定を設定 ]     │
└─────────────────────────────────────────────────┘
```

**機能**:
- タスクノードをダブルクリック or カレンダーアイコンクリックでモーダル表示
- 日付・時刻をビジュアルに選択（カレンダー + 時間スライダー）
- 所要時間をワンクリック選択（30分/1時間/2時間/カスタム）
- その時間帯の既存予定を表示（競合チェック）
- 「空き時間を提案」ボタン（AI/ルールベース）

#### 1.2 週間カレンダービュー（右サイドバー改善）

**現状**: 静的なモックアップ
**改善後**: 実際のGoogleカレンダーデータを表示

**機能**:
```
┌──────────────────────────────────────────┐
│  Googleカレンダー           [今週▼]      │
├──────────────────────────────────────────┤
│  月25  火26  水27  木28  金29            │
│ ┌────┬────┬────┬────┬────┐           │
│ │    │■■■■│    │    │    │ 9:00      │  ← Googleイベント
│ │    │MTG│    │    │    │ 10:00     │
│ │■■■■│    │    │    │■■■■│ 11:00     │  ← Shikumikaタスク
│ │資料│    │    │    │振返│           │
│ │作成│    │    │    │    │           │
│ └────┴────┴────┴────┴────┘           │
│                                          │
│  [+] タスクを予定に追加                   │
└──────────────────────────────────────────┘
```

**データ取得**:
- `GET /api/calendar/events?start=2026-01-25&end=2026-01-31`
- GoogleカレンダーAPI: `events.list`で週のイベントを取得
- Shikumikaのscheduled_atタスクと統合表示

**インタラクション**:
- イベントをクリック → 詳細モーダル
- タスクをドラッグ → カレンダーにドロップで予定設定
- 空き時間をクリック → 新規タスク作成

---

### 2. 自動スケジューリング機能

#### 2.1 空き時間提案アルゴリズム

**ユースケース**:
「この2時間のタスクをいつやるべき？」

**提案ロジック**:
1. **基本ルール**
   - 既存予定と重ならない時間帯を抽出
   - 営業時間内（9:00-18:00、設定可能）
   - 最低休憩時間（15分）を確保

2. **優先順位付け**
   - 朝イチ枠（9:00-11:00）: 集中作業に最適
   - 午後枠（14:00-16:00）: 会議後の作業時間
   - 夕方枠（16:00-18:00）: 締め前の追い込み

3. **タスクの特性を考慮**
   - 優先度が高い → 早い時間を提案
   - 所要時間が長い → 分割可能かを確認
   - 親タスクとの依存関係を考慮

**API設計**:
```typescript
POST /api/calendar/suggest-time
Body: {
  taskId: string,
  estimatedTime: number, // 分
  preferredDays?: string[], // ['2026-01-27', '2026-01-28']
  workingHours?: { start: '09:00', end: '18:00' }
}

Response: {
  suggestions: [
    {
      start: '2026-01-27T09:00:00',
      end: '2026-01-27T11:00:00',
      score: 95, // 0-100
      reason: '朝イチの集中時間。予定なし。'
    },
    {
      start: '2026-01-27T14:00:00',
      end: '2026-01-27T16:00:00',
      score: 80,
      reason: 'ランチ後の時間。16:30にデイリーMTGあり。'
    }
  ]
}
```

#### 2.2 ワンクリックスケジューリング

**UI**:
```
タスクノードに「自動予定」ボタンを追加
┌────────────────────────────────┐
│ 資料作成  ⏱️ 2h  [📅 自動予定]  │
└────────────────────────────────┘

クリック後:
┌────────────────────────────────┐
│ 提案: 明日 9:00-11:00 (朝イチ)  │
│ [他の時間を見る] [この時間でOK]  │
└────────────────────────────────┘
```

---

### 3. カレンダー→タスク同期（Phase 2）

#### 3.1 Googleカレンダーイベントのインポート

**ユースケース**:
- Googleカレンダーで作成した会議予定をShikumikaに取り込む
- 既存のGoogleイベントをタスク化して管理したい

**フロー**:
```
1. ポーリング（30秒ごと）
   GET /api/calendar/sync-from-calendar

2. Google Calendar API呼び出し
   events.list({ updatedMin: lastSyncedAt })

3. 新規・更新イベントを処理
   - 新規 → tasksテーブルに追加（グループ: "カレンダー同期"）
   - 更新 → google_event_idで検索してタスク更新
   - 削除 → タスクも削除（確認ダイアログ）

4. UI通知
   「新しい予定が2件追加されました: 火曜MTG, クライアント打ち合わせ」
```

**データマッピング**:
```typescript
Google Event → Shikumika Task
{
  summary → title
  start.dateTime → scheduled_at
  (end - start) → estimated_time (分)
  id → google_event_id
  description → notes (将来実装)
}
```

#### 3.2 競合検知と通知

**シナリオ**: Shikumikaで予定を入れたが、Googleカレンダーで同時刻に別の予定が作られた

**対応**:
1. **検知**: 同期時に時間重複を検出
2. **通知**:
   ```
   ⚠️ 予定が重複しています
   • 1/27 14:00-16:00: 資料作成（Shikumika）
   • 1/27 14:30-15:30: 緊急MTG（Google）

   [Shikumikaを優先] [Googleを優先] [両方保持]
   ```
3. **解決策の提案**:
   - Shikumikaタスクを自動的に空き時間に移動
   - 両方を保持（重複を許可）

---

## 技術実装

### 4.1 フロントエンド

#### 新規コンポーネント
1. **`QuickScheduleModal.tsx`**
   - 日付時刻ピッカー（react-datepicker or custom）
   - 所要時間選択UI
   - 既存予定表示エリア
   - 空き時間提案ボタン

2. **`CalendarWeekView.tsx`**
   - 週間カレンダーグリッド
   - イベント表示（Googleイベント + Shikumikaタスク）
   - ドラッグ＆ドロップ対応

3. **`TimeSlotSelector.tsx`**
   - 時間スロット選択UI（30分刻み）
   - 空き時間のハイライト

#### 状態管理
```typescript
// useCalendarSync.ts
const useCalendarSync = () => {
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [isPolling, setIsPolling] = useState(false);

  useEffect(() => {
    // 30秒ごとにポーリング
    const interval = setInterval(() => {
      fetchCalendarEvents();
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchCalendarEvents = async () => {
    const res = await fetch('/api/calendar/events?start=...&end=...');
    const data = await res.json();
    setCalendarEvents(data.events);
  };

  const suggestTime = async (taskId: string, estimatedTime: number) => {
    const res = await fetch('/api/calendar/suggest-time', {
      method: 'POST',
      body: JSON.stringify({ taskId, estimatedTime })
    });
    return await res.json();
  };

  return { calendarEvents, suggestTime };
};
```

### 4.2 バックエンド

#### 新規APIエンドポイント

1. **`GET /api/calendar/events`**
   ```typescript
   // 指定期間のGoogleカレンダーイベントを取得
   export async function GET(request: NextRequest) {
     const { searchParams } = new URL(request.url);
     const start = searchParams.get('start'); // ISO 8601
     const end = searchParams.get('end');

     const { calendar } = await getCalendarClient(userId);
     const response = await calendar.events.list({
       calendarId: 'primary',
       timeMin: start,
       timeMax: end,
       singleEvents: true,
       orderBy: 'startTime'
     });

     return NextResponse.json({ events: response.data.items });
   }
   ```

2. **`POST /api/calendar/suggest-time`**
   ```typescript
   // 空き時間を提案するアルゴリズム
   export async function POST(request: NextRequest) {
     const { taskId, estimatedTime, preferredDays } = await request.json();

     // 1. 既存予定を取得
     const events = await getCalendarEvents(userId, startDate, endDate);

     // 2. 空き時間を計算
     const freeSlots = calculateFreeSlots(events, workingHours);

     // 3. タスク特性を考慮してスコアリング
     const suggestions = freeSlots
       .filter(slot => slot.duration >= estimatedTime)
       .map(slot => scoreFreeSlot(slot, task))
       .sort((a, b) => b.score - a.score)
       .slice(0, 3);

     return NextResponse.json({ suggestions });
   }
   ```

3. **`POST /api/calendar/sync-from-calendar`**
   ```typescript
   // Googleカレンダーからイベントをインポート
   export async function POST(request: NextRequest) {
     const { lastSyncedAt } = await request.json();

     const { calendar } = await getCalendarClient(userId);
     const response = await calendar.events.list({
       calendarId: 'primary',
       updatedMin: lastSyncedAt,
       singleEvents: true
     });

     const newEvents = response.data.items;

     // 各イベントをタスク化
     for (const event of newEvents) {
       const existingTask = await supabase
         .from('tasks')
         .select('*')
         .eq('google_event_id', event.id)
         .single();

       if (!existingTask.data) {
         // 新規タスク作成
         await createTaskFromEvent(event, userId);
       } else {
         // 既存タスク更新
         await updateTaskFromEvent(existingTask.data.id, event);
       }
     }

     return NextResponse.json({ imported: newEvents.length });
   }
   ```

#### アルゴリズム: 空き時間計算

```typescript
function calculateFreeSlots(
  events: CalendarEvent[],
  workingHours: { start: string, end: string }
): FreeSlot[] {
  const freeSlots: FreeSlot[] = [];
  const dayStart = parseTime(workingHours.start); // 09:00
  const dayEnd = parseTime(workingHours.end);     // 18:00

  // イベントを時系列順にソート
  const sortedEvents = events.sort((a, b) =>
    new Date(a.start).getTime() - new Date(b.start).getTime()
  );

  let currentTime = dayStart;

  for (const event of sortedEvents) {
    const eventStart = new Date(event.start);
    const eventEnd = new Date(event.end);

    // 空き時間がある場合
    if (currentTime < eventStart) {
      freeSlots.push({
        start: currentTime,
        end: eventStart,
        duration: (eventStart.getTime() - currentTime.getTime()) / 60000 // 分
      });
    }

    currentTime = eventEnd;
  }

  // 最後のイベント後の空き時間
  if (currentTime < dayEnd) {
    freeSlots.push({
      start: currentTime,
      end: dayEnd,
      duration: (dayEnd.getTime() - currentTime.getTime()) / 60000
    });
  }

  return freeSlots;
}

function scoreFreeSlot(slot: FreeSlot, task: Task): ScoredSlot {
  let score = 50; // ベーススコア

  // 朝イチ（9:00-11:00）は集中時間
  if (slot.start.getHours() >= 9 && slot.start.getHours() < 11) {
    score += 30;
  }

  // 午後早め（13:00-15:00）もまだ集中できる
  if (slot.start.getHours() >= 13 && slot.start.getHours() < 15) {
    score += 20;
  }

  // 優先度が高いタスクは早い時間を優先
  if (task.priority >= 4 && slot.start.getHours() < 12) {
    score += 20;
  }

  // 余裕があるスロットを優先（所要時間の1.5倍以上）
  if (slot.duration >= task.estimated_time * 1.5) {
    score += 15;
  }

  return {
    ...slot,
    score,
    reason: generateReason(slot, score)
  };
}
```

---

## UI/UXフロー

### フロー1: タスクに予定を設定

```
1. ユーザー: MindMapでタスクノードをクリック
   ↓
2. UI: タスク詳細が表示される
   ↓
3. ユーザー: 「📅 予定を設定」ボタンをクリック
   ↓
4. UI: QuickScheduleModalが表示
   - 今日・明日・来週のクイック選択
   - カスタム日時選択
   - 所要時間選択（30分/1h/2h/カスタム）
   ↓
5. システム: その時間帯の既存予定を表示
   - 「13:00-14:00: 火曜MTG」
   - 空き時間なら「✓ 予定なし」
   ↓
6. ユーザー: 「予定を設定」をクリック
   ↓
7. システム:
   - タスクのscheduled_at, estimated_timeを更新
   - Googleカレンダーに同期（自動）
   - タスクノードに青いカレンダーアイコン表示
   ↓
8. UI: 「Googleカレンダーに同期しました」トースト通知
```

### フロー2: 自動スケジューリング

```
1. ユーザー: タスクノードの「自動予定」ボタンをクリック
   ↓
2. システム: 空き時間を計算・提案
   - POST /api/calendar/suggest-time
   ↓
3. UI: 提案をポップアップ表示
   ┌──────────────────────────────────┐
   │ 最適な時間:                       │
   │ ✨ 明日 9:00-11:00 (スコア: 95)   │
   │ 「朝イチの集中時間。予定なし。」   │
   │                                  │
   │ その他の候補:                     │
   │ • 明日 14:00-16:00 (スコア: 80)  │
   │ • 明後日 10:00-12:00 (スコア: 85)│
   │                                  │
   │ [他の時間を見る] [この時間でOK]   │
   └──────────────────────────────────┘
   ↓
4. ユーザー: 「この時間でOK」をクリック
   ↓
5. システム: タスク更新 + カレンダー同期
   ↓
6. UI: 「予定を設定しました」通知
```

### フロー3: カレンダービューからタスクを予定に追加

```
1. ユーザー: 右サイドバーのカレンダービューを表示
   ↓
2. UI: 週間カレンダーグリッドを表示
   - Googleイベント（紫）
   - Shikumikaタスク（青）
   - 空き時間（白）
   ↓
3. ユーザー: MindMapからタスクをドラッグ
   ↓
4. ユーザー: カレンダーの空き時間にドロップ
   ↓
5. UI: 確認ダイアログ
   「『資料作成』を1/27(月) 14:00に設定しますか？」
   [キャンセル] [設定]
   ↓
6. ユーザー: 「設定」をクリック
   ↓
7. システム: タスク更新 + カレンダー同期
```

---

## データモデル拡張

### tasksテーブル（既存）
```sql
-- 既に実装済み
scheduled_at TIMESTAMP NULL
estimated_time INTEGER NULL
google_event_id TEXT NULL
```

### 新規: user_preferences テーブル
```sql
CREATE TABLE user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users NOT NULL UNIQUE,

  -- スケジューリング設定
  working_hours_start TIME DEFAULT '09:00:00',
  working_hours_end TIME DEFAULT '18:00:00',
  preferred_task_duration INTEGER DEFAULT 60, -- 分
  break_time_minutes INTEGER DEFAULT 15,

  -- 通知設定
  enable_sync_notifications BOOLEAN DEFAULT true,
  enable_conflict_warnings BOOLEAN DEFAULT true,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

---

## 段階的実装計画

### Phase 2A: スケジューリングUI改善（2週間）
1. ✅ QuickScheduleModal作成
2. ✅ 日付時刻ピッカーの実装
3. ✅ 所要時間選択UI
4. ✅ 既存予定表示機能
5. ✅ タスク更新 + カレンダー同期の統合

### Phase 2B: カレンダービュー改善（2週間）
1. ✅ GET /api/calendar/events 実装
2. ✅ CalendarWeekView コンポーネント作成
3. ✅ Googleイベント + Shikumikaタスクの統合表示
4. ✅ ドラッグ＆ドロップ機能（react-dnd）

### Phase 2C: 自動スケジューリング（3週間）
1. ✅ 空き時間計算アルゴリズム実装
2. ✅ POST /api/calendar/suggest-time 実装
3. ✅ スコアリングロジック
4. ✅ 「自動予定」ボタンUI
5. ✅ 提案ポップアップ表示

### Phase 2D: 双方向同期（2週間）
1. ✅ POST /api/calendar/sync-from-calendar 実装
2. ✅ ポーリング機構（30秒間隔）
3. ✅ イベント→タスク変換ロジック
4. ✅ 競合検知と通知

---

## 成功指標

1. **予定設定の簡易化**
   - 予定設定にかかる時間: 平均30秒以内
   - 自動スケジューリング利用率: 40%以上

2. **カレンダー統合**
   - 週間ビューの利用率: 60%以上
   - ドラッグ＆ドロップ利用率: 30%以上

3. **同期精度**
   - 双方向同期の成功率: 99%以上
   - 競合発生率: 5%以下

---

## リスクと対策

| リスク | 影響度 | 対策 |
|--------|--------|------|
| 空き時間計算が重い | 中 | キャッシュ、バックグラウンド計算 |
| ドラッグ＆ドロップがバグる | 中 | 十分なテスト、フォールバックUI |
| ポーリングでAPIクォータ超過 | 高 | Webhook移行、ポーリング間隔調整 |
| UIが複雑になりすぎる | 中 | シンプルなデフォルトUI + 詳細オプション |

---

## まとめ

この設計により、Shikumikaは単なるタスク管理ツールから**スケジューリング支援ツール**へと進化します。

**コア価値**:
1. **予定入力が簡単**: ワンクリック＆ドラッグ＆ドロップ
2. **空き時間が見える**: カレンダービューで一目瞭然
3. **自動提案が賢い**: AIが最適な時間を提案

次のステップ: Phase 2Aから実装を開始し、段階的に機能を追加していきます。
