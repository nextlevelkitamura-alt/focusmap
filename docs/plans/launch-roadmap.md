# Focusmap ローンチ・ロードマップ

> 親計画: [focusmap-saas-pivot.md](./focusmap-saas-pivot.md)
> 親TODO: [master-todo.md](./master-todo.md)
> 作成: 2026-05-26
> 対象期間: Phase 3 実装完了 (2026-05-26) → 公開ローンチ (2026年11月想定)

---

## Context

Phase 3 で「最低限動く SaaS基盤」が完成した。ただし **「動く ≠ リリースできる」**:

- ✅ 完了: DB列追加 / 共通ライブラリ / 使用量UI / スキルカード改修 / プラン上限 / Stripe SDK統合 / BUYER管理画面 / スキルseed / install.sh / LP価格表
- ❌ 未着手: 動作検証 / UI磨き込み / オンボーディング / focusmap-agent本体 / 本番DB適用 / Stripe本番 / 法務 / マーケ / 監視

リリースまでの作業を **4フェーズ** に整理する。各フェーズ完了時に Go/No-Go 判定を行う。

---

## 🗺️ 全体マップ (4フェーズ)

```
Phase 4: クローズドβ準備      2026-06 〜 2026-07 (2ヶ月)
  → 動作検証 / UI磨き / Focusmap Lite / オンボーディング

Phase 5: 法務・運用整備        2026-08 (1ヶ月)
  → 利用規約 / 開業届 / Stripe本番 / 監視・ログ

Phase 6: クローズドβ + ローンチ 2026-09 〜 2026-10 (2ヶ月)
  → β募集10社 / フィードバック反映 / 公開ローンチ

Phase 7: ローンチ後 90日       2026-11 〜 2027-01 (3ヶ月)
  → ユーザー対応 / スキル拡張 / 成長戦略
```

---

## Phase 4: クローズドβ準備 (2026-06 〜 2026-07)

### 4.1 動作検証 【優先度: 🔥 最高】

実装したコードを **実際にブラウザで触って** 不具合を潰す。

| タスク | 詳細 | 工数 |
|---|---|---|
| Supabase migration 適用 (開発DB) | `20260526120000_saas_diff.sql` / `20260526120100_seed_skills.sql` を `supabase db push` で適用 | 1h |
| LeftSidebarの使用量カード表示確認 | UsageCard が compact モードで正しくレンダリングされるか | 1h |
| /dashboard/workspace 5ページの動作確認 | overview / members / billing / analytics / agents 全部 | 4h |
| Workspace 切替 (?space=xxx) の動作確認 | localStorage 永続化 + URL同期が正しいか | 2h |
| スキルカード改修の表示確認 | model_tier バッジ / コスト表示 / tier別フィルター | 2h |
| プラン上限check の動作確認 | Free プランで 5回実行後の 402 レスポンス + UpgradeModal 表示 | 2h |
| Stripe Checkout の起動確認 | STRIPE_SECRET_KEY 未設定時の 503 / 設定時の Checkout URL生成 | 2h |
| モバイル UI 動作確認 | iPhone Safari でダッシュボード〜workspace全部 | 3h |
| 既存機能のリグレッション | マインドマップ / カレンダー / タスク管理が壊れていないか | 4h |

**Go判定**: クリティカルバグゼロ。ブロッカーになるバグがあれば 4.2 / 4.3 に進む前に修正。

### 4.2 UI 磨き込み 【優先度: 🔥 高】

実装は機能優先で雑な部分がある。これをローンチ品質に上げる。

