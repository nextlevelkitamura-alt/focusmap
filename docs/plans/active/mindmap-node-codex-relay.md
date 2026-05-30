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

### Phase 0: スパイク確定（完了）
- [x] app-serverヘッドレス投入の実機検証（source='vscode'・アプリ表示・ユーザー目視確認済み）
- [x] `thread/resume`＋`turn/start` で往復が app-server経由でも継続（合言葉を想起・確認済み）
- [x] `workspace-write` でツール検証: gws実行OK・$HOME読み取りOK / ただし**ネットワークは既定で遮断**
- [x] **`config:{sandbox_workspace_write:{network_access:true}}` を per-thread で渡すとネット許可（HTTP:200）** ← スイートスポット
- [ ] スマホ（ChatGPTアプリ）表示の最終確認（PC表示は確認済み）
- [ ] gws の実ネットワーク呼び出し（例: `gws calendar list`）が network_access=true で通るか（実データ最小確認）

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

- **全開を継がない（実証済みの推奨モード）**: relay の `thread/start` は既定で
  `sandbox='workspace-write'` + `config:{sandbox_workspace_write:{network_access:true}}` + `approvalPolicy='on-request'`。
  → **書き込みはノードのcwd内に限定したまま、gws/Playwright/Web調査に必要なネットワークだけ許可**できる（HTTP:200実証）。
  普段使いの `~/.codex/config.toml`（`danger-full-access/never` 全開）は per-thread指定で**継がない**。
  ノードで真に必要なときだけ `danger-full-access` にエスカレーション。
  - 検証事実: `workspace-write` 単体は gws実行・$HOME読みは可だが**ネット遮断**。network_accessで解禁。
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

## ディープリサーチ統合（2026-05-30）

OpenAI公式doc・GitHub issue・コミュニティを横断調査し、敵対的検証（25主張中14採用/11却下）した結果。

