/**
 * 共通フォーマッタ
 *
 * SaaS UI (使用量バー / プラン表示 / 課金画面) で使う通貨・トークン・パーセントの統一フォーマット
 */

export type Currency = 'USD' | 'JPY';

const JPY_FORMATTER = new Intl.NumberFormat('ja-JP', {
  style: 'currency',
  currency: 'JPY',
  maximumFractionDigits: 0,
});

const USD_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const USD_FORMATTER_PRECISE = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

export function formatCurrency(amount: number, currency: Currency = 'USD', precise = false): string {
  if (currency === 'JPY') return JPY_FORMATTER.format(amount);
  if (precise && Math.abs(amount) < 1) return USD_FORMATTER_PRECISE.format(amount);
  return USD_FORMATTER.format(amount);
}

export function formatTokens(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  return `${(n / 1_000_000_000).toFixed(2)}B`;
}

export function formatPercent(ratio: number, decimals = 0): string {
  return `${(ratio * 100).toFixed(decimals)}%`;
}

export function formatExecutionRatio(used: number, limit: number): string {
  if (!isFinite(limit)) return `${used.toLocaleString()} / ∞`;
  return `${used.toLocaleString()} / ${limit.toLocaleString()}`;
}

export function getUsageBarColor(ratio: number): string {
  if (ratio >= 0.95) return 'bg-red-500';
  if (ratio >= 0.8) return 'bg-amber-500';
  return 'bg-emerald-500';
}

export function getUsageTextColor(ratio: number): string {
  if (ratio >= 0.95) return 'text-red-600 dark:text-red-400';
  if (ratio >= 0.8) return 'text-amber-600 dark:text-amber-400';
  return 'text-muted-foreground';
}

export function formatBillingCycle(date: Date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function daysUntilCycleReset(now: Date = new Date()): number {
  const utc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return Math.ceil((nextMonth.getTime() - utc.getTime()) / (24 * 60 * 60 * 1000));
}
