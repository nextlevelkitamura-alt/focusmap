'use client';

import { useEffect, useState } from 'react';

// 子06: 段階3のAIレーンの経過時間。started_at からクライアントが毎秒リアルタイム計算する。
// 点滅は「実装中」ピルのみで、この数値は motion-reduce でも更新する（数値=情報・点滅=装飾の切り分け）。
// started_at は board.py が書く JST naive 文字列（TZ無し）のため +09:00 として解釈し、
// ブラウザのTZに依存せず正しい経過を出す（既存SQLの DATETIME('now','+9 hours') 基準と揃える）。
function parseJstEpoch(value: string): number | null {
  if (!value) return null;
  let text = value.trim().replace(' ', 'T');
  if (!/([zZ]|[+-]\d\d:?\d\d)$/.test(text)) text += '+09:00';
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? null : ms;
}

function formatElapsed(totalSec: number): string {
  const secs = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function LiveElapsed({ startedAt, className }: { startedAt: string; className?: string }) {
  const epoch = parseJstEpoch(startedAt);
  // 初回は null → epoch起点の0を表示（SSR/hydration差を避けるため now は effect でのみ確定する）。
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (epoch === null) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [epoch]);
  if (epoch === null) return null;
  const elapsedSec = now === null ? 0 : (now - epoch) / 1000;
  return (
    <span className={className} suppressHydrationWarning>
      {formatElapsed(elapsedSec)}
    </span>
  );
}
