'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// 今日画面はAIが高頻度に書くのでポーリングを短縮（20s→10s）。
// あわせて画面復帰（タブ復帰・ウィンドウfocus）時に即再取得し、スマホで開き直した瞬間に最新化する。
const POLL_INTERVAL_MS = 10_000;

export function BoardPoller() {
  const router = useRouter();

  useEffect(() => {
    const timer = window.setInterval(() => {
      router.refresh();
    }, POLL_INTERVAL_MS);

    const refreshOnReturn = () => {
      if (document.visibilityState === 'visible') router.refresh();
    };
    document.addEventListener('visibilitychange', refreshOnReturn);
    window.addEventListener('focus', refreshOnReturn);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshOnReturn);
      window.removeEventListener('focus', refreshOnReturn);
    };
  }, [router]);

  return null;
}
