---
status: active
category: feature
priority: high
created: 2026-05-30
updated: 2026-05-30
related: [focusmap-lite-mac-agent.md, unified-agent-chat.md]
---

# マインドマップノード → Codex relay（app-server経由・往復・アプリ/スマホ同期）

## 概要

マインドマップのノード（`ideal_items`）から、そのノードのメモ＋詳細をプロンプトとして
**ローカルMacのCodex**に投入し、Codexと**往復会話**しながらタスクを実行させる。
会話はFocusMapに全ミラーして一元管理し、スマホ（FocusMapモバイルWeb）からも操作できるようにする。

**なぜこの方式か（実機検証で確定した前提）:**
`codex exec` で作ったセッションは `source='exec'` となり **Codexアプリの一覧に出ない**。
一方 **app-server（`codex app-server --listen ws://127.0.0.1:7878`）にWS JSON-RPCで投入**すると
`source='vscode'` のthreadになり、**Codexアプリにもペアリング済みスマホにも表示される**。
よって relay は `codex exec` ではなく **app-server経由**で実装する。

> 検証日 2026-05-30 / codex-cli 0.130.0 / macOS。実機で initialize→thread/start→turn/start→
> アプリ表示まで確認済み（ユーザー目視確認済み）。

## 確定した設計判断（壁打ち結果）

| 論点 | 決定 |
|---|---|
| Codexの役割 | 汎用タスク全般（調査・文章生成・コード・連絡下書き・予定等）。シェル/gws/Playwright をツールとして握らせる |
| 入口 | マインドマップのノード（`ideal_items`）から実行 |
| プロンプト内容 | ノードの `title` + `description`（詳細）+ 紐づくメモ本文（`memo_node_links`）+ 親/プロジェクト文脈 |
| 作業ディレクトリ | **ノードごとに必須指定**。未指定のノードは実行ボタンを押せない（UIで物理的に強制） |
| 会話の見え方 | ターン制 + 途中経過チラ見せ（progress） |
| 会話の正本 | **FocusMapに全ミラー**（`thread/turns/list` 等で取得しSupabaseへ）。往復UIもFocusMap自前。アプリにも出るのは副産物（dual surface） |
| スマホ操作 | FocusMapモバイルWebが主。純正Codexアプリ/スマホにも同じthreadが出るので併用可 |
| 投入経路 | **app-server WS JSON-RPC**（`codex exec` は不可＝アプリ非表示のため） |
| 安全（sandbox/approval） | `thread/start` で **per-thread に cwd と sandbox を指定**。普段の全開（`danger-full-access/never`）を継がない。詳細は「安全設計」 |

## アーキテクチャ

```
[FocusMap マインドマップ]  ノードの「Codexで実行」ボタン（dir未設定なら押下不可）
  ↓ プロンプト生成（title + description + 紐づくメモ + 文脈）
[Supabase]  ai_tasks(executor='codex_app') / codex_threads / codex_messages（Realtime購読）
  ↓ claim（FOCUSMAP_RUNNER_USER_ID で本人のみ）
[ローカルMac: task-runner / focusmap-agent]  ← ★codex_app 実行系を実装
  ws://127.0.0.1:7878 へ接続（app-server は launchd で常駐済み）
    initialize{clientInfo}                        … ハンドシェイク
    thread/start{cwd=ノードのdir, sandbox, approvalPolicy}  … thread生成（source='vscode'）
    turn/start{threadId, input:[{type:'text',text:prompt}]}  … プロンプト投入
    （往復）thread/resume → turn/start  /  追撃も turn/start{同threadId}
    （取得）thread/turns/list, thread/read で会話を回収 → codex_messages へミラー
  ↓ Realtime
[FocusMap チャットUI]  PC=デスクトップ / スマホ=同UIのモバイルWeb
[純正Codexアプリ / ペアリング済みスマホ]  同threadが source='vscode' で表示（副産物）
```

## 検証済み事実（再発見しないこと）

- app-server 常駐: `com.focusmap.codex-app-server.plist` → `scripts/run-codex-app-server.sh` →
  `codex app-server --listen ws://127.0.0.1:7878 --enable remote_control`（PID稼働確認済み）。
- アプリの正本DB: `~/.codex/state_5.sqlite` の `threads` テーブル（`session_index.jsonl`/rolloutは脇役）。
  一覧表示は `source` で選別: `source='vscode'` は表示、`source='exec'`/`'cli'` は非表示。
- モバイルペアリング: `state_5.sqlite` の `remote_control_enrollments` に `naonomac.local` 登録済み
  （`wss://chatgpt.com/backend-api/wham/remote/control/server`）。
- プロトコル: `codex app-server generate-ts --experimental --out <dir>` で型生成可。主要メソッド:
  `initialize` / `thread/start` / `turn/start` / `thread/resume` / `thread/turns/list` /
  `thread/read` / `turn/interrupt` / `turn/steer` / `thread/archive`。
  - `ClientInfo = {name, title, version}`（initialize時）。
  - `ThreadStartParams`: `cwd?`, `sandbox?`('read-only'|'workspace-write'|'danger-full-access'),
    `approvalPolicy?`('untrusted'|'on-failure'|'on-request'|'never'|{granular}),
    必須bool `experimentalRawEvents`, `persistExtendedHistory`。
  - `TurnStartParams`: `threadId`, `input: Array<UserInput>`, per-turnで `cwd?`/`sandboxPolicy?`/`approvalPolicy?` 上書き可。
  - `UserInput`: `{type:'text', text, text_elements:[]}` ほか image/skill/mention。
- 実証コード雛形: `/tmp/codex-relay-test/inject.mjs`（Node v24 内蔵WebSocketでWS JSON-RPC投入）。
  initialize→thread/start(sandbox=read-only)→turn/start で返答回収成功、`source='vscode'` 確認。
