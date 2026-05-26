/**
 * シンプルなロガー: timestamp + level + message
 *
 * 本番では JSON 形式に変えるなどの拡張余地あり。
 */

function ts(): string {
  return new Date().toISOString();
}

export function info(...args: unknown[]): void {
  console.log('[agent]', ts(), 'INFO', ...args);
}

export function warn(...args: unknown[]): void {
  console.warn('[agent]', ts(), 'WARN', ...args);
}

export function error(...args: unknown[]): void {
  console.error('[agent]', ts(), 'ERROR', ...args);
}

export function debug(...args: unknown[]): void {
  if (process.env.AGENT_DEBUG === '1') {
    console.log('[agent]', ts(), 'DEBUG', ...args);
  }
}
