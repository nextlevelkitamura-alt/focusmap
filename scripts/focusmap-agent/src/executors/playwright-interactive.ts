/**
 * Playwright インタラクティブ executor
 *
 * Claude Code の Browser 操作と同等:
 * - browser_navigate: URL を開く / 待機
 * - browser_click: セレクタ指定でクリック
 * - browser_fill: フォーム入力
 * - browser_screenshot: ページ/要素のスクリーンショット (PNG base64)
 * - browser_text: ページテキスト抽出
 * - browser_eval: JavaScript 評価 (安全モードのみ)
 *
 * セッション維持: 1つの browser context を共有 (既存 playwright.ts と統合)
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

let browser: Browser | null = null;
let context: BrowserContext | null = null;
const pages = new Map<string, Page>();

async function getContext(): Promise<BrowserContext> {
  if (context) return context;
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({ headless: true });
  }
  context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 focusmap-agent/0.2',
    viewport: { width: 1280, height: 800 },
  });
  return context;
}

async function getOrCreatePage(sessionId: string): Promise<Page> {
  const existing = pages.get(sessionId);
  if (existing && !existing.isClosed()) return existing;
  const ctx = await getContext();
  const page = await ctx.newPage();
  pages.set(sessionId, page);
  return page;
}

export interface BrowserNavigateOptions {
  session_id?: string;
  url: string;
  wait_for?: 'load' | 'domcontentloaded' | 'networkidle';
  timeout_ms?: number;
}

export async function browserNavigate(options: BrowserNavigateOptions): Promise<{
  session_id: string;
  url: string;
  title: string;
  status: number;
}> {
  const sessionId = options.session_id ?? 'default';
  const page = await getOrCreatePage(sessionId);
  const response = await page.goto(options.url, {
    waitUntil: options.wait_for ?? 'domcontentloaded',
    timeout: options.timeout_ms ?? 30_000,
  });
  return {
    session_id: sessionId,
    url: page.url(),
    title: await page.title(),
    status: response?.status() ?? 0,
  };
}

export interface BrowserClickOptions {
  session_id?: string;
  selector: string;
  timeout_ms?: number;
  click_count?: number;
}

export async function browserClick(options: BrowserClickOptions): Promise<{
  session_id: string;
  selector: string;
  url_after: string;
}> {
  const sessionId = options.session_id ?? 'default';
  const page = await getOrCreatePage(sessionId);
  await page.click(options.selector, {
    timeout: options.timeout_ms ?? 10_000,
    clickCount: options.click_count ?? 1,
  });
  return {
    session_id: sessionId,
    selector: options.selector,
    url_after: page.url(),
  };
}

export interface BrowserFillOptions {
  session_id?: string;
  selector: string;
  value: string;
  press_enter?: boolean;
  timeout_ms?: number;
}

export async function browserFill(options: BrowserFillOptions): Promise<{
  session_id: string;
  selector: string;
  filled_chars: number;
}> {
  const sessionId = options.session_id ?? 'default';
  const page = await getOrCreatePage(sessionId);
  await page.fill(options.selector, options.value, {
    timeout: options.timeout_ms ?? 10_000,
  });
  if (options.press_enter) {
    await page.press(options.selector, 'Enter');
  }
  return {
    session_id: sessionId,
    selector: options.selector,
    filled_chars: options.value.length,
  };
}

export interface BrowserScreenshotOptions {
  session_id?: string;
  url?: string;
  selector?: string;
  full_page?: boolean;
  type?: 'png' | 'jpeg';
}

export async function browserScreenshot(options: BrowserScreenshotOptions): Promise<{
  session_id: string;
  url: string;
  format: 'png' | 'jpeg';
  bytes: number;
  data_url: string;
}> {
  const sessionId = options.session_id ?? 'default';
  const page = await getOrCreatePage(sessionId);
  if (options.url) {
    await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  }
  const format = options.type ?? 'png';
  let buffer: Buffer;
  if (options.selector) {
    const element = await page.waitForSelector(options.selector, { timeout: 10_000 });
    buffer = await element.screenshot({ type: format });
  } else {
    buffer = await page.screenshot({ fullPage: options.full_page ?? true, type: format });
  }
  return {
    session_id: sessionId,
    url: page.url(),
    format,
    bytes: buffer.byteLength,
    data_url: `data:image/${format};base64,${buffer.toString('base64')}`,
  };
}

export interface BrowserTextOptions {
  session_id?: string;
  url?: string;
  selector?: string;
  max_chars?: number;
}

export async function browserText(options: BrowserTextOptions): Promise<{
  session_id: string;
  url: string;
  text: string;
  truncated: boolean;
}> {
  const sessionId = options.session_id ?? 'default';
  const page = await getOrCreatePage(sessionId);
  if (options.url) {
    await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  }
  let text: string;
  if (options.selector) {
    const el = await page.waitForSelector(options.selector, { timeout: 10_000 });
    text = (await el.innerText()) ?? '';
  } else {
    text = await page.evaluate(() => {
      const clone = document.body.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('script, style, noscript').forEach((n) => n.remove());
      return clone.innerText;
    });
  }
  const max = options.max_chars ?? 50_000;
  const truncated = text.length > max;
  return {
    session_id: sessionId,
    url: page.url(),
    text: truncated ? text.slice(0, max) : text,
    truncated,
  };
}

/**
 * セッション終了 (リソース解放)
 */
export async function browserCloseSession(sessionId: string): Promise<{ closed: boolean }> {
  const page = pages.get(sessionId);
  if (!page) return { closed: false };
  await page.close().catch(() => undefined);
  pages.delete(sessionId);
  return { closed: true };
}

/**
 * 終了時に全リソース解放
 */
export async function browserShutdown(): Promise<void> {
  for (const page of pages.values()) {
    await page.close().catch(() => undefined);
  }
  pages.clear();
  if (context) {
    await context.close().catch(() => undefined);
    context = null;
  }
  if (browser) {
    await browser.close().catch(() => undefined);
    browser = null;
  }
}
