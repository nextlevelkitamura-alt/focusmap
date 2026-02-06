# Phase 1.3: 通知機能

## 📋 概要

### 目的
タスクの開始時間や締切前にリマインダー通知を送信し、ユーザーの生産性を向上させる。

### 背景
- タスクやイベントの時間を忘れてしまうことがある
- リマインダーがあることで計画通りに行動できる
- Googleカレンダーの通知と統合した体験を提供

### スコープ
- ブラウザ通知（Web Push API）
- 通知設定UI
- タスク・イベントの通知タイミング管理
- メール通知（オプション）

---

## 🎯 要件定義

### 機能要件

#### FR-1: ブラウザ通知
- タスク開始時間の15分前に通知
- イベント開始時間の通知（Googleカレンダー設定に従う）
- 締切1時間前の通知
- 通知クリックで該当タスク/イベントにジャンプ

#### FR-2: 通知設定UI
- 通知のON/OFF切り替え
- 通知タイミングの選択（5分前、15分前、30分前、1時間前、1日前）
- タスク種別ごとの通知設定（重要タスク、通常タスクなど）
- サウンドのON/OFF

#### FR-3: 通知権限リクエスト
- 初回アクセス時に通知権限をリクエスト
- 拒否された場合の再リクエストUI
- 権限状態の表示

#### FR-4: 通知スケジューリング
- ブラウザがオフラインでも通知が届く（Service Worker）
- 通知のキャンセル（タスク削除時など）
- 重複通知の防止

#### FR-5 (オプション): メール通知
- Supabase Edge Functionsでメール送信
- メールテンプレート
- メール通知のON/OFF設定

---

## 🗄️ データベース設計

### notification_settings テーブル

```sql
CREATE TABLE notification_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,

  -- 通知タイプ
  notification_type TEXT NOT NULL, -- 'task_start' | 'task_due' | 'event_start'

  -- 設定
  is_enabled BOOLEAN DEFAULT true,
  advance_minutes INTEGER DEFAULT 15,  -- 何分前に通知（5, 15, 30, 60, 1440）
  sound_enabled BOOLEAN DEFAULT true,

  -- メール通知（オプション）
  email_enabled BOOLEAN DEFAULT false,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(user_id, notification_type)
);

-- RLS
ALTER TABLE notification_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can only access their own settings"
  ON notification_settings
  FOR ALL
  USING (auth.uid() = user_id);

-- デフォルト設定を挿入するトリガー
CREATE OR REPLACE FUNCTION create_default_notification_settings()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO notification_settings (user_id, notification_type, advance_minutes)
  VALUES
    (NEW.id, 'task_start', 15),
    (NEW.id, 'task_due', 60),
    (NEW.id, 'event_start', 15);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION create_default_notification_settings();
```

---

### notification_queue テーブル

```sql
CREATE TABLE notification_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,

  -- 通知対象
  target_type TEXT NOT NULL,       -- 'task' | 'event'
  target_id UUID NOT NULL,         -- tasks.id または calendar_events.id
  notification_type TEXT NOT NULL, -- 'task_start' | 'task_due' | 'event_start'

  -- 通知内容
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  icon_url TEXT,
  action_url TEXT,                 -- クリック時のURL

  -- スケジュール
  scheduled_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  is_sent BOOLEAN DEFAULT false,

  -- エラー処理
  retry_count INTEGER DEFAULT 0,
  last_error TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),

  INDEX idx_scheduled (user_id, scheduled_at, is_sent),
  INDEX idx_target (target_type, target_id)
);

-- RLS
ALTER TABLE notification_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can only access their own notifications"
  ON notification_queue
  FOR ALL
  USING (auth.uid() = user_id);
```

---

## 🔌 API設計

### 1. 通知設定の取得

**Endpoint:** `GET /api/notifications/settings`

