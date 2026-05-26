# 論点b — ローカルエージェント / インストーラ技術選定

> 親計画: [focusmap-saas-pivot.md](./focusmap-saas-pivot.md)
> 前提: [saas-design-buyer-user.md](./saas-design-buyer-user.md)
> 作成: 2026-05-26

---

## 0. このドキュメントで決めること

- ローカルエージェント (Mac mini常駐側) の実装技術
- 「ボタン1つで導入」UX の現実的な実装
- Webアプリ ↔ ローカルエージェント の通信・認証
- アップデート機構
- macOS Gatekeeper / 公証の扱い

---

## ⚠️ 0. 既存実装の活用 (2026-05-26 追記)

**ai_runners テーブル + API 一式が既に実装済み**。本ドキュメントの「focusmap-agent を新規作成」は実態と異なる。

### 既存実装の概要

| 機能 | 既存実装 | 状態 |
|---|---|---|
| Runner登録 (Mac mini相当) | `ai_runners` テーブル (hostname/executors/repo_keys/secrets/heartbeat) | ✅ |
| Runner ↔ Workspace 紐付け | `ai_runner_spaces` (複数Space対応、enable/disable可) | ✅ |
| ハートビート | `last_heartbeat_at` 更新、2分以内のみactive扱い | ✅ |
| タスクClaim | `claim_ai_task_for_runner(p_runner_id, p_claim_ttl_seconds)` 関数 | ✅ |
| API: `/api/ai-runners/claim` | 実装済み | ✅ |
| API: `/api/ai-runners/heartbeat` | 実装済み | ✅ |
| API: `/api/ai-runners/sync-package` | 実装済み | ✅ |
| パッケージキャッシュ | `ai_runner_package_cache` | ✅ |
| 既存常駐スクリプト | `scripts/codex-rpc-bridge.ts` / `scripts/com.focusmap.task-runner.plist` | ✅ |

### 設計との差分

| 本ドキュメントの記述 | 既存実装 | 対応 |
|---|---|---|
| agents テーブル新規 | `ai_runners` 既存 | 既存活用 |
| Runner = Workspace所有 | Runner = User所有 + 複数Space登録 | **既存設計の方が柔軟、これに合わせる** |
| `focusmap-agent` npm package | 既存に `codex-rpc-bridge.ts` 等の常駐スクリプトあり | **既存をパッケージ化する形に変更** |
| install.sh ワンライナー | 未実装 | **新規追加必要 (既存スクリプトをラップする形)** |

### 本当に不足しているもの (Phase 3 着手分)

1. **install.sh のホスティング** (focusmap-official.com/install.sh)
2. **install.sh の中身**: 既存 `scripts/` 配下のスクリプト群をパッケージとして公開できる形に整理
3. **agent_token 発行UI** (現状は North 開発者本人のキー設定で動作している可能性)
4. **Workspace 切替UI** (現状の管理画面が個人前提の可能性)
5. **Browser automation 用の Playwright** (現状の executors は claude/codex/codex_app だけで、Playwright直接実行系のexecutorがない可能性 → 要追加)

---

## 1. 実装技術の比較

| 案 | サイズ | 開発工数 | UX | クロスプラットフォーム |
|---|---|---|---|---|
| **Node.js CLI + launchd** | ~50MB (Playwright込み) | **小** (既存 task-runner.ts 拡張) | ターミナル必要 | macOS/Linux 楽、Windows要工夫 |
| Tauri (Rust + WebView) | ~10MB | 大 (Rust学習) | ネイティブGUI | フルクロス |
| Electron | ~150MB | 中 | ネイティブGUI | フルクロス |
| Homebrew formula | — | 小 (技術者向け) | brew install で完結 | macOS / Linux のみ |
| npm one-liner | — | 小 | コピペ1回 | Node環境必要 |

### 1.1 採用: **Node.js CLI (`focusmap-agent`) + launchd + npm one-liner**

理由:
1. **既存資産を活かせる**: task-runner.ts (Node.js) を拡張するだけで済む。Playwright も Node.js 製
2. **GUI 不要**: Webアプリで管理する設計のため、エージェント側にGUIは要らない。Tauri/Electronは過剰
3. **Apple Developer / 公証を後回しにできる**: ネイティブアプリではないので Gatekeeper の警告対象外
4. **アップデートが簡単**: `npm update -g focusmap-agent` でOK
5. **個人開発15時間/週で半年MVPに収まる**

### 1.2 却下した案と理由

| 案 | 却下理由 |
|---|---|
| Tauri | Rust学習コスト + 個人開発者にはオーバーキル + 現状GUI要件なし |
| Electron | サイズ大 (150MB) + 起動遅い + メンテナンス重い |
| Homebrew のみ | 「ボタン1つ」の理想から遠い (`brew tap` 説明が要る)、ただし副次配布として併用OK |