| 領域 | 改善内容 |
|---|---|
| **既存 vs 新規UIの整合** | `/dashboard` トップ (個人ダッシュボード) と `/dashboard/workspace/*` (SaaS管理) の遷移が断絶している → 共通ヘッダー設計 |
| **WorkspaceSwitcher 全画面常時化** | 現状 `/workspace/*` 内のみ → 全画面のヘッダー (DashboardBrandBar) に常時表示 |
| **モバイル workspace UI** | 5タブが横スクロール一杯。BottomNav に「管理」タブ追加 + ハンバーガーメニュー |
| **空状態 (Empty State)** | スキル未追加 / メンバー1人 / 使用量0 の各画面で「次に何をすればよいか」のCTA |
| **ローディング状態** | suspense fallback / skeleton / spinner の統一 |
| **エラー表示** | 統一トースト or バナーで erorr.message を表示 (現状は console.error 多数) |
| **使用量バーの色・閾値** | 80%黄 / 95%赤 だけでなく、 100%超のときに「⚠️ 自動停止中」を明示 |
| **ダークモード対応** | 新規追加コンポーネント全部で dark: クラス確認 (現状一部のみ) |
| **アクセシビリティ** | aria-label / focus-visible / キーボード操作。タップターゲット最低44px |
| **アニメーション** | tab切替 / dialog 開閉 / progress 更新の transition 統一 |
| **フォント階層** | text-xs / text-sm / text-base の使い分けルール統一 |
| **カラーコントラスト** | WCAG AA (4.5:1) 準拠の確認 |

**サブタスクの例 (具体的):**

- `src/app/dashboard/layout.tsx` に WorkspaceSwitcher を統合 (ヘッダー右上)
- `src/components/mobile/bottom-nav.tsx` に "Workspace" タブ追加
- 各 workspace ページに `<EmptyState>` 共通コンポーネント新規
- 既存 `space-project-switcher.tsx` と 新規 `workspace-selector.tsx` の役割整理 (重複削除)
- 全 Card に hover transition (`transition-colors duration-150`) 統一

工数目安: **UI磨き込みだけで 30〜40h**

### 4.3 オンボーディング設計 【優先度: 🔥 高】

新規ユーザーが Workspace を作って 最初の自動化を実行するまでの導線。

**現状の問題**: サインアップ後、何もしないと「空の画面」を見せられる

**設計**:

1. **初回ログイン時の Welcome モーダル** (`/dashboard/welcome` or modal):
   - Step 1: Workspace 名前を決める
   - Step 2: 最初のスキルを選ぶ (3スキルから1つ選択)
   - Step 3: Mac mini 設定が必要なスキルなら install.sh コピー画面へ誘導
   - Step 4: 「試しに1回実行する」ボタン

2. **スキル取り込みフロー**:
   - `system_skill_templates` から Workspace の `ai_task_packages` に1クリックで追加
   - API: `/api/spaces/[id]/skills/import` (新規)
   - UI: `/dashboard/workspace/agents` 内に「スキルを追加」セクション

3. **初回エージェント接続成功時の祝福**:
   - 「🎉 Mac mini が接続されました」トースト
   - 「最初のスキルを実行してみる」ボタン

4. **空状態 (Empty State) 改善**:
   - 「スキルがありません」 + 「テンプレから追加する」CTA
   - 「メンバーが1人だけです」 + 「招待する」CTA

工数目安: **オンボーディングUI実装で 20h**

### 4.4 Focusmap Lite / focusmap-agent 本体実装 【優先度: 🔥 高】

正本: [focusmap-lite-mac-agent.md](./focusmap-lite-mac-agent.md)

現状の `scripts/focusmap-agent/src/cli.ts` は **雛形のみ** (heartbeat だけ)。実機で動かすには:

| タスク | 詳細 |
|---|---|
| Focusmap Lite 導入CTA | Web設定画面からMac導入・pairingへ誘導 |
| `focusmap://pair` | Macアプリ/将来アプリでagent_tokenを受け取る |
| Supabase接続 (service role) | agent_token を auth に変換 |
| `claim_ai_task_for_runner` 呼び出しループ | 既存 RPC を毎10秒polling |
| Playwright executor | Browser automation の実行エンジン (新規) |
| スキル定義のパース | `ai_task_packages.prompt_template` + `input_schema` を Browser 操作命令に変換 |
| Gemini Flash-Lite / DeepSeek V4 Pro 切替 | `model_tier` で動的選択 |
| Cookie 永続化 | `~/.focusmap/auth/<service>.json` |
| エラーハンドリング + リトライ | ステップ単位 3回まで自動リトライ |
| 実行結果を `ai_tasks.result` に書き戻し | ステップ毎の進捗JSONをaccumulate |
| **CLAUDE.md の安全策遵守**: `ANTHROPIC_API_KEY` 起動時拒否 / `--max-budget-usd $2.00` 強制 | |
| 既存 `scripts/codex-rpc-bridge.ts` との共存 or 統合 | claude/codex の executor と Playwright executor を分離 |
| Macアプリ配布 | Phase 2以降で Developer ID署名 + notarization + DMG/PKG |

