# 論点a — BUYER/USER 分離設計

> 親計画: [focusmap-saas-pivot.md](./focusmap-saas-pivot.md)
> 競合分析: [competitive-analysis.md](./competitive-analysis.md)
> 作成: 2026-05-26
> ステータス: 設計案 (実装着手前)

---

## 0. 確定済みの上流判断

| 項目 | 確定 |
|---|---|
| アカウント・組織構造 | **A: Notion/Slack型 — 全員が常にWorkspaceに所属** |
| 課金単位 | **D: ハイブリッド (seat + 実行上限)** |
| 使用量UX | **Claude Code / Codex 型の使用量バー** で可視化 |
| 残り論点 (Role/管理画面/エージェント紐付け/認証情報) | 本ドキュメントの推奨案で進める |

---

## 1. Workspace 構造設計

### 1.1 基本ルール

- **すべてのユーザーは少なくとも1つの Workspace に所属する**
- サインアップ時に「Personal Workspace」が自動生成される (= 1人プラン)
- 「Team プランへアップグレード」したら、同じ Workspace に他メンバーを招待 — **データ移行不要**
- ユーザーは **複数の Workspace に所属可能** (副業・本業の使い分け)

### 1.2 採用理由

- 個人 → 法人化のアップグレード摩擦をゼロにする (Notion/Slack/Linear/Figmaが採用済みのベストプラクティス)
- 一人法人 (BUYER ≒ USER) もシームレスに扱える
- DBスキーマがシンプル (Personal/Team で別テーブル不要)

### 1.3 DBスキーマ案 (概略)

```sql
-- 既存 users テーブルを継続使用 (Supabase Auth)

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  plan text not null default 'free',  -- free / personal / team / enterprise
  owner_user_id uuid references auth.users(id),
  created_at timestamptz default now()
);

create table workspace_members (
  workspace_id uuid references workspaces(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  role text not null default 'member',  -- owner / admin / member
  invited_at timestamptz,
  joined_at timestamptz,
  primary key (workspace_id, user_id)
);

-- 既存 ai_tasks に workspace_id を追加
alter table ai_tasks add column workspace_id uuid references workspaces(id);

-- 新規: Mac mini ローカルエージェント
create table agents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete cascade,
  name text not null,                   -- "Office Mac mini" など
  token_hash text not null,              -- エージェント認証用
  last_seen_at timestamptz,              -- ハートビート
  status text default 'offline',         -- online / offline / error
  created_at timestamptz default now()
);

-- 新規: スキル定義 (現在のJSONをDB化)
create table skills (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete cascade,
  name text not null,
  description text,
  icon text,
  approval_type text default 'auto',
  prompt_template text,
  steps jsonb,
  schedule text,
  created_at timestamptz default now()
);

-- 新規: 月間使用量
create table usage_metrics (
  workspace_id uuid references workspaces(id) on delete cascade,
  user_id uuid references auth.users(id),
  month text not null,                   -- "2026-05"
  executions int default 0,              -- 今月の実行数
  api_cost_usd numeric default 0,        -- 概算API原価
  primary key (workspace_id, user_id, month)
);

-- 新規: Audit Log
create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete cascade,
  user_id uuid references auth.users(id),
  action text not null,                  -- "skill.executed" / "member.invited" 等
  target_type text,                       -- "skill" / "agent" / "member" 等
  target_id text,
  metadata jsonb,
  created_at timestamptz default now()
);
```

### 1.4 RLS (Row Level Security) 方針

- すべての Workspace スコープのテーブルは、`workspace_members` の存在チェックで読み書きを制限
- Admin/Owner だけが書き込める列 (Role変更、課金、エージェント追加等) は別途ガード

---

## 2. 課金プラン設計

### 2.1 4プラン構成

| プラン | 月額 | seat | 実行数/月 | Mac mini連携 | 管理画面 | API課金 |
|---|---|---|---|---|---|---|
| **Free** | $0 | 1 | **5** | 不可 (試用のみクラウド) | × | Focusmap負担 (Gemini Flash) |
| **Personal** | $19 | 1 | **100** | ◎ 1台 | △ 個人ダッシュボード | Focusmap負担 |
| **Team** | **$39/seat (最低3seat = $117〜)** | 任意 | **500/seat** | ◎ 最大5台 | ○ 管理画面フル機能 | Focusmap負担 / 超過pay-as-you-go |
| **Enterprise** | Custom | Unlimited | Custom | ◎ Unlimited | ○ + 監査ログ + SSO | **BYOK選択可** |

### 2.2 採用根拠 (競合との位置取り)

- 個人 $19: Zapier Pro $19.99、Make Pro $16、Bardeen $10 の **真ん中** に置く
- Team $39/seat: Make Teams $29 + Zapier Team $69 の中間。 **管理画面の質で差別化** する価格
- Free 5実行/月: Zapier 100tasks より厳しい。Focusmapは1実行=ブラウザ自動化丸ごとなので過剰利用を防ぐ意図

