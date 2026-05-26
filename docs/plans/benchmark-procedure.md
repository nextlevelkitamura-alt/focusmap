# Gemini Flash ベンチマーク手順書

> 親計画: [focusmap-saas-pivot.md](./focusmap-saas-pivot.md)
> 価格設計の根拠: [saas-design-api-billing.md](./saas-design-api-billing.md)
> 着手時期: Phase 3 開始前（必須）

---

## 0. このベンチマークの目的

Phase 3 着手前に **必ず計測** すべき値:

1. Gemini 2.5 Flash が Browser automation で **どれくらいの精度で動くか**
2. 1実行あたりの **実コスト** ($0.02 想定だが、実測しないと分からない)
3. リトライ・誤動作で **想定の何倍** にコストが膨らむか
4. Claude Haiku 4.5 にフォールバックする必要があるか

**この計測結果次第で、Personal $19 プランの価格 / 月100実行の上限 / 採用モデル が変わる。**

---

## 1. 比較するモデル

| モデル | 入力 $/M | 出力 $/M | 採用想定 |
|---|---|---|---|
| Gemini 2.5 Flash | $0.075 | $0.30 | 第一候補（Focusmap負担月額プランに採用） |
| Gemini 2.5 Flash-Lite | $0.0375 | $0.15 | 軽量タスク用フォールバック |
| Claude Haiku 4.5 | $1.00 | $5.00 | 精度不足時のフォールバック |
| Claude Sonnet 4.6 | $3.00 | $15.00 | Enterprise BYOK のリファレンス（精度の上限） |

---

## 2. 計測するスキル

MVP の3スキル + 統合の計4パターン。各10回ずつ実行 = **40実行 × 4モデル = 160実行**。

| # | スキル | 認証 | 想定難易度 | 想定トークン (入/出) |
|---|---|---|---|---|
| 1 | 📅 今日のカレンダー整理 | Google Calendar API | 低（既存APIなのでDOM操作不要） | 5万 / 1万 |
| 2 | 🌐 競合・情報サイト巡回（5サイト固定） | なし | 中（DOMが多様） | 20万 / 4万 |
| 3 | 📧 メール要約（Gmail API） | Gmail OAuth | 低-中 | 15万 / 3万 |
| 4 | 🌅 統合（1+2+3 順次実行） | 全部 | 高 | 40万 / 8万 |

---

## 3. 計測項目

各実行ごとに以下を記録:

| 項目 | 単位 | 重要度 |
|---|---|---|
| 実行モデル | — | — |
| スキル名 | — | — |
| 入力トークン | tokens | 高 |
| 出力トークン | tokens | 高 |
| 推定コスト (USD) | $ | 高 |
| 実行時間 | 秒 | 中 |
| 成功/失敗 | bool | 高 |
| 失敗理由 (失敗時) | text | 中 |
| リトライ回数 | int | 高 |
| 最終結果の品質 (主観評価) | 1-5 | 高 |
| DOM操作の試行回数 | int | 中 |
| 確認待ちで止まった箇所 | text | 低 |

---

## 4. 計測の流れ

### 4.1 準備

- [ ] Google AI Studio から Gemini API キー取得 (Free tier で十分: 1日1,500リクエスト)
- [ ] Anthropic Console から API キー取得 (Haiku/Sonnet計測用、$10 のクレジット入金)
- [ ] テストシナリオ作成:
  - スキル2用: 競合サイト5つを固定 (Zapier / n8n / Lindy / Bardeen / Make 公式)
  - スキル1, 3用: 北村のテスト用Google アカウントを使用
- [ ] 計測結果記録用のスプシ準備 (Google Sheets)

### 4.2 1回の計測 (1モデル × 1スキル × 10回)

```
1. スキルAを実行 (モデルX)
2. ログから入力/出力トークン数を取得
3. 実行時間を計測
4. 成功/失敗を判定
5. 失敗時はリトライ (最大3回)
6. 結果をスプシに記録
7. 1分待機 (rate limit対策)
8. 次の実行へ
```

### 4.3 全体フロー (160実行)

```
モデル: Gemini Flash → Flash-Lite → Haiku → Sonnet の順
スキル: 1 → 2 → 3 → 4 の順
各組合せ10回ずつ → 合計160実行

所要時間想定:
  1実行 平均 3分 (シンプル) 〜 10分 (統合)
  平均5分 × 160 = 800分 = 約13.3時間

実施スパン: 2-3日に分けて、夜間に流す
```

### 4.4 集計

実行完了後、スプシで:
- モデル別 平均コスト / 平均実行時間 / 成功率 / 品質スコア
- スキル別 同じ集計
- リトライ込みの実コスト推定 (= 1実行 × リトライ係数)

---

## 5. 判定基準

### 5.1 採用基準

各モデルが Personal プラン ($19/月、100実行) で使えるかの判定:

