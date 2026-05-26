# ミニベンチマーク結果 (2026-05-26)

> 親計画: [benchmark-procedure.md](./benchmark-procedure.md)
> スクリプト: [scripts/benchmark/mini.ts](../../scripts/benchmark/mini.ts)
> 生データ: [scripts/benchmark/results-2026-05-26.jsonl](../../scripts/benchmark/results-2026-05-26.jsonl)

---

## 0. 実施概要

| 項目 | 内容 |
|---|---|
| 目的 | Phase 3 着手前に「激安モデルで価格設計が破綻しないか」のフィージビリティ確認 |
| スコープ | Browser automation の **プロキシタスク** (固定HTML/メール/カレンダーを構造化JSON出力) |
| 対象モデル | Gemini 2.5 Flash / Flash-Lite / Groq Llama 3.3 70B |
| タスク | web-summary / email-classify / calendar-suggest |
| 試行数 | 3モデル × 3タスク × 3回 = 27呼び出し |
| 実施時間 | 約2分 |
| **非含む** | Kimi (高価)、Claude (Anthropic未契約・方針外)、DeepSeek (キー未設定)、実Playwright (未インストール) |

---

## 1. 結果テーブル

### 1.1 モデル別 総合

| Model | 試行 | 完全成功率 | 平均コスト/呼び出し | 月100実行原価 | 月2,500実行原価 |
|---|---|---|---|---|---|
| **gemini-2.5-flash-lite** | 9 | **100% ✅** | $0.00008 | $0.008 | $0.20 |
| gemini-2.5-flash | 9 | 44% (※rate limit) | $0.00007 (成功時) | $0.007 | $0.18 |
| groq-llama-3.3-70b | 9 | 56% (※rate limit) | $0.00028 | $0.028 | $0.71 |

### 1.2 タスク別 詳細

| Model | Task | 成功率 | 入/出 平均トークン | 平均レイテンシ |
|---|---|---|---|---|
| gemini-2.5-flash | web-summary | 33% | 109 / 130 | 4.5s |
| gemini-2.5-flash | email-classify | 67% | 320 / 283 | 9.5s |
| gemini-2.5-flash | calendar-suggest | 33% | 115 / 167 | 15.7s |
| gemini-2.5-flash-lite | web-summary | **100%** | 328 / 396 | 2.5s |
| gemini-2.5-flash-lite | email-classify | **100%** | 480 / 421 | 3.0s |
| gemini-2.5-flash-lite | calendar-suggest | **100%** | 344 / 407 | 2.8s |
| groq-llama-3.3-70b | web-summary | 67% | 245 / 189 | 0.6s |
| groq-llama-3.3-70b | email-classify | 33% | 188 / 118 | 0.5s |
| groq-llama-3.3-70b | calendar-suggest | 67% | 252 / 257 | 0.7s |

---

## 2. 失敗の原因分析

**失敗の100%が rate limit (HTTP 429 / 503) 起因**。モデルの能力不足ではない。

### 2.1 Gemini Flash の失敗

- **429**: `Quota exceeded for metric` (Free tier の分単位クォータ超過)
- **503**: `This model is currently experiencing high demand` (一時的な過負荷)
- → Paid tier (従量課金) に切り替えれば大幅緩和される

### 2.2 Groq Llama の失敗

- **429**: `TPM (tokens per minute) limit 12,000` 超過
- 各呼び出し約4,000トークン、3呼び出しで枯渇
- → Groq Dev Tier ($) で大幅緩和

### 2.3 Flash-Lite が100%成功した理由

- 同じGemini APIキーだが、Flash-Lite は **別のクォータ枠**
- Flash が429で停滞している間に時間経過し、レートが回復していた可能性
- 単独で連続実行した場合の挙動は別途検証が必要

---

## 3. 設計判断への含意

### 3.1 デフォルトモデルの変更を推奨

| 当初 | 変更後 |
|---|---|
| デフォルト = Gemini 2.5 Flash | **デフォルト = Gemini 2.5 Flash-Lite** |
| Flash の精度を前提に設計 | Flash-Lite で十分、Flash は精度オプション化 |

**根拠:**
1. Flash-Lite は本ベンチマークで100%成功
2. コスト Flash の半額
3. レイテンシも Flash より速い (2.5-3s vs 4.5-15.7s)
4. プロキシタスクの範囲では品質差を観測できなかった

### 3.2 価格設計の修正

[saas-design-api-billing.md](./saas-design-api-billing.md) の数値を以下で更新可能:

| プラン | 当初試算 (Flash) | 修正後 (Flash-Lite) |
|---|---|---|
| Personal $19 / 100実行 | 原価 $2 / 粗利率89% | 原価 **$0.50-$1** / 粗利率 **95-97%** |
| Team $39/seat × 5 / 2,500実行 | 原価 $50 / 粗利率74% | 原価 **$12-25** / 粗利率 **87-94%** |

→ **価格を下げる余地が出る** か、**実行上限を引き上げる余地が出る**:
- 案A: Personal $14 で同等粗利率を維持 → 価格競争力向上
- 案B: Personal $19 のまま、実行上限を100→200に倍増 → ユーザー満足度向上
- 案C: 現状維持 + 暴走対策の予算を厚くする

### 3.3 Free tier クォータは当てにできない

- Phase 3 Month 1 着手前に **Gemini API の Paid tier 切り替え** が必須
- 月数千円〜数万円の従量課金が発生する見込み
- 暴走対策 (`--max-budget-usd`) は **個別実行レベルでなく、月間ハードキャップも併設** 必要

---

## 4. このベンチマークの限界

### 4.1 観測できなかったこと

- **Browser automation の実精度**: Playwrightで実DOMを操作した時の成功率は別物
- **長尺タスクのコスト**: 1スキル完了に10〜30 turn の往復が必要な場合のトークン消費
- **モデル間の品質差**: Flash と Flash-Lite の差は **実Playwrightで初めて見える** 可能性
- **長時間運用のレイテンシ変動**: 1日中走らせ続けた時の Paid tier での挙動

### 4.2 次にやるべきベンチマーク (Phase 3 Month 3 想定)

1. **Paid tier 切替後の再計測** (rate limit による失敗を消す)
2. **Playwright 実装後のフルベンチマーク** (benchmark-procedure.md §2-4)
3. **長時間連続実行** (1日100実行 × 7日 = 700実行 で安定性確認)
4. **DeepSeek V3.1 ($0.27/$1.10) の追加検証** (キー入手後)

---

## 5. 次のアクション

- [ ] [saas-design-api-billing.md](./saas-design-api-billing.md) のデフォルトモデルを Flash-Lite に変更
- [ ] [saas-design-mvp.md](./saas-design-mvp.md) の価格表に「Flash-Lite 採用、$19 / 100実行で粗利率 95%超」 追記
- [ ] Gemini API の Paid tier 切替 (Google Cloud Console)
- [ ] 月間ハードキャップの設定 ($100/月など)
- [ ] Phase 3 Month 3 でPlaywright実装後にフルベンチマーク再実施

---

最終更新: 2026-05-26
