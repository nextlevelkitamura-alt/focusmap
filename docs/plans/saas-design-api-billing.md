# 論点c — API原価・課金実装設計

> 親計画: [focusmap-saas-pivot.md](./focusmap-saas-pivot.md)
> 前提: [saas-design-buyer-user.md](./saas-design-buyer-user.md)
> 競合分析: [competitive-analysis.md](./competitive-analysis.md)
> 作成: 2026-05-26

---

## 0. このドキュメントで決めること

- AIモデル選定と原価試算 → **どのモデルを基準に価格設計するか**
- 月額にAPIコストを含める「Focusmap負担モデル」の利益率
- Pay-as-you-go 超過課金の具体仕様
- BYOK (Enterprise) の実装方針
- Stripe実装の概略

---

## ⚠️ 0. 既存実装の活用 (2026-05-26 追記)

**使用量計測テーブル `ai_usage` と BYOK基盤 `api_keys` が既に実装済み**。

### 既存スキーマ

```sql
-- ai_usage: AI使用量ログ
CREATE TABLE ai_usage (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  feature TEXT NOT NULL,            -- 'memo_to_mindmap' 等
  model TEXT NOT NULL,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cost_usd NUMERIC(10,6) DEFAULT 0,
  metadata JSONB,
  created_at TIMESTAMPTZ
);

-- api_keys: BYOK基盤
CREATE TABLE api_keys (...);  -- 詳細は supabase/migrations/20260311_create_api_keys.sql
```

### 設計と既存の対応

| 本ドキュメントの記述 | 既存実装 | 状態 |
|---|---|---|
| usage_metrics (月集計) | `ai_usage` (1行=1実行、月集計はクエリで) | ✅ 既存活用 |
| プラン上限check | 未実装 (記録のみ) | ❌ **新規追加必要** |
| BYOK | `api_keys` テーブル既存 | ✅ 既存活用 (詳細実装は要確認) |
| Stripe Subscriptions | 未実装 | ❌ 新規追加必要 |
| Metered Billing | 未実装 | ❌ 新規追加必要 |
| 暴走対策 (`--max-budget-usd` 強制) | 一部実装の可能性、要確認 | △ |

### 差分追加が必要なもの

1. **`spaces.plan` 列**: free / personal / team / enterprise
2. **`spaces.billing_customer_id`** 列: Stripe Customer ID
3. **`ai_usage` への `space_id` 列追加** (現在は user_id のみ)
4. **月間使用量ビュー or 集計関数**: usage_monthly_summary(space_id, month)
5. **プラン上限check ロジック**: ai_tasks INSERT前に上限check (Trigger or アプリ層)
6. **Stripe Subscriptions / Webhook / Customer Portal** 統合

### 残る本文の扱い

§1〜§7 のモデル選定・原価試算・課金プラン設計はそのまま有効。実装時は **既存 `ai_usage` を上限check付きで活用** する。

---

## 1. AIモデル別 原価試算

### 1.1 各モデルの単価 (2026-05時点の公開価格)

| モデル | 入力 $/M tokens | 出力 $/M tokens | Browser能力 | 備考 |
|---|---|---|---|---|
| **Gemini 2.5 Flash** | $0.075 | $0.30 | △ (要検証) | 激安、速い |
| **Kimi K2** | ~$0.15 | ~$2.50 | △ | コード強い、自動化は実績薄 |
| **Claude Haiku 4.5** | $1.00 | $5.00 | ○ | Claude系で最安 |
| **Claude Sonnet 4.6** | $3.00 | $15.00 | ◎ | Browser automation 最強クラス |
| **GPT-4o mini** | $0.15 | $0.60 | △ | OpenAI系の激安枠 |

### 1.2 Browser automation 1実行あたりの想定トークン

実測前の見積もり (要本番計測):

- **入力**: 15万 tokens (システムプロンプト + DOM スナップショット数回 + 履歴)
- **出力**: 3万 tokens (思考 + アクション指示)

### 1.3 1実行原価の比較

| モデル | 入力15万分 | 出力3万分 | **1実行合計** | 月100実行 | 月2,500実行 |
|---|---|---|---|---|---|
| Gemini Flash | $0.011 | $0.009 | **$0.020** | $2.00 | $50.00 |
| GPT-4o mini | $0.023 | $0.018 | **$0.041** | $4.10 | $102.50 |
| Kimi K2 | $0.023 | $0.075 | **$0.098** | $9.80 | $245.00 |
| Claude Haiku | $0.150 | $0.150 | **$0.300** | $30.00 | $750.00 |
| Claude Sonnet | $0.450 | $0.450 | **$0.900** | $90.00 | $2,250.00 |

**桁が違う**: Gemini Flash と Claude Sonnet で **45倍** のコスト差。

