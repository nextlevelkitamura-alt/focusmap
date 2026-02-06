'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { X, Bell } from 'lucide-react';

interface NotificationPermissionBannerProps {
  onDismiss?: () => void;
}

export function NotificationPermissionBanner({ onDismiss }: NotificationPermissionBannerProps) {
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    if (typeof Notification !== 'undefined') {
      setPermission(Notification.permission);
    }

    // ローカルストレージから閉じた状態を復元
    const dismissed = localStorage.getItem('notification-banner-dismissed');
    if (dismissed === 'true') {
      setIsDismissed(true);
    }
  }, []);

  const handleRequestPermission = async () => {
    if (typeof Notification !== 'undefined') {
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
