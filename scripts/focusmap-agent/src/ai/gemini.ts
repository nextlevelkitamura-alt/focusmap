/**
 * Gemini 2.5 Flash-Lite クライアント
 *
 * - 入力 $0.0375/M / 出力 $0.15/M (2026-05 時点)
 * - simple tier のデフォルトモデル (saas-design-api-billing.md)
 * - max_tokens を safety.ts の MAX_TOKENS_PER_CALL に強制
 */

import { MAX_TOKENS_PER_CALL, API_TIMEOUT_MS } from '../safety.js';

const GEMINI_MODEL = 'gemini-2.5-flash-lite';
const INPUT_PRICE_PER_M = 0.0375;
const OUTPUT_PRICE_PER_M = 0.15;

export interface GeminiResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  model: string;
}

export interface GeminiOptions {
  apiKey: string;
  maxTokens?: number;
  temperature?: number;
  responseJson?: boolean;
}

export async function callGemini(prompt: string, options: GeminiOptions): Promise<GeminiResult> {
  if (!options.apiKey) {
    throw new Error('Gemini API key が未設定です (config.gemini_api_key)');
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${options.apiKey}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      maxOutputTokens: Math.min(options.maxTokens ?? MAX_TOKENS_PER_CALL, MAX_TOKENS_PER_CALL),
      temperature: options.temperature ?? 0.2,
      ...(options.responseJson !== false ? { responseMimeType: 'application/json' } : {}),
    },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini API ${res.status}: ${errText.slice(0, 300)}`);
    }
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const inputTokens = data.usageMetadata?.promptTokenCount ?? 0;
    const outputTokens = data.usageMetadata?.candidatesTokenCount ?? 0;
    const costUsd = (inputTokens * INPUT_PRICE_PER_M + outputTokens * OUTPUT_PRICE_PER_M) / 1_000_000;
    return { text, inputTokens, outputTokens, costUsd, model: GEMINI_MODEL };
  } finally {
    clearTimeout(timeout);
  }
}
