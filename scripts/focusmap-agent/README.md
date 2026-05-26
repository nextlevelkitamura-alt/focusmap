# @focusmap/agent

Focusmap の **ローカル実行エージェント**。Mac mini や常時稼働マシンに導入し、
Web アプリ (`focusmap-official.com`) からの自動化タスクを Playwright 経由で実行する。

## 特徴

- **データは手元から出ない**: Cookie や認証情報は `~/.focusmap/` にのみ保存される
- **Webアプリで管理**: ジョブ投入・実行状態の可視化は SaaS 側で完結
- **launchd で常時稼働**: Mac mini を起動するだけで自動的にジョブを処理

## インストール

```bash
curl -sSL https://focusmap-official.com/install.sh | sh -s -- <agent_token>
```

`<agent_token>` は Web アプリの `/dashboard/workspace/agents` から発行できる。

## 仕組み

```
[Webアプリ: focusmap-official.com]
  ↕ Supabase Realtime (WebSocket)
[Supabase: ai_tasks テーブル]
  ↕ claim_ai_task_for_runner RPC
[ローカル: focusmap-agent]
  → Playwright で Browser automation
  → 結果を Supabase に書き戻し
```

## 設定ファイル

`~/.focusmap/config.json`:

```json
{
  "agent_token": "...",
  "api_url": "https://focusmap-official.com/api",
  "hostname": "your-mac-mini.local"
}
```

`chmod 600` でユーザー専用に保護される。

## ログ

- `~/.focusmap/logs/agent.log`
- `~/.focusmap/logs/agent.error.log`

## 停止・再起動

```bash
launchctl unload ~/Library/LaunchAgents/com.focusmap-official.agent.plist
launchctl load   ~/Library/LaunchAgents/com.focusmap-official.agent.plist
```

## 開発

```bash
git clone https://github.com/focusmap-official/focusmap-agent
cd focusmap-agent
npm install
npm run dev
```

## ライセンス

UNLICENSED — Focusmap 商用利用専用。
