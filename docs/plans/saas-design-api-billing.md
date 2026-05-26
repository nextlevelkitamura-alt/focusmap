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

### 2.3 結論: モデル選定 (2026-05-26 ミニベンチマーク後に更新)

| 用途 | 採用モデル | 理由 |
|---|---|---|
| **Free / Personal / Team の月額込み実行 (デフォルト)** | **Gemini 2.5 Flash-Lite** | プロキシタスクで100%成功、Flashの半額、レイテンシも速い |
| 精度オプション (有料アップグレード) | Gemini 2.5 Flash | Flash-Lite で精度不足のスキルに切替可 |
| Enterprise / BYOK | Sonnet 4.6 / Haiku 4.5 / 任意 | ユーザーが自分でキーを持つので原価リスクなし |
| Browser automation 精度が要るスキル | Sonnet (BYOK) または Haiku 加算オプション | 「精度オプション」で別途課金 |

**ミニベンチマーク結果** ([benchmark-results-2026-05-26.md](./benchmark-results-2026-05-26.md)):
- Flash-Lite: 完全成功率 100%, 平均 $0.00008/呼び出し, レイテンシ 2.5-3.0s
- Flash: 完全成功率 44% (※Free tier rate limit、Paid tier では別の結果になる見込み)
- Groq Llama 3.3 70B: 完全成功率 56% (※TPM制限)

**残る検証必要事項**: Playwrightでの実DOM操作精度。プロキシタスクで100%でも、実Browser automationでは別物。Phase 3 Month 3でフルベンチマーク再実施。

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