**(1) 我々の方針と一致する点（採用）:**
- スレッド一覧の正本は `state_5.sqlite`（threadsテーブル）。`session_index.jsonl` は0.13xでは陳腐化＝索引いじりは当てにならない。我々の実機所見と一致。
  出典: [#24730](https://github.com/openai/codex/issues/24730), [#19517](https://github.com/openai/codex/issues/19517), [#21196](https://github.com/openai/codex/issues/21196), [app-server doc](https://developers.openai.com/codex/app-server)
- `codex exec`（source=Exec）はアプリ一覧から **by design で除外**（OpenAI collaborator明言, [#14544](https://github.com/openai/codex/issues/14544)）。
  → **execを使わず app-server 経由にする**のが公式にも推奨される唯一筋。リサーチの推奨[A]＝我々が実証した方式と同一。
- 「app-serverのthreads/listはexecをsourceKindsで出せる」仮説は**反証（0-3）**。execを出す公式手段は無い。我々がexecを捨てた判断は正しい。

**(2) 新たに判明した重大な但し書き（モバイル）:**
- **モバイルのリモート会話一覧は `state_5.sqlite` に在るだけでは出ない。** バックエンド(WHAM)経由で、現状 **Desktopアプリが作ったスレッドしか確実に出ない**。
  CLI起動/モバイル起動/SSHリモート由来は**モバイルに出ず再開できない**（OPEN bug）。
  出典: [#23351](https://github.com/openai/codex/issues/23351)(2026-05-18 OPEN), [#24730](https://github.com/openai/codex/issues/24730)
- 含意: **app-server経由で注入した我々のthreadも、純正Codexアプリの「スマホ」には出ない可能性が高い**（PCデスクトップアプリには出る＝実証済み）。
- ★**ただし本環境では実際にスマホにも出た（ユーザー確認, 2026-05-30）**。`codex app-server --enable remote_control` 常駐＋`remote_control_enrollments`登録済みの構成のため、注入threadもWHAM登録されスマホ伝播したと推定。
  リサーチの否定的所見を本環境では上回る。**ただし公式は未解決バグ領域・1回の観測のため「保証された機能」とは扱わず、要再現確認**。頼り先はFocusMapモバイルWeb（確実）、純正スマホは現状おまけ。

**(3) この設計への影響＝小さい（重要）:**
- 本設計は **「FocusMap全ミラー＋往復UI自前」** を採用済み。**スマホ操作はFocusMapモバイルWebで行う**ため、純正アプリのモバイル可視性に依存しない。
- → リサーチの否定的所見（純正スマホに出ない）は **ユーザーのゴールをブロックしない**。純正アプリ/スマホ表示は「出れば嬉しいボーナス」に格下げ。
- ⚠️ ただし「FocusMapからではなく純正Codexアプリのスマホで直接操作したい」場合は **現状不可**（公式の未解決バグ）。ここは曖昧にしない。

**(4) バージョン安定性リスク:**
- app-server / remote-control / TUI移行は **experimental・流動的**。collaboratorは「TUIをapp-server上へ移行中」「execをthreads/listに出すかは未解決の論点」と発言＝将来仕様変更あり。バージョン固定＋回帰テスト必須。
- `state_5.sqlite` の手動編集（sourceを偽装等）は **DB破損・ホストoffline化の実例あり＝禁止**（[#24730](https://github.com/openai/codex/issues/24730), 推定confidence medium）。

## 実装ログ（2026-05-30, branch: feature/codex-node-relay）

**重要な発見**: バックエンド実行系は既に完成していた。ゼロから作らず再利用した。
- 既存（動作・流用）: `scripts/codex-rpc-bridge.ts`（app-server WS: initialize→thread/start→turn/start、承認ログ、結果書き戻し）、
  `scripts/run-codex-app-server.sh`＋plist（app-server常駐）、`scripts/task-runner.ts`（codex_app dispatch・`launchCodexRemote`・`buildPromptWithMemo`・`syncCodexAppThreads`）、
  `src/components/wishlist/wishlist-view.tsx` の `launchAiForMemo(item,'codex_app')`（メモ→codex_app の既存UI）。
- 真の差分＝「マインドマップのノード(task)起点」だけ。これを実装した。

**今回の実装（Phase 1+2 相当・ノード起点の最小スライス）:**
- [x] `supabase/migrations/20260530120000_task_codex_work_dir.sql` — `tasks.codex_work_dir` 追加（⚠️ **DB未適用。`supabase db push` 等で適用が必要**）
- [x] `src/types/database.ts` — tasks Row/Insert/Update に `codex_work_dir`、楽観更新リテラル3ファイルに `codex_work_dir: null` 補完
- [x] `src/components/mindmap/custom-mind-map-view.tsx` — memo ノードに「Codex」ボタン（`onRunCodex`）配線
- [x] `src/components/dashboard/mind-map.tsx` — `handleRunCodex`: dir必須（未設定は `window.prompt` で入力→`tasks.codex_work_dir` に保存）→ プロンプト=「title + memo」→ `POST /api/ai-tasks/schedule {executor:'codex_app', cwd}` → 既存パイプラインで app-server 実行
- [x] tsc --noEmit: 0 error / 変更ファイルの新規lintエラー無し

**設計決定の差分（実装時）:**
- dir必須ガードは「ボタンを押せなくする」ではなく **クリック時に未設定なら入力を促す**方式（モデル全層へ work_dir を通す大改修を避けた。実行不可は担保）。
- 会話の正本＝「FocusMap全ミラー＋往復UI自前」は**未着手**（次フェーズ）。現状は既存の ai_tasks.result(steps/live_log) 経由で結果表示。往復(resume)も bridge 未対応。

**往復（resume）実装（2026-05-30 追加）:**
- [x] migration を本番DBへ適用（Management API で `tasks.codex_work_dir` / `ai_tasks.codex_resume_thread_id` を冪等追加。`db push`は未同期migration14個を巻き込むため不使用）
- [x] **会話の正本は新テーブルを作らず ai_tasks を再利用**（同一 `codex_thread_id` のターン列＝会話）。当初案の codex_threads/codex_messages は不要と判断
- [x] bridge: 第5引数 `resumeThreadId` で `thread/resume`→`turn/start`（未指定は従来の `thread/start`）
- [x] task-runner: `task.codex_resume_thread_id` を bridge へ受け渡し（launchCodexRemote）
- [x] schedule API: `codex_resume_thread_id` を受理して ai_task に保存
- [x] ノードボタンを executor='codex'（bridge・返信を ai_tasks.result に回収）に変更＝FocusMapで往復可能に
- [x] 往復UI: 「AI実行」タイムライン(`ai-execution-timeline.tsx`)の codex ターンに「続けて送る」入力を追加 → resume タスク生成
- [x] tsc 0 error / scripts は esbuild bundle 成功

**残タスク（次フェーズ）:**
- [ ] 実機E2E: ノードのCodexボタン→アプリ/スマホにスレッド表示→タイムラインで返信→継続
- [ ] dir未設定時の入力UIを `window.prompt` から専用ダイアログへ
- [ ] 「外部送信前は一度止まれ」規律をプロンプトに注入（task-runnerの`buildPromptWithMemo`周辺）
- [ ] タイムラインの往復表示を「同一threadのターンをグルーピング」して会話らしく（現状はタスク並び）

## メモ

- スパイク資産: `/tmp/codex-relay-test/`（inject.mjs / spike.mjs / netcheck.mjs / archive.mjs / proto/ TS型）。本実装時に `scripts/` へ移植。
- 全文リサーチ出力: セッションの workflow task `wp4hnpq0p` 結果（22ソース/102主張）。
