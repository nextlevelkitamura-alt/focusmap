'use client';

import { useEffect } from 'react';
import { register } from '@/lib/service-worker-registration';

export function ServiceWorkerRegistration() {
  useEffect(() => {
    // Register service worker
    register();
  }, []);

  return null;
}
