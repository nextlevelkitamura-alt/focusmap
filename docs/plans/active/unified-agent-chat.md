---
status: active
category: feature
priority: high
created: 2026-05-29
updated: 2026-06-12
related: [focusmap-lite-mac-agent.md]
---

# 統合エージェントチャット (DeepSeek V4 Pro + Vercel AI SDK)

## 概要

現状「通常チャット(Gemini Flash-Lite)」と「自動化チャット(DeepSeek intent判定→ai_tasks)」が
`FocusmapChatMode` で完全分離している。これを **1つのチャット基盤・1つのモデル(DeepSeek V4 Pro)・
1つのエンドポイント** に統合する。2026-06-12時点のUI方針は、`チャット / 自動化` の2タブではなく **単一の全画面チャット** にする。予定整理・タスク化・調査などのショートカットは入力欄左の `+` メニューから同じチャットへプロンプト挿入し、Mac online/offline はヘッダーと入力欄上のステータスチップで常時表示する。

中核思想: **ツール対応モデルにツール群を渡せば、モデルがメッセージごとに「ただ答える/ツールを呼ぶ」を
自律判断する**。モード切り替え・intent分類・キーワードルーターは不要になり、「必要な時だけエージェントが動く」
が自然に実現する。脳はサーバー側(Vercel AI SDK `streamText` + `stopWhen`)に置き、Mac常駐エージェントは
「リモートツール実行器」として既存の24コマンドをそのまま使う(Mac側v1変更ゼロ)。

## 決定事項 (ユーザー確定)

- モデル: **DeepSeek V4 Pro**(全メッセージ共通。雑談もV4 Proを通る代償は許容)
- チャット: **通常/自動化を1つのチャット基盤に統合**。UIも単一チャットにし、専用の `自動化` タブ/チャットは出さない
- エージェント動作: 1チャット内で必要時のみツール実行(モデルが判断)
- 脳の置き場所: **サーバー側 (Vercel AI SDK)**

## 確定した設計判断 (grill 2026-05-29)

ライフサイクル・オフライン・通知まわりを設計ツリーで詰めた結果:

| # | 論点 | 決定 |
|---|------|------|
| Q1 | ホスト | **Mac mini と ラップトップ両方**サポート → オフラインは"例外"でなく"常態"扱い |
| Q2 | オフライン時の挙動 | **ハイブリッド**: オンライン=即同期実行 / オフライン=**予約実行**(ai_tasksにキュー) |
| Q3 | 予約タスクの頭脳 | **runnerオンライン化をトリガーにサーバーのエージェントループを無人再実行 + 承認先取り**。破壊的操作は予約時に承認、無ければ「承認待ち」で停止 |
| Q4 | 結果通知・予定化 | **ntfyで完了通知**(新規) + **予約タスク自体を「予定」としてカレンダー登録** + 完了で**チェックボックス**(既存の予定↔task done連携を流用) |
| Q5 | 事前警告 | **入力欄上に常時ステータスチップ**: 🟢接続中=即実行 / 🟡オフライン=予約になります / ⚪未導入=セットアップ。送信ボタン文言も動的変化 |
| Q6 | オンボーディング | **未導入でエージェント操作を頼まれたらチャット内にインラインのセットアップカード** + 接続自動検出。「コピー→貼る→Enter」の3アクション。以降はlaunchdで永久自動起動(手動ターミナル起動は不要) |
| Q7 | タスク中スリープ | heartbeat停止検知→実行中ツールgraceful timeout→**残りを予約に自動変換** + ntfy通知 |
| Q8 | スリープ抑止 | **タスク実行中だけ `caffeinate -i` でスリープ抑止のopt-in**(24時間ではなく実行中のみ。ラップトップ時は既定ON) |

### 重要な前提の訂正
- エージェント起動は **launchd 自動起動**(`RunAtLoad`+`KeepAlive`)。インストール後の手動ターミナル起動は**不要**。ユーザーがやるターミナル操作は「最初の1回 curl 貼り付け」だけ。
- 「未導入」と「導入済みだがオフライン」は別状態として区別して扱う(AgentStatusBadgeの totalCount==0 判定を流用)。

## 要件

- [ ] 1つのチャット画面で雑談もエージェント実行も両立する
- [ ] DeepSeek V4 Pro が tools を使ってマルチステップ実行できる(`stopWhen: stepCountIs`)
- [ ] サーバー直実行ツール(タスク追加/カレンダー/マインドマップ)が動く
- [ ] Mac必要ツール(terminal/browser/file)が agent_command 経由で動く
- [ ] Macオフライン時はツールが理由を返し、モデルがユーザーに伝える
- [ ] 破壊的ツール(terminal等)はUI承認を挟む
- [x] ツール呼び出しがUIに表示される。永続runでは `agent_chat_sessions.messages` のprogressメッセージをRealtime/pollで戻し、開きっぱなしでも復帰後でも進行ログを見せる
- [ ] 既存の通常/自動化分離コードを削除しても回帰しない