---

## 2. 「ボタン1つで導入」UX の現実

### 2.1 Webアプリ上での導線

```
管理画面 > エージェント > 「+ 新しいMac miniを追加」をクリック
  ↓
モーダル表示:
  ┌────────────────────────────────────────────────┐
  │ 新しいMac miniをFocusmapに接続                  │
  │                                                  │
  │ 接続したいMac miniのターミナルで以下を実行:    │
  │                                                  │
  │ ┌────────────────────────────────────────────┐ │
  │ │ curl -sSL https://focusmap-official.com/install.sh \│ │
  │ │   | sh -s -- ws_xxx_token_yyy             │ │
  │ │                                       [コピー] │ │
  │ └────────────────────────────────────────────┘ │
  │                                                  │
  │ ⏳ 接続を待っています...                        │
  │ (接続が完了すると自動でこの画面が次に進みます) │
  └────────────────────────────────────────────────┘
  ↓
ターミナルで実行 → エージェント起動 → Supabase接続 → 画面遷移
```

### 2.2 install.sh の中身 (概略)

```bash
#!/bin/bash
set -e

AGENT_TOKEN=$1
INSTALL_DIR="$HOME/.focusmap"

echo "→ Focusmap エージェントをインストールします..."

# 1. Node.js チェック (なければ Homebrew で導入)
if ! command -v node &> /dev/null; then
  echo "→ Node.jsをインストール (Homebrew経由)..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  brew install node
fi

# 2. focusmap-agent をグローバルインストール
echo "→ focusmap-agent をインストール..."
npm install -g @focusmap/agent

# 3. Playwright + Chromium 導入
echo "→ Playwright + Chromiumを導入..."
npx playwright install chromium

# 4. 設定ファイル作成
mkdir -p "$INSTALL_DIR"
cat > "$INSTALL_DIR/config.json" <<EOF
{
  "agent_token": "$AGENT_TOKEN",
  "api_url": "https://focusmap-official.com/api",
  "installed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

# 5. launchd plist を登録 (起動時自動起動)
PLIST_PATH="$HOME/Library/LaunchAgents/com.focusmap-official.agent.plist"
cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.focusmap-official.agent</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/focusmap-agent</string>
    <string>start</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$INSTALL_DIR/agent.log</string>
  <key>StandardErrorPath</key><string>$INSTALL_DIR/agent.error.log</string>
</dict>
</plist>
EOF

launchctl load "$PLIST_PATH"

echo "✅ インストール完了! Webアプリに自動的に戻ります..."
```

### 2.3 「APIわからない人」が実行できるか

正直に評価: **`curl | sh` の段階でつまずく可能性が高い**。

対策:
1. **Webアプリで「ターミナルの開き方」を画像/動画で案内** (Spotlight → "ターミナル")
2. **BUYERが代行する前提** (Admin/Owner が初期セットアップ、社員はWebアプリだけ使う)
3. **将来オプション: Tauri製の超軽量インストーラGUI** (Phase 4 以降、月収◯円超えてから)

→ MVPでは「Admin/Owner がセットアップ」前提でOK。USERは触らない。

---

## 3. Webアプリ ↔ エージェントの通信

### 3.1 採用方式: **Supabase Realtime (WebSocket) + Polling フォールバック**

```
Webアプリ → Supabase ai_tasks INSERT
              ↓
              Supabase Realtime (postgres_changes)
              ↓
エージェント (WebSocket 購読)
              ↓
              タスク受信 → Playwright実行 → 結果書き戻し
              ↓
Supabase → Webアプリ (Realtime購読で自動更新)
```

- **既存Focusmap (Phase 1) で既にSupabase Realtimeを使っている** → 拡張で対応可
- 接続断時は60秒polling にフォールバック (Phase 2 task-runner.ts と同じ)
- ハートビート: 30秒ごとに `agents.last_seen_at` を更新

### 3.2 認証

- エージェント起動時に `config.json` の `agent_token` で認証
- Supabase RLS で `workspace_id` でガード
- トークンは Workspace固有、Member別ではない

### 3.3 通信プロトコル

| 方向 | 内容 |
|---|---|
| Web → Agent | `ai_tasks` の INSERT を Realtime 経由で通知 |
| Agent → Web | 実行ログを `ai_tasks.result` に書き戻し、ステータス更新 |
| Agent → Web | ハートビート (30秒ごと、`agents` テーブル更新) |
| Web → Agent | スキル定義の更新 (Realtime via `skills` テーブル) |

---

## 4. アップデート機構

### 4.1 採用: `npm update` + 内部チェック

