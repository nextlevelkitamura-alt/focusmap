# 論点e — MVP 定義と Phase 3 計画

> 親計画: [focusmap-saas-pivot.md](./focusmap-saas-pivot.md)
> 前提:
> - [saas-design-buyer-user.md](./saas-design-buyer-user.md)
> - [saas-design-api-billing.md](./saas-design-api-billing.md)
> - [saas-design-installer.md](./saas-design-installer.md)
> - [saas-design-skills.md](./saas-design-skills.md)
> - [competitive-analysis.md](./competitive-analysis.md)
> 作成: 2026-05-26

---

## ⚠️ 重大な認識訂正 (2026-05-26 追記)

設計時点で既存実装を見落としていた。**Phase 3 Month 1-3 のタスクの大半が既に実装済み**。
最新の Phase 3 タスクは [master-todo.md](./master-todo.md) を参照すること。本ドキュメントの Phase 3 計画 §2.2 は **設計時点のスナップショット** として残す。

実態反映の詳細は [focusmap-saas-pivot.md §10](./focusmap-saas-pivot.md) を参照。

---

## 0. このドキュメントで決めること

- **MVP の定義** = Phase 3 で何を出すか、何を出さないか
- 6ヶ月の実装計画 (Phase 3) と Phase 4 以降の構想
- 必須機能と「あったら便利」の分離
- ローンチ判断基準

---

## 1. MVP の定義: 何を出すか

### 1.1 MVP の必須要素 (Must Have)

| # | 要素 | 出典 |
|---|---|---|
| 1 | Workspace構造 (Notion型、Personal自動生成) | 論点a |
| 2 | Owner/Admin/Member の3 Role | 論点a |
| 3 | 課金プラン: Free / Personal / Team (Enterprise は後回し) | 論点c |
| 4 | Stripe Subscriptions + Customer Portal | 論点c |
| 5 | Gemini Flash 経由のAI実行 (Focusmap負担モデル) | 論点c |
| 6 | install.sh ワンライナーで Mac mini エージェント導入 | 論点b |
| 7 | Supabase Realtime 経由のジョブ実行 | 論点b |
| 8 | 初期スキル 3個: カレンダー整理 / 競合巡回 / メール要約 | 論点d |
| 9 | 使用量バー UX (Claude Code 型) | 論点a |
| 10 | 暴走対策 4層 (上限/間隔/予算/累積監視) | 論点c |
| 11 | 利用規約・プライバシーポリシー・特商法表記 | 論点c (法務) |

### 1.2 MVP では出さない (Won't Have)

| 要素 | 理由 | 投入Phase |
|---|---|---|
| Enterprise プラン (SSO/SAML/監査ログ) | 個別交渉ベース、最初の10社で十分 | Phase 4 |
| BYOK | Enterprise契約まで保留 | Phase 4 |
| 議事録要約 (スキル5) | ファイルアップロード機構が新規実装 | Phase 4 Week 1-2 |
| 問い合わせフォーム集約 (スキル6) | 管理画面が顧客毎に違う、汎用化困難 | Phase 4 Week 3-4 |
| 朝のブリーフィング (スキル7) | スキル1-3完成後に組み立て | Phase 4 Week 5+ |
| LINE連携 (スキル3の一部) | LINE Notify終了済み、LINE Messaging APIの認証実装が重い | Phase 4 |
| Slack連携 (スキル3の一部) | OAuth実装、ボット権限の検討必要 | Phase 4 |
| テンプレマーケットプレイス | 公式7個で十分、UGC審査機構は重い | Phase 5 |
| Windows対応 | Mac前提でいい | Phase 4以降 |
| GUIインストーラ (Tauri) | install.sh で代替可能 | Phase 5+ |
| 自動アップデート | npm update 手動でOK初期 | Phase 4 |
| インボイス制度 / JCT自動計算 | 法人プラン拡大時に Stripe Tax 設定 | Phase 4 |
| マーケティング自動化 (リファラル等) | 個人開発で扱いきれない | Phase 4以降 |

### 1.3 MVP リリース時の差別化メッセージ

```
「あなたのMacで動く、AI業務自動化プラットフォーム」

特徴:
✓ ローカル実行 — 認証情報はクラウドに送られない
✓ Webアプリで管理 — 社員はボタンを押すだけ
✓ 月100実行まで $19 — ZapierやMakeより透明な価格
✓ 朝のメール/カレンダー/Webサイト巡回が自動化
```

---

## 2. Phase 3 (6ヶ月) 実装計画

### 2.1 全体スケジュール

```
Phase 3 = 2026年6月 〜 2026年11月 (6ヶ月)
  Month 1 (6月): 基盤整備 + Workspace構造
  Month 2 (7月): 課金 + 利用者UI
  Month 3 (8月): エージェント配布 + スキル2個
  Month 4 (9月): スキル追加 + 暴走対策
  Month 5 (10月): クローズドβ + 法務整備
  Month 6 (11月): 公開ローンチ + 初期マーケ
```

