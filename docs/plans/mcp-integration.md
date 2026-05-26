# MCP統合 — 外部サービス連携の方針

> 作成: 2026-05-27
> 親計画: [launch-roadmap.md](./launch-roadmap.md)
> 関連: [saas-design-skills.md](./saas-design-skills.md)

---

## Context

Focusmap は Phase A-D で Google Calendar / Gmail を「自前OAuth実装」で連携する設計だったが、
以下の理由で **外部 MCP (Model Context Protocol) サーバ経由** に切り替える:

- Google の **sensitive scope** (Gmail / Drive / Sheets 等) は OAuth verification 必須
  - 動画提出 / プライバシーポリシー審査 / 数週間〜数ヶ月かかる
  - 既存ユーザーには再認証フローを強制する
- **同じ仕組み (自前OAuth)** を Notion / Slack / Discord / 各SaaS について繰り返すのは負担大
- **MCPサーバなら 1度の統合で多サービス対応**、メンテも委譲できる

---

## 採用する MCP プロバイダ (候補)

### 第一候補: Composio
- 100+ ツール対応 (Gmail / Sheets / Notion / Slack / Discord / GitHub etc)
- OAuth はComposio側で完結 (Focusmap側でOAuth実装不要)
- TypeScript SDK / REST API あり
- 料金: Free tier (100 actions/月), Pro $20/月
- 公式: https://composio.dev

### 第二候補: Zapier MCP
- Zapier の8000+ アプリ統合を MCP として公開
- Zapier の既存ユーザー基盤がある
- 認証はZapier側
- 公式: https://mcp.zapier.com (調査要)

### 第三候補: Pipedream MCP
- 2000+ アプリ
- 開発者向けのアクション・トリガー
- 公式: https://pipedream.com/mcp

### 第四候補: 自前で公式MCPサーバを使う
- 各サービスが公式MCPサーバを公開している場合 (例: GitHub MCP server)
- メリット: 中間業者がいない
- デメリット: 認証実装を結局自前でやることになる場合あり

**初期方針: Composio を採用**。Pro $20/月の費用は Focusmap側で負担、ユーザーは Composio アカウント作成だけ。

---

## 連携対象 (優先順)

| サービス | 用途 (スキル例) | MCP優先度 |
|---|---|---|
| **Google Calendar** | 予定の読み書き | **自前 (既存実装維持)** ※ non-sensitive scope のため |
| **Gmail** | 未読要約 / 自動分類 | 🔥 MCP優先 |
| **Google Sheets** | 顧客リスト / 経理 / 候補者管理 | 🔥 MCP優先 |
| **Notion** | ナレッジ管理 / 議事録 | ⭐ 高 |
| **Slack** | チームコミュニケーション | ⭐ 高 |
| **Discord** | コミュニティ | △ 中 |
| **GitHub** | コード管理 / Issue管理 | △ 中 |
| **LINE / Chatwork** | 国内向け | △ 中 (公式SDK直接呼び出しも可) |

---

## アーキテクチャ

```
[ユーザー]
  ↓ /dashboard/workspace/integrations で「Gmail連携」クリック
  ↓
[Focusmap (Web)]
  ↓ Composio OAuth flow にリダイレクト
  ↓
[Composio]
  ↓ Google OAuth (Composioのアカウント名義)
  ↓ Composio が認証情報を保管
  ↓ Composio が Focusmap に connection_id を返す
[Focusmap]
  ↓ user_composio_connections テーブルに connection_id を保存

[ユーザーが「メール要約して」と指示]
  ↓
[focusmap-agent]
  ↓ Supabase から connection_id 取得
  ↓ Composio API 呼び出し: `composio.actions.execute('GMAIL_FETCH_EMAILS', { connection_id, ... })`
  ↓ Composio が Gmail からメール取得して返す
  ↓ focusmap-agent が Gemini で要約 → ai_tasks.result に保存
```

---

## 実装フェーズ

### Phase E (推定 6-10h、今後着手)

**E.1: Composio アカウント開設 + SDK統合**
- npm install `composio-core` (or 公式SDKの最新名)
- 環境変数 `COMPOSIO_API_KEY` 追加
- `src/lib/integrations/composio.ts` でクライアント初期化

**E.2: 連携テーブル追加 (新規 migration)**
```sql
CREATE TABLE user_composio_connections (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  space_id UUID REFERENCES spaces(id),
  service TEXT NOT NULL,  -- 'gmail' / 'sheets' / 'notion' 等
  composio_connection_id TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ,
  ...
);
```

**E.3: 連携UI (新規ページ)**
- `/dashboard/workspace/integrations`
- 各サービスの「連携」「切断」ボタン
- Composio OAuth flow にリダイレクト

**E.4: スキル実装の MCP 切替**
- `email-summary.ts`: Gmail API直叩き → Composio.GMAIL_FETCH_EMAILS
- 新規 `sheets-update.ts`: Composio.GSHEETS_UPDATE_ROW
- 新規 `notion-search.ts`: Composio.NOTION_SEARCH

**E.5: 動的スキル登録**
- system_skill_templates に 「Composio対応」フラグ追加
- agent側で連携状態を確認、未連携なら適切なエラー

---

## 注意点

### セキュリティ
- Composio の connection_id を Focusmap側で保持するが、 実際のOAuth tokenは Composio側
- **Focusmap が Compromise しても、ユーザーのデータは流出しない** (1-hop indirection)
- ただし Composio自体への信頼は必要

### 料金構造
- Composio Pro: $20/月 (100,000 actions)
- 1ユーザーあたり月100スキル実行なら、 100ユーザーで上限
- → スケールしたら Composio エンタープライズ契約 or 自前MCPサーバ移行を検討

### ローカル実行原則との整合
- 「ローカル実行 = データ流出ゼロ」が Focusmap の差別化軸
- MCP経由は外部依存だが、 認証 + データ取得のみ
- focusmap-agent でのデータ処理は引き続きローカル (AI呼び出しのみ Composio/外部AI API)
- セキュリティ訴求: 「認証は Composio が責任、ローカル処理は Focusmap が責任」

---

## ローンチへの影響

- **Phase 4 (β準備) で email-summary スキルは MCP対応に変更**
- **既存 Google Calendar連携 は維持** (sensitive scope ではないため)
- **新規スキル拡張は MCP 経由で爆発的に増やせる** (Sheets / Notion / Slack を1日で追加可能)
- **OAuth verification 申請を回避** = ローンチ前の手間を削減

---

## 次のアクション

1. Composio アカウント開設 + API key 取得 (北村)
2. SDK 統合 (Phase E.1)
3. 連携テーブル migration (Phase E.2)
4. 連携UI 実装 (Phase E.3)
5. email-summary を Composio版に置換 (Phase E.4)

---

最終更新: 2026-05-27
