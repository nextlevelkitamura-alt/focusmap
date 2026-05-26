/**
 * 安全策: ANTHROPIC_API_KEY 起動時拒否 / トークン上限定数
 *
 * CLAUDE.md 方針:
 *   - ANTHROPIC_API_KEY が環境変数にあると Max契約ではなく API 従量課金になる ($1,800事故事例)
 *   - 起動時に拒否してプロセスを終了する
 */

import { error as logError } from './logger.js';

export function assertNoAnthropicKey(): void {
  if (process.env.ANTHROPIC_API_KEY) {
    logError(
      'ANTHROPIC_API_KEY が環境変数にあります。CLAUDE.md 方針に従い、起動を中止します。',
      '対応: `unset ANTHROPIC_API_KEY` してから再起動してください。',
    );
    process.exit(1);
  }
}

/** 1 API call あたりの最大出力トークン (Gemini Flash-Lite で4096) */
export const MAX_TOKENS_PER_CALL = 4096;

/** 1 task あたりの最大 turn 数 (将来 multi-turn になった場合) */
export const MAX_TURNS_PER_TASK = 10;

/** API call の timeout (ms) */
export const API_TIMEOUT_MS = 60_000;
