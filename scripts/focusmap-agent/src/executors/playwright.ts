/**
 * Playwright executor
 *
 * - URL を受け取り、 chromium headless で開く
 * - ページ内テキストを取得
 * - 簡易 Cookie 永続化 (~/.focusmap/auth/<domain>.json)
 * - シングルブラウザインスタンス維持 (起動コスト削減)
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { existsSync } from 'node:fs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { info, warn } from '../logger.js';

let browserInstance: Browser | null = null;
let contextInstance: BrowserContext | null = null;
const AUTH_DIR = join(homedir(), '.focusmap', 'auth');

async function getBrowser(): Promise<Browser> {
  if (browserInstance && browserInstance.isConnected()) {
    return browserInstance;
  }
  info('[playwright] launching chromium...');
  browserInstance = await chromium.launch({ headless: true });
  return browserInstance;
}

async function getContext(): Promise<BrowserContext> {
  if (contextInstance) return contextInstance;
  const browser = await getBrowser();
  contextInstance = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 focusmap-agent/0.1',
    viewport: { width: 1280, height: 800 },
  });
  return contextInstance;
}

export interface FetchPageResult {
  url: string;
  title: string;
  textContent: string;
  status: number;
  durationMs: number;
}

/**
 * URL を開いて主要テキストを取得
 */
export async function fetchPageText(
  url: string,
  options: { maxChars?: number; timeoutMs?: number } = {},
): Promise<FetchPageResult> {
  const start = Date.now();
  const context = await getContext();
  const page = await context.newPage();
  try {
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: options.timeoutMs ?? 30_000,
    });
    const status = response?.status() ?? 0;

    // body のテキストを取得 (script/style除外)
    const text = await page.evaluate(() => {
      const clone = document.body.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('script, style, noscript').forEach((el) => el.remove());
      return clone.innerText.replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
    });
    const truncated = text.slice(0, options.maxChars ?? 30_000);

    const title = await page.title();
    return {
      url,
      title,
      textContent: truncated,
      status,
      durationMs: Date.now() - start,
    };
  } finally {
    await page.close();
  }
}

/**
 * 複数URLを並列フェッチ (上限3並列)
 */
export async function fetchMultiplePages(
  urls: string[],
  options: { maxConcurrency?: number; maxCharsPerPage?: number } = {},
): Promise<FetchPageResult[]> {
  const concurrency = Math.min(options.maxConcurrency ?? 3, urls.length);
  const results: FetchPageResult[] = [];
  const queue = [...urls];

  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) break;
      try {
        const result = await fetchPageText(next, { maxChars: options.maxCharsPerPage });
        results.push(result);
      } catch (e) {
        warn(`[playwright] fetch failed for ${next}`, e);
        results.push({
          url: next,
          title: '(error)',
          textContent: '',
          status: 0,
          durationMs: 0,
        });
      }
    }
  });

  await Promise.all(workers);
  return results;
}

/**
 * 共有Cookie保存 (将来用、 まだ簡易版)
 */
export async function saveCookiesForDomain(domain: string): Promise<void> {
  if (!contextInstance) return;
  await mkdir(AUTH_DIR, { recursive: true, mode: 0o700 });
  const cookies = await contextInstance.cookies();
  const filtered = cookies.filter((c) => c.domain.includes(domain));
  await writeFile(
    join(AUTH_DIR, `${domain}.json`),
    JSON.stringify(filtered, null, 2),
    { mode: 0o600 },
  );
}

export async function loadCookiesForDomain(domain: string): Promise<void> {
  const path = join(AUTH_DIR, `${domain}.json`);
  if (!existsSync(path)) return;
  const raw = await readFile(path, 'utf8');
  const cookies = JSON.parse(raw);
  const context = await getContext();
  await context.addCookies(cookies);
}

/**
 * 終了時クリーンアップ
 */
export async function shutdownPlaywright(): Promise<void> {
  if (contextInstance) {
    await contextInstance.close().catch(() => undefined);
    contextInstance = null;
  }
  if (browserInstance) {
    await browserInstance.close().catch(() => undefined);
    browserInstance = null;
  }
}
