# Focusmap SaaS化計画（配布版・マルチユーザー化）

> grill-me セッション（2026-05-26）での合意事項を記録
> 親計画: [focusmap-pivot.md](./focusmap-pivot.md)
> ステータス: 設計詰め中（5論点中 0/5 完了）

---

## 経緯

個人用ダッシュボードとして方向転換した Focusmap を、SaaS化して「他人にも使ってもらう」方向に発展させる構想。
grill-me セッションで以下の論点を詰めた。

最初は「base44のように誰でも簡単に自動化を作れるプラットフォーム」という曖昧な構想だったが、9問のgrill-meを通じて構造矛盾を解消し、現実的な設計枠まで降ろした。

---

## 1. 確定したゴール

- **起業して食える事業を作る**（月◯円の売上を立てる商業プロダクト）
- 売却も視野
- 自分自身が一番使えるツールであることも大切にする（Scratch your own itch）
- **半年リリースは無理、伸ばしてOK** と合意

---

## 2. 確定したターゲット（2層ペルソナ）

| 層 | 役割 | 特徴 |
|---|---|---|
| **BUYER（購買者）** | 小規模法人の経営者・CTO・IT責任者 | Mac mini投資を決裁、月額課金OK、AI導入の意思決定者 |
| **USER（利用者）** | その会社の社員 / 興味あるが踏み切れない個人 | AI不慣れ、ITはそこそこ、ボタン押すだけで動いてほしい |

- ポジショニング: **B2SMB（Small Business）+ B2C アーリーマジョリティ手前**
- 「お金を払う人 ≠ 使う人」 = SaaS設計の典型（決裁者と利用者の分離設計が必要）

### ターゲット選定の理由

1. 「Mac mini常時稼働」が「PC接続時のみ動く」問題の解決策。これを許容できるリテラシー層
2. Zapier/Lindyとの差別化「ローカル実行で自分のCookie使える」が最も刺さる
3. 月5,000〜10,000円のSaaS料金を払える層
4. 売却時の買い手（DevOps/MLOps系SaaS、Bardeen/Lindy系企業）が見つけやすい

### 却下した選択肢と理由

| 却下した案 | 理由 |
|---|---|
| 業界特化（CA業務同業向け） | 北村が同業界に閉じたくない、汎用ツールにしたい |
| 「APIわからない、PCはブラウザしか触らない人」 | Mac mini投資不可能、戦略破綻 |
| 「個人/法人で完全汎用」 | Zapier/Lindyと同じ土俵で勝てる根拠なし |

---

## 3. 確定したアーキテクチャ（ハイブリッド）

```
[クラウド側: Webアプリ + Supabase]
  - スキル選択UI / 実行ログ / 状態可視化
  - チーム共有・スペース共有
  - 課金 / 管理画面（決裁者向け）
  - 利用者向け簡単UI（ボタン押すだけ）
        ↕ (Supabase Realtime)
[ローカル側: Mac mini常時稼働 + エージェント]
  - Playwright実行 / claude or Gemini呼び出し
  - 認証Cookie保持 / ローカルファイル操作
        ↕
[AI API: Gemini Flash / Kimi K2 / Claude Sonnet]
```

### 設計判断の理由

- 「ローカル + チーム共有」の矛盾を、**実行=ローカル / 状態管理=クラウド** で解消
- Apple Developer登録/公証/Windows code signing を後回しにし、**まずWebアプリで成立させる**
- 半年でできること、後回しでいいことを分離

---

## 4. 確定した課金モデル

| 対象 | API課金方式 |
|---|---|
| カスタマー（個人）向け | **月額こみ**（Focusmapが代理でAPI叩き、料金に含める） |
| 法人向け | **選べる**（自社APIキー持ち込み or 月額こみ） |
| プラットフォーム利用料 | 別途課金（席数ベース等） |

### 暴走対策（必須）

- `--max-budget-usd` を全実行に強制
- `--max-turns` を強制
- ユーザー単位の月間API予算上限
- 異常検知時の自動停止
- $1,800事故型の暴走を構造的に防ぐ

---

## 5. 詰めた5論点（すべて完了 ✅）

### a. BUYER/USER 分離設計 ✅

詳細: [saas-design-buyer-user.md](./saas-design-buyer-user.md)

主な確定事項:
- Workspace構造: Notion型（個人=1人Workspace、Team化で同Workspaceに招待）
- Role: Owner / Admin / Member の3種
- 課金プラン: Free $0 / Personal $19 / Team $39/seat（最低3）/ Enterprise Custom
- 実行上限: Free 5 / Personal 100 / Team 500/seat
- 認証情報はクラウドに保存しない（差別化の核心）
- 暴走対策3層（実行上限 / 最小間隔 / --max-budget-usd強制）

