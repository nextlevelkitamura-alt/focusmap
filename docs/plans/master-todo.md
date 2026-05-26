# Focusmap SaaS化 マスター TODO リスト

> 全タスクの一覧。詳細は各リンク先を参照。
> 親計画: [focusmap-saas-pivot.md](./focusmap-saas-pivot.md)
> 作成: 2026-05-26

---

## 🎯 今ここ

| ステータス | 内容 |
|---|---|
| ✅ 完了 | grill-me 9問 → ターゲット・アーキ確定 |
| ✅ 完了 | 競合分析 (Zapier/Lindy/Bardeen/n8n/Member) |
| ✅ 完了 | 論点a〜e 設計 (5ドキュメント) |
| ✅ 完了 | ミニベンチマーク (Flash-Lite で粗利率99%実証) |
| ✅ 完了 | ハイブリッドモデル戦略 (simple + agent + Cache hit) |
| ✅ 完了 | DeepSeek V4 Pro = agent tier 第一候補 |
| ✅ 完了 | **既存実装の調査** → Workspace構造 + ai_runners + ai_task_packages 等が既に実装済みと判明 |
| ✅ 完了 | 各設計docs に「既存実装の活用」セクション追記 |
| ✅ 完了 | **Stage 1-8 実装 (差分migration / lib / 使用量UI / スキルカード改修 / プラン上限check / Stripe / BUYER管理画面 / seed+install.sh+LP)** |
| ✅ 完了 | **本番DB へ差分migration適用** (spaces.plan等 + audit_logs + user_byok_keys + system_skill_templates + helper関数3個) |
| ✅ 完了 | **LP動作検証 + 価格表レイアウト修正** (Preview MCP で snapshot 確認、4プラン表示OK) |
| ✅ 完了 | **focusmap-agent MVP本体実装** (config / heartbeat / claim / executor / calendar-organize / Gemini Flash-Lite / safety) |
| ✅ 完了 | **Phase A: ワンクリックセットアップ** (install.sh強化 + 3stepウィザード + Gmail scope + agent_token API) |
| ✅ 完了 | **Phase B: AIチャット + DeepSeek V4 Pro** (intent classifier + /dashboard/chat + Realtime hook) |
| ✅ 完了 | **Phase C: Playwright + 実GCal連携** (google-calendar.ts + Playwright executor + web-research / email-summary / 実GCal化 calendar-organize) |
| ✅ 完了 | **Phase D: UI磨き込み** (GlobalWorkspaceSwitcher / EmptyState / Skeleton / ErrorBanner / 各画面統合) |
| **🔥 次** | **実機統合テスト** (config.json で起動 → ブラウザで /dashboard/chat → 「カレンダー整理して」→ Playwright実機実行 → 結果Realtime表示) |

---

## 📋 直近やるべき (Phase 3 着手前、6月までに完了)

### 実装系
- [ ] **差分migration SQL 作成** ← 次にやる
  - `spaces.plan` / `spaces.billing_customer_id` 列追加
  - `ai_task_packages` に `model_tier` / `approval_type` / `description` / `icon` / `category` / `metadata` 列追加
  - `ai_usage` に `space_id` 列追加
  - `audit_logs` テーブル新規作成
  - 詳細: 各 saas-design-*.md の「§0 既存実装の活用」セクション
- [ ] 既存実装の動作確認 (テーブルは存在するが実際に動くか、空殻か)
- [ ] focusmap-agent npm package を空状態で予約 publish (名前確保)
- [ ] Gemini API を Paid tier に切替 (Free tier だと rate limit 多発)
- [ ] 月間ハードキャップ設定 ($100/月など、暴走対策)

### 検証系
- [ ] DeepSeek V4 Pro でミニベンチマーク (agent tier の簡易検証、API key 入手後)
- [ ] Cache hit が実際に効くか実機確認

### 法務・税務系 (北村本人の作業)
- [ ] 個人事業主開業届
- [ ] 適格請求書発行事業者登録 (インボイス)
- [ ] 弁護士相談 (利用規約・特商法・プライバシーポリシー)
- [ ] 税理士選定

---

## 📅 Phase 3 (2026-06 〜 2026-11, 6ヶ月)

詳細: [saas-design-mvp.md §2.2](./saas-design-mvp.md)

### Month 1 (6月): 基盤整備 + Workspace構造 【**大幅削減: 既存実装活用**】 ✅ 実装完了