```bash
# launchd タスクで daily 実行
focusmap-agent self-update

# 中身:
#   1. npm view @focusmap/agent version で最新を取得
#   2. ローカル version と比較
#   3. 新しければ npm install -g @focusmap/agent@latest
#   4. プロセス再起動
```

### 4.2 アップデート戦略

- **マイナーバージョン**: 自動アップデート (バグ修正・パフォーマンス改善)
- **メジャーバージョン**: 管理画面で通知 → Admin が手動承認 (破壊的変更時)
- ロールバック: `npm install -g @focusmap/agent@<前バージョン>`

---

## 5. macOS Gatekeeper / 公証

### 5.1 結論: **当面は対象外**

理由:
- `focusmap-agent` は Node.js モジュール (バイナリではない) → Gatekeeper の警告対象外
- `curl | sh` での導入も、ユーザー自身がコマンドを実行している扱いで Gatekeeper をバイパス
- launchd 登録もプロセス起動扱い、警告なし

### 5.2 公証が必要になるタイミング

| トリガー | 対応 |
|---|---|
| Tauri製GUIアプリを配布 | Apple Developer Program ($99/年) + 公証フロー |
| Mac App Store配布 | App Store審査 + サンドボックス対応 |

→ **Phase 4 以降の課題** (収益化後、月収数十万円超えてから検討)

### 5.3 セキュリティ警告への対応 (将来)

- `curl | sh` を懸念する層 (セキュリティ意識高い企業) には Homebrew formula を別途提供
- `brew install focusmap/tap/focusmap-agent`

---

## 6. Windows 対応の方針

### 6.1 結論: **MVP では対象外、Phase 4以降**

理由:
- ターゲット (BUYER) は Mac mini導入を許容するペルソナ → Mac前提でOK
- Windows対応は工数が大きい:
  - launchd の代わりに タスクスケジューラ
  - PowerShell スクリプト書き換え
  - Windows code signing certificate ($200-500/年)
  - WSL2 などの環境差吸収
- 競合 (Zapier/n8n) もMac前提のSaaSは少なくない

### 6.2 将来検討時の方針

- Windows対応するなら **Tauri採用 + フルクロス** が現実的
- 個人開発で15時間/週なら、Phase 4 (1年〜1年半後) 以降が現実的

---

## 7. インストール失敗時のサポート

### 7.1 想定エラーと対応

| エラー | 自動対応 | ユーザー誘導 |
|---|---|---|
| Node.js が無い | Homebrew 経由で自動インストール | ✓ |
| Homebrew が無い | curl で自動インストール | ✓ |
| Playwright Chromium ダウンロード失敗 | リトライ (3回) | ネットワーク確認案内 |
| launchd 登録失敗 (権限) | 手動コマンド案内 | システム設定 > プライバシー > フルディスクアクセス |
| token が無効 | エラーメッセージ表示 | Webアプリで token を再発行案内 |
| 既に別 Workspace に接続済 | エージェントログに表示 | Webアプリで「リセット」ボタン提供 |

### 7.2 ログ収集

- `~/.focusmap/agent.log` (1日ローテーション、7日保持)
- `~/.focusmap/agent.error.log` (エラー専用、30日保持)
- 管理画面から「ログをアップロード」ボタンで Supabase に送信 → 北村がデバッグ

### 7.3 サポート体制 (MVP)

- ドキュメント (Webアプリ内ヘルプ + FAQ)
- メールサポート (Personal/Team)
- 専任サポート (Enterprise)
- **個人開発15h/週なので、CSは週2時間想定**、超えたら有料サポート

---

## 8. セキュリティ考慮

### 8.1 ローカルエージェントが扱うリスク

- 認証Cookie (Google Calendar / 業務管理画面 / LINE 等)
- Playwright が任意のサイトを操作可能
- claude / gemini API キー

### 8.2 対策

| リスク | 対策 |
|---|---|
| token漏洩 | bcrypt ハッシュで保存、ローテーション機構 |
| 認証Cookie盗難 | `~/.focusmap/auth/` を chmod 600、ログに書かない |
| Playwright が意図しない操作 | Workspace で許可ドメインを限定、prompt template に許可URL明記 |
| API暴走 | 論点cの3層暴走対策 |

### 8.3 利用規約での明示

- ユーザーが認証情報を入力するサイトの利用規約に違反する操作は禁止
- 北村が個人の認証情報を取得することはない (ローカル保管)
- データの取得は Workspace 内でのみ共有

---

## 9. 残課題

- [ ] `install.sh` のホスティング先 (Cloud Run vs Cloudflare)
- [ ] npm package の名前確保 (`@focusmap/agent` が空いているか)
- [ ] Homebrew tap の作成 (副次配布用)
- [ ] Playwright Chromium のキャッシュ戦略 (200MBダウンロード)
- [ ] ARM Mac / Intel Mac の両対応

---

最終更新: 2026-05-26