---

## 2. プラン別 利益率試算

### 2.1 Gemini Flash 基準

| プラン | 月額収入 | API原価 (Gemini Flash) | 粗利 | 粗利率 |
|---|---|---|---|---|
| Free | $0 | 5実行 × $0.02 = **$0.10** | -$0.10 | 損失 (許容範囲) |
| Personal | $19 | 100実行 × $0.02 = **$2.00** | +$17.00 | **89%** |
| Team (5seat) | $195 | 2,500実行 × $0.02 = **$50** | +$145 | **74%** |
| Team (10seat) | $390 | 5,000実行 × $0.02 = **$100** | +$290 | **74%** |

### 2.2 Claude Sonnet 基準 (= Sonnetを月額に含めるとどうなるか)

| プラン | 月額収入 | API原価 (Sonnet) | 粗利 |
|---|---|---|---|
| Personal | $19 | 100実行 × $0.90 = **$90** | **-$71 (赤字)** |
| Team (5seat) | $195 | 2,500実行 × $0.90 = **$2,250** | **-$2,055 (大赤字)** |

→ **Sonnet を月額に含めるのは不可能**。

### 2.3 結論: ハイブリッドモデル戦略 (2026-05-26 ミニベンチマーク後)

スキル定義の `model_tier` で2タイプに分けてモデルを動的選択:

| model_tier | 採用モデル (現時点) | コスト想定 | 用途 |
|---|---|---|---|
| **`simple`** | **Gemini 2.5 Flash-Lite** | $0.001-$0.01/実行 | 要約・分類・整理・情報抽出 (DOM操作なし) |
| **`agent`** | **Phase 3 Month 3 で実機検証して決定** | $0.05-$0.30/実行 | Browser automation / Tool use 連鎖 / マルチターン推論 |
| Enterprise BYOK | Claude Sonnet 4.6 / 任意 | ユーザー負担 | 高精度が必要な業務 |

### 2.3.1 `agent` モデル候補の比較表

| モデル | 入力/出力 $/M | コンテキスト | キャッシュ | エージェント能力評価 | 採用判断 |
|---|---|---|---|---|---|
| **DeepSeek V4 Pro** (2026-04リリース) | **$0.435 / $0.87** | **1M tokens** | Cache hit $0.003625/M (超激安) | Browser automationの長尺DOM処理に有利、Kimi K2.6の半額以下 | **第一候補** |
| DeepSeek V3.1 (Terminus) | $0.27 / $1.10 | 128K | — | Function calling 強い、入力単価最安 | 第二候補 (短尺タスク用) |
| Kimi K2.6 | $0.95 / $4.00 | — | $0.16/M | Moonshot公式が「agent workload」と訴求 | 第三候補 (高品質枠) |
| GLM-4.6 | $0.50 / $1.50 | — | — | 中国系、要検証 | 第四候補 |
| Claude Haiku 4.5 | $1.00 / $5.00 | — | — | Anthropic Tool use の事実上標準 | リファレンス比較用 |
| Claude Sonnet 4.6 | $3.00 / $15.00 | — | — | Browser automation 最強クラス | Enterprise BYOK のみ |

**DeepSeek V4 Pro が第一候補となる理由:**
1. **1M token コンテキスト**: Browser automation で複数DOMスナップショット保持可、長尺マルチターンに強い
2. **Cache hit $0.003625/M**: システムプロンプト固定で繰り返し呼ぶ運用ならほぼタダ同然
3. **Kimi K2.6 の半額以下** で同等以上のエージェント能力 (公式リファレンス)
4. **2026-04リリースの最新世代**、価格戦略も攻撃的 (75%割引が永続化)

### 2.3.4 Cache hit 最適化戦略 (`agent` tier の **必須要件**)

DeepSeek V4 Pro の **Cache hit ($0.003625/M) は通常入力 ($0.435/M) の 120倍安い**。これを活用しないと Team プランの粗利率が破綻する。

**粗利率試算 (Team $195/月、agent 500実行/月):**

| 状態 | API原価 | 粗利率 |
|---|---|---|
| Cache hit 0% (素朴実装) | $152 | **22%** ❌ |
| Cache hit 50% | $77 | 60% △ |
| **Cache hit 80%** | **$32** | **84%** ✅ 目標値 |
| Cache hit 95% | $11 | 94% ✅ |

#### 実装方針

1. **プロンプト構造を「Cache 対象」と「Variable 部分」に明確分離**

   ```
   [CACHED_PREFIX]  ← 全実行で固定、自動でCache対象
     ・システム指示 (役割定義、ガードレール、暴走対策の指示)
     ・出力JSONスキーマ
     ・Tool定義一覧
     ・Few-shot 例示
     → 約2,000〜5,000 tokens、毎回同じ
   [/CACHED_PREFIX]

   [VARIABLE]  ← 毎回変わる、Cache miss
     ・現在のDOMスナップショット
     ・このタスクのユーザー指示
     ・直近の実行履歴
     → 約1,000〜10,000 tokens
   [/VARIABLE]
   ```

