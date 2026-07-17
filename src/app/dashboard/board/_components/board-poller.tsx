'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

const POLL_INTERVAL_MS = 20_000;

export function BoardPoller() {
  const router = useRouter();

  useEffect(() => {
    const timer = window.setInterval(() => {
      router.refresh();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [router]);

  return null;
}