工数目安: **エージェント本体実装で 60〜80h** (このフェーズで最も重い)

### 4.5 Phase 4 完了の Go判定

- [ ] 動作検証完了 (クリティカルバグゼロ)
- [ ] UI磨き込み 主要項目完了 (Workspace統合 / 空状態 / モバイル)
- [ ] オンボーディング動作確認
- [ ] focusmap-agent でテストスキル (カレンダー整理) が **実機で完走**
- [ ] 北村本人が「毎日使えるか」を1週間ドッグフード

---

## Phase 5: 法務・運用整備 (2026-08)

### 5.1 法務 【優先度: 🔥 最高】

ローンチ前必須。

| タスク | 詳細 | 担当 |
|---|---|---|
| 利用規約 改訂 | 既存 `src/app/terms/page.tsx` を SaaS用に書き換え (有料プラン / 解約 / 払戻し / SLA) | 弁護士相談 + 北村 |
| プライバシーポリシー 改訂 | Cookie保管 / 第三者提供 / GDPR / CCPA / Stripe・Supabase の記載 | 弁護士相談 + 北村 |
| 特定商取引法表記 | 個人事業主名義 + 住所 + 連絡先 + 価格 + 返金規約 | 北村 |
| 個人事業主開業届 | 税務署提出 + マイナンバー連携 | 北村 |
| 適格請求書発行事業者登録 (インボイス) | 申請から登録まで 1〜2ヶ月かかる → 早めに着手 | 北村 |
| 反社チェック / 利用規約への組み込み | Stripeの審査でも必要 | 北村 |

工数目安: **法務まわりで弁護士相談 1〜2回 + 5〜10h**

### 5.2 インフラ本番セットアップ 【優先度: 🔥 最高】

| タスク | 詳細 |
|---|---|
| Supabase 本番DBに migration 適用 | 開発DBで動作確認後、本番 `supabase db push --linked` |
| Cloud Run 本番デプロイ確認 | 既存 GitHub Actions で自動デプロイ済みだが、新しい依存 (stripe) が含まれることを確認 |
| `focusmap-official.com` ドメインの install.sh ホスティング | nginx or Cloud Run で `scripts/install.sh` を配信 |
| Stripe 本番アカウント開設 + Product / Price 作成 | Personal $19/月 / Team $39/seat/月 / Webhook endpoint設定 |
| `.env.local` に本番Stripe key設定 | テストキーで動作確認後に本番切替 |
| Stripe Webhook 動作確認 | `customer.subscription.created/updated/deleted` で spaces.plan が同期するか |
| Stripe Tax 設定 (JCT/消費税) | 日本国内向け請求の自動計算 |
| 月次ハードキャップ設定 ($100など) | 暴走時の課金上限 |

### 5.3 監視・ログ 【優先度: 高】

| タスク | 詳細 |
|---|---|
| エラートラッキング | Sentry or Highlight or LogTail を追加 (Free tierでOK) |
| Stripe イベントの監視 | Webhook失敗時のアラート (Stripe Dashboard組み込み) |
| Supabase ログの可視化 | 重要なRLS失敗 / 503エラーを Slack 通知 |
| 暴走対策の累積コスト監視 | Cron Job (Supabase Edge Functions) で 1日3倍超のスキル実行を検知 → 自動停止 |
| 健康チェック (uptime) | UptimeRobot 等で `https://focusmap-official.com/api/health` を5分ごとに監視 |
| 監視ダッシュボード | 自社管理画面に「直近24時間のエラー / 実行数 / API原価」を表示 |

**新規ファイル候補**:
- `src/app/api/health/route.ts` (GET → DB ping + Stripe ping)
- `src/lib/monitoring.ts` (Sentry init + サーバー側エラー報告)
- Supabase Edge Functions: `daily-anomaly-detection`

---

## Phase 6: クローズドβ + ローンチ (2026-09 〜 2026-10)

### 6.1 マーケ準備 【優先度: 🔥 高】