**Response:**
```typescript
{
  success: true,
  settings: [
    {
      id: string;
      notificationType: 'task_start' | 'task_due' | 'event_start';
      isEnabled: boolean;
      advanceMinutes: number;
      soundEnabled: boolean;
      emailEnabled: boolean;
    }
  ]
}
```

---

### 2. 通知設定の更新

**Endpoint:** `PATCH /api/notifications/settings`

**Request Body:**
```typescript
{
  notificationType: 'task_start' | 'task_due' | 'event_start';
  isEnabled?: boolean;
  advanceMinutes?: number;
  soundEnabled?: boolean;
  emailEnabled?: boolean;
}
```

**Response:**
```typescript
{
  success: true,
  setting: {
    id: string;
    notificationType: string;
    isEnabled: boolean;
    advanceMinutes: number;
    soundEnabled: boolean;
    emailEnabled: boolean;
  }
}
```

---

### 3. 通知のスケジュール登録

**Endpoint:** `POST /api/notifications/schedule`

**Request Body:**
```typescript
{
  targetType: 'task' | 'event';
  targetId: string;
  notificationType: 'task_start' | 'task_due' | 'event_start';
  scheduledAt: string;       // ISO 8601
  title: string;
  body: string;
  actionUrl: string;
}
```

**Response:**
```typescript
{
  success: true,
  notificationId: string;
}
```

**使用タイミング:**
- タスク作成時
- イベント作成時
- タスク/イベントの時間変更時

---

### 4. 通知のキャンセル

**Endpoint:** `DELETE /api/notifications/cancel`

**Request Body:**
```typescript
{
  targetType: 'task' | 'event';
  targetId: string;
}
```

**Response:**
```typescript
{
  success: true,
  canceledCount: number;
}
```

**使用タイミング:**
- タスク削除時
- イベント削除時
- タスク/イベントの時間変更時（再スケジュール前）

---

### 5. 通知権限の確認

**Endpoint:** `GET /api/notifications/permission`

**Response:**
```typescript
{
  success: true,
  permission: 'granted' | 'denied' | 'default';
  supported: boolean;  // ブラウザがWeb Push APIをサポートしているか
}
```

---

## 🎨 UIコンポーネント設計

### 1. NotificationPermissionBanner

**ファイル:** `src/components/notifications/notification-permission-banner.tsx`

**Props:**
```typescript
interface NotificationPermissionBannerProps {
  onDismiss?: () => void;
}
```

**機能:**
- 通知権限がまだリクエストされていない場合に表示
- 「通知を有効にする」ボタン
- 閉じるボタン

**表示位置:** ダッシュボード上部

**実装例:**
```typescript
'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { X, Bell } from 'lucide-react';

export function NotificationPermissionBanner({ onDismiss }: NotificationPermissionBannerProps) {
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    if ('Notification' in window) {
      setPermission(Notification.permission);
    }

    // ローカルストレージから閉じた状態を復元
    const dismissed = localStorage.getItem('notification-banner-dismissed');
    if (dismissed === 'true') {
      setIsDismissed(true);
    }
  }, []);

  const handleRequestPermission = async () => {
    if ('Notification' in window) {
      const result = await Notification.requestPermission();
      setPermission(result);

      if (result === 'granted') {
        setIsDismissed(true);
        localStorage.setItem('notification-banner-dismissed', 'true');
      }
    }
  };

  const handleDismiss = () => {
    setIsDismissed(true);
    localStorage.setItem('notification-banner-dismissed', 'true');
    onDismiss?.();
  };

  if (permission !== 'default' || isDismissed) {
    return null;
  }

  return (
    <div className="flex items-center justify-between p-4 bg-primary/10 border-b">
      <div className="flex items-center gap-3">
        <Bell className="h-5 w-5 text-primary" />
        <div>
          <p className="text-sm font-medium">通知を有効にしますか?</p>
          <p className="text-xs text-muted-foreground">
            タスクやイベントのリマインダーを受け取ることができます
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button onClick={handleRequestPermission}>
          有効にする
        </Button>
        <Button variant="ghost" size="icon" onClick={handleDismiss}>
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
```