## 実装対象ファイル（重要）

- [ ] 作成するファイル:
  - `src/app/api/ai/agent/route.ts` — streamText + tools + stopWhen の統合エンドポイント
  - `src/lib/ai/remote-tools.ts` — Mac agent_command ブリッジ (resolveOnlineRunner / runRemoteCommand) と remote tool 群
  - `src/lib/ai/agent-tools.ts` — サーバー直実行 + リモートを束ねた ToolSet 組み立て
  - `src/components/chat/unified-chat.tsx` — useChat ベースの統合チャットUI
  - `src/components/chat/agent-status-chip.tsx` — 入力欄上の常時ステータスチップ(接続中/オフライン/未導入)
  - `src/components/chat/inline-setup-card.tsx` — チャット内インラインのMac接続カード + 自動検出
  - `src/lib/notify/ntfy.ts` — ntfy publish (タスク完了/中断/承認待ち通知)
  - `src/lib/ai/deferred-runner.ts` — runnerオンライン化トリガーで予約タスクをサーバー無人再実行
  - `src/app/api/ai/reserve/route.ts` — オフライン時にゴール+承認フラグを ai_tasks に予約登録
- [ ] 変更するファイル:
  - `src/lib/ai/providers/index.ts` — エージェント用にDeepSeek V4 Pro(Thinking ON)を返す関数を追加
  - `src/lib/ai/tools/index.ts` — `TOOL_ENABLED_SKILLS`(空Set)を撤廃 or 統合ToolSetに移行
  - [x] `src/app/dashboard/dashboard-client.tsx` — AiView/AutoChatView 分岐を統合ビューに置換
  - [x] `src/contexts/ViewContext.tsx` — 'ai'|'automation' を単一ビューへ
  - `src/components/mobile/bottom-nav.tsx` / `header.tsx` — タブ統合
  - `package.json` — `@ai-sdk/react` 追加(useChat用)
  - `scripts/focusmap-agent/src/command-loop.ts` — コマンドポーリング 5s→1-2s or Realtime push
- [ ] 削除するファイル:
  - `src/app/api/chat/send/route.ts`(自動化エンドポイント)
  - `src/lib/ai/intent-classifier.ts` / `src/lib/ai/router.ts`(intent判定不要)
  - `src/lib/chat-runtime.ts` の `FocusmapChatMode` 分離ロジック(統合後に整理)

## 実装フェーズ

### Phase 0: 死んだ配線の修正・前提整備 (低リスク・即効)
- [ ] `src/app/api/ai/chat/route.ts:761` `maxSteps: 5` → `stopWhen: stepCountIs(8)` (v6で死んでるバグ)
- [ ] `@ai-sdk/react` を devで追加し useChat が import できるか確認
- [ ] providers に `getAgentModel()`(DeepSeek V4 Pro, Thinking ON) を追加

### Phase 1: リモートツール・ブリッジ (中核)
- [ ] `resolveOnlineRunner(userId, spaceId)` — heartbeat 2分以内のrunner選択。無ければnull
- [ ] `runRemoteCommand(runnerId, type, args, timeoutMs)` — agent_command挿入 → Realtime購読で結果待ち(fallbackポーリング) → result/error返却
- [ ] remote tool 群を `tool()` で定義: runTerminal / browserNavigate / browserClick / browserFill / browserScreenshot / readFile / writeFile / webResearch
- [ ] Macオフライン時の graceful return

### Phase 2: 統合エージェントエンドポイント
- [ ] `/api/ai/agent/route.ts`: `streamText({ model: getAgentModel(), system, messages: convertToModelMessages(messages), tools, stopWhen: stepCountIs(12) })`
- [ ] `.toUIMessageStreamResponse()` で返す
- [ ] system prompt: 「雑談は普通に答え、実行が必要な時だけツールを使う」方針を明記
- [ ] 既存サーバー直ツール(addTask/addCalendarEvent/mindmap系)を統合ToolSetに接続

### Phase 3: 統合チャットUI
- [ ] `unified-chat.tsx`: `useChat({ api: '/api/ai/agent' })`
- [x] 永続runのtool lifecycleをprogressメッセージとしてDB保存し、UIで「予定確認中…」「マップ全体確認完了」のようなログ行として表示する
- [x] dashboard / nav から 通常・自動化の重い分離を廃止し、単一チャットUIへ統合
- [ ] mode別state/localStorage を単一化

