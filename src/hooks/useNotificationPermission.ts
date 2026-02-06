import { useState, useEffect, useCallback } from 'react';

interface UseNotificationPermissionReturn {
  permission: NotificationPermission | 'unsupported';
  isSupported: boolean;
  requestPermission: () => Promise<NotificationPermission>;
  isGranted: boolean;
  isDenied: boolean;
  isDefault: boolean;
}

export function useNotificationPermission(): UseNotificationPermissionReturn {
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default');
  const [isSupported, setIsSupported] = useState(false);

  useEffect(() => {
    if (typeof Notification !== 'undefined') {
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
    isDefault: permission === 'default',
  };
}