2. **Cache hit率の目標**: 全 agent 実行で **80%以上**
   - 計測指標: `cache_hit_tokens / total_input_tokens`
   - 月次でモニタリング、低下時はプロンプト構造を見直す

3. **DeepSeek API の Cache 仕様**
   - 入力プロンプトの **先頭部分** が前回と完全一致するとCache hit
   - 最小Cache対象長: 通常 1,024 tokens 以上 (公式仕様の確認 Phase 3 Month 1 で実施)
   - 明示的なCache ID指定は不要、自動判定

4. **スキル定義での扱い**

   ```json
   {
     "id": "form-aggregate",
     "model_tier": "agent",
     "cache_strategy": {
       "enabled": true,
       "min_hit_rate_target": 0.80,
       "cached_sections": ["system", "tools", "output_schema", "examples"]
     }
   }
   ```

#### Cache miss が高い場合の打ち手

| Cache hit率 | 状態 | 打ち手 |
|---|---|---|
| > 80% | 健全 | 維持 |
| 50-80% | 注意 | プロンプト構造の見直し、可変部分の最小化 |
| < 50% | 危険 | agent モデルを Kimi K2.6 に切替検討 (Cache依存度が低い設計) |

#### Phase 3 Month 3 のフルベンチマークで実測必須

- 実Playwright + DeepSeek V4 Pro で Cache hit率を計測
- 目標 80% に届かない場合は Team プラン構造の再設計が必要
- 副案: Cache hit に依存しないモデル (Kimi K2.6) を採用、その分価格を上げる

#### Cache hit 戦略は agent tier の **必須要件**

スキル開発時のレビュー項目:
- [ ] プロンプトが Cached / Variable に明確分離されているか
- [ ] Cached 部分が 1,024 tokens 以上あるか
- [ ] Variable 部分に「毎回変わる必要のない情報」が紛れていないか
- [ ] テスト実行で Cache hit率を確認したか

**判定基準** (Phase 3 Month 3 で実機検証時に適用):
- Playwright + 実DOM操作で 80%以上の成功率
- 1実行あたり $0.30 以下
- レイテンシ 平均 5分以内

### 2.3.2 ミニベンチマーク結果 (simple tier の確認)

[benchmark-results-2026-05-26.md](./benchmark-results-2026-05-26.md):
- Flash-Lite: 完全成功率 100%, 平均 $0.00008/呼び出し → **simple tier のデフォルトに確定**
- Flash: 完全成功率 44% (※Free tier rate limit)
- Groq Llama 3.3 70B: 完全成功率 56% (※TPM制限)

### 2.3.3 残る検証必要事項

- Playwrightでの実DOM操作精度 (agent tier 候補の本番ベンチマーク)
- DeepSeek V4 Pro が出ているか確認 (より安価な選択肢の可能性)
- 各候補モデルでの Tool use の挙動 (関数呼び出しエラー率)

---

## 3. Pay-as-you-go 超過課金

### 3.1 超過時の単価

| プラン | 超過1実行あたり |
|---|---|
| Personal | **$0.20** (= 原価$0.02の10倍マージン) |
| Team | **$0.10** (= 原価$0.02の5倍マージン) |
| Enterprise | BYOK or 別途交渉 |

### 3.2 超過時の挙動 (Admin が選択)

| モード | 挙動 |
|---|---|
| **自動停止** (デフォルト) | 上限到達で実行受付停止、Admin に通知 |
| **自動課金** | 上限超過後も実行を続け、月末に超過分を請求 |

- 自動課金モードは **月間ハードキャップ** を必須設定 (例: 上限の3倍まで)
- ハードキャップ到達で必ず停止 (暴走防止)

### 3.3 課金タイミング

- 月額: Stripe Subscription で月初請求
- 超過分: Stripe Metered Billing で月末集計請求

---

## 4. BYOK (Bring Your Own Key) 実装方針

### 4.1 対象プラン

- **Enterprise**: BYOK 標準提供 (Anthropic / OpenAI / Google AI / Moonshot 等)
- **Team**: BYOK オプション提供 (月額から「APIコスト分」を割引、$19/seatなど)
- **Personal / Free**: BYOK 非対応 (Focusmap負担モデルのみ)

### 4.2 キー保管

```
ユーザー → Webアプリで API key 入力
         ↓
Webサーバ → AES-256-GCM で暗号化 (環境変数の Master Key で)
         ↓
Supabase → encrypted_api_keys テーブルに保存
         ↓
実行時のみ → エージェントへ暗号化したまま送付、エージェント側で復号
```