### 2.3 実行数の数え方

- **1実行 = 1スキル完了 (成功/失敗問わず)** ← n8n方式に倣う (シンプル、ステップ数気にせず使える)
- 確認待ちで止まっても1実行カウント
- リトライは1実行扱い (Focusmap側で再試行制限あり)

### 2.4 使用量UX (Claude Code / Codex 型バー)

```
┌─────────────────────────────────────────────┐
│ 📊 今月の使用量                              │
│                                              │
│ あなた:    ████████░░░░░░░░  87 / 100 実行  │
│ Workspace: ████████████████░  2,340 / 2,500 │
│                                              │
│ ⏰ リセット: 6月1日 (あと5日)                │
│ 💰 超過時: $0.10/実行 (Pay-as-you-go)        │
└─────────────────────────────────────────────┘
```

- 個人ダッシュボードに **常時表示**
- 80%超で黄色、95%超で赤色警告
- 超過時のpay-as-you-goは **事前に明示・同意必須** (暴走防止)
- **「あと何日で何回実行できる」** が直感で分かる設計

---

## 3. Role 設計 (3種類で開始)

### 3.1 Role 定義

| Role | 課金 | メンバー管理 | スキル管理 | 実行 | 管理画面 | Audit閲覧 |
|---|---|---|---|---|---|---|
| **Owner** | ◎ 全権 | ◎ | ◎ | ◎ | ◎ | ◎ |
| **Admin** | × 閲覧のみ | ◎ | ◎ | ◎ | ◎ | ◎ |
| **Member** | × | × | × (実行のみ) | ◎ | × | × (自分の履歴のみ) |

- **Owner は1人/Workspace** (引き継ぎ可能)
- **Admin は複数可** (実質的な運用責任者)
- **Member** が中小企業の「AIに不慣れな社員」(= USER ペルソナ)

### 3.2 採用理由

- 競合 (Zapier/n8n) は4〜5 Role持ってるが、Focusmapの初期スコープでは **3で十分**
- 将来 Editor (スキル作れるが課金触れない) を追加可能
- 社員数5〜30人の小規模法人で過剰な階層は不要

---

## 4. 管理画面 vs 利用者UI のスコープ

### 4.1 管理画面 (Admin Dashboard) — Owner/Admin専用

| セクション | 内容 |
|---|---|
| **メンバー** | 招待・削除・Role変更・最終ログイン |
| **利用Analytics** | メンバー別実行回数、スキル別実行回数、月推移グラフ |
| **使用量バー (Workspace全体)** | 全体予算の消費状況、API原価の推移 |
| **課金管理** | プラン変更、請求書、支払い方法、領収書ダウンロード |
| **スキル管理** | 共有スキル追加・編集・削除、テンプレ取り込み |
| **エージェント管理** | 接続中のMac mini一覧、ステータス、再認証案内 |
| **認証情報** | サービス別認証状態 (Google/LINE/管理画面 etc.)、切れたら通知 |
| **Audit Log** | 過去操作の検索可能ログ (誰が何をいつ) |

### 4.2 利用者UI (Main App) — 全員アクセス

| セクション | 内容 |
|---|---|
| **スキルカード一覧** | 実行可能なスキル (Admin が登録したもの)、お気に入り、最近使った |
| **実行履歴** | 自分が実行した結果、確認待ちのもの、失敗 |
| **確認待ち** | `awaiting_approval` のタスク、承認/修正指示UI |
| **使用量バー (個人)** | 自分の月間実行数、リセット日 |
| **AI壁打ち** | テキスト送信→AI回答 (現Phase 1機能を継続) |

### 4.3 設計原則

- **Memberが管理画面に迷い込まない** — Member は URL直アクセスでも 403
- **Adminは管理画面と利用者UIを行き来する** — トップナビで切替
- **Owner = Admin の上位互換**、UIは同じ。差は「課金変更ボタン」だけ

---

## 5. ローカルエージェント (Mac mini) の紐付け

### 5.1 基本ルール

- **エージェントは Workspace に紐づく** (個人ではなく組織)
- 1 Workspace で複数台のMac mini登録可 (Team以上、最大5台)
- エージェントは `workspace_id + agent_token` でSupabaseに認証
- 30秒ごとにハートビート → `agents.last_seen_at` 更新
- 90秒以上 last_seen が無ければ `offline` に変更

### 5.2 セットアップフロー (ワンクリック相当)