---

### 2. NotificationSettings

**ファイル:** `src/components/notifications/notification-settings.tsx`

**Props:**
```typescript
interface NotificationSettingsProps {
  // なし
}
```

**機能:**
- 通知設定の一覧表示
- 各通知タイプのON/OFF切り替え
- 通知タイミングの選択
- サウンドのON/OFF
- テスト通知の送信

**レイアウト:**
```
┌─────────────────────────────────────────┐
│ 通知設定                                 │
├─────────────────────────────────────────┤
│ ブラウザ通知                             │
│   権限: ✅ 許可済み                      │
│                                         │
│ タスク開始時の通知                       │
│   ☑ 有効                                │
│   通知タイミング: [15分前 ▼]            │
│   ☑ サウンド                            │
│                                         │
│ タスク締切の通知                         │
│   ☑ 有効                                │
│   通知タイミング: [1時間前 ▼]           │
│   ☑ サウンド                            │
│                                         │
│ イベント開始時の通知                     │
│   ☑ 有効                                │
│   通知タイミング: [15分前 ▼]            │
│   ☑ サウンド                            │
│                                         │
│ [テスト通知を送信]                      │
└─────────────────────────────────────────┘
```

---

### 3. NotificationTest

**機能:**
- テスト通知の送信ボタン
- 通知が正常に動作するか確認

---

## 🪝 Custom Hooks設計

### useNotificationSettings

**目的:** 通知設定の管理

```typescript
import { useState, useEffect, useCallback } from 'react';
import { NotificationSetting } from '@/types/notification';

export function useNotificationSettings() {
  const [settings, setSettings] = useState<NotificationSetting[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // 設定取得
  const fetchSettings = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/notifications/settings');
      if (!response.ok) throw new Error('Failed to fetch settings');

      const data = await response.json();
      setSettings(data.settings);
    } catch (err) {
      setError(err as Error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  // 設定更新
  const updateSetting = useCallback(async (
    notificationType: string,
    updates: Partial<NotificationSetting>
  ) => {
    // Optimistic Update
    setSettings(prev => prev.map(setting =>
      setting.notificationType === notificationType
        ? { ...setting, ...updates }
        : setting
    ));

    try {
      const response = await fetch('/api/notifications/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notificationType, ...updates })
      });

      if (!response.ok) throw new Error('Failed to update setting');
    } catch (err) {
      // Rollback
      fetchSettings();
      setError(err as Error);
    }
  }, [fetchSettings]);

  return {
    settings,
    isLoading,
    error,
    updateSetting,
    refetch: fetchSettings
  };
}
```

---

### useNotificationPermission

**目的:** 通知権限の管理

```typescript
import { useState, useEffect, useCallback } from 'react';

export function useNotificationPermission() {
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [isSupported, setIsSupported] = useState(false);

  useEffect(() => {
    if ('Notification' in window) {
      setIsSupported(true);
      setPermission(Notification.permission);
    }
  }, []);

  const requestPermission = useCallback(async () => {
    if (!isSupported) {
      throw new Error('Notifications not supported');
    }

    const result = await Notification.requestPermission();
    setPermission(result);
    return result;
  }, [isSupported]);

  return {
    permission,
    isSupported,
    requestPermission,
    isGranted: permission === 'granted',
    isDenied: permission === 'denied',
    isDefault: permission === 'default'
  };
}
```

---

### useNotificationScheduler

**目的:** 通知のスケジュール登録・キャンセル