- `ai_tasks.executor` enum は既に `'claude' | 'codex' | 'codex_app'`（型: `src/types/database.ts`）。
- 既存流用資産: `scripts/task-runner.ts`（ai_tasks claim ループ）、
  `scripts/focusmap-agent/src/command-executor.ts`（spawn/cwd/timeout/`DANGEROUS_SHELL_PATTERN`）、
  `focusmap-side-projects/slack-codex-bot/src/codexRunner.ts`（`checkPromptSafety`＋危険パターン）。

## 実装対象ファイル（重要）

- [ ] 作成:
  - `scripts/codex-app-client.ts` — app-server WS JSON-RPC クライアント（initialize/thread.start/turn.start/resume/turns.list）
  - `supabase/migrations/2026XXXX_codex_relay.sql` — `codex_threads` / `codex_messages` テーブル + RLS + Realtime publication、`ideal_items.codex_work_dir` 列追加
  - `src/lib/codex/buildPrompt.ts` — ノード→プロンプト生成（テンプレ）
  - `src/app/api/codex/threads/route.ts` ほか — 投入・往復・取得API
- [ ] 変更:
  - `scripts/task-runner.ts` — `executor='codex_app'` の実行パス（claim→codex-app-client投入→codex_messagesミラー）
  - マインドマップノードUI（コンポーネント） — 「Codexで実行」ボタン + `codex_work_dir` 設定欄 + dir必須化
  - FocusMap チャットUI — codex_messages 表示 + 返信入力 + progress表示（モバイル対応確認）
  - `src/types/database.ts` — 新テーブル型

## 実装フェーズ

### Phase 0: スパイク確定（ほぼ完了）
- [x] app-serverヘッドレス投入の実機検証（source='vscode'・アプリ表示）
- [ ] スマホ（ChatGPTアプリ）表示の最終確認
- [ ] `thread/resume`＋`turn/start` で往復が app-server経由でも継続するか検証
- [ ] `workspace-write` で gws / Playwright が実際に呼べるか検証（汎用タスク成立性）

### Phase 1: バックエンド relay
- [ ] `codex-app-client.ts`（WSクライアント・再接続・タイムアウト・進捗イベント抽出）
- [ ] マイグレーション（codex_threads / codex_messages / ideal_items.codex_work_dir / RLS / Realtime）
- [ ] `task-runner.ts` に `codex_app` パス（claim→投入→threadId保存→turns.listミラー）

### Phase 2: フロント（投入＋一覧）
- [ ] ノードに dir 設定欄 + 「Codexで実行」ボタン（dir必須化）
- [ ] プロンプト生成 `buildPrompt.ts`

### Phase 3: 往復UI
- [ ] チャットUIで codex_messages 表示 + 返信→turn/start
- [ ] progress（チラ見せ）表示、モバイルWeb確認

### Phase 4: 安全・運用
- [ ] per-thread sandbox/approval の既定値とノード別上書き
- [ ] プロンプト規律（外部送信前は一度止まれ）の埋め込み
- [ ]（任意）第2層コードガード（gws send / git push / rm 検出で強制停止）
- [ ] timeout 設計（app-server経由は長尺対応）、experimental機能のバージョン固定

## 安全設計

- **全開を継がない**: relay の `thread/start` は既定 `sandbox='workspace-write'` + `approvalPolicy='on-request'`。
  ノードで明示エスカレーション時のみ `danger-full-access`。普段使いの `~/.codex/config.toml`（全開）とは
  per-thread 指定で隔離する（`-c` 上書きや専用 `CODEX_HOME`/permissions profile も検討）。
- **プロンプト規律（紙の盾）**: プロンプトに「不可逆・外部送信（メール送信・予定確定/削除・外部投稿・rm・git push）は
  実行前に一度確認を返す。読み取り・調査・下書きは確認不要」を明記。強制力はないため、本気の遮断は第2層に寄せる。
- **第2層コードガード（任意・強制力あり）**: 既存 `DANGEROUS_SHELL_PATTERN` / `checkPromptSafety` を流用。
- **claim制御**: `FOCUSMAP_RUNNER_USER_ID` で本人のタスクのみ実行。localhost binドのみ（外部公開しない）。

## 完了条件

- [ ] マインドマップのノード（dir設定済み）から「Codexで実行」で、app-server経由のthreadが立つ
- [ ] Codexの返答がFocusMapに表示され、FocusMap（PC/スマホ）から返信して往復できる
- [ ] 同threadが純正Codexアプリ/ペアリング済みスマホにも出る
- [ ] 外部送信系は実行前に確認が返る（規律 or 第2層）
- [ ] dir未設定ノードは実行不可

## リスク / 未確定

- app-server / remote-control は **experimental**。codex更新でプロトコル/挙動が変わり得る → バージョン固定 + 回帰テスト。
- `source='vscode'` は app-server の既定挙動。将来 clientName で source が変わる可能性（要追跡）。
- 全文ミラー（thread/turns/list）はアプリと二重管理になる。整合性（アプリ側で操作されたら？）の同期方針は別途。
- per-thread sandbox が gws/Playwright（ネット/プロセス）を阻害しないか要検証（Phase 0）。

## メモ

- 並行で `/deep-research`（execセッションをアプリに出す方法）実行中。完了したらバージョン安定性・公式見解の
  注意点を本書「リスク」へ追記する。ただし本方式（app-server経由）は実機で実証済みのため設計の前提は確定。
- スパイク資産: `/tmp/codex-relay-test/`（inject.mjs / proto/ TS型 / 各turn.jsonl）。本実装時に `scripts/` へ移植。
