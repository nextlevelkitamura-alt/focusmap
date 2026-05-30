---
status: active
category: docs
priority: high
created: 2026-05-30
updated: 2026-05-30
related: [mindmap-node-codex-relay.md]
---

# Codex relay — 実行フロー正本 & 運用 / トラブル対応

このドキュメントは「ノード → Codex 実行」の**唯一の正本フロー**と、安定運用・トラブル対応をまとめる。
今後の保守はまずここを見る。設計の経緯は [mindmap-node-codex-relay.md](./mindmap-node-codex-relay.md)。

## 正本フロー（これだけ覚えればよい）

```
[FocusMap] マインドマップのノード「Codex」ボタン
   │  作業ディレクトリ(cwd)を選択（履歴/Finder/手入力, per-node に保存）
   ▼
POST /api/ai-tasks/schedule  { prompt = ノードtitle+メモ詳細, cwd, executor:'codex' }
   ▼
[Supabase] ai_tasks に1行 insert（status=pending）
   ▼
[Mac常駐] task-runner（launchd, tsx, ~18秒ポーリング）が claim
   │  executor='codex' → codex 分岐 → launchCodexRemote
   ▼
codex-rpc-bridge.ts を tsx で spawn（detached, 1タスク1プロセス）
   │  ws://127.0.0.1:7878 に initialize → thread/start(cwd) → turn/start(prompt)
   │  （往復は thread/resume + turn/start。resume id は ai_tasks.codex_resume_thread_id）
   ▼
[codex app-server] (launchd常駐) が Codex を実行 → thread を state_5.sqlite に作成
   │  source='vscode' → Codexアプリ & ペアリング済みスマホに表示
   ▼
bridge が返信を ai_tasks.result(live_log, codex_thread_id, steps) に書き戻し（status=awaiting_approval）
   ▼
[FocusMap] 「Today → AI実行タイムライン」に返信表示 + 「続けて送る」で往復
```

## 構成要素（常駐サービス）

| 役割 | 実体 | launchd | ログ |
|---|---|---|---|
| Codex 実行基盤 | `codex app-server --listen ws://127.0.0.1:7878 --enable remote_control` | `com.focusmap.codex-app-server` | `/tmp/codex-app-server.log` |
| ジョブ実行役 | `scripts/task-runner.ts`（tsx, ~18秒ポーリング） | `com.focusmap.task-runner` | `scripts/task-runner.log` / `.err` |
| 1タスク実行 | `scripts/codex-rpc-bridge.ts`（task-runnerがspawn） | （都度起動） | `/tmp/codex-bridge-<taskId>.log` |
| ブラウザ自動化（別系統） | focusmap-agent | `com.focusmap.agent` | `~/.focusmap/logs/` |

## executor の整理方針

| executor | 役割 | 方針 |
|---|---|---|
| **codex** | bridge経由・FocusMapに返信回収・往復・アプリ/スマホ表示 | ✅ **正本。ノードからはこれだけ使う** |
| codex_app | `codex://` でアプリGUIを開くだけ（返信がFocusMapに戻らない） | ⚠️ codex と重複。要・存続判断 |
| claude | `claude -p` ローカル実行 | ❌ 当環境で `spawn ENOEXEC`（壊れ）。要・修正 or 撤去判断 |
| playwright/simple | focusmap-agent（別runner naonomac-playwright.local） | 別系統。触らない |

## 安定運用のルール

- **完全オンライン前提**：Codex は OpenAI バックエンド必須。オフラインでは動かない（offline対応は作らない）。
- **Mac はスリープ中は実行されない**：未達タスクは Supabase に滞留し、**復帰してオンラインになった瞬間に直列で処理**（設計どおり）。常時確実にしたいなら常時起動マシン推奨。
- **送達確認 = Mac が claim した時点**（status=running）。それまで「Mac待ち」。クラウド書き込みは1回（重複なし）。

## トラブル対応（既知の落とし穴と直し方）

1. **「実行したのにFocusMapに出ない / 失敗する」**
   - 確認: `ai_tasks` の status / `error` / `codex_thread_id`。`error="spawn ENOEXEC"` なら codex タスクが claude に誤ルーティング → task-runner の分岐条件を確認（解決済: cwd+executor=codex なら codex 分岐へ）。
2. **`codex_thread_id` が null のまま**
   - bridge が起動できていない。`/tmp/codex-bridge-<id>.log` が無ければ spawn 失敗。**bridge は `tsx` で起動**（ts-node 未導入。解決済）。
3. **task-runner.err に `fetch failed` 多発**
   - Supabase の制限ではなく**ノートPCのネットワーク一時切断**（スリープ/WiFi）。一瞬なら heartbeat 2分窓で吸収。長時間断は復帰後に回復。
4. **runner が「not configured」**
   - heartbeat fetch 失敗で runner が stale。ネットワーク回復で自動復帰。再起動: `launchctl kickstart -k gui/$(id -u)/com.focusmap.task-runner`。
5. **1件の不良タスクで全体が止まる**
   - per-task エラー隔離済み（解決済）。1件失敗は failed にして次へ。

## 確認コマンド

```bash
tail -f scripts/task-runner.log               # claim/実行ログ
tail -f /tmp/codex-bridge-*.log               # bridge詳細
launchctl kickstart -k gui/$(id -u)/com.focusmap.task-runner   # runner再起動
# DBのcodexタスク状態:
#   SELECT status, codex_thread_id, result->>'live_log' FROM ai_tasks WHERE executor='codex' ORDER BY created_at DESC LIMIT 5;
```

## クリーンアップ候補（要・本人判断）

- [ ] **claude executor**: 当環境で壊れている。使わないなら wishlist UI から撤去（誤って壊れた選択肢を出さない）。使うなら `claude` コマンドの ENOEXEC を別途調査。
- [ ] **codex_app executor**: codex と重複。FocusMap統合(codex)に一本化するなら UI から撤去。
- [ ] 旧 `codex --remote`(TUI) 由来のコメント/残骸の掃除。
- [ ] スパイク資産 `/tmp/codex-relay-test/` は本実装へ移植済み → 不要。
