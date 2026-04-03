'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Bell, BellOff, CheckCircle2, XCircle } from 'lucide-react';
import { useNotificationSettings } from '@/hooks/useNotificationSettings';
import { useNotificationPermission } from '@/hooks/useNotificationPermission';
import type { NotificationSetting } from '@/types/calendar';

const NOTIFICATION_TYPE_LABELS: Record<string, { title: string; description: string }> = {
  task_start: {
    title: 'タスク開始時の通知',
    description: 'タスクの開始時間になったら通知します',
  },
  task_due: {
    title: 'タスク締切の通知',
    description: 'タスクの締め切り前に通知します',
  },
  event_start: {
    title: 'イベント開始時の通知',
    description: 'カレンダーイベントの開始前に通知します',
  },
};

const ADVANCE_MINUTES_OPTIONS = [
  { value: 5, label: '5分前' },
  { value: 15, label: '15分前' },
  { value: 30, label: '30分前' },
  { value: 60, label: '1時間前' },
  { value: 1440, label: '1日前' },
];

export function NotificationSettings() {
  const { settings, isLoading, error, updateSetting } = useNotificationSettings();
  const { permission, isSupported, requestPermission } = useNotificationPermission();
  const [isSendingTest, setIsSendingTest] = useState(false);

  const handleRequestPermission = async () => {
    await requestPermission();
  };

  const handleToggleEnabled = async (setting: NotificationSetting) => {
    await updateSetting(setting.notification_type, {
      is_enabled: !setting.is_enabled,
    });
  };

  const handleToggleSound = async (setting: NotificationSetting) => {
    await updateSetting(setting.notification_type, {
      sound_enabled: !setting.sound_enabled,
    });
  };

  const handleChangeAdvanceMinutes = async (setting: NotificationSetting, value: number) => {
    await updateSetting(setting.notification_type, {
      advance_minutes: value,
    });
  };

  const handleSendTestNotification = async () => {
    if (!isSupported || permission !== 'granted') {
      return;
    }

    setIsSendingTest(true);
    try {
      if (typeof Notification !== 'undefined') {
        new Notification('Focusmap テスト通知', {
          body: '通知機能が正常に動作しています',
          icon: '/icon-192x192.png',
          badge: '/badge-72x72.png',
          tag: 'test-notification',
        });
      }
    } finally {
      setTimeout(() => setIsSendingTest(false), 1000);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center text-sm text-muted-foreground">
            読み込み中...
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    const isTableMissing = error.message?.includes('schema cache') || error.message?.includes('relation');
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            通知設定
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center text-sm text-muted-foreground py-4">
            {isTableMissing
              ? '通知機能は現在準備中です'
              : `エラーが発生しました: ${error.message}`}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-5 w-5" />
          通知設定
        </CardTitle>
        <CardDescription>
          タスクやイベントのリマインダー通知を設定できます
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* ブラウザ通知の権限状態 */}
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div className="flex items-center gap-3">
            {permission === 'granted' ? (
              <CheckCircle2 className="h-5 w-5 text-green-500" />
            ) : (
              <BellOff className="h-5 w-5 text-muted-foreground" />
            )}
            <div>
              <p className="text-sm font-medium">ブラウザ通知</p>
              <p className="text-xs text-muted-foreground">
                {!isSupported && 'このブラウザは通知をサポートしていません'}
                {isSupported && permission === 'granted' && '通知が許可されています'}
                {isSupported && permission === 'denied' && '通知が拒否されています'}
                {isSupported && permission === 'default' && '通知の許可がまだです'}
              </p>
            </div>
          </div>
          {isSupported && permission !== 'granted' && (
            <Button onClick={handleRequestPermission} variant="outline" size="sm">
              許可する
            </Button>
          )}
        </div>

        {/* 通知設定リスト */}
        <div className="space-y-4">
          {settings.map((setting) => {
            const labels = NOTIFICATION_TYPE_LABELS[setting.notification_type];
            return (
              <div key={setting.id} className="rounded-lg border p-4 space-y-4">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <p className="text-sm font-medium">{labels.title}</p>
                    <p className="text-xs text-muted-foreground">{labels.description}</p>
                  </div>
                  <Switch
                    checked={setting.is_enabled}
                    onCheckedChange={() => handleToggleEnabled(setting)}
                  />
                </div>

                {setting.is_enabled && (
                  <div className="space-y-3 pl-4">
                    {/* 通知タイミング */}
                    <div className="flex items-center justify-between">
                      <span className="text-sm">通知タイミング</span>
                      <Select
                        value={setting.advance_minutes.toString()}
                        onValueChange={(value) =>
                          handleChangeAdvanceMinutes(setting, parseInt(value))
                        }
                      >
                        <SelectTrigger className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ADVANCE_MINUTES_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value.toString()}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* サウンド */}
                    <div className="flex items-center justify-between">
                      <span className="text-sm">サウンド</span>
                      <Switch
                        checked={setting.sound_enabled}
                        onCheckedChange={() => handleToggleSound(setting)}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* テスト通知 */}
        {permission === 'granted' && (
          <div className="flex justify-center pt-4 border-t">
            <Button
              onClick={handleSendTestNotification}
              variant="outline"
              disabled={isSendingTest}
            >
              <Bell className="h-4 w-4 mr-2" />
              {isSendingTest ? '送信中...' : 'テスト通知を送信'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