**既存活用するもの**: spaces / space_members / space_invites / RLS用ヘルパー関数 (全部実装済み)

- [x] **差分migration**: `spaces.plan` / `spaces.billing_customer_id` 列追加
- [x] **差分migration**: `ai_task_packages.model_tier` / `approval_type` / `description` / `icon` / `category` / `metadata` 列追加
- [x] **差分migration**: `ai_usage.space_id` 列追加
- [x] **新規migration**: `audit_logs` テーブル + `user_byok_keys` テーブル + ヘルパー関数
- [x] Workspace 切替UI (WorkspaceSelector + WorkspaceTabs)
- [x] Role 表示: 既存 owner/editor/commenter/viewer を SaaS UI で Owner/Admin/Member の3層に圧縮
- [ ] 既存実装の動作確認 (実際に動いているか、空殻か)
- [ ] Supabase 本番 DB に migration 適用

### Month 2 (7月): 課金 + 利用者UI 【ほぼ新規】 ✅ コード実装完了

- [ ] Stripe アカウント開設 (北村本人作業)
- [x] Stripe SDK 統合 + 環境変数定義 (.env.example)
- [x] Checkout / Portal / Webhook の3エンドポイント
- [x] 使用量バー UI (個人 + Workspace、Claude Code 型)
- [x] プラン上限check (ai-tasks API で 402 Payment Required)
- [x] プラン超過時のUX (UpgradeModal)
- [x] スキルカード UI 改修 (`model_tier` 表示、`approval_type` 表示、コスト表示)
- [x] BUYER管理画面 (/dashboard/workspace 配下5ページ)
- [ ] Stripe で Product / Price を作成 (北村本人作業、Price ID を .env.local に設定)
- [ ] Stripe Webhook endpoint を本番に登録

### Month 3 (8月): エージェント配布 + スキル2個 【**大幅削減**】 ✅ 雛形完了

**既存活用**: `ai_runners` / `ai_runner_spaces` / `/api/ai-runners/claim` / `/api/ai-runners/heartbeat` / `claim_ai_task_for_runner` 関数

- [x] focusmap-agent npm パッケージ雛形 (`scripts/focusmap-agent/`)
- [x] install.sh 作成 + 実行権限付与
- [ ] install.sh ホスティング (Cloud Run / focusmap-official.com 配信設定)
- [x] エージェント追加UI (AgentInstallPanel — install.sh ワンライナーコピー対応)
- [x] スキル seed (system_skill_templates: カレンダー整理 / 競合巡回 / メール要約)
- [ ] Playwright executor の実装 (focusmap-agent の本体ロジック)
- [ ] **フルベンチマーク再実施** (Playwright + 全モデル比較、agent tier 決定)
- [ ] @focusmap/agent を npm publish (北村本人作業)

### Month 4 (9月): スキル追加 + 暴走対策
- [ ] スキル1 (メール要約) 実装: Gmail OAuth
- [ ] 暴走対策層4 (累積コスト監視) 実装
- [ ] Cron Job (異常検知)
- [ ] ANTHROPIC_API_KEY 存在チェック (起動拒否)
- [ ] エージェントログ収集機構
- [ ] Audit Log 実装
- [ ] 認証情報ヘルスチェック (5分ごと)

### Month 5 (10月): クローズドβ + 法務整備
- [ ] 利用規約・プライバシーポリシー・特商法表記を弁護士レビュー
- [ ] Stripe Tax で日本のJCT設定
- [ ] クローズドβ募集 (北村のSNS / 同業ネットワーク / 副業界隈で10社)
- [ ] β中はPersonal/Team を無料 (実コスト計測 + フィードバック収集)
- [ ] バグ修正・UX改善ループ
- [ ] リピート率測定

### Month 6 (11月): 公開ローンチ + 初期マーケ
- [ ] 公開ローンチ (Producthunt, Hacker News, Zenn, note)
- [ ] LP改修 (SaaS価格表 / スキル紹介 / 差別化 / 比較表 / セキュリティ訴求)
- [ ] 紹介動画 (1分、スキル実行デモ)
- [ ] 初期マーケ: Twitter (旧X) / LinkedIn / 副業界隈
- [ ] 課金開始 (Free + Personal + Team)
- [ ] サポート体制: メール + ヘルプドキュメント

**Phase 3 目標**: Personal 30社 + Team 5社 = MRR約17万円

---

## 🔮 Phase 4-7 ローンチ・ロードマップ