### Phase 4: ガードレール
- [ ] `runTerminal` は通常コマンドを承認なしで実行し、削除・sudo・git push等はMac側でブロックする。`writeFile` / `file_delete` など破壊的I/Oは v6 tool approval(`needsApproval`) → UI承認
- [ ] Cloud Run timeout 600s。`stepCountIs` + ツール個別timeoutで上限
- [ ] コマンドポーリング間隔短縮 or Realtime push (Phase F bottleneck解消)
- [ ] scheduleTask ツール(recurrence_cron/scheduled_at で ai_tasks 登録) — 「毎朝〜」系を吸収

### Phase 5: オフライン・予約実行・通知 (grill決定の中核)
- [ ] `agent-status-chip.tsx`: 5秒ポーリングで接続中/オフライン/未導入を判定し入力欄上に常時表示。送信ボタン文言を動的変化(「送信」/「予約して送信」)
- [ ] オフライン送信 → `/api/ai/reserve` でゴール+会話context+承認フラグを ai_tasks に予約登録
- [ ] `deferred-runner.ts`: runnerオンライン化(heartbeat受信)をトリガーに予約タスクのサーバーエージェントループを無人再実行。破壊的操作は承認フラグ必須、無ければ承認待ちで停止
- [ ] 予約タスクを「予定」としてカレンダー登録(scheduled_at) + 完了でチェックボックスtoggle(既存 calendar-event-card の onToggleTask/isDone を流用)
- [ ] `ntfy.ts`: タスク完了/中断/承認待ちを ntfy publish。結果は同じチャットスレッドにRealtimeで後から注入
- [ ] Q7: 実行中にheartbeat停止検知 → ツールgraceful timeout → 残タスクを予約に自動変換 + ntfy通知
- [ ] Q8: Mac側で実行中のみ `caffeinate -i` ラップのopt-in(ラップトップ既定ON)

### Phase 6: オンボーディング (初心者導線)
- [ ] `inline-setup-card.tsx`: 未導入(totalCount==0)でエージェント操作を頼まれたらチャット内にcurlコマンド+コピーボタンを表示
- [ ] 接続自動検出: ポーリングで runner 登録を検知 → 「接続できました」→ そのまま元の指示を続行
- [ ] 「未導入」と「導入済みオフライン」で出し分け(未導入=セットアップ / オフライン=予約案内)

### Phase 7: 旧分離コードの撤去
- [ ] /api/chat/send, intent-classifier, router 削除
- [ ] FocusmapChatMode 撤去・chat-runtime 整理
- [ ] 回帰確認(雑談/単発実行/マルチステップ/スケジュール/オフライン)

## 完了条件

- [ ] 1画面のチャットで「予定教えて(返答)」「求人巡回して記録(マルチステップ実行)」「毎朝まとめて(スケジュール)」が全て成立
- [ ] ツール呼び出しがUIにストリーミング表示される
- [ ] 入力欄上の常時チップで 接続中/オフライン/未導入 が一目でわかり、送信ボタン文言も連動する
- [ ] オフライン時に送信 → 予約登録され、Macが起きたら無人で実行される
- [ ] 予約タスクがカレンダーに「予定」として出て、完了でチェックが付く
- [ ] 予約/中断/完了が ntfy で通知され、結果が同じチャットに後から差し込まれる
- [ ] 実行中に蓋を閉じても残りが予約に自動変換される
- [ ] 未導入の初心者がチャット内カードの3アクション(コピー→貼る→Enter)で接続でき、自動検出で続行される
- [ ] 破壊的操作で承認ダイアログが出る(予約は承認先取り)
- [ ] 旧 通常/自動化 分離コードが残っていない

## メモ・リスク

- **DeepSeekのツール信頼性**: Claude/GPTより複雑ループの実績が薄い。inputSchema厳格化 + stopWhen上限 + 失敗時リトライで吸収。実機で空回り頻度を観測する。
- **Thinking ON判断**: intent判定はThinking OFFだったが、マルチステップ計画にはThinking推奨。要チューニング。
- **全メッセージV4 Pro**: 雑談もV4 Proのレイテンシ/コスト。ユーザー確定の代償。後でFlash-Lite受け→V4Pro昇格のhybridも検討余地(ただしrouting復活なので当面しない)。
- **5sポーリング**: 1ツール=最大5s待ち。12ステップで累積1分の死に時間。Phase 4で必須改修。
- **Mac側変更あり**: `cwd` 反映、フォルダ権限/Google Drive検出、OpenCode等ハーネス検出のため `focusmap-agent` 側も更新する。既存 `agent_commands` 種別は増やさず、`run_shell` / `file_list` を拡張利用する。