| タスク | 詳細 | 工数 |
|---|---|---|
| LP磨き込み | 既存 `src/app/page.tsx` をデザイン品質UP (ヒーロー / スクリーンショット / 顧客の声プレースホルダ) | 15h |
| OGP / Twitter Card | `/dashboard/workspace/*` 各ページのメタタグ | 4h |
| SEO | sitemap.xml / robots.txt / 構造化データ (Product Schema) | 6h |
| 紹介動画 1分版 | Screen recording + ナレーション (Loom or QuickTime) | 4h |
| デモアカウント | 北村のテストWorkspaceを「Demo」モードで公開可能に | 6h |
| Stripe支払いボタンの動作確認 | テストカードで Checkout 完走 → Webhook → spaces.plan 更新まで一気通貫 | 4h |
| ヘルプドキュメント | `/help` ページ + FAQ (10〜20項目) | 10h |

### 6.2 クローズドβ 募集 〜 ローンチ

| 週 | 内容 |
|---|---|
| Week 1 | β募集: 北村の SNS (X / LinkedIn) / 副業界隈 / 同業ネットワーク → 10社 |
| Week 2 | β参加者の Mac mini セットアップ補助 + 個別オンボーディング |
| Week 3-4 | β中に得たフィードバックでバグ修正・UX改善ループ |
| Week 5 | β完了 + リテンション計測 (30日活性率 60%以上を目標) |
| Week 6 | 公開ローンチ準備 (LP最終調整 / OGP / 動画) |
| Week 7 | **公開ローンチ**: ProductHunt / Hacker News / Zenn / note 同時公開 |
| Week 8 | 初期マーケ反応の観察 + ホットなフィードバックに対応 |

### 6.3 ローンチ判定基準

ローンチを実施するための最低条件:

- [ ] β参加者 10社中 7社以上が「継続使用したい」と回答
- [ ] Browser automation 成功率 80%以上 (スキル3つ全部)
- [ ] β中の暴走事故 ゼロ
- [ ] クリティカルバグ ゼロ
- [ ] 利用規約 / プライバシーポリシー / 特商法 法務レビュー完了
- [ ] Stripe本番決済 動作確認済
- [ ] 監視 / アラート 設定済
- [ ] 1ヶ月運用しても安定 (Supabase / Cloud Run の負荷想定OK)

---

## Phase 7: ローンチ後 90日 (2026-11 〜 2027-01)

### 7.1 ユーザー対応 (継続)

- 毎週: 新規サインアップ / Mac miniエージェント接続率 / スキル実行数 / 解約率を Slack/メールでサマリ
- 毎日: Sentry / Stripe Webhook失敗 をモニタリング
- 月1: ユーザーインタビュー 5社

### 7.2 スキル拡張

Phase 3 で実装したのは 3スキル。残り 4スキルを実装:

| スキル | model_tier | 実装難易度 |
|---|---|---|
| 💬 未読メッセージ集約 (LINE / Slack) | agent | 中 (各サービスの認証) |
| 📝 議事録要約 | simple | 低 (録音アップロード → 文字起こし → 要約) |
| 📊 問い合わせフォーム集約 | agent | 高 (各社の管理画面が違う、汎用化難しい) |
| 🌅 朝のブリーフィング | mixed | 中 (1+2+3 統合) |

### 7.3 次の成長戦略 (2026年下半期検討)

- **業界別パッケージ**: 人材紹介 / 士業 / 飲食 / 小売 (Phase 5以降)
- **テンプレマーケットプレイス**: ユーザーがスキルを作って公開・有料化
- **Windows対応**: Tauri採用検討、需要次第
- **法人化判断**: MRR 月50万円超えたタイミングで個人事業主 → 株式会社
- **売却交渉準備**: DevOps / 自動化系SaaS (Bardeen / Lindy 系企業) との接点作り

---

## 📋 UI磨き込み 詳細チェックリスト

ローンチ品質に上げるためのUI項目を全部リストアップ:

### グローバル
- [ ] ヘッダー: WorkspaceSwitcher を全画面で常時表示
- [ ] フッター: 利用規約 / プライバシー / 特商法 / お問い合わせ
- [ ] BottomNav (モバイル): 「Workspace」タブ追加
- [ ] ダークモード: 全コンポーネントで `dark:` クラス確認

