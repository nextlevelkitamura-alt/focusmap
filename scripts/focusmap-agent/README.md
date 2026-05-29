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

`<agent_token>` は Web アプリの `/dashboard/settings/automation` から発行できる。
Mac側に Supabase service role key は置かない。

## 仕組み

```
[Webアプリ: focusmap-official.com]
  ↕ Focusmap Agent API (Bearer agent_token)
[Supabase: ai_tasks / agent_commands]
  ↕ claim_ai_task_for_runner RPC / command queue
[ローカル: focusmap-agent]
  → Playwright で Browser automation
  → 結果を Focusmap API 経由で書き戻し
```

## 設定ファイル

`~/.focusmap/config.json`:

```json
{
  "agent_token": "...",
  "api_url": "https://focusmap-official.com/api",
  "hostname": "your-mac-mini.local",
  "shell_enabled": true
}
```

`chmod 600` でユーザー専用に保護される。

## できること

- `ai_tasks` の `executor=playwright|browser|terminal|simple` を claim
- Playwright で URL を巡回して本文取得
- `open` でブラウザ/認証URLを起動
- `agent_commands` 経由で `open_url` / `open_google_auth` / `open_gws_auth` / `run_shell` / `file_list` / `scan_capabilities`
- Google Workspace CLI (`npm install -g @googleworkspace/cli`) と `gws auth login` の導線
- ハートビートで GWS / Playwright / terminal / OpenCode / Codex / Claude / フォルダ権限の検出状態を Web に返す

## フォルダ権限

macOS のプライバシー制限により、launchd で動く `focusmap-agent` から `Downloads` や
`~/Library/CloudStorage/GoogleDrive-*` が `EPERM` になる場合がある。

Focusmap は起動時に実際に `readdir` できるパスだけを `google_drive_roots` としてWebへ返す。
Google Drive のアカウントコンテナが読めない場合でも、ホーム直下の
`~/マイドライブ（...）` のような実体ディレクトリが読めれば、そちらを優先して探索する。

`folder_access` が `denied` の場合は、macOSの
「システム設定 → プライバシーとセキュリティ → フルディスクアクセス」で
agentを起動している `node` / `focusmap-agent` 実行ファイルにアクセス許可を付けてから、
`launchctl kickstart -k gui/$(id -u)/com.focusmap-official.agent` で再起動する。

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
git clone https://github.com/nextlevelkitamura-alt/focusmap
cd focusmap/scripts/focusmap-agent
npm install
npm run dev
```

## ライセンス

UNLICENSED — Focusmap 商用利用専用。
