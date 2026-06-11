# Task Board

Last updated: 2026-06-11

task-router の現在地を示す軽量ボード。詳細は各 Plan を正とし、このファイルは見出し・状態・リンク・次アクションを一覧する。

## Active

| ID | Status | Task | Plan | Scope | Owner/Chat | Branch | Next | Updated |
|---|---|---|---|---|---|---|---|---|
| TASK-20260607-004 | in_progress | Codex/Macローカル連携の一本化計画 | [plan](plans/active/20260607-codex-mac-agent-unification.md) | Mac app / focusmap-agent / Codex monitoring / task-progress UI | task-router parent chat | main | 設定画面は `AI` としてMacエージェントheartbeat中心に簡素化済み。次はUI read-only pollingとsync-node fallback範囲の縮小を分割実装 | 2026-06-09 |

## Waiting / Blocked

| ID | Status | Task | Plan | Blocker | Needed Decision | Updated |
|---|---|---|---|---|---|---|

## Recently Completed

直近の完了だけ最大5件。月別の正本は `docs/ai/task-archive/YYYY/MM.md`。

| ID | Completed | Task | Plan | Result |
|---|---|---|---|---|
| TASK-20260611-006 | 2026-06-11 | メモカード選択を左編集パネルへ統合 | - | デスクトップ通常メモ画面でカード選択時に右サイドバーではなく左の追加パネルを `メモを編集` として再利用するようにした。画像セクション直後に白黒の `Codexに送る` を置き、Codex状態とactivity履歴は左パネル内の折りたたみ `Codexチャット` に収める。保存ボタンは下部固定の黄緑系にし、既存メモのPATCHと画像保存後のCodex起動を同じパネル内で扱う |
| TASK-20260611-005 | 2026-06-11 | メモ詳細の右サイドバー化とCodex送信配置調整 | - | 選択したメモの編集画面をデスクトップでは中央モーダルではなく右サイドバーで開くようにし、1カラムで `見出し / メモ詳細 / 画像 / Codex / 時間・予定 / タグ` の順に整理した。Codex送信欄は写真の直後、時間設定より前に固定し、既存の画像コピー/手動handoff導線を維持した |
| TASK-20260611-004 | 2026-06-11 | スマホメモ画面の3列化と詳細アイコン配置調整 | - | スマホ通常メモ画面を `メモ` / `今日` / `完了` の3切替へ整理し、左上の重複見出しを外してスペース/プロジェクト切替を左詰めにした。入力バーの＋は音声ボタンと同じ四角outlineにし、メモ詳細ではスマホ時だけ本文枠下部へキラキラと音声アイコンを隣接配置。画像はスマホで `写真を選択` だけを表示し、所要時間プリセットは再タップで未設定へ戻る |
| TASK-20260611-003 | 2026-06-11 | デスクトップメモ追加パネルの初期非表示と本文フォーカス | - | デスクトップ通常メモ画面は初期状態で左追加パネルを開かず、`メモ` / `今日` の＋から開いた時に本文欄へフォーカスするようにした。左パネルが閉じていてもD&D失敗などの操作エラーがボード上部に表示される |
| TASK-20260611-002 | 2026-06-11 | デスクトップメモ左パネルの閉じる挙動とメモ列表示調整 | - | 左追加パネルの×を入力クリアではなくパネル閉じる挙動へ戻し、レーンの＋で再表示するようにした。デスクトップ通常看板の `未予定` 表示名を `メモ` に変更し、左パネル表示中はメモ列2列、閉じた時は3列表示へ切り替える |
| TASK-20260611-001 | 2026-06-11 | デスクトップメモ追加パネルの保存ボタン常時表示と看板幅調整 | - | 左追加パネルを常時フォーム表示にし、×は入力クリアだけに変更。保存ボタンが消えないようにした。未予定は最大3列カード表示、今日/完了は最低幅を広げ、完了レーンの＋は削除。画像添付は既存共通圧縮関数を通ってから添付APIへ送られることをテストで固定 |
| TASK-20260610-012 | 2026-06-10 | メモ画面の左追加パネル＋3レーン看板化 | - | デスクトップ通常メモ画面を、左の追加パネルと `未予定` / `今日` / `完了` の3レーン看板へ変更した。左パネルでは見出し・本文・所要時間・クリップボード/フォルダ画像を入力し、保存後に既存添付APIへ画像アップロードする。カードは既存 `WishlistCard` を使い、完了チェックと既存DB状態を維持する |
| TASK-20260610-011 | 2026-06-10 | Codex.app起点の未紐付けthread取り込み | [plan](plans/archive/2026/06/20260610-codex-orphan-thread-inbox.md) | Mac agentがCodex.app側で直接開始された未登録threadを検出し、`Codex Inbox` グループ配下のマップノードと `ai_tasks` へ冪等に取り込むようにした。既存manual handoff taskの同期を先に試すため、FocusmapからCodexへ送る導線は維持される |
| TASK-20260610-010 | 2026-06-10 | Codex看板内のスペース/プロジェクト切替と未送信実行導線 | - | 看板の初期表示は現在マップのまま、看板内だけでスペース/プロジェクトを切り替え、選択プロジェクトの全マップノードを未送信カードとして表示してCodex実行を開けるようにした |
| TASK-20260610-009 | 2026-06-10 | Codex看板を現在マップの操作可能カードだけに整理 | - | source不明/削除済みノード由来の古いCodexカードを看板から除外し、元ノードが残るカードのチェック/削除をAPI完了前に即時反映するようにした |
| TASK-20260610-008 | 2026-06-10 | スマホCodex看板カード操作の紐付け補完 | - | Turso snapshotに `source_type/source_id` が欠ける場合でも、同じ `ai_task.id` が現在ノードの `/api/ai-tasks?source=linked` 紐付けに残っていれば看板表示前に補完し、スマホ看板でもチェックボックスと削除ボタンを出せるようにした |
| TASK-20260610-007 | 2026-06-10 | マップノード予定化の追加先カレンダー選択 | [plan](plans/archive/2026/06/20260610-node-calendar-target-select.md) | 右ペインDayカレンダーの右上に書き込み可能カレンダーの追加先プルダウンを追加し、マップノードdrop時の `calendar_id` はこの選択値を優先する。選択済みカレンダーが候補から外れた場合は既定の書き込み可能カレンダーへ戻す |
| TASK-20260610-006 | 2026-06-10 | マップノードのカレンダーD&D予定化 | [plan](plans/archive/2026/06/20260610-node-calendar-dnd.md) | 自作マップの単一ノードを右ペインDayカレンダーへドラッグすると、予定カードUIのpreview/overlayへ切り替わり、dropで既存タスク更新へ載せる。drop/同期/表示の重複ガードで2つ3つ予定が並ぶ状態を抑制し、D&D中は端だけ低速で当日内オートスクロールする |
| TASK-20260610-005 | 2026-06-10 | チェック済みマップノードの下寄せと完了済みバッジ | - | ノードチェック時に同じ親配下の完了済みノードを下へ表示し、右上Codexバッジもチェック済みなら即時 `完了済み` にする。チェック操作は `Cmd+Z` / `Ctrl+Z` で戻せ、undo/redo時も紐づくCodex task-progress状態を同期する |
| TASK-20260610-003 | 2026-06-10 | Codex看板の高さ調整とカード完了/削除操作 | [plan](plans/archive/2026/06/20260610-codex-kanban-resize-card-actions.md) | デスクトップ看板を上端ドラッグで広げられるようにし、看板カードから元ノードの完了チェック・削除を実行できるようにした |
| TASK-20260610-002 | 2026-06-10 | ノードチェック10秒後のCodex threadアーカイブ要求 | [plan](plans/archive/2026/06/20260610-codex-node-check-archive-request.md) | ノードチェック直後は10秒猶予にし、維持された場合だけ `ai_tasks.result` にpending archive requestを保存。Mac agentがpending requestを拾ってローカルCodex app-serverへ `thread/archive` を送り、解除済み/キャンセル済みは対象外にする |
| TASK-20260610-001 | 2026-06-10 | Codex看板のモバイル横切替と削除済みノード除外 | - | モバイルCodex看板をステータスチップの横スクロール/横スワイプでレーン切替する表示へ変更。`source_type='mindmap'` のsnapshotは現在のマップ `groups/tasks` に残る `source_id` だけ表示し、削除済みノード由来の古いCodex taskを除外 |
| TASK-20260609-012 | 2026-06-10 | Codex完了チェックと完了済み表示 | [plan](plans/archive/2026/06/20260609-codex-complete-checkbox-status.md) | チェック済みCodex taskを `完了済み` 表示へ変更し、チェック解除時は `確認待ち` へ戻す。Codex実行完了だけでは確認待ちに留め、アーカイブ済みthreadだけ元ノードをチェック済みにする |
| TASK-20260609-011 | 2026-06-09 | Codex画像handoffの2段階化 | [plan](plans/archive/2026/06/20260609-codex-two-step-image-handoff.md) | 初回Codex起動はpromptだけをコピー/起動し、保存済み画像はメモ詳細・ノード詳細の画像コピーアイコンから同じCodex入力欄へ2段階目として貼り付ける仕様へ変更。Mac Electron bridge、ローカルAPI、iOS bridge、ブラウザfallbackの画像単体コピーを追加し、prompt-onlyとimage-onlyのMac pasteboard読み返しを確認 |
| TASK-20260609-010 | 2026-06-09 | 画像登録とCodex画像clipboard検証 | - | メモ編集シート全体でCmd/Ctrl+V画像貼り付けを拾い、画像登録導線を補強。CodexローカルAPI/Electron bridgeはテキストと画像をclipboardへ書いた後に読み返し、画像コピー結果を返す。ローカル3001 APIで `copied_to_clipboard=true` / `copied_image_to_clipboard=true`、`pbpaste` の日本語prompt、pasteboard `public.png` を確認 |
| TASK-20260609-009 | 2026-06-09 | 長文ノード見出し生成の待ち時間UX改善 | - | Sparkles押下直後に長文をメモ化して1行目由来の仮見出しを即時保存し、AI見出しは後続で上書きする流れへ変更。生成中は短いノードにも右下spinnerを残し、3行以上ノードはボタン用余白を確保。過去の半端な生成タイトル再生成では既存メモ本文をAI入力の正にする |
| TASK-20260609-008 | 2026-06-09 | 長文マップノードのメモ化とAI見出し生成 | - | 自作マップで表示上3行以上のタスクノード右下にSparklesボタンを追加。押すとタイトル全文をメモ本文へ保存し、既存メモは空行区切りで保持しつつ、同じ本文からAI見出しを生成してノードタイトルへ反映する。デスクトップ/モバイル共通UIとデータフロー、回帰テストを追加 |
| TASK-20260609-007 | 2026-06-09 | Mac agent依存同梱とTurso heartbeat復旧 | [parent plan](plans/active/20260607-codex-mac-agent-unification.md) | packaged `Focusmap.app` の `focusmap-agent` がruntime依存不足で落ちていた原因を修正。`mac:prepare-agent` で依存とbuildを必ず準備し、runner heartbeatは状態変化即時upsertと正常終了offline送信に対応。現行 `/Applications/Focusmap.app` へagent依存も反映し、Turso heartbeatでMac agent onlineを確認。Macアプリ内Codex導線は今後もmanual handoff固定 |
| TASK-20260609-006 | 2026-06-09 | AI設定画面のMacエージェント中心化 | [parent plan](plans/active/20260607-codex-mac-agent-unification.md) | 設定サイドバー/ページ名を `AI` に変更。通常表示を `/api/task-progress/runner-heartbeats` のMacエージェントheartbeat正本にし、オンライン/オフライン、最終更新、巡回状態、Codex連携だけへ簡素化。旧task-runner、Playwright/GWS説明、重複runner一覧は通常UIから外した |
| TASK-20260609-005 | 2026-06-09 | Mac/Codex接続カードのCodex Desktop未導入導線追加 | [parent plan](plans/active/20260607-codex-mac-agent-unification.md) | Focusmap Macアプリが `/Applications/Codex.app` を確認し、未導入なら `codex app` でCodex Desktopインストーラーを開く。CLIも無い場合は既定ブラウザーでOpenAI Codexページを開く。設定 > 自動化にも `要インストール` と `Codexを入れる` ボタンを追加した |
| TASK-20260609-004 | 2026-06-09 | マップ右上操作とノード選択案内の整理 | - | デスクトップマップ右上は設定ボタンだけを残し、Codex snapshot更新ボタンと全画面拡大/縮小ボタンを削除。ノード選択時に下部へ出るキーボードショートカット案内を非表示にした。完了時にArcでローカルdashboardを開く運用もAGENTS.mdへ追記した |
| TASK-20260609-003 | 2026-06-09 | メモ編集シートの予定入力UI改善 | [plan](plans/archive/2026/06/20260609-memo-schedule-editor.md) | PC版メモ編集は左をメモ詳細、右を画像・時間予定へ寄せた。カレンダーはGoogle連携済みカレンダーのプルダウンにし、日時・所要時間・カレンダーが揃った時だけ予定登録/更新できる。所要時間のカスタムは時間/分ホイールにし、解除は独立ボタン化した |
| TASK-20260609-002 | 2026-06-09 | MacアプリFocusmapログインのローカル保存復元強化 | - | MacアプリのGoogle外部ブラウザログイン完了時、既存の `/api/auth/desktop-session` ポーリングに加えて `focusmap://auth-complete` deep linkでセッションを直接受け取り、pending nonce一致時だけ `auth-session.json` へ保存するようにした。全ページの `DesktopAuthSessionBridge` がダッシュボード表示後の既存セッション/トークン更新もローカル保存へ同期し、明示ログアウト時は保存セッションも削除する |