### ダッシュボード (/dashboard)
- [ ] 使用量バー: LeftSidebarだけでなく、メインビュー上部にも表示オプション
- [ ] スキルカード: 推定コスト表示の整合性確認
- [ ] 空状態: 「最初のスキルを追加」CTA

### Workspace (/dashboard/workspace/*)
- [ ] Overview: 「次にすべきこと」のおすすめCTA (メンバー招待 / Mac mini接続 / スキル追加)
- [ ] Members: 「Adminロールに昇格」UI (現状は招待時のみrole選択)
- [ ] Billing: 失敗時のリトライUX (Stripeエラーをわかりやすく)
- [ ] Analytics: グラフが空のときのEmpty State (「データなし」より「初実行を待っています」)
- [ ] Agents: install.sh コピー後の「待機中…」アニメーション + 接続完了の祝福

### モバイル
- [ ] 全ページのレスポンシブ確認
- [ ] タップターゲット最低44px
- [ ] フォントサイズ最低14px (本文)
- [ ] スクロール深度の最適化

### アクセシビリティ
- [ ] aria-label 主要ボタン全部
- [ ] focus-visible ring統一
- [ ] スクリーンリーダー対応 (Dialog / Select)
- [ ] カラーコントラスト WCAG AA (4.5:1)

### パフォーマンス
- [ ] Lighthouse スコア 90以上 (LP / dashboard / workspace)
- [ ] 画像最適化 (next/image)
- [ ] Font preload
- [ ] バンドルサイズ確認 (next build > dynamic imports)

---

## 🎯 優先順位マトリクス

| 緊急度 \\ 重要度 | 高 | 中 | 低 |
|---|---|---|---|
| **高** | 動作検証 / focusmap-agent本体 / 法務 / Stripe本番 | UI磨き / オンボーディング | — |
| **中** | 監視・ログ / マーケ準備 | スキル拡張 / モバイル | — |
| **低** | — | テンプレマーケ / Windows対応 / 業界別 | 売却準備 / 法人化 |

---

## 💰 工数試算 まとめ

| フェーズ | 純工数 (人時) | AI並列 +30% | 期間 (週15h前提) |
|---|---|---|---|
| Phase 4 (β準備) | 約 150h | 195h相当 | 13週 = 3ヶ月 |
| Phase 5 (法務・運用) | 約 50h | 65h相当 | 4週 = 1ヶ月 |
| Phase 6 (β + ローンチ) | 約 80h | 105h相当 | 7週 = 2ヶ月 |
| Phase 7 (運用) | 約 80h/月 | — | 継続 |

**合計**: Phase 4-6 で約 **280h / 24週 = 約6ヶ月**。

→ Phase 3 完了 (2026-05-26) から起算すると **公開ローンチは 2026-11-25 前後**。

これは saas-design-mvp.md の Phase 3 計画 (2026-11ローンチ) と整合する。

---

## ⚠️ 既知のリスク

| リスク | 重大度 | 対応策 |
|---|---|---|
| focusmap-agent の Playwright実装が想定より重い | 高 | 既存 codex-rpc-bridge.ts を流用してリスク軽減 |
| Stripe 個人事業主審査で時間がかかる | 中 | Phase 5の最初に申請、平行で他を進める |
| クローズドβ で 7社未満しか継続しなかった | 中 | LP / プラン構造を見直して再ローンチ |
| 競合 (n8n 等) が同領域 (ローカル実行+管理画面) に進出 | 高 | 早期のユーザー確保 + 業界知識で差別化壁 |
| 本業 (CA業務) で開発時間が削られる | 中 | 「Phase 4 Month 1-2 で最低限のWorkspace + 課金」までを最速で出す |

---

## 📚 関連ドキュメント

- [focusmap-saas-pivot.md](./focusmap-saas-pivot.md) — 親計画
- [master-todo.md](./master-todo.md) — 全タスク一覧
- [saas-design-mvp.md](./saas-design-mvp.md) — Phase 3 元計画 (時系列)
- [saas-design-buyer-user.md](./saas-design-buyer-user.md) — Workspace構造
- [saas-design-api-billing.md](./saas-design-api-billing.md) — 課金設計
- [benchmark-procedure.md](./benchmark-procedure.md) — 本番ベンチマーク手順

---

最終更新: 2026-05-26
