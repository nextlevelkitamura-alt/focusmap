/**
 * Focusmap Mini Benchmark
 *
 * 激安AIモデル3種を「Browser automationのプロキシタスク」3つで比較計測。
 * 詳細: docs/plans/benchmark-procedure.md
 *
 * 実行: npx tsx scripts/benchmark/mini.ts
 */

import { readFileSync, appendFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// .env.local を手動で読み込む (dotenv 依存を避けるため)
function loadEnvFile(path: string) {
  if (!existsSync(path)) return;
  const lines = readFileSync(path, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // クォート除去
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnvFile('.env.local');

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, 'fixtures');
const RESULTS_DIR = __dirname;
const TS = new Date().toISOString().slice(0, 10);
const JSONL_PATH = join(RESULTS_DIR, `results-${TS}.jsonl`);
const SUMMARY_PATH = join(RESULTS_DIR, `results-${TS}-summary.md`);

const ITERATIONS_PER_PAIR = 3;
const SLEEP_BETWEEN_CALLS_MS = 2_000;

type ModelConfig =
  | { provider: 'gemini'; modelId: string; apiKey: string; inputPriceUsdPerM: number; outputPriceUsdPerM: number }
  | { provider: 'openai-compat'; endpoint: string; modelId: string; apiKey: string; inputPriceUsdPerM: number; outputPriceUsdPerM: number };

const MODELS: BenchRecord<string, ModelConfig> = {
  'gemini-2.5-flash': {
    provider: 'gemini',
    modelId: 'gemini-2.5-flash',
    apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? '',
    inputPriceUsdPerM: 0.075,
    outputPriceUsdPerM: 0.30,
  },
  'gemini-2.5-flash-lite': {
    provider: 'gemini',
    modelId: 'gemini-2.5-flash-lite',
    apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? '',
    inputPriceUsdPerM: 0.0375,
    outputPriceUsdPerM: 0.15,
  },
  'groq-llama-3.3-70b': {
    provider: 'openai-compat',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    modelId: 'llama-3.3-70b-versatile',
    apiKey: process.env.GROQ_API_KEY ?? '',
    inputPriceUsdPerM: 0.59,
    outputPriceUsdPerM: 0.79,
  },
};

interface Task {
  name: string;
  inputFile: string;
  validate: (jsonOutput: any) => { validJson: boolean; hasExpectedKeys: boolean; notes: string };
}

const TASKS: Task[] = [
  {
    name: 'web-summary',
    inputFile: 'web-summary-input.txt',
    validate: (j) => {
      const hasPlans = Array.isArray(j?.plans) && j.plans.length >= 3;
      const hasLowest = typeof j?.lowest_paid_plan === 'string';
      return {
        validJson: true,
        hasExpectedKeys: hasPlans && hasLowest,
        notes: `plans.length=${j?.plans?.length}, lowest=${j?.lowest_paid_plan}`,
      };
    },
  },
  {
    name: 'email-classify',
    inputFile: 'email-classify-input.txt',
    validate: (j) => {
      const hasEmails = Array.isArray(j?.emails) && j.emails.length === 5;
      const allHavePriority = hasEmails && j.emails.every((e: any) => ['high', 'medium', 'low'].includes(e?.priority));
      const hasCounts = typeof j?.must_reply_today_count === 'number';
      return {
        validJson: true,
        hasExpectedKeys: hasEmails && allHavePriority && hasCounts,
        notes: `emails.length=${j?.emails?.length}, must_reply=${j?.must_reply_today_count}`,
      };
    },
  },
  {
    name: 'calendar-suggest',
    inputFile: 'calendar-suggest-input.txt',
    validate: (j) => {
      const hasFree = Array.isArray(j?.free_slots);
      const hasSuggestions = Array.isArray(j?.suggested_allocations);
      const hasTotal = typeof j?.total_free_minutes === 'number';
      return {
        validJson: true,
        hasExpectedKeys: hasFree && hasSuggestions && hasTotal,
        notes: `free_slots=${j?.free_slots?.length}, suggestions=${j?.suggested_allocations?.length}, total=${j?.total_free_minutes}`,
      };
    },
  },
];

interface ApiResult {
  output: string;
  inputTokens: number;
  outputTokens: number;
}

async function callGemini(modelId: string, apiKey: string, prompt: string): Promise<ApiResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json',
      maxOutputTokens: 4096,
    },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data: any = await res.json();
  if (!res.ok) throw new Error(`Gemini error ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return {
    output: data.candidates?.[0]?.content?.parts?.[0]?.text ?? '',
    inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
  };
}

async function callOpenAICompat(endpoint: string, modelId: string, apiKey: string, prompt: string): Promise<ApiResult> {
  const body = {
    model: modelId,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2,
    response_format: { type: 'json_object' },
    max_tokens: 4096,
  };
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  const data: any = await res.json();
  if (!res.ok) throw new Error(`OpenAI-compat error ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return {
    output: data.choices?.[0]?.message?.content ?? '',
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
  };
}

interface BenchBenchRecord {
  ts: string;
  modelName: string;
  task: string;
  iteration: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  durationMs: number;
  success: boolean;
  validJson: boolean;
  hasExpectedKeys: boolean;
  notes: string;
  error?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function run() {
  console.log(`\n=== Focusmap Mini Benchmark ===`);
  console.log(`Models: ${Object.keys(MODELS).join(', ')}`);
  console.log(`Tasks:  ${TASKS.map((t) => t.name).join(', ')}`);
  console.log(`Iterations per pair: ${ITERATIONS_PER_PAIR}`);
  console.log(`Output: ${JSONL_PATH}\n`);

  // 各モデルのキー有無確認
  for (const [name, cfg] of Object.entries(MODELS)) {
    if (!cfg.apiKey) {
      console.log(`⚠️  ${name}: APIキー未設定 — スキップ`);
    }
  }

  const records: BenchRecord[] = [];

  for (const [modelName, cfg] of Object.entries(MODELS)) {
    if (!cfg.apiKey) continue;

    for (const task of TASKS) {
      const prompt = readFileSync(join(FIXTURES_DIR, task.inputFile), 'utf8');

      for (let iter = 1; iter <= ITERATIONS_PER_PAIR; iter++) {
        const start = Date.now();
        let inputTokens = 0;
        let outputTokens = 0;
        let output = '';
        let error: string | undefined;
        let success = false;
        let validJson = false;
        let hasExpectedKeys = false;
        let notes = '';

        try {
          const result =
            cfg.provider === 'gemini'
              ? await callGemini(cfg.modelId, cfg.apiKey, prompt)
              : await callOpenAICompat(cfg.endpoint, cfg.modelId, cfg.apiKey, prompt);
          inputTokens = result.inputTokens;
          outputTokens = result.outputTokens;
          output = result.output;
          success = true;
        } catch (e: any) {
          error = String(e?.message ?? e).slice(0, 500);
        }

        if (success) {
          try {
            const parsed = JSON.parse(output);
            validJson = true;
            const v = task.validate(parsed);
            hasExpectedKeys = v.hasExpectedKeys;
            notes = v.notes;
          } catch {
            validJson = false;
            notes = `JSON parse failed: ${output.slice(0, 100)}`;
          }
        }

        const durationMs = Date.now() - start;
        const estimatedCostUsd =
          (inputTokens * cfg.inputPriceUsdPerM + outputTokens * cfg.outputPriceUsdPerM) / 1_000_000;

        const rec: BenchRecord = {
          ts: new Date().toISOString(),
          modelName,
          task: task.name,
          iteration: iter,
          inputTokens,
          outputTokens,
          estimatedCostUsd,
          durationMs,
          success,
          validJson,
          hasExpectedKeys,
          notes,
          error,
        };
        records.push(rec);
        appendFileSync(JSONL_PATH, JSON.stringify(rec) + '\n');

        const flag = !success ? '❌' : !validJson ? '⚠️ ' : !hasExpectedKeys ? '🟡' : '✅';
        console.log(
          `${flag} ${modelName.padEnd(24)} ${task.name.padEnd(18)} #${iter}  ${durationMs}ms  in=${inputTokens} out=${outputTokens}  $${estimatedCostUsd.toFixed(5)}  ${notes}`,
        );

        await sleep(SLEEP_BETWEEN_CALLS_MS);
      }
    }
  }

  // サマリ作成
  const summary = makeSummary(records);
  writeFileSync(SUMMARY_PATH, summary);
  console.log(`\n📄 サマリを書き出し: ${SUMMARY_PATH}\n`);
}

function makeSummary(records: BenchRecord[]): string {
  const byModelTask = new Map<string, BenchRecord[]>();
  for (const r of records) {
    const key = `${r.modelName}__${r.task}`;
    if (!byModelTask.has(key)) byModelTask.set(key, []);
    byModelTask.get(key)!.push(r);
  }

  let md = `# Mini Benchmark Results (${TS})\n\n`;
  md += `> 自動生成: scripts/benchmark/mini.ts による測定結果\n`;
  md += `> 親計画: [benchmark-procedure.md](../../docs/plans/benchmark-procedure.md)\n\n`;
  md += `## 集計\n\n`;
  md += `| Model | Task | 成功率 | JSON有効率 | キー充足率 | 平均トークン (入/出) | 平均コスト | 平均レイテンシ |\n`;
  md += `|---|---|---|---|---|---|---|---|\n`;

  const modelTotals = new Map<string, { runs: number; cost: number; success: number; fullPass: number }>();

  for (const [key, rs] of byModelTask) {
    const [modelName, task] = key.split('__');
    const n = rs.length;
    const successRate = (rs.filter((r) => r.success).length / n) * 100;
    const jsonRate = (rs.filter((r) => r.validJson).length / n) * 100;
    const keysRate = (rs.filter((r) => r.hasExpectedKeys).length / n) * 100;
    const avgInTok = rs.reduce((s, r) => s + r.inputTokens, 0) / n;
    const avgOutTok = rs.reduce((s, r) => s + r.outputTokens, 0) / n;
    const avgCost = rs.reduce((s, r) => s + r.estimatedCostUsd, 0) / n;
    const avgMs = rs.reduce((s, r) => s + r.durationMs, 0) / n;

    md += `| ${modelName} | ${task} | ${successRate.toFixed(0)}% | ${jsonRate.toFixed(0)}% | ${keysRate.toFixed(0)}% | ${avgInTok.toFixed(0)} / ${avgOutTok.toFixed(0)} | $${avgCost.toFixed(5)} | ${(avgMs / 1000).toFixed(1)}s |\n`;

    if (!modelTotals.has(modelName)) {
      modelTotals.set(modelName, { runs: 0, cost: 0, success: 0, fullPass: 0 });
    }
    const m = modelTotals.get(modelName)!;
    m.runs += n;
    m.cost += rs.reduce((s, r) => s + r.estimatedCostUsd, 0);
    m.success += rs.filter((r) => r.success).length;
    m.fullPass += rs.filter((r) => r.success && r.validJson && r.hasExpectedKeys).length;
  }

  md += `\n## モデル別 総合\n\n`;
  md += `| Model | 試行 | 完全成功率 | 平均コスト/実行 | 月100実行原価 (Personal $19想定) | 月2,500実行原価 (Team $195想定) |\n`;
  md += `|---|---|---|---|---|---|\n`;
  for (const [name, m] of modelTotals) {
    const fullPass = (m.fullPass / m.runs) * 100;
    const avgCost = m.cost / m.runs;
    const cost100 = avgCost * 100;
    const cost2500 = avgCost * 2500;
    md += `| ${name} | ${m.runs} | ${fullPass.toFixed(0)}% | $${avgCost.toFixed(5)} | $${cost100.toFixed(2)} | $${cost2500.toFixed(2)} |\n`;
  }

  md += `\n## 注意事項\n\n`;
  md += `- このベンチマークは **Browser automation のプロキシ**として固定HTML/メール/カレンダーをLLMに渡して構造化出力させたもの\n`;
  md += `- 実際のPlaywright実行では DOM操作の試行錯誤・リトライが入り、トークンが3〜5倍に膨らむ可能性\n`;
  md += `- benchmark-procedure.md のフル仕様 (Playwright + 4スキル × 4モデル × 10回 = 160実行) は北村本人が後日実施\n`;
  md += `- この結果は **「価格設計が現実的か」のフィージビリティチェック**として読む\n`;

  return md;
}

run().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