```typescript
import { useCallback } from 'react';

interface ScheduleNotificationInput {
  targetType: 'task' | 'event';
  targetId: string;
  notificationType: 'task_start' | 'task_due' | 'event_start';
  scheduledAt: Date;
  title: string;
  body: string;
  actionUrl: string;
}

export function useNotificationScheduler() {
  const scheduleNotification = useCallback(async (input: ScheduleNotificationInput) => {
    const response = await fetch('/api/notifications/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...input,
        scheduledAt: input.scheduledAt.toISOString()
      })
    });

    if (!response.ok) throw new Error('Failed to schedule notification');

    const data = await response.json();
    return data.notificationId;
  }, []);

  const cancelNotifications = useCallback(async (
    targetType: 'task' | 'event',
    targetId: string
  ) => {
    const response = await fetch('/api/notifications/cancel', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetType, targetId })
    });

    if (!response.ok) throw new Error('Failed to cancel notifications');

    const data = await response.json();
    return data.canceledCount;
  }, []);

  return {
    scheduleNotification,
    cancelNotifications
  };
}
```

---

## ⚙️ Service Worker実装

### public/service-worker.js

```javascript
// Service Workerでバックグラウンド通知を処理

self.addEventListener('push', (event) => {
  const data = event.data.json();

  const options = {
    body: data.body,
    icon: data.icon || '/icon-192x192.png',
    badge: '/badge-72x72.png',
    data: {
      url: data.actionUrl
    },
    requireInteraction: false,
    vibrate: [200, 100, 200]
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil(
    clients.openWindow(event.notification.data.url)
  );
});
```

---

## 🔗 統合ポイント

### タスク作成時の通知スケジュール

**ファイル:** `src/hooks/useMindMapSync.ts`

**変更点:**
```typescript
// タスク作成時
const createTask = async (input: CreateTaskInput) => {
  const task = await createTaskAPI(input);

  // 通知をスケジュール
  if (task.startTime) {
    await scheduleNotification({
      targetType: 'task',
      targetId: task.id,
      notificationType: 'task_start',
      scheduledAt: new Date(task.startTime.getTime() - 15 * 60 * 1000), // 15分前
      title: 'タスク開始',
      body: task.title,
      actionUrl: `/dashboard?task=${task.id}`
    });
  }

  return task;
};
```

---

## 🧪 テスト観点

### 単体テスト

#### API Routes
- [ ] 通知設定取得: 正常系
- [ ] 通知設定更新: 正常系
- [ ] 通知スケジュール登録: 正常系
- [ ] 通知キャンセル: 正常系

#### Custom Hooks
- [ ] useNotificationSettings: 設定取得
- [ ] useNotificationSettings: 設定更新（Optimistic Update）
- [ ] useNotificationPermission: 権限リクエスト
- [ ] useNotificationScheduler: 通知スケジュール

#### コンポーネント
- [ ] NotificationPermissionBanner: 表示・非表示
- [ ] NotificationSettings: 設定変更

---

### 統合テスト

- [ ] タスク作成 → 通知スケジュール登録 → 時間になったら通知
- [ ] 通知クリック → 該当タスクにジャンプ
- [ ] タスク削除 → 通知キャンセル

---

## 📦 実装の優先順位

### Phase 1-3-1: ブラウザ通知（最優先）
1. `notification_settings`テーブル作成
2. `notification_queue`テーブル作成
3. `/api/notifications/settings` 実装
4. `/api/notifications/schedule` 実装
5. Service Worker実装
6. `useNotificationPermission` 実装
7. `NotificationPermissionBanner` 実装

### Phase 1-3-2: 通知設定UI
1. `NotificationSettings` コンポーネント実装
2. 設定画面への統合

### Phase 1-3-3 (オプション): メール通知
1. Supabase Edge Function実装
2. メールテンプレート作成

---

## 📚 参考資料

- [Web Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API)
- [Notification API](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API)
- [Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)
- [Supabase Edge Functions](https://supabase.com/docs/guides/functions)

---

**作成日:** 2026-01-28
**対象バージョン:** v1.0.0
**担当:** Architect AI (Sonnet 4.5)