| 基準 | 必須ライン |
|---|---|
| 1実行平均コスト (リトライ込) | $0.05 以下 (= 月100実行で $5、粗利率74%以上) |
| 成功率 | 80%以上 |
| 品質スコア平均 | 3.5/5 以上 |
| 平均実行時間 | 5分以内 |

### 5.2 結果別の打ち手

| 結果 | 打ち手 |
|---|---|
| Gemini Flash で全基準クリア | 当初設計通り、Personal $19 で進む |
| Gemini Flash 精度不足 (成功率 < 80%) | Haiku 4.5 へ移行検討、Personal $24-29 に値上げ |
| Gemini Flash 精度OKだがコスト高 (>$0.05) | Personal 100→50実行に削減、または Pay-as-you-go閾値下げ |
| Haiku でも基準満たさない | スキル設計を見直し、Browser automationの依存度を下げる (Gmail APIを直叩き、DOM操作減らす) |
| すべて基準満たさない | プロダクト方向性の再検討（Phase 3 着手延期） |

---

## 6. ベンチマーク用最小サンプル (Playwright + Gemini Flash)

`scripts/benchmark/run.ts` (新規作成予定):

```typescript
import { chromium, Browser, Page } from 'playwright';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { writeFileSync, appendFileSync } from 'fs';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

interface RunResult {
  skill: string;
  model: string;
  iteration: number;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
  duration_sec: number;
  success: boolean;
  failure_reason?: string;
  retries: number;
  quality_score?: number; // 後で手動入力
  timestamp: string;
}

const COSTS = {
  'gemini-2.5-flash': { input: 0.075 / 1_000_000, output: 0.30 / 1_000_000 },
  'gemini-2.5-flash-lite': { input: 0.0375 / 1_000_000, output: 0.15 / 1_000_000 },
  'claude-haiku-4-5': { input: 1.00 / 1_000_000, output: 5.00 / 1_000_000 },
  'claude-sonnet-4-6': { input: 3.00 / 1_000_000, output: 15.00 / 1_000_000 },
};

async function runSkill(skillName: string, modelName: string, iteration: number): Promise<RunResult> {
  const start = Date.now();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  let inputTokens = 0;
  let outputTokens = 0;
  let success = false;
  let retries = 0;
  let failureReason: string | undefined;

  try {
    // スキル別のロジックを実装 (省略、各スキルファイルに分割)
    // ここでは例として「指定URLに行って、要約を生成」
    await page.goto('https://example.com');
    const html = await page.content();

    const prompt = `以下のHTMLを3行で要約してください:\n${html.slice(0, 50000)}`;
    const result = await model.generateContent(prompt);

    inputTokens = result.response.usageMetadata?.promptTokenCount ?? 0;
    outputTokens = result.response.usageMetadata?.candidatesTokenCount ?? 0;
    success = true;
  } catch (err) {
    failureReason = String(err);
  } finally {
    await browser.close();
  }

  const cost = COSTS[modelName as keyof typeof COSTS];
  const estimatedCost = inputTokens * cost.input + outputTokens * cost.output;

  return {
    skill: skillName,
    model: modelName,
    iteration,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    estimated_cost_usd: estimatedCost,
    duration_sec: (Date.now() - start) / 1000,
    success,
    failure_reason: failureReason,
    retries,
    timestamp: new Date().toISOString(),
  };
}

async function main() {
  const results: RunResult[] = [];
  const skills = ['calendar', 'web-research', 'email-summary', 'morning-briefing'];
  const models = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'claude-haiku-4-5', 'claude-sonnet-4-6'];

  for (const m of models) {
    for (const s of skills) {
      for (let i = 1; i <= 10; i++) {
        console.log(`[${m}] ${s} #${i}`);
        const r = await runSkill(s, m, i);
        results.push(r);
        appendFileSync('benchmark-results.jsonl', JSON.stringify(r) + '\n');
        await new Promise(res => setTimeout(res, 60_000)); // 1分待機
      }
    }
  }

  writeFileSync('benchmark-results-summary.json', JSON.stringify(results, null, 2));
}

main();
```

実装する時はスキル別のロジックを個別ファイルに分割（`skills/calendar.ts` 等）。

---

## 7. 計測結果のレポート先

完了後、結果を以下にまとめる:
- `docs/plans/benchmark-results-2026-XX.md` (新規ドキュメント)
- 上記の判定基準に基づくモデル選定の最終決定
- 必要なら [saas-design-api-billing.md](./saas-design-api-billing.md) と [saas-design-mvp.md](./saas-design-mvp.md) を更新

---

## 8. 注意事項

- **本番APIキーで実行する**。Free tier だとレート制限で遅延する
- **テスト用Googleアカウント**を別途用意する。本業のアカウントでBrowser automationしない
- **対象サイトの利用規約**を確認: スクレイピング禁止条項に抵触しないか
- **Rate limit対策**: モデル毎に分間/日次の上限あり、1分待機で大体OK
- **失敗ログを必ず残す**: 「なぜ失敗したか」が次の打ち手に直結

---

最終更新: 2026-05-26
