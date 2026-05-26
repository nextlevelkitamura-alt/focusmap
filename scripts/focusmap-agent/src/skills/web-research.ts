/**
 * スキル: web-research (競合・情報サイト巡回)
 *
 * - Playwright で複数URLを並列フェッチ
 * - 各ページのテキストを Gemini Flash-Lite で要約
 * - キーワードフィルタあれば優先表示
 */

import { fetchMultiplePages } from '../executors/playwright.js';
import { callGemini } from '../ai/gemini.js';
import type { AgentConfig, AiTask, TaskResultJson } from '../types.js';
import { info, warn } from '../logger.js';

const DEFAULT_URLS = ['https://zapier.com/pricing', 'https://n8n.io/pricing/'];

interface WebResearchArgs {
  urls?: string[];
  keywords?: string[];
}

export async function runWebResearch(
  task: AiTask,
  config: AgentConfig,
): Promise<TaskResultJson> {
  const startedAt = new Date().toISOString();
  const steps: TaskResultJson['steps'] = [];

  const args = ((task.package_snapshot as { args?: WebResearchArgs } | null)?.args ??
    {}) as WebResearchArgs;
  const urls = args.urls && args.urls.length > 0 ? args.urls : DEFAULT_URLS;
  const keywords = args.keywords ?? [];

  info(`[web-research] task ${task.id}: urls=${urls.length}, keywords=${keywords.length}`);

  // Step 1: URLs取得
  steps.push({ label: `URLs フェッチ (${urls.length}件)`, status: 'running', at: new Date().toISOString() });
  const pages = await fetchMultiplePages(urls, { maxCharsPerPage: 20_000 });
  steps[0] = { ...steps[0], status: 'done', at: new Date().toISOString() };

  const successCount = pages.filter((p) => p.status >= 200 && p.status < 400).length;
  info(`[web-research] fetched ${successCount}/${urls.length} successfully`);

  // Step 2: AI で各ページ要約
  steps.push({ label: 'AIで要約 + キーワードフィルタ', status: 'running', at: new Date().toISOString() });

  const summaryPrompt = `以下のWebページ群から、 新着情報・主要事項を ${keywords.length > 0 ? `特に「${keywords.join(', ')}」 に関連する内容を優先して、` : ''}サマリしてください。

${pages
  .map((p) => `=== URL: ${p.url} ===\nタイトル: ${p.title}\n本文:\n${p.textContent.slice(0, 8000)}`)
  .join('\n\n')}

【出力フォーマット (JSON)】
{
  "summaries": [
    {"url": "...", "title": "...", "key_points": ["..."], "matched_keywords": ["..."]}
  ],
  "overall_summary": "全体要約 (3-5行)",
  "fetch_status": [{"url": "...", "ok": true|false}]
}`;

  let ai;
  try {
    ai = await callGemini(summaryPrompt, {
      apiKey: config.gemini_api_key ?? '',
      maxTokens: 3072,
      temperature: 0.2,
      responseJson: true,
    });
    steps[1] = { ...steps[1], status: 'done', at: new Date().toISOString() };
  } catch (e) {
    warn('[web-research] AI summary failed', e);
    steps[1] = {
      ...steps[1],
      status: 'failed',
      at: new Date().toISOString(),
      detail: e instanceof Error ? e.message : String(e),
    };
    throw e;
  }

  return {
    executor: 'playwright',
    steps,
    output: ai.text,
    usage: {
      input_tokens: ai.inputTokens,
      output_tokens: ai.outputTokens,
      cost_usd: ai.costUsd,
      model: ai.model,
    },
    meta: {
      skill_id: 'web-research',
      started_at: startedAt,
      url_count: urls.length,
      success_count: successCount,
    },
  };
}