### c. APIキー・課金実装 ✅

詳細: [saas-design-api-billing.md](./saas-design-api-billing.md)

主な確定事項:
- 月額込みプランは **Gemini Flash** を採用（粗利率74-89%）
- Claude Sonnet は BYOK (Enterprise) のみ
- Pay-as-you-go超過: Personal $0.20/実行、Team $0.10/実行
- Stripe Subscriptions + Metered Billing + Customer Portal
- **必須ベンチマーク**: Gemini Flash で代表5スキルの精度・コスト実測

### e. MVP定義（Phase 3 計画） ✅

詳細: [saas-design-mvp.md](./saas-design-mvp.md)

主な確定事項:
- Phase 3 = 2026年6月〜11月（6ヶ月）
- Month 1-2: 基盤+課金、Month 3-4: エージェント+スキル3個、Month 5: クローズドβ、Month 6: 公開ローンチ
- MVPに入れる: Workspace / 3 Role / Free+Personal+Team / Gemini Flash / install.sh / スキル3個（カレンダー/競合巡回/メール要約）/ 使用量バー / 暴走対策
- MVPに入れない: Enterprise / BYOK / 議事録/問い合わせフォーム/朝ブリーフィング / LINE/Slack / Windows / Tauri / マーケットプレイス
- ローンチ3ヶ月後の目標: MRR $5,800 = 月収約87万円

### b. ローカルセットアップ技術選定 ✅

詳細: [saas-design-installer.md](./saas-design-installer.md)

主な確定事項:
- **Node.js CLI（`@focusmap/agent`）+ launchd + npm**（Tauri/Electron 不採用）
- 導入は `curl -sSL focusmap-official.com/install.sh | sh -s -- <token>` ワンライナー
- Apple Developer / 公証は当面不要（Node.jsモジュールのため）
- Webアプリ ↔ エージェントは Supabase Realtime（既存資産活用）
- Windows対応はPhase 4以降

### d. スキルテンプレの初期セット ✅

詳細: [saas-design-skills.md](./saas-design-skills.md)

主な確定事項:
- MVP は **3スキル**（Phase 3 内で実装）:
  1. 📅 今日のカレンダー整理（既存Google Calendar連携を活用）
  2. 🌐 競合・情報サイト巡回（認証不要、精度検証に適）
  3. 📧 メール要約（Gmail OAuth）
- Phase 4以降に追加: 未読メッセージ集約 / 議事録要約 / 問い合わせフォーム集約 / 朝のブリーフィング
- スキル定義JSONスキーマ確定（configurable / approval_type / required_auths / estimated_cost_usd）
- テンプレマーケットプレイスは Phase 5以降

---

## 5b. 競合分析サマリ

詳細: [competitive-analysis.md](./competitive-analysis.md)

- 個人向け価格相場: $9〜$20（Make/Bardeen/Zapier）
- AI特化（Lindy）は $49.99 〜
- 軽量管理画面 $29-50帯（Make Teams / n8n Pro）に Focusmap を置く
- 「**ローカル実行 × 軽量管理画面 × 非エンジニア向け**」は構造的に空白 = 取れるポジション
- 最大リスク: n8n がローカル+軽量管理画面を出してきたら一瞬で潰される

---

## 6. 楽観バイアスへの注意（grill-meで指摘した点を記録）

### 6.1 「AIエージェントに並列作業させる」効果は過大評価しない

- **AIで巻ける作業**: コード実装、テスト、UI構築、ドキュメント
- **AIで巻けない作業**: プロダクト方向性決定、UI/UXの細かな判断、Apple Developer手続き、Stripe実装、利用規約/プライバシーポリシー、営業、マーケ、SEO、SNS、カスタマーサポート、法務
- 週15時間 + AI並列でも、**実効は週20時間相当が現実的見積もり**

### 6.2 「2ヶ月でここまで作った」を根拠にしない

| 完了済（2ヶ月） | これから（半年〜1年） |
|---|---|
| UI: 今日のボード、スキルカード、確認画面、認証状態表示 | Phase 2: task-runner / Commander / Executor / Reviewer / Monitor / Scheduler |
| ユーザー数: 1名（自分） | 配布: 他人のPCへのインストーラ + 認証 + サポート |
| 課金なし | Stripe + 利用規約 + 特商法 + プライバシーポリシー |
| マーケなし | SNS + 広告 + SEO + テストマーケ |
| サポートなし | 質問対応 + バグ対応 + ドキュメント |

工数が桁違い。同じペースで進む前提は楽観。

### 6.3 「激安API」の幻想

- Gemini Flash / Kimi K2.6 は安いが、**Browser automation精度が低い**
- 誤クリック → リトライで結局コスト膨らむ
- Claude Sonnet等で実測してから判断
- $1,800事故は**暴走の問題**で、モデル単価を下げても解決しない