- **平文は Webアプリにも DB にも残さない**
- マスターキーは Cloud Run の secret manager に置く (Supabase RLS だけだと不十分)

### 4.3 暴走防止の強制

BYOK でも以下は強制:
- `--max-budget-usd $2.00` を全実行に注入
- `--max-turns 10`
- 月間 hard cap ($100/月 等を Workspace で設定可)
- 過去24時間の累積コスト監視、急増時にアラート

### 4.4 キーローテーション

- 管理画面から1クリックで「キー再登録」
- 古いキーは即時無効化、保存も完全削除

---

## 5. Stripe実装の概略

### 5.1 採用するStripe機能

| 機能 | 用途 |
|---|---|
| **Subscriptions** | 月額固定料金 (Personal / Team プラン) |
| **Metered Billing** | 超過分の従量課金 |
| **Customer Portal** | ユーザーがプラン変更・カード変更を自己解決 |
| **Invoices** | 領収書ダウンロード (請求書払いの法人対応) |
| **Tax** | 消費税の自動計算 (日本のJCT対応) |
| **Webhooks** | 課金イベントを Supabase に反映 |

### 5.2 必要なStripe Product / Price 定義

```
Product: Focusmap Personal
  Price: $19/月 (recurring monthly)
  Metered Add-on: $0.20/execution (超過分)

Product: Focusmap Team
  Price: $39/seat/月 (recurring monthly, per_unit)
  Metered Add-on: $0.10/execution (超過分)

Product: Focusmap Enterprise
  Price: Custom (sales-led)
```

### 5.3 実装フェーズ

| フェーズ | 内容 |
|---|---|
| **MVP (Phase 3 Week 1-2)** | Stripe Subscriptions + Customer Portal + Webhook → Supabase反映 |
| **Phase 3 Week 3-4** | Metered Billing + 超過課金 |
| **Phase 3 Week 5+** | 法人請求書発行、消費税対応、年契約割引 |

### 5.4 法務・税務の前提条件

- **特定商取引法表記** (個人事業主として開業届 or 法人化)
- **利用規約 + プライバシーポリシー** (個人情報保護法 + GDPR)
- **インボイス制度対応** (適格請求書発行事業者登録)
- **JCT (日本消費税) の Stripe Tax 設定**

→ これらは **Phase 3 開始前** に弁護士・税理士と詰める必要 (1ヶ月程度の準備期間)

---

## 6. 暴走防止の最終仕様 (論点aと統合)

### 6.1 4層構造

| 層 | 内容 | 実装場所 |
|---|---|---|
| 層1: 実行数上限 | プラン別の月間実行カウンタ | Webサーバ |
| 層2: 最小実行間隔 | スキル別レートリミット | Webサーバ |
| 層3: API予算 | `--max-budget-usd $2.00` 強制 | エージェント |
| **層4: 累積コスト監視** | 過去24時間で平常時の3倍以上検知 → 自動停止 | Webサーバ + Cron |

### 6.2 `ANTHROPIC_API_KEY` の安全策

- エージェント起動時に環境変数チェック → 存在したら拒否 + ログ
- 利用者がうっかり `.env` に書かないようドキュメントで強く警告
- Sonnet/Haiku利用時はBYOK経由のみ、環境変数注入は使わない

---

## 7. ベンチマーク必須項目 (Phase 3 着手前)

実装に入る前に **必ず計測** する:

- [ ] Gemini Flash で代表スキル5個 (LINE未読 / 経理 / 求人更新 / 朝のブリーフィング / 架電リスト) を10回ずつ実行
- [ ] 各実行の: 実コスト / 成功率 / 平均実行時間 / リトライ回数
- [ ] Browser automation 精度が想定 (80%以上) を満たすか
- [ ] 満たさない場合: Haiku 4.5 で再計測、価格設計を見直し

**想定リスク:** Gemini Flash の精度が低く、リトライ多発でコストが3〜5倍に膨らむ可能性 (grill-meセッションでも指摘済み)
→ 計測結果次第で:
- Gemini Flash + Haiku のフォールバック構成にする
- Personal プランを $24-29 に値上げ
- 実行上限を100→50に厳しくする
- などの調整が必要

---

## 8. 次に検証すべきこと

- [ ] 実コスト計測 (上記ベンチマーク)
- [ ] Stripe Tax で日本のJCT処理がどこまで自動化されるか
- [ ] 適格請求書発行事業者登録の手続き期間
- [ ] BYOK のキー暗号化方式 (AES-256-GCM + AWS KMS / GCP KMS の選定)
- [ ] 個人開発者がStripeで決済受け取り開始までの審査期間

---

最終更新: 2026-05-26