### 2.2 月別タスク

#### Month 1 (6月): 基盤整備 + Workspace構造

```
[ ] Supabaseマイグレーション: workspaces / workspace_members / agents / skills / usage_metrics / audit_logs テーブル
[ ] 既存 ai_tasks に workspace_id 追加
[ ] RLS ポリシー設計と適用
[ ] Workspace 切替UI (現在のFocusmapは個人前提なので、Workspace概念を導入)
[ ] 招待フロー (メール招待 + Role割当)
[ ] Owner/Admin/Memberの権限ガード
[ ] 既存 北村Workspace を Personal 扱いに移行
```

技術的に重い: RLS, 既存データのworkspace_id振り分け

#### Month 2 (7月): 課金 + 利用者UI

```
[ ] Stripe アカウント開設 + 個人事業主開業届
[ ] Stripe Subscriptions: Free / Personal / Team プラン作成
[ ] Customer Portal 統合
[ ] Webhook で Supabase の workspaces.plan 同期
[ ] 使用量バー UI (個人 + Workspace)
[ ] 使用量カウンタ実装 (ai_tasks 実行時にincrement)
[ ] プラン超過時の挙動 (自動停止 or 自動課金)
[ ] スキルカード UI 改修 (実行ボタン、approval_type 表示)
[ ] 管理画面の枠組み (メンバー一覧、課金ページ)
```

技術的に重い: Stripe Webhook ↔ Supabase 同期、超過時UX

#### Month 3 (8月): エージェント配布 + スキル2個

```
[ ] focusmap-agent パッケージ (Node.js) 切り出し
[ ] install.sh ホスティング (Cloud Run でドメイン配信)
[ ] エージェント追加フロー: token発行 → install.sh実行 → 接続確認
[ ] agents テーブルのハートビート機構
[ ] スキル2 (今日のカレンダー整理) 実装: 既存Google Calendar連携を利用
[ ] スキル4 (競合・情報サイト巡回) 実装: 認証不要なBrowser automation検証
[ ] Gemini Flash 実コスト計測 (この時点で要計測)
```

ベンチマークの結果次第で価格設計を見直す可能性

#### Month 4 (9月): スキル追加 + 暴走対策

```
[ ] スキル1 (メール要約) 実装: Gmail OAuth
[ ] 暴走対策層4 (累積コスト監視) 実装
[ ] Cron Job (Supabase Edge Functions or Cloud Run) で異常検知
[ ] ANTHROPIC_API_KEY 存在チェック (起動拒否ロジック)
[ ] エージェントログ収集機構 (Webアプリから「ログアップロード」)
[ ] Audit Log 実装
[ ] 認証情報ヘルスチェック (5分ごと、切れたら通知)
```

#### Month 5 (10月): クローズドβ + 法務整備

```
[ ] 利用規約・プライバシーポリシー・特商法表記を弁護士レビュー
[ ] 適格請求書発行事業者登録
[ ] Stripe Tax で日本のJCT設定
[ ] クローズドβ募集 (北村のSNS / 同業ネットワーク / 副業界隈で10社)
[ ] β中はPersonal/Team を無料 (実コスト計測 + フィードバック収集)
[ ] バグ修正・UX改善ループ
[ ] 「2週間使ってもらってリピート率測定」
```

10月中旬には「クローズドβ実施中」とSNSで発信開始

#### Month 6 (11月): 公開ローンチ + 初期マーケ

```
[ ] 公開ローンチ (Producthunt, Hacker News, Zenn, note)
[ ] LP改修 (focusmap-official.com 既存LPに、SaaS価格表・スキル紹介・差別化メッセージ・比較表 vs Zapier/Lindy・セキュリティ訴求を追加)
[ ] 紹介動画 (1分、スキル実行デモ)
[ ] 初期マーケ: Twitter (旧X) / LinkedIn / 副業界隈
[ ] 課金開始 (Free + Personal + Team)
[ ] サポート体制: メール + ヘルプドキュメント
[ ] 初期目標: 30 Personal契約 + 5 Team契約 = 月収 $1,165 (約17万円)
```

---

## 3. リソース計画

### 3.1 投入リソース

| 項目 | 量 |
|---|---|
| 開発時間 | 週15時間 × 26週 = 390時間 |
| AI並列効果 | 既存試算より控えめに +30% = 510時間相当 |
| 実コスト想定 (Phase 3全体) | 50,000円 (Supabase + Cloud Run + Stripe手数料 + Apple Developer無し) |

### 3.2 個人開発で「巻ききれない」もの

下記は外部リソース投入 or スコープ削減で対応:

| 課題 | 対策 |
|---|---|
| 利用規約・特商法 | 弁護士に1回相談 (5万円程度) |
| 税理士相談 (個人事業主) | 顧問契約 (月1万円〜) |
| LP デザイン | 既存テンプレ (Tailwind UI 等) を使い回し、自作 |
| 紹介動画 | 自分でスクリーン録画 (1時間程度の作業) |
| カスタマーサポート | メール対応のみ、週2時間に制限 |

---

## 4. ローンチ判断基準

### 4.1 Month 5 終了時 (= β完了時) の Go/No-Go 判定

| 判定軸 | Goライン |
|---|---|
| Gemini Flash 実コスト | Personal 1人あたり < $3/月 (= 粗利率 80%以上) |
| Browser automation 成功率 | 各スキル 80%以上 |
| クローズドβ参加者 | 10社中 7社以上が「継続使用したい」と回答 |
| 暴走事故 | β中の発生件数ゼロ |
| クリティカルバグ | 未解決ゼロ |

→ 1つでも Go ライン未達なら、ローンチを1ヶ月延期 + 該当課題に集中

### 4.2 ローンチ後3ヶ月の目標 (= Phase 4 Month 1-3)

| 目標 | 数値 |
|---|---|
| Personal 契約 | 100社 |
| Team 契約 | 20社 (平均5seat = 100seat) |
| MRR (月間経常収益) | $5,800 (約87万円) |
| API原価 | $400 (= MRRの7%) |
| 粗利 | $5,400 (約81万円) |
| 解約率 | 月5%以下 |

達成できれば「個人開発で月収80万円」= **「食える事業」のスタートライン**

---

## 5. Phase 4 (Month 7-12) 構想

### 5.1 中核施策

- 残りスキル (議事録 / 問い合わせフォーム / 朝のブリーフィング) 実装
- LINE / Slack 連携
- Enterprise プラン正式提供 (BYOK / SSO / 監査ログ)
- インボイス制度対応
- 自動アップデート機構
- Windows対応の検討開始 (まだ着手しない)

### 5.2 Phase 4 末の目標

- Personal 500社 + Team 100社
- MRR $14,000 (約210万円)
- 年商換算 $168K (約2,500万円)

→ ここで「個人事業主→法人化」の判断時期

### 5.3 Phase 5 以降 (Year 2)

- テンプレマーケットプレイス
- Windows 対応 (Tauri 採用検討)
- 業界別パッケージ (人材紹介 / 士業 / 飲食 / 小売)
- 売却交渉の準備 (DevOps系 / 自動化系 SaaSへの被買収)

---

## 6. リスクと打ち手

### 6.1 構造リスク (致命的)

| リスク | 確率 | 打ち手 |
|---|---|---|
| n8n が「ローカル実行 + 軽量GUI管理画面」を出す | 30% | 早期ユーザー確保 + 業界知識で差別化、最悪は被買収の道 |
| Gemini Flash の Browser automation 精度が低すぎる | 40% | Haiku 4.5 へフォールバック、価格を$24-29 に上げる |
| Mac mini投資の心理障壁が予想以上に高い | 50% | クラウド実行オプションを Phase 4 で追加 (Browserbase等) |
| Stripe審査 / 個人事業主開業 / インボイス登録 で2ヶ月遅延 | 30% | Month 1 から並行着手 |

### 6.2 個人リスク

| リスク | 打ち手 |
|---|---|
| 本業 (CA業務) が忙しくなり開発時間が削られる | Phase 3 Month 1-2 で「最低限のWorkspace + 課金」を最速で出す、後はゆっくりでも回せる構造に |
| モチベ低下 | 自分自身がPersonal Workspaceで毎日使う設計 (Scratch your own itch)、これで継続性確保 |
| 法律トラブル | 弁護士・税理士に早期相談、利用規約で免責明記 |

---

## 7. 成功指標 (KPI)

### 7.1 リーディング指標 (週次で見る)

- 週次新規サインアップ数
- Mac mini エージェント接続数 (= 「実際に使う気がある人」)
- スキル実行数 (Workspace別 / 全体)
- 認証切れ件数

### 7.2 ラギング指標 (月次で見る)

- MRR (月間経常収益)
- 解約率 (月次)
- 粗利率
- カスタマーサポート対応時間

### 7.3 ローンチ後3ヶ月時点で見るチェック

- リテンション: 30日後の活性ユーザー率 > 60%
- NPS: > 30
- リファラル: 月10社以上が口コミ経由で流入

---

## 8. 残課題

- [x] ~~focusmap-official.com ドメイン取得確認~~ → 取得済み (LP稼働中)
- [ ] @focusmap/agent の npm package 名空き確認
- [ ] 北村の本業との時間配分の合意 (週15時間を守れるか)
- [ ] Phase 3 Month 1 着手の正式GO判断
- [ ] 弁護士・税理士の人選

---

最終更新: 2026-05-26