### 6.4 「base44一人で作った」のミスリーディング

- base44は実は「**業務ツール作成**」に特化、汎用ではない
- ターゲット明確 + **クラウド完結** + コード生成（LLM最強領域）
- Focusmapは: ターゲット曖昧 + **ローカル配布要** + Browser automation（LLM苦手領域）
- 「一人で作れた」だけ真似ても無理。条件が全く違う

---

## 7. 競合分析

### 直接競合

| 競合 | 規模 | 特徴 |
|---|---|---|
| Zapier | 評価額$5B（約7,500億円）、数百人エンジニア | ノーコード自動化の老舗、SaaS連携が強み |
| n8n | OSS + 商用、調達済 | セルフホスト可、開発者向け |
| Make (Integromat) | Celonis傘下、大規模 | ビジュアル指向のノーコード |
| Lindy | $50M調達済 | AIエージェント特化 |
| Bardeen | $15M調達済 | ブラウザ拡張ベースの自動化 |
| Browser-use | OSS | LLM x Browser automation のOSS実装 |
| Skyvern | OSS | LLMによるブラウザ操作自動化 |

### Focusmapの差別化候補（仮説、要検証）

- **ローカル実行 = 自分のCookie使える、データ流出しない**（セキュリティ意識高い層に刺さる）
- **BUYER/USER分離** = 決裁者向け管理画面と利用者向け簡単UIの両立
- **スキルテンプレ + ワンクリック導入** = 非エンジニア社員でも使える

### 注意点

- これらは「仮説」で、**早期にユーザーインタビューで検証必須**
- 「組み合わせ優位性」は専業ツールに各軸で負けやすい
- 競合は全て桁違いのリソースを持つ。同じ土俵で戦わない設計が必要

---

## 8. 次のアクション

5論点（a〜e）は **すべて設計完了**。実装フェーズ（Phase 3）に着手可能な状態。

### 着手前の必須準備

- [ ] **Gemini Flash ベンチマーク**: 代表3スキル（カレンダー / 競合巡回 / メール要約）の実コスト・成功率を実測（[saas-design-api-billing.md §7](./saas-design-api-billing.md)）
- [ ] 個人事業主開業届 + 適格請求書発行事業者登録
- [ ] 弁護士相談（利用規約・特商法・プライバシーポリシー）
- [x] ~~focusmap-official.com ドメイン取得~~ → 既に取得済み・LP稼働中
- [ ] @focusmap/agent npm package 名空き確認
- [ ] 週15時間の開発時間確保の本業との合意

### Phase 3 着手

準備が整い次第、[saas-design-mvp.md §2](./saas-design-mvp.md) の月別タスクに沿って Month 1 から実行。

### 立ち戻るべき原則

各論点を実装する際は、必ず本ドキュメントの以下に立ち戻ること:
- **「却下した選択肢と理由」**（同じ罠を繰り返さないため）
- **「楽観バイアスへの注意」**（AI並列効果の過大評価、激安APIの幻想、base44ミスリーディング）
- **「grill-meで露呈したパターン」**（質問スルー、気合いでいける、矛盾の組み合わせ）

---

## 9. grill-me セッションのサマリ

### 議論したQ&A（9問）

1. **Q1: 「誰でも使える」のタイミング** → 早期リリース希望、競合警戒
2. **Q2: リリースの定義 + 週開発時間** → 起業/月◯円事業、15時間/週
3. **Q3: 完成品 vs プラットフォーム vs 業界特化** → 完成品テンプレ、業界特化拒否
4. **Q4: 矛盾の解消（3つの構造矛盾）** → ハイブリッド構造、Webアプリ先行、半年伸ばすで譲歩
5. **Q5: 本当に作りたいもの** → 起業 + 売却 + 自分も使う
6. **Q6: PC接続時のみで成立するターゲット** → Mac mini常時稼働で解決
7. **Q7: 3矛盾のどれを譲るか** → 半年リリース譲歩、ハイブリッドで部分譲歩
8. **Q8: ターゲットのリテラシー軸** → A（Mac mini投資できる層）、BUYER/USER分離追加
9. **Q9: 次に詰める論点** → a → c → e → b → d で進める

### grill-me で露呈したパターン（自覚しておくこと）

- 大事な質問（週時間など）を繰り返しスルーする傾向
- 指摘に対し「気合いでいける」と返す傾向（具体的反論なし）
- 矛盾する選択を平気で組み合わせる傾向（ローカル+共有、汎用+ワンクリック等）
- 既存競合の調査が薄い傾向

これらは「作りたい気持ち」が先行している証拠。今後の設計では、各論点で **明示的に競合との差別化を言語化** すること。

---

最終更新: 2026-05-26