**詳細**: [launch-roadmap.md](./launch-roadmap.md)

### サマリ

| Phase | 期間 | 焦点 |
|---|---|---|
| Phase 4 (2026-06 〜 2026-07) | 2ヶ月 | 動作検証 / UI磨き / focusmap-agent本体 / オンボーディング |
| Phase 5 (2026-08) | 1ヶ月 | 法務 / Stripe本番 / 監視 |
| Phase 6 (2026-09 〜 2026-10) | 2ヶ月 | クローズドβ 10社 → 公開ローンチ |
| Phase 7 (2026-11 〜 2027-01) | 3ヶ月 | スキル拡張 / ユーザー対応 / 成長戦略 |

公開ローンチ予定: **2026-11-25 前後**。

---

## 🌅 Phase 4以降 旧計画 (参考)

詳細: [saas-design-mvp.md §5](./saas-design-mvp.md)

- [ ] 残りスキル実装: 議事録要約 / 問い合わせフォーム集約 / 朝のブリーフィング
- [ ] LINE / Slack 連携
- [ ] Enterprise プラン正式提供 (BYOK / SSO / 監査ログ)
- [ ] インボイス制度対応
- [ ] 自動アップデート機構
- [ ] Windows対応の検討開始
- [ ] テンプレマーケットプレイス検討

**Phase 4 目標**: Personal 500社 + Team 100社 = MRR約210万円

---

## 🌅 Phase 5 以降 (Year 2)

- [ ] テンプレマーケットプレイス本実装
- [ ] Windows 対応 (Tauri 採用検討)
- [ ] 業界別パッケージ (人材紹介 / 士業 / 飲食 / 小売)
- [ ] 売却交渉の準備 (DevOps系 / 自動化系 SaaSへの被買収)
- [ ] 法人化判断

---

## ⚙️ 並行する常時タスク

### モニタリング
- [ ] 週次: 新規サインアップ / エージェント接続 / スキル実行
- [ ] 月次: MRR / 解約率 / 粗利率 / Cache hit率 / API原価

### 検証 (定期)
- [ ] 月1回: ユーザーインタビュー (5社目処)
- [ ] 月1回: 競合動向チェック (特に n8n のローカル実行対応)

### 立ち戻り原則 (実装時に毎回確認)
詳細: [focusmap-saas-pivot.md §8](./focusmap-saas-pivot.md)

- 「却下した選択肢と理由」(同じ罠を繰り返さない)
- 「楽観バイアスへの注意」(AI並列効果の過大評価、激安APIの幻想)
- 「grill-meで露呈したパターン」(質問スルー、気合いでいける、矛盾の組み合わせ)

---

## 📚 設計ドキュメント目次 (参照用)

| ファイル | 役割 |
|---|---|
| [focusmap-saas-pivot.md](./focusmap-saas-pivot.md) | **親計画書** (grill-me合意、全体像) |
| [competitive-analysis.md](./competitive-analysis.md) | 競合5社比較、ポジショニング |
| [saas-design-buyer-user.md](./saas-design-buyer-user.md) | 論点a: Workspace / Role / DB schema / 管理画面 |
| [saas-design-api-billing.md](./saas-design-api-billing.md) | 論点c: AI原価 / Stripe / Cache hit戦略 |
| [saas-design-installer.md](./saas-design-installer.md) | 論点b: install.sh / Node.js+launchd |
| [saas-design-skills.md](./saas-design-skills.md) | 論点d: スキル7個 / JSONスキーマ / model_tier |
| [saas-design-mvp.md](./saas-design-mvp.md) | 論点e: Phase 3 月別タスク / KPI |
| [benchmark-procedure.md](./benchmark-procedure.md) | フルベンチマーク手順書 (Phase 3 Month 3で実施) |
| [benchmark-results-2026-05-26.md](./benchmark-results-2026-05-26.md) | ミニベンチマーク結果 (Flash-Lite採用根拠) |
| **[master-todo.md](./master-todo.md)** | **本ドキュメント (全タスク一覧)** |

---

## 規模感

- **Phase 3 タスク総数**: 約40タスク × 6ヶ月
- **直近 (準備)**: 11タスク (実装3 + 検証2 + 法務4 + 雑務2)
- **Phase 4 タスク総数**: 約20タスク × 6ヶ月
- **個人開発リソース**: 週15時間 × 52週 = 780時間/年

---

最終更新: 2026-05-26