```
1. Webアプリ > 管理画面 > エージェント追加
2. Workspaceに紐づく `agent_token` 発行
3. ターミナルで以下を実行 (Webアプリにコマンドが表示される):
   curl -sSL https://focusmap.app/install.sh | sh -s -- <agent_token>
4. install.sh が:
   - Node + Playwright + Chromiumをインストール
   - focusmap-agentパッケージをセットアップ
   - launchd plistを登録 (Mac mini起動時自動起動)
   - 初回認証フロー (各サービスログイン誘導)
5. Webアプリ側で接続確認 (緑色○表示)
```

- 「ボタン1つ」は厳密には「ワンライナー1つ」だが、コピペ1回で完結
- 失敗時のサポートUXは後続スプリントで詰める

### 5.3 ジョブのルーティング

- スキルごとに「実行する Mac mini」を Admin が指定
- 将来: ラウンドロビン / タグベース選択 (`#sales-pc` 等)
- どのエージェントも `offline` なら実行不可、Workspaceに通知

### 5.4 エージェント認証の安全性

- `agent_token` はDB上は **bcrypt ハッシュで保存**、平文は発行時のみ
- トークンは Workspace単位、Member別ではない (運用簡素化)
- 失効 (revoke) は管理画面から1クリック

---

## 6. 認証情報 (Cookie/OAuth) の管理

### 6.1 原則: ローカル保持を徹底

- 各サービス (Google Calendar / LINE / 管理画面サイト等) の認証情報は **Mac mini上の `~/.focusmap/auth/` にのみ保存**
- **クラウド (Supabase) には絶対に保存しない** ← セキュリティ訴求の核心
- 利用者は Cookie/OAuth トークンを直接見ることはできない

### 6.2 認証情報の所有モデル

| パターン | 用途 |
|---|---|
| **Workspace共有** | 会社共有のSalesforce / 業務管理画面 / 共有Google Workspace |
| **個人専用** | 個人のGmail / 個人のLINE |

- Admin が「この認証はWorkspace共有 / 個人専用」を設定
- Workspace共有 → 全Memberがスキル経由で利用可
- 個人専用 → 当該Memberのスキル実行時のみ利用

### 6.3 認証切れの検知と通知

- 5分ごとに各サービスにヘルスチェック (軽いリクエスト)
- 切れたら:
  - 管理画面に ⚠️ 表示
  - Workspace全員にメール/プッシュ通知 (Admin宛優先)
  - 該当認証を使うスキルを一時無効化 (誤実行防止)
- Admin がブラウザで再ログイン → 1分以内に復旧

---

## 7. 暴走対策 (3層構造)

| 層 | 内容 |
|---|---|
| **層1: 実行数上限** | プランごとの月間実行上限 (Free 5 / Personal 100 / Team 500/seat) |
| **層2: 最小実行間隔** | スキル毎に「前回実行から◯分以内は再実行不可」(Free 15分 / Personal 5分 / Team 1分) |
| **層3: API予算強制** | `--max-budget-usd $2.00` + `--max-turns 10` を全実行に強制 |

加えて:
- **異常検知**: 1日内に同じスキルが想定の3倍以上実行されたら自動停止 + Admin通知
- **ANTHROPIC_API_KEY 確認**: 環境変数に存在したら起動拒否 ($1,800事故型を防ぐ)

---

## 8. 既存Focusmapからの差分・移行

| 既存 | 移行後 |
|---|---|
| ai_tasks テーブル | + workspace_id カラム追加 |
| スキル定義 JSON ファイル | skills テーブルに移行 (Workspace別) |
| 認証情報 (auth.json) | エージェントに `~/.focusmap/auth/<workspace_id>/` の構造で保持 |
| Mac常駐スクリプト (task-runner.ts) | `focusmap-agent` パッケージ化、`agent_token` で認証 |
| 北村個人ダッシュボード | Personal Workspace として継続使用 |

---

## 9. 次に詰めるべき残り論点

a (BUYER/USER分離) はこれで完了。残り:

- [ ] **論点c**: APIキー詳細 (今のドキュメントで一部触れたが、Pay-as-you-go超過課金の具体実装、Stripe連携、月額にAPIをどう含めるか)
- [ ] **論点e**: MVP定義 (本ドキュメントの全部を半年で作るのは無理。何を最初に出すか)
- [ ] **論点b**: ローカルセットアップ技術選定 (install.sh で十分か、Tauri製GUIインストーラ要否)
- [ ] **論点d**: スキルテンプレの初期セット

---

## 10. 検証が必要な仮説

- [ ] 「3 Role (Owner/Admin/Member)」が小規模法人で過不足ないか (5社程度ユーザーインタビュー)
- [ ] 「Team最低3seat」は決裁ハードル高すぎないか (1seat単位売りも検討)
- [ ] 「使用量バー」の心理効果 (Claude Codeユーザーで実証されているが、非エンジニアでも有効か)
- [ ] ワンライナー install.sh で「APIわからない人」の社員が完了できるか (現実的にはAdminがやる前提)

---

最終更新: 2026-05-26
