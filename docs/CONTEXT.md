# しかみか (Shikumika) - プロジェクト全体像

> このファイルは /next で自動更新されます

## 目的
マインドマップとタスク管理を統合し、Google カレンダーと連携した統合的なプロダクティビティアプリ

## 現在の状況
Phase 1: Googleカレンダー完全連携（MVP）- 開発中
コード規模: 約15,000行 / 100ファイル（中規模）

---

## ダッシュボード構成（3ペイン）

### 📍 左サイドバー (`LeftSidebar`)
**ファイル**: `src/components/dashboard/left-sidebar.tsx` (118行)

**機能:**
- **Goals（目標）選択** - 目標の一覧表示・選択
- **Projects（プロジェクト）選択** - プロジェクトの階層表示・選択
- 選択したプロジェクトに応じて、中央ペイン・右ペインの内容が変化

**データフロー:**
```
Goals → Projects → TaskGroups → Tasks
```

---

### 📍 中央ペイン (`CenterPane`)
**ファイル**:
- `src/components/dashboard/center-pane.tsx` (1,147行)
- `src/components/dashboard/mind-map.tsx` (2,266行)

**2つのビューモード:**

#### 1. マインドマップビュー（上半分）
**コンポーネント**: `MindMap`
- ReactFlow によるノードベースのマインドマップ表示
- Dagre アルゴリズムで自動レイアウト計算
- ノード種類: Project / TaskGroup / Task
- ノードの色分け・優先度・進捗表示
- ドラッグ操作による並び替え
- 高さ調整可能（スプリッタ）

**主な操作:**
- グループ/タスクの作成・編集・削除
- ノードのドラッグで並び替え
- ノードをクリックで詳細表示

#### 2. リストビュー（下半分）
**コンポーネント**: `CenterPane`
- タスクグループの折りたたみ表示
- ツリー形式でタスクの親子関係を表示（最大6階層）
- ドラッグ&ドロップでグループ内・グループ間のタスク移動
- インラインエディタ（タイトル直接編集）
- タイマー機能（Focusボタン、一時停止、完了）
- 優先度バッジ（高/中/低）
- 見積もり時間設定（手動/自動集計）
- スケジュール日時設定
- Google Calendar 同期ステータス表示

**主な操作:**
- タスクの新規作成（自動フォーカス）
- タイトル編集（Enterで確定）
- チェックボックスで完了/未完了
- タイマー開始/停止/完了
- カレンダー選択・同期

---

### 📍 右サイドバー (`RightSidebar`)
**ファイル**:
- `src/components/dashboard/right-sidebar.tsx` (90行)
- `src/components/dashboard/sidebar-calendar.tsx` (160行)
- `src/components/calendar/*.tsx` (11ファイル, 1,867行)

**機能:**
- **Google Calendar 連携**
  - カレンダーの表示/非表示切り替え
  - 複数カレンダー対応
  - イベント同期
  - 空き時間検索

**4つのビューモード:**
1. **月ビュー** (`CalendarMonthView`) - 月間カレンダー表示
2. **週ビュー** (`CalendarWeekView`) - 7日間のグリッド表示
3. **3日ビュー** (`Calendar3DayView`) - コンパクト表示用
4. **日ビュー** (`CalendarDayView`) - 1日の時間軸詳細表示

**カレンダー機能:**
- Google Calendar イベント表示
- スケジュール済みタスク表示
- ドラッグ&ドロップで時間変更
- タスクをカレンダーにドロップしてスケジュール設定
- ミニカレンダー（月選択）
- カレンダー選択（複数カレンダーの表示/非表示）

---

## 各ペインの連携

```
左サイドバー                中央ペイン                    右サイドバー
┌──────────┐              ┌──────────┐              ┌──────────┐
│ Goals    │──選択──────→│ MindMap  │              │ Calendar  │
│          │              │          │──ドラッグ──→│          │
│Projects  │──選択──────→│ TaskList │              │ Events   │
└──────────┘              └──────────┘              └──────────┘
```

**データフロー:**
1. 左ペインでプロジェクトを選択
2. 中央ペインに該当するタスクグループ・タスクが表示
3. 中央ペインのタスクを右ペインのカレンダーにドラッグしてスケジュール
4. 右ペインでタスクの時間を変更すると、中央ペインのタスクにも反映

---

## 主要な Hooks

| Hook | 用途 | 使用箇所 |
|------|------|----------|
| `useMindMapSync` | Supabase CRUD・同期 | dashboard-client.tsx |
| `useTaskCalendarSync` | タスク⇄Google Calendar同期 | center-pane.tsx |
| `useCalendarEvents` | Calendarイベント取得・ローカル/DBキャッシュ先出し | sidebar-calendar.tsx |
| `useCalendars` | ユーザーカレンダー一覧・選択管理 | calendar-selector.tsx |
| `useTimer` | タスクタイマー | center-pane.tsx |
| `useMemoAiTasks` | マインドマップ/メモ起点の最新 `ai_tasks` 状態を取得し、Codex状態バッジへ反映 | mind-map.tsx / mindmap-linked-memos-dialog.tsx |

---

## 現在の主要仕様

このセクションは、チャット履歴がなくても実装意図を復元できるようにするための現行仕様メモ。主要なUI・同期方式・データフローを変えた場合は、実装と同じコミットで更新する。

### AIエージェント並列作業ポリシー

- 複数チャット・readonlyサブエージェント・Git worktree を使うか迷う依頼は、`task-router` Skill を入口にする。詳細な判断基準、worktree安全策、各チャット用プロンプト雛形は `task-router` の workflows を正とする。
- task-router の進捗管理は `docs/ai/task-board.md` を現在地の正本にする。task-router が新規に作る計画は `docs/ai/plans/active/`、完了タスクは `docs/ai/task-archive/YYYY/MM.md`、完了計画は `docs/ai/plans/archive/YYYY/MM/` に月別で格納する。
- 並列化判断はタスク量・見積時間だけで行わず、同じファイルを触る可能性、UI/backend等の責務分離、API contract / DB schema / shared types / auth / error format の未確定、generated files / lockfile / migration の衝突、統合コスト、失敗worktreeを破棄できるかを見て提案する。
- UI と backend を並列で進める場合は、まず Planner が `API_CONTRACT.md` / `UI_ACCEPTANCE.md` / `TEST_PLAN.md` / `OWNERSHIP.md` 相当を作り、Frontend / Backend / Integration / Review に分ける。worktree は統括側が branch/status/uncommitted changes/base/責務/allowed files/merge順を確認してから提案し、force push、`git reset --hard`、`git clean -fd`、本番DB操作、secret/token表示編集、GCP/GCS削除停止、未承認の大規模削除、意図しないlockfile更新、unrelated refactorは禁止する。

### ダッシュボードナビゲーション

- デスクトップ上部タブとモバイル下部ナビの通常導線は `Todo` / `メモ` / `マップ` / `チャット` / `設定` を基本にする。`マップ` は通常タブとして残し、メモ由来の `マップ追加済み` 判定も裏側に残す。
- モバイル下部ナビは `Todo` / `メモ` / `マップ` / `チャット` / `設定` の5項目にし、`チャット` を強調表示の対象にする。
- モバイル下部ナビとデスクトップヘッダーの `設定` は、通常利用では `/dashboard/settings` へルート遷移せず、`DashboardClient` 内の `settings` ビューとして `SettingsOverview` を表示する。マップやTodoのクライアント状態を破棄しないことで、設定へ移動して戻る時の再取得・マップ再初期化を避ける。設定内の詳細カテゴリリンクは従来通り `/dashboard/settings/*` を使う。
- 設定トップと設定サイドナビのカテゴリリンクは `prefetch={false}` にし、一覧表示だけで重い設定詳細のRSC/JSを先読みしない。AIモデルはアプリ側の固定値を正とし、ユーザー設定UI・AI設定カテゴリ・`/dashboard/settings/ai` の詳細画面は表示しない。古いAI設定URLは設定トップへ戻す。
- モバイル `Todo` 画面は、予定タイムラインだけでなく `予定` / `AI` の切替を持つ。`AI` 側はデスクトップの `Todo > AI実行` と同じ `AiExecutionTimeline` を使い、`ai_tasks` / scheduled AI tasks / Codex状態 / follow-up送信をWeb・Mac・iPhoneで同じAPI経由で表示する。
- モバイル `Todo > 予定` のヘッダーは、下へ引くと更新アイコンを表示し、しきい値を超えて離すと `useCalendarEvents.syncNow({ silent: true })` でカレンダー予定だけを強制更新する。iPhoneアプリのWebViewネイティブpull-to-refreshは画面全体のリロードになるため無効にし、このヘッダーpull更新を標準導線にする。
- Focusmap iOSアプリ（`mobile/focusmap-app/App.tsx`）は `source=ios-app&standalone=1` のWebViewでダッシュボードを開く。ネイティブの全画面ローディングは初回起動直後だけ最大1.2秒まで表示し、一度Webコンテンツを表示した後は、通常の画面遷移・手動再読み込み・WebView process復旧で全画面ローディングへ戻さない。表示済みUIをできるだけ残し、必要な時だけ上端の細い進捗バーを出す。`react-native-webview` 内部の再読み込みローディングと注入前のdocument背景も黒にし、白地スピナーの全画面を出さない。アプリを開いている/閉じている判定はReact Native `AppState` を使い、`active` 復帰時だけWebViewへ `focus` / `visibilitychange` / `focusmap:native-app-resume` を注入する。`DashboardClient` は `focusmap:native-app-resume` を受けたら、選択中プロジェクトのタスクを `refreshFromServer({ force: true, silent: true })` で裏更新する。バックグラウンド中にスマホ側が定期pollを続ける前提にしない。この再開・更新方針を変えたら、実装と同じ作業内でこの項目も更新する。
- `/dashboard/loading.tsx` と `DashboardLoader` の動的import fallbackは、スマホでは `DashboardStartupFallback` を表示する。前回の `focusmap:calendar-events:*` と `focusmap:mindmap:project:*` localStorage/sessionStorageキャッシュを読める場合は予定やマップノードの一部を暗色UIで先に描画し、読めない場合も暗色の操作面を出す。サーバー初期データやJSチャンク待ちで白い空画面を出さない。
- 日次カレンダーのD&D（空き時間ドラッグ作成、予定/タスク移動、メモD&D、マップノードD&D）は、ドラッグ中だけカレンダーグリッドとページ全体のtouch scroll / overscrollをロックする。移動中は通常の指スクロールやWebViewのpull-to-refreshを動かさず、ポインタがタイムライン上端/下端56px以内にある時だけ最大2px/frameでゆっくり自動スクロールする。自動スクロールと予定時刻は当日タイムライン内にclampし、D&Dだけで日付はまたがない。
- デスクトップの自作マップでは、単一タスクノードを右ペインの `Todo > 予定` Dayタイムラインへドラッグすると、`focusmap:mindmap-node-calendar-drag` のCustomEventで座標とタスク情報を共有する。カレンダー領域へ入るまでは通常のマップ内ドラッグだけを見せ、領域内では `TodayTimelineCalendar` が15分スナップの予定previewと固定overlayを予定カードUIへ切り替える。領域外へ戻った時は同じoverlayをノードUIへ戻し、drop時は `DesktopTodayPanel` が `onUpdateTask` で `scheduled_at` / `estimated_time` / `calendar_id` を更新して既存のtask calendar syncへ載せる。右ペインDayカレンダーの右上操作群には書き込み可能カレンダーの追加先プルダウンを置き、ノードdrop時の `calendar_id` はこの選択値を優先する。dropイベントは `taskId + scheduled_at` で短時間dedupeし、`useMultiTaskCalendarSync` は画面インスタンス横断のin-flight/cooldownで同じタスクの同期POSTを1本に絞る。同期直後にタスク本体・optimistic event・Google eventが一時的に並ばないよう、同じカレンダー/タイトル/開始分のカレンダーイベントはタスク表示を優先して除外する。複数選択ドラッグとカレンダー外dropは従来通りマップ内移動として扱う。
- モバイル `Todo > 予定` の右下プラスから開く新規タスク追加シートと、予定/タスクをタップした時の編集シートは黒背景のボトムシートにし、日時はスマホ標準の `datetime-local` 入力で日付/時刻をまとめて選ぶ。所要時間/通知は2列、追加先カレンダーとサブタスクは全幅の選択/入力欄として表示し、プロジェクトと優先度は表示しない。サブタスクは追加直後にローカル仮行として即時表示し、保存後は `tasks.parent_task_id` で親タスクへ紐づく子タスクとしてDB保存する。チェック状態は `tasks.status` で扱い、右端のゴミ箱で子タスクを削除できる。`所要時間` は通常時は値だけを表示し、タップ時だけ5分/15分/30分等のプリセットとグリッド内のカスタム導線をインライン展開し、時間選択後は所要時間パネルを閉じる。追加/編集シート本体は縦スクロールなしで収め、サブタスクが増えた時だけサブタスク一覧内をスクロールする。
- モバイルでは、作成/編集ダイアログやボトムシートを開いただけで入力欄へ自動フォーカスせず、キーボードを勝手に出さない。入力欄をタップした時だけキーボードを出す。プロジェクト/スペース作成編集、今日するメモ追加、タスク追加シートはこの方針に合わせる。
- 上部の `SpaceProjectSwitcher` は左のスペース選択と右のプロジェクト選択を独立状態として扱う。右側でプロジェクトを選択・作成・編集しても左側の `selectedSpaceId` は変更せず、スペースは左側のスペースメニューで明示的に選んだ時だけ切り替える。
- デスクトップ `メモ` 画面の右上ヘッダーには、左から `マップ分割`（Networkアイコン）、`カレンダー分割`（Calendarアイコン）、設定、ユーザーを置く。`マップ分割` は左にメモ看板、右に `CenterPane` のマップを横表示し、`カレンダー分割` と同時表示はしない。`メモ` 画面内の右側アクションは `追加` と `生成` だけにし、AI状況更新やカレンダー切替は画面内ツールバーへ戻さない。
- モバイル `マップ` 画面のヘッダーは `メモ` 画面と同じコンパクトな `SpaceProjectSwitcher` を使う。ヘッダーの通常操作はスペース/プロジェクト切替と、NetworkアイコンにSparklesを重ねたAIボタンだけにし、ルート追加の `+` とチャットアイコンは出さない。AIボタンは選択中プロジェクトの未予定メモを `wishlist` から取得し、既存の `MemoToMindmapDialog` を開いてメモからマインドマップを生成・配置する。
- `Todo` タブの `メモ + カレンダー` サブビューは、サブビュータブ自体を見出しとして扱う。中央ペイン内に重複する「今日する」見出しや説明文は置かず、カラム切替・カレンダー選択・今日するメモ追加ボタンだけを薄いツールバーにまとめる。
- `Todo` タブ左側のメモカードは、`メモ` 画面と同じ `WishlistCardDetail` 編集シートを開く。見出し・本文・タグ・画像・予定化などのメモ編集導線は左ペインからも同じ挙動にする。PCのメモ編集シートは右サイドからのスライドではなく、画面中央から短いフェードで浮かび上がるモーダルとして表示する。スマホのメモ編集シートは予定編集シートと同じ黒背景の下部シートに寄せ、順序は `見出し → メモ詳細 → 画像 → Codex → 時間・予定 → プロジェクト/タグ` を正にする。タグは低頻度操作として最下部へ置き、見出し直下には出さない。狭幅ブラウザでも `useIsMobile` はモバイル幅判定でスマホUIに切り替える。シートを開いた直後は見出し入力へ自動フォーカスせず、キーボードを出さない。日付・時刻・カレンダー・タグは通常時は小さなフィールド/ボタンだけを表示し、タップ時だけ既存フォームの上へPopoverを重ねる。シートは右上の×で閉じ、スマホでは上端から下へ引いた時も閉じる。構造化パネルと対話履歴は通常UIから外す。
- メモ編集シートの本文欄は、同じ枠の中を本文スクロール領域と下部の保存状態表示に分ける。`本文を音声入力` と `本文から見出し生成` はメモ見出し行の右側、コピーアイコンの左側へ小さく並べ、コピーは文言を出さずアイコンだけにする。本文が長くなってもスクロールは本文領域だけで発生する。音声入力は `useVoiceRecorder` と `/api/transcribe` を使い、文字起こし結果を本文へ追記する。見出し生成は `/api/ai/generate-memo-heading` を使い、本文から14〜22字程度、長くても24字以内の短い日本語見出しを作る。
- メモ編集シートの `画像` セクションは本文の直下に常時表示し、同じ添付API `/api/wishlist/[id]/attachments` を使う。スマホでは中央の「画像を追加」タイルだけを追加導線にし、見出し行右上の追加ボタンとクリップボード貼り付けボタンは出さない。スマホのサムネイルは横スクロールではなく2列グリッドで表示し、メモ編集シート全体は横方向へスクロールさせない。PCでも画像見出し右の追加ボタンは出さず、見出し/プロジェクトの下を「左: メモ詳細」「右: 画像 → 時間・予定 → Codex」の2ペインにし、画像・予定入力がメモ詳細の左へ戻らないようにする。画像・時間・Codex・タグの各セクションは、メモ欄と同じく見出しを外側、操作面を内側の枠として表示する。PCではクリックでフォルダーから選択、ドラッグ&ドロップ、`クリップボード画像を貼り付け` ボタン、画像セクション内またはメモ編集シート内の `Cmd/Ctrl+V` で画像を追加できる。サムネイルは「画像を追加」タイルより上に置き、アップロード中は元画像のローカルプレビューを低透明度で即時表示し、オンライン送信前にクライアント側でJPEGへ圧縮して300KB以下にする。登録完了後に通常の濃さと保存/削除操作へ切り替える。複数画像は並列アップロードし、仮メモ作成中に追加された画像はメモ作成APIの完了を待ってから添付APIへ送る。添付APIはユーザーセッションで対象メモの所有確認を行い、その後のStorage操作と `ideal_attachments` の取得/作成/削除だけをserver-side service role clientで実行する。これにより本番DBのRLS policy差分で本人の画像添付が `new row violates row-level security policy` に落ちる状態を避ける。サーバー側も300KB超の画像を拒否し、画像アップロードは60秒でタイムアウトし、失敗時だけ対象の仮プレビューを消してエラーを表示する。画像削除はDELETE完了を待たずにサムネイルを即時非表示にし、失敗時だけ元の位置へ戻す。添付画像のStorage保存パスはISO時刻トークンを使い、ミリ秒の巨大整数をDB値と誤認させない。
- メモ編集シートの予定化は、日付フィールドからこの画面専用の小さな月間カレンダーPopover、時刻フィールドから24時間/60分の2カラムiPhone風ホイールPopover、所要時間は `5分` / `15分` / `30分` / `1時間` / `2時間` / `カスタム` のチップで選ぶ。`カスタム` は同じiPhone風ホイールPopoverで「時間」「分」を選び、1分単位で反映する。解除は所要時間が入っている時だけラベル横の小ボタンとして出す。日付Popoverは選択後に閉じる。スマホでは日付/時刻Popoverを開く時に対象フィールドをシート中央寄りへ寄せ、下側に出たPopoverが画面下で切れにくい状態にする。PCでは日付/時刻Popoverをフィールド上側へ出し、下段配置でも画面下へ切れないようにする。時刻Popoverと所要時間Popoverは中央の半透明ハイライト帯へ選択値を吸着させ、上下の数字をフェードさせる。ホイールはネイティブスクロールに依存せず、タップ選択・上下ドラッグ・フリック・PCの二本指/マウスホイールの移動量から中央値とラベルを即時プレビューし、確定時は中央の値へ吸着する。カレンダー追加欄は `useCalendars` の選択済み/書き込み可能なGoogleカレンダーを優先して表示し、選択後はPopoverを閉じる。候補が無い時だけ `primary` にフォールバックする。予定追加ボタンは日時・所要時間・追加先カレンダーが揃うまで無効にし、選択した `calendar_id` を `/api/wishlist/[id]/calendar` へ渡し、登録後のメモにも `calendar_id` を保存する。
- モバイルのメモホーム入力列は、本文入力欄の右に `音声入力`、その右に `AIで整理して生成`、一番右に `メモを追加` を置く。音声ボタンの右隣はAIキラキラボタンにし、プラスボタンは最右端の純粋追加導線として固定する。AI整理追加の見出しは14〜22字、最大22字に抑え、入力本文はAI要約で削らず原文をメモ本文として保存する。
- `メモ` 画面の `+ 追加` は、入力欄に本文がある時はその先頭行をタイトルにして即時メモ追加し、入力欄が空の時はタイトル空欄の未保存ドラフトとして新規メモ詳細シートだけを開く。空ドラフトは見出し入力を自動フォーカスせず、`新しいメモ` を初期値として表示しない。見出し/本文/画像/タグ/予定など保存対象の内容が入った時だけ作成POSTを走らせ、何も入力せず閉じた場合はローカルドラフトを破棄してサーバーへ作成しない。メモ詳細は見出し・本文を自動保存し、明示的な `メモを保存` ボタンは表示しない。作成POSTは15秒タイムアウト付きでリトライし、サーバー側は同じクライアントUUIDの再送を既存メモ取得として扱う。これにより通信が固まった場合でも再送で二重作成しない。仮メモの `display_order` はクライアントから作成APIへ送らず、サーバー側でPostgreSQL `integer` 範囲内の値だけを採用し、それ以外は件数ベースで採番する。`生成` はAI整理追加の専用導線にし、純粋追加と分ける。新規メモ/AI生成結果はタグを自動で入れず、タグ欄は空の状態から始める。クイック追加・AI整理から作ったメモも保存直後に同じ詳細シートを開く。メモ一覧取得と事前読み込みは `selectedSpaceId` だけでなく `selectedProjectId` も渡し、選択中プロジェクトへ追加したメモが同じ画面に即表示されるようにする。
- `メモ` 画面の看板ボードは維持し、表示順は `未予定` / `今日する` / `マップ追加済み` / `予定済み` / `完了` とする。メモカードは左上にプロジェクト、見出し下に重複排除したタグ、右上に完了チェックを置き、今日するアイコンと一覧カード右側のCodex/クリップボード導線は表示しない。スマホ看板ではカードを左右端へ短く保持すると隣の看板へスクロールし、ドロップ時にカラム移動として保存する。タグ絞り込みとメモ選択マップ化の処理はコード上に残すが、通常UIの上部ツールバーからは非表示にする。タグ候補は編集シート内でスマホでも押しやすいチップサイズを維持する。
- デスクトップ右側の `Today` パネル上部には、カレンダー予定を手動で強制同期する更新ボタンを常設する。押下時は `useTodayViewLogic.refreshCalendar()` 経由で `useCalendarEvents.syncNow({ silent: true })` を呼び、同期中はボタン内の `RefreshCw` を回し、完了時は一時的にチェック表示にする。

### メモとマップ追加済みの同期

- メモの `マップ追加済み` 判定は、全プロジェクト横断で実在するマップノード（`tasks.deleted_at is null`）に対応しているかを基準にする。今開いているプロジェクトだけで判定しない。
- `memo_node_links` の active link または旧 `ai_source_payload.mindmap_links` があっても、対応する `task_id` が存在しない場合はマップ上にないものとして扱う。メモ一覧/詳細取得時に古い参照を自動で外し、必要なら未予定へ戻す。
- マップノードを削除した時は、削除対象の子孫ノードも含めて元メモとの対応を外す。そのメモに他の実在マップノードが残っていなければ、元メモは削除せず `未予定`（`memo_status='unsorted'`）へ戻す。
- ただし元メモが `今日する` / `予定済み` / `完了` の場合、その状態を優先し、マップノード削除だけでは `未予定` へ戻さない。
- マップ削除後はUndoスタックへ復元用スナップショットを積む。トーストの `元に戻す` と `Cmd/Ctrl+Z` は同じUndo処理を呼び、削除したノード群・元メモ対応・未予定戻し前のメモ状態をまとめて復元する。
- メモ詳細の `Codexにプロンプトを送る` は標準では `executor='codex_app'` / `dispatch_mode='manual'` の `ai_tasks` を先に作り、Codex.app/ChatGPT Codex入口を開く。Codex.appへ見えるpromptはユーザー本文だけにし、Focusmap同期ID（handoff token）や「返信で触れないでください」系の連携文言は付けない。日本語promptの文字化けを避けるため、`codex://` deep linkのqueryへprompt本文を載せず、本文はブラウザ/ローカルAPIのクリップボードコピーだけで渡す。handoff tokenは `ai_tasks.result.codex_handoff_token` にだけ保存し、thread検出はprompt先頭・cwd・作成時刻・既存thread idで行う。Codex.appで最終送信するのは人間で、Focusmapはprompt / handoff token / ai_task tracking packageを作る。自動 `thread/start` / `turn/start` は、明示的な自動実行導線が `dispatch_mode='auto'` を渡した時だけ使う。
- メモに画像添付がある場合、Codex起動直前に `/api/wishlist/[id]/attachments` から署名URLを再発行し、本文末尾に `添付画像:` として画像名・形式・サイズ・URLだけを追加する。prompt本文は「見出し + 1改行 + 本文」を基本にし、ラベル文言は足さない。画像バイナリをdeep linkへ詰め込まず、初回起動ではpromptだけをクリップボードへコピーする。保存済み画像はCodex欄の画像コピーアイコンから個別にOSクリップボードへ保存し、ユーザーが同じCodex入力欄へ続けて貼り付ける。複数画像はprompt本文のURL一覧を正にしつつ、UIから各画像を必要な順にコピーできるようにする。
- メモ詳細のCodex実行表示は `ai_task_activity_messages` を `/api/ai-tasks/[id]/activity` から読み、チャット風活動メッセージを正とする。詳細を開いた時は `/api/codex/sync-node` に `include_visible_activity=true` を付け、rollout JSONLの `agent_message` / assistant `message` / `task_complete.last_agent_message` / Codex側のユーザー追加入力を複数件dedupeしてactivityへ残す。さらに、Codex task が `running` / `prompt_waiting` から `awaiting_approval` へ初めて入る時と、Codex thread archiveで完了扱いへ進む時は、詳細表示を待たずに同じ可視メッセージを1回先取り保存する。これにより、スマホ側で確認待ち/確認済みになった後に詳細を開いた時、読める範囲の会話内容を即表示できる。`Codex.appの稼働シグナルを確認中` のようなpulse文はチャット本文として表示しない。確認待ちでは最新の質問/承認メッセージを最上部に出し、raw `live_log` は補助データとしてDBに残すだけにする。PC版メモ編集シートでは `左: メモ詳細`、`右: 画像 / 時間・予定 / Codex送信と簡易ログ/チャット` にする。マップの `CodexNodePanel` とスマホ版メモ編集シートは、スマホで `見出し → メモ詳細 → 画像 → Codex → 時間・予定 → タグ` の順にし、タグを低頻度操作として最下部へ置く。Codex欄は画像の直後、時間・予定より前に置き、送信後は同じ欄で状態とチャットを確認できるようにする。Codex欄は最新 `ai_tasks` のactivityを初回描画後に読み、実行中は10秒間隔で更新し、送信内容・状態・Codex返答をカードで表示する。Codexログとチャットはスマホ幅内で折り返し、メッセージ取得後もシート全体を横スクロールさせない。時間・Codex・タグも見出しを外側に出し、内側の枠には入力/ログ/タグ本体だけを入れる。Codex送信欄は追加依頼文の編集UIを持たず、現在の見出しとメモ本文を既存manual handoff promptへ渡す。画像アップロード/クリップボード貼り付けの保存中はCodex送信を無効にし、添付一覧に登録されてから送れる状態にする。メモ内の簡易実行ログは新規テーブルを増やさず最新 `ai_tasks` を読み、`pending` / `prompt_waiting` を `未送信`、task作成を `送信済み`、`running` を `実行中`、`awaiting_approval` / `needs_input` を `確認待ち`、`completed` を `完了`、`failed` を `失敗` に丸めて表示する。`状況を見る` ボタンやチャット内容選択タブは置かない。詳細表示中のCodex同期やactivity再取得はバックグラウンドで走らせ、`同期中` / `最新ログまで表示済み` / `情報を更新しました` のような一時ラベルでチャット面の高さや視線を動かさない。サブタスク候補の入力欄は通常のメモ編集UIから外す。
- `/api/ai-tasks/[id]/activity` は、Turso/Supabaseに残る `thread_detected`、`running`、`awaiting_approval`、`status:running`、`status:awaiting_approval` などの内部状態イベントをチャット表示用レスポンスから除外する。スレッド検出・状態遷移だけの丸薬ログを本文に出さず、Codexの実際の返答・質問・ユーザー追加指示を優先して表示する。ユーザー向けの手動handoff文言は外部アプリ名を並べず、`Codex` に丸める。
- `整理する` は初期実装では最大2件の構造化項目に抑える。プロジェクト文脈は `projects.title/description/purpose` に加えて `project_contexts.heading`、`details` 先頭、`progress_status`、`progress` 先頭を軽量に取り込み、マインドマップ候補は対象プロジェクトの既存ノード候補だけを後段で読む。
- 構造化項目のマップ配置は自動追加しない。候補取得後、デスクトップはselect、モバイルは下部シートでプロジェクトチップ・ノード検索・候補ノード一覧から `新しい枝にする` / `この下に追加` / `同じ階層に追加` / `既存に紐付け` を選び、ユーザーがマップ投入ボタンを押した時だけ `memo_node_links` と `tasks` を更新する。

### 自作マップ表示

- 自作マップの横位置は、`dagre` の縦並びを使った後、同じ深さの最長ノード幅を列幅として再計算する。列間の基本余白は短めにし、短いノード同士では親子線を長く伸ばさず、横に長いノードがある列だけ次階層全体を右へ押し出す。線の折れ点は列間の中央へ置き、ノード矩形上を線が通って見えないようにする。
- ノードは線より前面に描画し、完了ノードもノード全体を透過させない。完了状態は文字・枠の弱調と取り消し線で表し、背面の線がノード内に透けて見える状態を避ける。
- タスクノードの描画高さは `mindmap-geometry` の推定高さと一致させる。長文タイトルが推定高さを超える場合は本文領域内でスクロールし、ノード外へ本文を漏らして他ノードへ重ねない。
- 自作マップのタスクノード右端の三点ボタンは、小さなノード下メニューを出さず、対象ノードを選択して詳細編集パネルを直接開く。ノード下へ `Codexを開く` / `日時を指定する` のメニューを重ねない。日時・所要時間・画像は詳細編集パネル側で編集し、Codex進捗はノード右上の状態バッジから開く。
- 自作マップで表示上3行以上に折り返されるタスクノードには、右下へSparklesボタンを出す。押すとまずノードタイトル全文を `tasks.memo` へ移し、既存メモがある場合はタイトル全文の後ろに空行区切りで保持しつつ、1行目由来の仮見出しを `tasks.title` に即時保存する。その後 `/api/ai/generate-memo-heading` に同じ本文を渡して短いAI見出しを生成し、完了時に `tasks.title` を上書きする。過去の生成済み見出しを再生成する場合は、半端に切れた現タイトルを本文へ混ぜず、既存 `tasks.memo` をAI入力の正にする。デスクトップ/モバイルとも `CustomMindMapView` の共通UIからこの処理を呼び、処理中は短いノードの右下にも同じボタンをローディング表示で残す。3行以上ノードは `mindmap-geometry` 側で生成ボタン用の下余白も確保する。
- デスクトップ自作マップの右上常設操作は `MindMapDisplaySettingsPopover` の設定ボタンだけにする。全画面拡大/縮小ボタン、Codex snapshot の手動更新ボタン、ノード選択時の下部ショートカット案内は通常UIに表示しない。ノード追加・編集・削除・複製のキーボード操作は内部挙動として残すが、選択だけで操作パネルを重ねない。
- モバイル自作マップのノード編集中に出るキーボード上部バーは、`閉じる` / `子追加` / `親追加` / `削除` に加えて、削除ボタンの右側に音声入力ボタンを置く。音声入力は既存の `useVoiceRecorder` と `/api/transcribe` を使い、文字起こし結果を編集中ノード名の選択範囲へ挿入する。録音中は停止アイコン、文字起こし中はローディングを表示し、キーボード上の編集状態を維持する。

### カレンダー取得・キャッシュ

- `useCalendarEvents` は、同一画面内のメモリキャッシュに加えて `sessionStorage` / `localStorage` に予定を保存する。表示用TTLは12時間、再検証は1分を目安にし、アプリ/Webの再起動後も手元の予定を先に描画してから裏で更新する。
- `useCalendars` はカレンダー一覧と選択状態も `localStorage` に保存し、Macアプリ/スマホ起動直後に選択カレンダーIDを復元する。これによりイベントキャッシュキーが初回描画から確定し、`primary` だけを一瞬表示してから全カレンダーへ増える段階表示を避ける。
- `useMindMapSync` は、プロジェクト単位のマップ表示用タスクを `localStorage` の `focusmap:mindmap:project:{projectId}` に12時間保存する。初期サーバーデータがまだ無い時はこのキャッシュを先にstateへ入れ、通常の `refreshFromServer({ force: true })` やiOS復帰時の `refreshFromServer({ force: true, silent: true })` で裏更新する。キャッシュは初期表示用であり、正はDB/Realtime/API更新とする。
- 選択カレンダーIDが空配列の場合、`useCalendarEvents` はGoogle Calendar APIのデフォルト `primary` 取得へフォールバックせず、空予定として扱う。カレンダー選択が未確定の間は予定取得を開始しない。
- `/api/calendar/events/list` は `forceSync=false` かつ `calendar_events` に対象期間のキャッシュがある場合、Google Calendar APIを待たずにDBキャッシュを返す。返却時も `task_id` / 優先度 / 見積時間 / 完了状態 / カレンダー色 / 祝日カレンダー除外を付け直す。
- DBキャッシュは初期表示用であり正ではない。APIはキャッシュ返却時に `fromCache: true` / `needsRefresh: true` を返し、フロントは表示後に `forceSync=true` のサイレント同期を1回走らせる。`forceSync=true`、手動更新、定期自動更新、DBキャッシュなしの初回はGoogle Calendar APIから取得して `calendar_events` を更新する。
- Google Calendar APIの返却は表示にはそのまま使うが、`calendar_events` への保存前には `google_event_id` で重複排除する。DBは `UNIQUE(user_id, google_event_id)` のため、複数カレンダーで同じ `google_event_id` が返った場合に `ON CONFLICT` が同一行を二度更新してキャッシュ保存全体が失敗するのを防ぐ。
- カレンダー色が未取得の予定も表示対象から落とさない。`Today` の日/3日/月表示では、カレンダー色がないGoogle予定にGoogle Calendar標準色 `#039BE5` を使う。
- 既存Google予定またはGoogle連携済みタスクのカレンダーを変更する場合は、旧カレンダーから削除して新規作成せず、移動元 `source_calendar_id` と移動先 `calendar_id` を `/api/calendar/sync-task` / `/api/calendar/events/[eventId]` に渡して Google Calendar の `events.move` 後に `events.update` する。これにより既存予定の二重登録を避ける。カレンダー解除時の削除だけは、DB更新後でも旧予定を消せるようリクエストbodyの `calendar_id` を削除先として優先する。

### マインドマップとCodex.app連携

- ノードやメモからCodexへ渡す場合、Focusmapは作業本体を裏側で完結させるのではなく、Codex.app側を主軸にする。
- 標準導線は、Focusmap Macアプリ、通常デスクトップブラウザ、ローカルWeb、Cloudflare preview、スマホのいずれでも `executor='codex_app'` / `dispatch_mode='manual'` の manual handoff とする。Focusmap側は `ai_tasks` に追跡taskを作り、prompt本文をクリップボードへコピーし、Codex.app/ChatGPT Codex入口を開く。Codex.appへ最終送信するのは人間。
- 常駐Mac runner/agentは、manual handoff taskでは人間がCodex.appで送信した後のthread/status/activity同期だけを担当する。Macアプリ内であること、Mac supervisorがonlineであること、repo pathが設定されていることを理由に、通常ボタンや既存manual handoffをautoへ暗黙昇格しない。
- マインドマップのメモ編集パネル（`CodexNodePanel`）でも、Macアプリを含め同じprompt本文で `dispatch_mode='manual'` の `ai_tasks` を作る。プロンプト本文はdeep link queryへ載せずにクリップボードへコピーし、Mac/デスクトップではpromptなしの `codex://?path=...&originUrl=...` またはローカルAPI/Electron bridgeでCodex.appを開く。画像がある場合も初回起動時のクリップボードはpromptだけにし、メモ詳細/ノード詳細に保存済み画像ごとのコピーアイコンを表示して、同じCodex入力欄へ2段階目として貼り付ける。画像コピーは `copyCodexImageToClipboard()` からElectron bridge、Focusmap iOS bridge、ローカルAPI、ブラウザClipboard APIの順で試し、新しい `ai_tasks` を作らない。thread紐付けは初回prompt送信で作ったmanual handoff task、`source_task_id` / `source_ideal_goal_id`、Mac側monitorまたは `/api/codex/sync-node` によるCodex.app thread検出を正にする。スマホではOSの外部アプリ起動制約を優先し、タップ直後に `ai_tasks` 登録リクエストと同期クリップボードコピーを先に開始してからChatGPT Codex入口を起動する。Focusmapが `visibilitychange` / `pagehide` / `blur` / 復帰を検知した時、またはFocusmap iOSアプリWebViewが `focusmap:openExternal` bridgeを送った時は、外部アプリ起動を受け身イベントとして扱い、`prompt_waiting` / `未送信` のまま残す。`実行中` へ進めるのは、Mac側monitorまたは `/api/codex/sync-node` がCodex.app thread、`task_started`、直近のユーザー可視Codex activity、または明示auto dispatchのqueue/run activityを確認した時だけにする。通常ブラウザ/CloudflareプレビューではiOSは公式Codex mobile URL `https://chatgpt.com/codex/mobile/`、Androidは `intent://chatgpt.com/codex/mobile/#Intent;scheme=https;package=com.openai.chatgpt;S.browser_fallback_url=https%3A%2F%2Fchatgpt.com%2Fcodex%2Fmobile%2F;end` を使い、OS側にChatGPTアプリ起動を試させる。Focusmap iOSアプリ内WebViewではpromptがあれば `focusmap:copyAndOpenExternal` に `text` だけを載せ、画像コピー操作では `focusmap:copyCodexImage` に `imageUrl` を載せる。React Native側は `FocusmapExternalOpener.copyCodexImage()` が利用できるiOSアプリで画像だけをOSクリップボードitemへ保存する。iOSアプリには `urls` 候補として公式URL → `chatgpt://codex/mobile` → `chatgpt://codex` → `com.openai.chat://codex/mobile` → 汎用 `chatgpt://` / `com.openai.chat://` を渡す。再インストール済みアプリでは公式URLを `UIApplication.open(..., universalLinksOnly: true)` で先に試し、ChatGPTアプリがCodex URLとして扱える場合だけ成功させる。汎用schemeはChatGPTアプリを開くだけでCodex画面直行を保証しないためfallback扱いにする。
- `CodexNodePanel` は `メモを編集` のフル編集パネルとして扱う。上部は見出しだけを置き、タグ風の状態チップは本文エリアの最下部へ移す。本文側はPCでは `左: メモ詳細 / Codex`、`右: 画像 / 時間・予定 / タグ` の2カラムにし、スマホでは `メモ詳細 → 画像 → Codex → 時間・予定 → タグ` の1カラムにする。スマホの画像追加は「画像を追加」だけを出し、クリップボード貼り付けはPC導線に寄せる。画像は `/api/tasks/[id]/attachments` でフォルダー選択、ドラッグ&ドロップ、クリップボード貼り付け、削除を行う。`task_attachments` APIはユーザーセッションで対象タスクと添付の所有確認を行い、その後のStorage操作と添付DB操作はserver-side service role clientで実行する。アップロード中は元画像のローカルプレビューを薄く表示し、オンライン送信前にクライアント側でJPEGへ圧縮して300KB以下にする。保存済み添付に入るまでCodex送信を無効にし、サーバー側も300KB超の画像を拒否する。日付・時刻・所要時間・カレンダーIDは親の `onUpdateTask` 経由で `scheduled_at` / `estimated_time` / `calendar_id` を更新し、所要時間の `カスタム` は時間/分ホイールPopoverで選ぶ。カレンダーは `useCalendars` の選択済み/書き込み可能なGoogleカレンダーをプルダウン表示し、日時・所要時間・カレンダーが揃った時だけ `予定を登録` / `予定を更新` ボタンから `/api/calendar/sync-task` に登録できる。簡易な `メモ見出し` / `メモ詳細` だけの画面や、三点メニューから別操作を選ぶ導線へ戻さない。
- `dispatch_mode='auto'` を使うUIを別途作る場合は、`Codexを開く` ではなく「Macで自動実行」のように手動handoffと区別できる文言にする。Macアプリ内の通常の初回Codex操作はauto導線にしない。
- Codex送信後、`未送信` / `prompt_waiting` / thread未検出 / 外部アプリ起動失敗など、まだ `実行中` へ進んでいない状態では、メモ詳細・ノード詳細・リンクメモ詳細・Codex看板詳細に `Codexを開く` とprompt再コピーのボタンを残す。スマホの `Codexを開く` は同じタップで端末クリップボードコピーを開始し、ChatGPTアプリ候補URLへ進む。Cloud Runデプロイだけで変わる範囲は、Web側が渡す第一候補URLとbridge payloadである。インストール済みFocusmapアプリが既に `focusmap:openExternal` を受け取れる場合、デプロイだけでも第一候補を公式Codex URLへ変えられるが、通常の `Linking.openURL("https://...")` はSafariで成功扱いになり得る。ChatGPTアプリ内Codex画面を優先するにはiOS nativeの `universalLinksOnly` が必要で、これはアプリ本体の変更である。`mobile/focusmap-app/plugins/withFocusmapExternalOpener.js` がExpo prebuild時にSwift/ObjC moduleとbridging header設定を生成するので、確実に直すにはUSB接続して `mobile/focusmap-app/scripts/install-ios-free.sh` で再インストールする。公開されているOpenAI/ChatGPT公式情報ではCodexメニュー直行の専用URL schemeは確認できないため、Focusmapは公式Codex HTTPS URLのUniversal Link成功を最優先し、失敗時だけfallback schemeまたはWebへ落とす。`実行中` になったら通常は再コピー導線を隠し、以後はCodex.app側のthreadを正にする。
- localhost、`*.local`、`*.trycloudflare.com` の通常ブラウザ/スマホプレビューでも、Focusmap Macアプリ内でも、標準導線はmanual handoffにする。デスクトップmanualではローカルAPI `/api/codex/open-repo` またはElectron bridgeからMacのクリップボードコピー、`open codex://...`、Codex.appのactivateを実行できる。ノード詳細の `Codexを開く` は `ai_tasks` の追跡task登録、下書き保存、Codex.app起動を並列寄りに進め、下書き保存完了やブラウザ側クリップボードコピー完了をCodex.app起動の前提にしない。Codex.appは開けたが追跡task登録に失敗した場合は、Focusmap側で追跡できない可能性を警告して再送導線を残す。スマホmanual時は `/api/codex/open-repo` へ送らず、端末側クリップボードへの同期コピーとChatGPT mobile入口を優先する。ブラウザまたはFocusmap iOSアプリが外部アプリへ画面を切り替えても、ChatGPT側の会話本文はFocusmapから直接読めず、送信・実行確認にもならないため、thread未検出のmanual handoffは `prompt_waiting` / `未送信` として再コピー・再起動導線を残す。
- prompt付きのローカルAPI起動では、標準導線は `pbcopy` でpromptだけをコピーしてCodex.appを開く。保存済み画像がある時は画面上の画像コピーアイコンから別操作で `/api/codex/open-repo` の `open_app=false` / `clipboard_image_url`、またはElectron bridgeの `copyCodexImage()` を呼び、macOS `NSPasteboard` / Electron `clipboard.writeImage()` に画像だけを保存する。日本語promptが文字化けしない形でコピーし、promptコピーに失敗した場合はCodex.appを開かずエラーとして返し、UI側は送信済み扱いにしない。画像単体コピーではローカルAPIがpasteboard image type、Electron bridgeが `clipboard.readImage()` を読み返し、`copied_image_to_clipboard` または `copiedImageToClipboard` として返す。複数画像はprompt本文のURL一覧を正に残しつつ、UIでは各保存済み画像を個別にコピーできるようにする。同時テキスト+画像コピーは互換処理として残すが、Codex手動handoffの標準UIでは使わない。
- `codex://` deep link 経由の新規スレッド作成・リポジトリ選択・貼り付け済み送信は、OS/アプリ側の公開API制約により完全自動化できない前提。明示auto導線だけ `ws://127.0.0.1:7878` のCodex app-serverへ送る。Focusmapはユーザー向け状態を `未送信` / `実行中` / `確認待ち` / `完了済み` / `接続失敗` へ丸め、`/api/codex/sync-node` と `~/.codex/state_5.sqlite` / rollout JSONL から状態確認とログ同期する。
- Focusmap Lite `scripts/focusmap-agent` は、Codex.appまたはCodex CLIを検出したMacでは `codex_app` executorをheartbeatに含める。`codex_app` taskをclaimして自動送信するのは `dispatch_mode='auto'` の時だけで、その場合は `ws://127.0.0.1:7878` のCodex app-serverへ `initialize` → `thread/start|thread/resume` → `turn/start` を送る。`dispatch_mode='manual'` のtaskは人間がCodex.appで送信した後の監視・同期対象であり、agentが標準で自動turn/startしない。
- `scripts/install.sh` はWeb同梱の `focusmap-agent.tar.gz` を優先導入し、Codex.app/Codex CLIがあるMacでは `~/.focusmap/bin/run-codex-app-server.sh` と `~/Library/LaunchAgents/com.focusmap-official.codex-app-server.plist` も作成する。Codex.app未導入の場合は警告だけ出し、Codex導入後に再実行すれば `codex_app` executorが有効になる。
- プロンプト本文は、メモ見出しなどのラベルを足さず、ノード本文/メモ本文を改行区切りでそのまま渡す。
- Web起動の詳細設計は `docs/plans/active/codex-app-web-launch-design.md` を参照する。
- Macアプリ/agent/Codex監視の一本化計画は `docs/ai/plans/active/20260607-codex-mac-agent-unification.md` を正とする。
- ノードの状態表示は `src/lib/codex-run-state.ts` の `getCodexTaskUiState` と `src/lib/task-progress-ui.ts` の表示丸めを正とする。
  - `result.codex_run_state=prompt_waiting`: `未送信`（青）
  - `pending`: 通常は `未送信`。ただしauto dispatchで `result.codex_run_state=running`、`codex_manual_handoff=false`、直近 `last_activity_at` / キュー投入メッセージがある場合は `実行中`
  - `status=running`: `実行中`
  - `awaiting_approval` / `needs_input` / `completed`: `確認待ち`
  - `result.codex_source_task_completed=true` かつ `codex_review_reason!='thread_deleted'`: `完了済み`
  - `result.codex_source_task_completion_suppressed=true`: チェック解除後の `確認待ち`
  - `failed`: `接続失敗`
  - 古い `result.codex_run_state=running` だけでは、`pending` / `completed` / `awaiting_approval` / `needs_input` / `failed` を実行中扱いにしない。ただし `pending` でも `codex_thread_id` とユーザー可視のCodex出力/進捗文が同期済みなら、手動handoff後に実行へ進んだ暫定状態として `実行中` に戻す。
- 明示auto導線の直後は、`ai_tasks` 作成時点で `result.codex_run_state=running` / `codex_review_reason=queued` / `last_activity_at` を入れ、Mac runnerがclaimするまでの間も `実行中` として3秒更新に乗せる。manual handoffは `prompt_waiting` / `未送信` として表示する。Mac/デスクトップのmanual Codex.app threadは、Codex側で送信・活動が確認できるまでは `未送信` のままにする。スマホChatGPTアプリ handoff は thread/rolloutを読めないため、画面切替または復帰だけでは `確認待ち` に進めない。`実行中` の根拠は、rollout JSONLで最新の `task_started` の後に `task_complete` / `turn_aborted` がまだ無いこと、または明示auto dispatchのqueue/run activityが残っていることに限定する。`task_complete` / `turn_aborted`、ユーザー可視assistantの最終発話、Codex thread missing/deleteは `確認待ち` へ進める。Codex thread archiveだけはユーザーが完了として閉じた意思表示とみなし、元ノードをチェック済みにできる。確認待ち後の再開は、checkpoint以降の新しい `user_message` または `task_started` だけを根拠にし、threadの `updated_at_ms` や完了後のassistant messageだけでは `実行中` へ戻さない。Mac heartbeatはあるがCodex activityが止まっていれば停止疑いまたは `確認待ち` とする。ユーザー可視の出力本文やpreviewは通常snapshotへ保存しない。
- ノード自体のタスク完了はCodex状態ではなくチェックボックスで判断する。`task_complete` / `turn_aborted` などCodex側の停止だけでは `確認待ち` のままにし、人間がノードのチェックボックスを入れた時、またはCodex threadをアーカイブして `codex_source_task_completed=true` になった時に `完了済み` と表示する。thread missing/deleteは完了根拠にせず `確認待ち` に留める。チェック済みノードは同じ親配下の未完了ノードより下へ表示し、完了済み同士・未完了同士では既存の `order_index` を保つ。ノード右上のCodex状態バッジも、紐づくsnapshotがまだ `確認待ち` でもチェック済みなら即時に `完了済み` を表示する。チェック操作はdashboard全体のundo/redo対象で、`Cmd+Z` / `Ctrl+Z` で直前のチェック状態へ戻し、`Cmd+Shift+Z` / `Ctrl+Shift+Z` でやり直せる。undo/redoでも紐づく `ai_tasks` とtask-progress snapshotを同じ完了/確認待ち状態へ同期する。チェック後10秒は誤タップ猶予としてCodex threadアーカイブ要求を送らず、10秒後にまだノードが `done` なら同じ端末が `ai_tasks.result` にpending requestを保存する。チェックを外すと、紐づく `ai_tasks` は `awaiting_approval` に戻り、`codex_source_task_completion_suppressed=true` と `codex_archive_request_state='cancelled'` でアーカイブ済みthreadの再同期による自動再チェックとMac側アーカイブ要求を抑止する。
- マップ画面のCodex監視はチャットtabへ逃がさず、マップ内で完結させる。デスクトップはマップ下に折りたたみ式 `Codex看板` を置き、初期状態は畳んで件数だけを見せ、必要な時だけ展開する。展開時は看板上端のドラッグハンドルを上へ動かすと表示高さを広げられ、保存した高さを次回表示にも使う。モバイルは右下の `Codex` ボタンから下シートで看板を開く。右下ボタン自体にも `online` / `offline` / `確認中` のMac状態を出し、スマホでFocusmap/Codex runnerが動いているかを看板を開かず確認できるようにする。看板レーンは `未送信` / `実行中` / `確認待ち` / `接続失敗` / `完了済み`。`未送信` はCodex.appでまだ開始されていないもの、`確認待ち` はCodex出力や完了を人間が確認するものに限定し、同じカード内で両方の意味を併記しない。`完了済み` レーンはノードがチェック済みで、紐づくprogressの `updated_at` が当日のものだけを一時表示し、翌日以降は看板から消す。
- モバイルCodex看板は、Sheet上部のステータスチップを横スクロールでき、タップまたは横スワイプで `未送信` / `実行中` / `確認待ち` / `接続失敗` / `完了済み` の表示レーンを切り替える。デスクトップ/モバイルのCodex看板は現在表示中のマップに紐づく `source_type='mindmap'` snapshotだけを表示し、現在の `groups/tasks` に `source_id` が残っていないカード、削除済みノード由来のカード、source不明の古いカードは看板から除外する。Turso snapshotに `source_type` / `source_id` が欠けていても、同じ `ai_task.id` が `/api/ai-tasks?source=linked` の現在ノード紐付けに残っていれば、看板表示前に `source_type='mindmap'` / `source_id` を補完する。
- Codex看板カードは `status`、`current_step`、`summary`、Mac online/offline、最終更新を表示する。`source_type='mindmap'` で元ノードが残っているカードには完了チェックと削除ボタンを出し、チェックは既存ノードチェックと同じ `status=done/todo` 更新、削除は既存ノード削除処理へ委譲する。チェック/削除はAPI完了を待たずに看板上へ即時反映し、失敗時だけ元に戻す。補完後に元ノードへ解決できるsnapshotも同じく操作可能にする。モバイルカードは情報量を絞り、状態・今やっていること・確認要否を優先する。カード本文をタップするとTurso progress詳細panel/drawerを右サイドパネルまたはモバイルdrawerとして開き、詳細では送信した内容・Codexの返答・状態更新だけをチャット形式で読む。
- Codex看板と進捗詳細のpollは、次回取得用cursorは内部的に進めるが、無変更のsnapshot/activityでは表示用stateを更新しない。詳細パネルは定期確認中の表示や「最新ログまで表示済み」を常設せず、状態・チャット内容など実際の差分があった時だけ短時間「情報を更新しました」を表示する。
- `/api/task-progress/snapshot` が一時的に失敗した場合でも、現在のマップノードに紐づく `/api/ai-tasks?source=linked` の最小状態から暫定カードを作り、看板とノードのCodex状態を空にしない。Turso snapshotが復帰したら正式snapshotを優先する。この暫定表示では詳細tailを事前取得しない。
- 一本化後の通常UIは `/api/codex/sync-node` を3秒pollで呼ばず、`/api/task-progress/snapshot` と `/api/ai-tasks/[id]/activity` の読み取りに寄せる。`sync-node` は移行中の互換、手動sync now、debug fallbackとして残し、通常のsqlite/rollout探索とDB書き込みはMac側の単一monitorだけが担当する。
- ノード詳細を開いている間は、`未送信` / `実行中` / `確認待ち` のCodex taskだけ `/api/codex/sync-node` を約3秒ごとに呼び、Codex.appへの貼り付け・稼働開始・停止・最新のユーザー可視返信を短時間でUIへ反映する。CodexNodePanel、マップのリンクメモ詳細、Codex看板/右サイド詳細panel/drawerは開いた瞬間に `/api/task-progress/watch` へ `open`、表示中は10秒ごとに `ping`、閉じる時は `close` を送り、TTL 20秒程度のactive watchとして扱う。チャット本文を回収する `/api/codex/sync-node` 呼び出しは `include_visible_activity=true` を付け、sync後に `/api/ai-tasks/[id]/activity` を読む。マップ全体や `useMemoAiTasks` の軽量状態同期はこのフラグを付けず、返信本文は保存しない。`/api/codex/sync-node` は、thread検出、状態変化、current_step変化、progress_summary変化、Turso未設定時のactivity fallbackがある時だけSupabaseへ書き、`codex_last_checked_at` だけの無変化pollではSupabase/Tursoへ書かない。Next dev が `0.0.0.0` bindで起動しても `Host` / `X-Forwarded-Host` が `localhost` / `*.local` / `*.trycloudflare.com` ならローカルCodex同期対象にする。Supabase更新に失敗した場合は成功扱いにせず500を返す。`*.local` のMacローカルプレビューもこの同期対象に含める。Codexが `task_started` を出さずに短い `agent_message` / `task_complete.last_agent_message` だけで終わった場合も、詳細open同期では質問/返答をactivityへ保存して表示する。保存境界は `docs/specs/codex-app-handoff-monitoring/03-backyard-sync-and-turso.md` を正とする。
- マップ全体の軽量Codex同期（`useMemoAiTasks`）は、実行中taskだけ3秒同期し、`prompt_waiting` / `未送信` は作成または開始から3分以内だけ5秒同期する。3分を過ぎても送信検出できないmanual handoffは通常の低頻度更新へ落とし、ノード詳細を開いた時のactive watchや手動再コピー導線で補足する。
- 実行中ノードは、右上の小さなスピナーではなく、ノード枠は固定したまま外周上を緑色の光が流れる動きで示す。外周用の矩形そのものを回転させて、複製ノードが周囲を回っているように見せない。
- マインドマップ右上の更新アイコンは、Web側の `ai_tasks` 状態を手動再取得するためのもの。常駐runnerの即時スキャン強制ではない。
- `useMindMapSync` のSupabase Realtime購読が `CHANNEL_ERROR` / `TIMED_OUT` / `CLOSED` になった場合、マップ本体は手動更新待ちにせず、前面表示中だけ `/api/tasks?project_id=...` を3秒ごとにsilent再取得する。`SUBSCRIBED` に戻るかプロジェクトを切り替えたらfallback pollを止める。toast文言も「3秒ごとに再取得します」にし、ローディング表示を毎回点滅させない。

### Codex同期ポリシー

#### Codex/Macローカル連携 一本化方針

- Codex/Mac監視のwriter所有者、監視間隔、クラウド保存境界、UIの更新表示を変えた場合は、同じ作業内でこの `docs/CONTEXT.md` と `docs/specs/codex-app-handoff-monitoring/03-backyard-sync-and-turso.md` を必ず更新する。チャット上の説明や実装コメントだけを正にしない。
- Focusmap Macアプリは、本番Webを表示する薄いElectron shellとローカルSupervisorを兼ねる。packaged appの通常表示先は `https://focusmap-official.com/dashboard?desktop=1&source=mac` で、Cloud RunへデプロイされたUI/JS変更はMacアプリ再インストールなしで反映される。packaged remote modeでは、起動時にElectronの固定プロファイルからHTTP cache、Service Worker、CacheStorageだけを削除し、ログインCookie/localStorageは残したまま最新の本番Web UIを取り直す。起動直前に `auth-session.json` のrefresh tokenからSupabaseセッションを必要時だけ更新し、`sb-*-auth-token` Cookieを400日max-ageで固定プロファイルへ復元してから `/dashboard` を開く。これによりaccess token期限切れやCookie欠落で毎日ログイン画面へ戻る状態を避け、無駄な再ログイン/DB読み取りを増やさない。ローカルNext 3001は開発起動と明示fallback専用で、`npm run mac:dev` は既定でローカル、packaged appは `FOCUSMAP_DESKTOP_UI_MODE=local` またはローカル `FOCUSMAP_DESKTOP_URL` を明示した時だけローカルNextを使う。
- Focusmap Macアプリは、`FOCUSMAP_DESKTOP_AUTO_CONNECT` が `0` / `false` でない限り、起動後に表示先Web、`focusmap-agent`、Codex Desktop/Codex app-serverを自動確認する。packaged remote modeではローカルNextを自動起動せず、`focusmap-agent` と Codex app-server `ws://127.0.0.1:7878` の監督、ローカルログ `~/.focusmap/logs/`、必要権限確認を担当する。既存の `focusmap-agent` プロセスがすでに動いている場合、Macアプリはそれを利用し、新しいagentを重ねて起動しない。Codex Desktopが `/Applications/Codex.app` に無い場合はCodex接続を未完了扱いにし、`codex` CLIがあれば `codex app` でインストーラーを起動し、CLIも無ければ既定ブラウザで `https://openai.com/codex/` を開く。互換 `task-runner` は通常自動起動せず、`FOCUSMAP_DESKTOP_ENABLE_LEGACY_TASK_RUNNER=1` を明示した互換/デバッグ時だけMacアプリからkick対象にする。Electronの `powerSaveBlocker` は `prevent-app-suspension` を使い、Macアプリ自体がバックグラウンド停止しにくい状態を維持する。明示的に「切断」した場合はSupervisorを止め、勝手に再起動しない。
- Macアプリの通常起動は `/Applications/Focusmap.app` またはビルド済み `Focusmap.app` を使う。`npm run mac:dev` は開発用の `node_modules/electron/dist/Electron.app` で起動するため、macOS Dockの実行中ドットやメニューバー名がElectron側に寄ることがある。開発起動でも `desktop/focusmap-mac/main.cjs` でアプリ名を `Focusmap` に固定するが、Dockの固定済みFocusmapアイコンに実行中ドットを確実に出すにはpackaged appとして起動する。
- packaged remote modeでMacアプリ管理下の `focusmap-agent` を起動する時は、`~/.focusmap/config.json` の `api_url` に関係なく、runtime configの `api_url` を `https://focusmap-official.com/api` に向ける。これによりagent heartbeat、Codex monitor、`ai_tasks` claim/progress writeは本番APIへ送られる。Macアプリ管理下でローカルNextを使う時だけ、`http://127.0.0.1:3001/api` / `http://localhost:3001/api` へ向けたruntime configで起動し、ローカル `.env.local` のSupabase service role等を持つNext API経由でagent token認証・claim・progress writeを行う。MacアプリのNext/agent起動envは `.env` / `.env.local` / `.env.monitoring.local` / `~/.focusmap/desktop.env` を読み、Turso監視設定は `.env.monitoring.local` からも反映する。`FOCUSMAP_DESKTOP_AGENT_API_URL` を明示した場合はそれを最優先する。
- production `focusmap-official.com` 側でagent token認証を使うには、Cloud Runに `SUPABASE_SERVICE_ROLE_KEY` をGitHub Secrets経由で設定する。値そのものはMac/ブラウザ/リポジトリへ置かない。
- `scripts/install.sh` は現行 `com.focusmap-official.agent` / `com.focusmap-official.codex-app-server` を入れる前に、旧 `com.focusmap.agent` / `com.focusmap.codex-app-server` / `com.focusmap.task-runner` を停止し、古い常駐ジョブがproduction API失敗を繰り返さないようにする。
- `focusmap-agent` の起動時capability収集は、Google Drive / CloudStorage の権限確認が詰まっても登録・heartbeatを止めないよう、Drive発見を8秒、各folder access確認を2秒でtimeoutする。詳細な権限状態が取れない場合でもrunnerは先にonlineへ上がる。
- 設定サイドバーでは `/dashboard/settings/automation` を `AI` と表示し、通常画面はMacエージェントのオンライン/オフライン、最終heartbeat、巡回状態、Codex連携だけを見せる。表示の正本は `/api/task-progress/runner-heartbeats` の細かな更新記録で、`/api/ai-runners` はdisplay name/executorsなどの登録情報を補完するだけに使う。古いBridge、重複runner、旧 `task-runner`、Playwright/GWS/MCPの詳細説明は通常UIから隠し、内部executor/capabilityとして残す。Focusmap Macアプリ内だけElectron preloadの `window.focusmapDesktop.getAutomationStatus()` / `connectAutomation()` / `disconnectAutomation()` による `Mac App Control` パネルを追加表示し、Macエージェント再接続、Codex Desktop導入、Codex app-server復旧を操作できる。Codex Desktop未導入時はカード内に `Codexを入れる` ボタンを出し、既定ブラウザで公式Codexページを開く。preloadには同じ `window.focusmapDesktop` 上に `copyText()`、`copyCodexImage()`、`launchCodex()` も公開し、本番Web表示中でもCodex.app起動とクリップボード同期をローカルMac上で行う。IPCは `https://focusmap-official.com`、明示した `FOCUSMAP_DESKTOP_URL`、`FOCUSMAP_WEB_AUTH_ORIGIN` のallowlistに入ったoriginからの呼び出しだけ受ける。接続/復旧は通常 `focusmap-agent` とCodex app-serverだけを起動し、Codex Desktop未導入時は導入ページ/インストーラーを開いて再接続を促す。旧 `task-runner` のpause解除/kickは `FOCUSMAP_DESKTOP_ENABLE_LEGACY_TASK_RUNNER=1` 明示時だけ行う。通常ブラウザ・Cloud Run・スマホではこのIPCは存在しないため、ローカルMacを停止/起動するAPIを公開せず、runner heartbeat表示と手動ハンドオフを維持する。
- スマホはMac内のCodex sqlite/rolloutやファイルを直接読まない。スマホからの操作はSupabase/Tursoへ `ai_tasks`、follow-up、active watchとして保存され、スリープしていないMac側Supervisor/agent/runnerだけがローカルCodex.appの状態を読み、トークン/ログ量を抑えた状態・可視チャット断片だけをクラウドへ戻す。Macが完全スリープ中、またはMac側常駐プロセスが一切無い状態から、スマホ単体でMacアプリを起動できるとは扱わない。
- Codex状態の通常writerはMac側 `focusmap-agent` の単一monitorに寄せる。monitorはapp-server通知、`~/.codex/state_5.sqlite`、rollout JSONLを観測し、`codex_thread_id`、status、current_step、summary、activityを軽量payloadでTurso/Supabaseへ反映する。同じtaskに対して複数monitorが書かないようlock/leaseを持つ。`ai_tasks.codex_thread_id` が保存済みのtaskは、以後そのthreadを固定監視し、通常巡回で全thread探索を繰り返さない。monitorの状態判定では、`task_complete` / `turn_aborted` を強い停止・確認待ち根拠にし、thread `updated_at_ms` は新しいユーザー入力/実行開始の代替証拠として扱わない。
- UIはCodex内部ファイルを直接監視しない。通常の3秒更新は `/api/task-progress/snapshot` と `/api/ai-tasks/[id]/activity` の読み取り専用にし、表示中であることを理由にsqlite/rollout探索やDB writeを起こさない。
- `/api/codex/sync-node` と `scripts/task-runner.ts` のCodex監視は移行期間の互換、手動sync now、debug fallbackとして扱い、通常運用では書き込み監視に使わない。旧 `task-runner.ts` のsqlite/rollout監視は `FOCUSMAP_LEGACY_CODEX_MONITOR=1` を明示した時だけ動かし、Mac supervisor配下の `focusmap-agent` monitorが所有するtaskでは重複書き込みを避ける。
- `ai_tasks` はコマンド、最終状態、互換summaryの正、Tursoは高頻度表示用のsnapshot/event/heartbeatの正、ローカルファイルはraw sqlite/rollout/screenshot/logの正にする。クラウドにはfull thread historyやraw logを保存しない。
- Supabase/Tursoの保存境界は `docs/specs/codex-app-handoff-monitoring/03-backyard-sync-and-turso.md` を正とする。Supabaseへ保存するのはtask作成、thread初回検出、状態変化、完了/失敗/確認待ちなどの重要状態と互換fallbackに限る。Tursoが使える時、activityはTursoを主にし、Supabase activity mirrorは `FOCUSMAP_TURSO_ACTIVITY_PRIMARY=0` を明示した時だけ行う。
- Mac側のCodex監視間隔はactive task中だけ1秒基準にする。ただしDB書き込みはhash、活動時刻、状態、新規activityが変わった時だけにし、runner heartbeatの書き込みは実行中2秒・アイドル30秒基準にする。作業中/待機中の切替時は次回intervalを待たずにTurso `runner_heartbeats` へ即時upsertし、Macアプリ終了やagentのSIGTERM/SIGINT時は可能なら `status='offline'` を1回送る。クラッシュ、強制終了、スリープではoffline送信自体ができないため、Web/スマホは従来通り `last_seen_at` が90秒以上古い場合もofflineと解釈する。既知のCodex threadは1秒ごとにローカル確認するが、`/api/agents/codex-monitor/tasks` の監視対象リスト取得は既定10秒キャッシュにし、Supabaseの対象selectを毎tickへ増やさない。Web/スマホのMac接続表示は、画面が前面表示中の時だけ `/api/task-progress/runner-heartbeats` を30秒ごとに読む。アプリ未起動、WebView/ブラウザ未表示、`document.visibilityState !== 'visible'` の間はheartbeat読み取りpollを走らせず、表示復帰時に即再取得する。Focusmap iOSアプリは `focusmap:native-app-resume` / `focus` / `pageshow` を受けた瞬間にもMac状態を即再取得し、同時イベントによる重複取得は750ms以内1回にまとめる。すでにMac heartbeatがクラウドへ届いている場合、スマホのonline表示はアプリ表示開始からSupabase session取得 + `/api/task-progress/runner-heartbeats` 1往復分（通常1秒前後、通信が遅い場合は数秒）で反映する。Macがidleで直近heartbeatがまだクラウドに無い最悪ケースは、Mac側の次回idle heartbeat最大30秒 + スマホAPI 1往復で反映する。オンライン判定窓は90秒にする。
- macOS権限は機能別に明示する。Codex.appや他アプリを汎用的に自由監視できる前提にはせず、Full Disk Access、Accessibility、Screen Recording、Automationは必要な機能を使う時だけ案内する。

- `ai_tasks` が全ての起点。Codex.app連携では `executor='codex_app'` または `executor='codex'` を使う。
- ローカル同期が使える環境では、通常はMac supervisor配下の `focusmap-agent` monitorだけが `~/.codex/state_5.sqlite` と rollout JSONL を読み、`ai_tasks.result` とTurso snapshot/eventへ状態を同期する。`scripts/task-runner.ts` と `/api/codex/sync-node` は互換/手動sync/debug fallbackに限定する。
- 実行中はMac側で `~/.codex/state_5.sqlite` / rollout JSONL / app-server通知を1秒基準で確認してよい。看板・一覧向けのWeb UIは3秒pollを基準にし、Turso snapshotは `runner_heartbeats.current_task_id`、`last_seen_at`、`ai_tasks.last_activity_at/current_step/summary` の短い状態だけを読む。Mac `focusmap-agent` の通常flushは2秒最短だが、hashまたは活動時刻が変わった時と状態変化時だけにし、同一hashや同じ活動時刻なら送信しない。thread検出・running再開・確認待ち・完了・失敗など状態変化だけforce送信する。
- メモからCodexへ渡す導線と活動表示の詳細計画は `docs/specs/memo-codex-execution/requirements.md` / `delivery-plan.md` を参考にする。メモ詳細・マップノード詳細・リンクメモ詳細の初回Codex操作は、Focusmap Macアプリ内でも通常ブラウザ、ローカルWeb、Cloudflare preview、スマホでも `executor='codex_app'` / `dispatch_mode='manual'` の handoff task を作り、プロンプトのクリップボードコピーと Codex.app / ChatGPT Codex 入口の起動だけを補助する。Codex.appへ最終送信するのは人間。Macアプリ内であることを理由に `dispatch_mode='auto'` へ切り替えない。作成から10分以内で `codex_thread_id` が未保存のmanual handoffは、`focusmap-agent` が `~/.codex/state_5.sqlite` の `first_user_message` をhandoff tokenまたはprompt先頭で照合し、初回thread検出をMac側巡回だけで保存する。確認待ち後にCodex側で追加プロンプトが送られた場合は、`focusmap-agent` の固定thread monitorが `awaiting_approval_at` / `last_activity_at` より後の `user_message` / `task_started` / thread `updated_at_ms` を見て再開を検知し、通常でも1秒以内を目安に `running` snapshot/eventへ戻す。
- DBにはCodexの全生ログやfull thread historyを保存しない。看板・一覧の通常running同期では `ai_tasks.result.live_log` / `output` / Codex thread preview を保存せず、Turso/Supabaseのlatest snapshotは軽量pulseに寄せる。一方で、ノード/メモ詳細を開いた時にチャットとして確認できるよう、Codex側のユーザー可視発話・質問・確認内容は rollout から最大16件ずつ抽出し、`ai_task_activity_messages` またはTurso progress/eventへ短文でdedupe保存する。`dispatch_mode='auto'` のCodex.app実行は、詳細を開いてからローカルログを取りに行く遅延を避けるため、Mac側 `focusmap-agent` が `running -> awaiting_approval` に変わる1回だけ、app-server通知で保持した直近最大8件・各2000文字以内のユーザー可視assistant発話を `/api/agents/tasks/[id]/state` へ同送する。`completed` 理由の確認待ち状態は上部タブ/バッジで示し、Codex回答と誤認されるため「Codex実行が完了し確認待ち」だけのstatus activityは保存しない。activity保存先がローカルdevで未設定またはSupabase schema cache上に無い場合でも返答を落とさないため、短いfallback会話は `ai_tasks.result.codex_visible_messages` に残し、`/api/ai-tasks/[id]/activity` が互換表示する。通常の `focusmap-agent` monitorは、active watchがあるtaskだけチャット本文をactivity化し、watchなしの巡回では状態イベントと軽量snapshotだけを書く。ただしmanual/autoを問わず承認要求・停止・thread archiveなどCodex本文以外の確認が必要な時は、watchなしでも確認用activityを単発保存する。`current_step` は看板向けに `Codex.appが作業中です` / `確認待ち` など状態語に寄せ、会話本文は詳細API `/api/ai-tasks/[id]/activity` で読む。
- Codex thread未検出の高速探索は開始後10分まで。10分を超えても見つからないmanual handoffは `prompt_waiting` / `未送信` のまま再コピー・Codexを開く導線を残す。一度 `codex_thread_id` を保存できたtaskは、`/api/agents/codex-monitor/tasks` が固定監視対象として返し、Mac agentはそのthread IDだけを読む。
- `/api/agents/codex-monitor/tasks` は、`tasks.deleted_at is null` / `notes.deleted_at is null` / `ideal_goals.status != 'archived'` を満たすsourceだけを監視対象にする。マインドマップノード・メモ・wishlist/ideal由来メモが削除またはアーカイブされた場合、そのCodex threadは通常monitor対象から外れ、以後は明示sync/debug fallbackでない限り追わない。
- Codex.app側で連携中threadをアーカイブした場合は、人間がそのCodex作業を片付けた合図として扱う。通常の `focusmap-agent` monitorは次の同期で対象 `ai_tasks.status='completed'` / `completed_at` を保存し、元ノードをチェック済みにする。理由は `ai_tasks.result.codex_review_reason='archived'` に残す。削除またはsqliteから読めなくなった `thread_deleted` は監視不能の確認待ちとして扱い、元ノードを勝手に完了しない。通常のCodex実行完了 `completed` や承認待ちでも元ノードを勝手に完了しない。逆方向では、Focusmapのノードチェック直後は `ai_tasks.result.codex_archive_request_state='waiting_for_grace'` に留め、同じ端末で10秒以上チェックが維持された時だけ `codex_archive_request_state='pending'` / `codex_archive_requested_at` を保存する。スマホやWebはMac内のCodexを直接操作せず、Mac側 `focusmap-agent` が `/api/agents/codex-monitor/tasks` からpending requestを拾い、ローカル `codex app-server` へ `thread/archive` を送る。チェック解除時はタイマーを止め、保存済みrequestも `cancelled` として扱うため、Mac agentはアーカイブしない。
- 確認待ち・手動貼り付け待ち・needs_inputは、Mac側ではCodex.app sqlite/rollout/app-serverを1秒単位で確認する。ただしDBへは無変化の `codex_last_checked_at` だけを書かず、人間がCodex.appへ追加入力して `running` に戻った時、thread検出、確認待ち化、thread missing/deleteによる監視不能化、thread archiveによる完了、失敗などの状態変化だけをUI詳細表示中は約3秒、通常の `focusmap-agent` monitorでは1秒以内を目安にsnapshot/eventへ反映する。
- `/api/agents/codex-monitor/tasks` は、通常のactive Codex taskに加えて、`completed` でも `codex_archive_request_state='pending'` かつ元ノードがまだ `done` のtaskだけをMac agentへ返す。これによりスマホからチェックした完了ノードでもMac agentがCodex threadを閉じに行ける一方、10秒以内の誤チェック解除やキャンセル済みrequestはMacへ渡らない。互換/debug用の旧 `scripts/task-runner.ts` も同じpending requestだけをarchive対象にし、単に元ノードがdoneになっただけでは即アーカイブしない。
- 高頻度のAI実行系APIは `src/lib/auth/verify-supabase-jwt.ts` でSupabase access tokenをオフライン検証し、`user_id` はJWTの `sub` を使う。`Authorization: Bearer <access_token>` を優先し、SSR cookieからもaccess tokenを読める。JWKSはサーバー側で10分キャッシュし、legacy HS256はサーバー環境変数 `SUPABASE_JWT_SECRET` / `SUPABASE_AUTH_JWT_SECRET` がある場合だけfallbackする。互換性のため検証できない古いcookieでは `auth.getUser()` fallbackを残すが、通常の短周期APIは `src/lib/auth/supabase-auth-fetch.ts` でBearerを付ける。
- Supabase Auth制限で開発が止まる場合に限り、ローカル開発用の非常口として `FOCUSMAP_DEV_AUTH=1` と `FOCUSMAP_DEV_USER_ID=<uuid>` を使える。これは `localhost` / `127.0.0.1` / `*.localhost` かつ `NODE_ENV !== production` の時だけ有効で、middleware・サーバー/ブラウザSupabase client・`authenticateSupabaseRequest` が同じdev userを返す。スマホ確認用Cloudflare quick tunnelで同じdev authを使う時だけ、ローカル `.env.local` に `FOCUSMAP_DEV_AUTH_ALLOW_TUNNEL=1` と `NEXT_PUBLIC_FOCUSMAP_DEV_AUTH_ALLOW_TUNNEL=1` を追加し、`*.trycloudflare.com` を一時許可する。本番/Cloud Run/共有URLでは絶対に有効化しない。`SUPABASE_JWT_SECRET` / `SUPABASE_AUTH_JWT_SECRET` がある場合はローカルでHS256 Supabase JWTも署名し、Supabase Authを呼ばずにRLS付きDBリクエストへ `Authorization: Bearer` を付ける。JWT secretが未設定で `SUPABASE_SERVICE_ROLE_KEY` がローカルにある場合、サーバー側 `createClient()` だけservice role keyでDBを読む。service role keyはブラウザへ返さず、本番/Cloud Runへローカルdev auth系envを設定しない。
- `/api/ai-tasks` の一覧取得は `select('*')` を使わず、一覧・バッジ・タイムラインに必要なカラムと `result` のJSON pathだけを取得する。巨大な `result` / `codex_thread_snapshot` / 生ログを一覧レスポンスへ載せない。マップ上の3秒更新では `view=status` と `source_task_ids=<現在表示中ノードID>` を使い、promptや `live_log` を含まない軽量status行だけを読む。同じノードに複数の `ai_tasks` がある場合は `created_at` が最新のものだけをノード状態の正とし、古い行や古いTurso snapshotで `未送信` / `実行中` / `確認待ち` / `接続失敗` のノードラベルを上書きしない。詳細ログが必要なメモ詳細・CodexNodePanel・progress詳細panelだけ、開いた瞬間にactivityをまとめて読み、開いている間だけ3秒pollで取り、Focusmapから送ったpromptとCodex側の発話をチャットとして表示する。CodexNodePanel とマインドマップのリンクメモ詳細はactivityを直接読み、古い `result.message` の稼働シグナルだけでチャットを組み立てない。activityがTurso progress/eventだけの場合も、Turso progressの `progress_json.source='activity_message'` に入っている `role` / `kind` / `importance` を復元し、送信内容とCodex返答を左右のチャットとして表示する。
- Web側の `useAiTasks` / `useMemoAiTasks` / `useNoteAiTasks` / `useScheduledTasks` は、広域の `ai_tasks` Realtime購読をやめ、Bearer付きREST snapshot取得へ寄せる。マップ用 `useMemoAiTasks` は初回と明示更新だけ通常取得し、アクティブなCodex task（`pending` / `running` / `awaiting_approval` / `needs_input`）がある間は `view=status` の軽量RESTを3秒更新する。表示中マップでは `source_task_ids` で現在のノードに絞る。ブラウザ/iPhoneがバックグラウンド中はinterval取得しない。一本化後のローカル `/api/codex/sync-node` は表示中ノードの通常3秒同期対象にせず、手動sync-now、debug、Mac supervisor monitor未起動時のfallbackだけに使う。
- runner状態表示は、Mac側がTurso `runner_heartbeats` へ実行中2秒・アイドル30秒で1 row upsertし、Web/スマホ側は30秒ごとに `/api/task-progress/runner-heartbeats` を読む。Macアプリ内の `Mac App Control` だけはElectron IPCでローカルSupervisorへ直接診断を頼めるが、通常ブラウザ・Webアプリ・スマホはローカルMacへ直接触らずTurso heartbeatを正本にする。Turso未設定または設定エラー時はSupabase `ai_runners.last_heartbeat_at` / `metadata.current_task_id` へfallbackする。オンライン判定窓は90秒にし、`current_task_id` と `metadata.agent_state` でMac agentの生存と実行中タスクだけを示す。正常終了時は `status='offline'` を1回送るが、異常終了時はstale heartbeatでoffline化する。互換用の `/agents/heartbeat` full registration は実行中60秒・アイドル10分程度に抑え、claim/command は15秒を基準にし、通信失敗時はbackoffする。`/api/agents/tasks/[id]/state` は他runnerの有効claim中taskだけを拒否し、`claim_expires_at` が過去の古いclaimは監視回復のため更新を許可する。`scripts/task-runner.ts` のCodex監視クエリは通常無効で、`FOCUSMAP_LEGACY_CODEX_MONITOR=1` を明示した互換/デバッグ時だけ動く。その時もローカルrunner user id（`FOCUSMAP_RUNNER_USER_ID` または `~/.config/life-manager/focusmap-user-id`）と `ai_runner_spaces` のenabled space、または `FOCUSMAP_RUNNER_SPACE_ID(S)` に基づいて対象を絞る。user id未設定の旧単一ユーザー環境だけ互換的に広域監視へfallbackする。Supabase制限エラーを検知した場合は pause file を作って制限中の無駄な巡回を止める。
- Codex監視の軽量データはTursoへ段階移行する。Turso schemaは `db/turso/migrations/20260605000000_codex_monitoring.sql` を正とし、`ai_tasks` / `ai_task_progress` / `ai_task_events` / `runner_heartbeats` / `task_progress_watches` / `screenshots` metadataだけを持つ。Next API側のTurso clientは `src/lib/turso/client.ts` に集約し、`TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`（または `LIBSQL_*`）はサーバー環境変数だけで使う。
- `/api/task-progress` はMac agentの軽量progress JSON POSTと、Web/iPhoneのprogress snapshot GETを受ける。Turso未設定時のGETは既存Supabase `ai_tasks.result` の最小JSON pathへfallbackする。`/api/task-progress/runner-heartbeats` はTurso未設定時も空配列ではなくSupabase `ai_runners` へfallbackし、POSTも `last_heartbeat_at` / `metadata.current_task_id` を軽量更新する。通常運用ではTursoを主にし、Supabase fallbackはTurso未設定・設定エラー時の互換経路としてだけ使う。POSTの通常tickは `ai_tasks` latest snapshot upsertだけを行い、`snapshot_only` なら `ai_task_progress` にinsertしない。`ai_task_events` は `thread_detected` / `running` / `resumed` / `awaiting_approval` / `needs_input` / `completed` / `failed` など状態変化だけをinsertする。既存 `/api/ai-tasks/[id]/live-log` と `/api/ai-tasks/[id]/activity` は、Tursoにprogress/eventがある場合はTursoを優先し、古いSupabase activity/resultは互換fallbackとして残す。
- 新規 `/api/ai-tasks` 作成、`/api/ai-tasks/schedule` 作成、`/api/agents/tasks/[id]/state`、`/api/agents/heartbeat`、`/api/ai-runners/heartbeat` は、Tursoが設定されている場合だけ軽量dual-writeする。dual-write失敗で既存Supabase導線を落とさない。agent token認証は5分メモリキャッシュし、Heartbeat/Progressで毎回Supabase token lookupへ戻らない。`/api/ai-tasks/schedule` はマップ表示に必要な `source_type` / `source_id` もTursoへ書き、直後のprogress snapshotだけでノードへ紐づけられる状態にする。
- `insertAiTaskActivityMessage` と `/api/ai-tasks/[id]/progress-check` はTursoへ軽量履歴をmirrorする。activityは `metadata.dedupe_key` と決定的なTurso progress id（`activity:<sha256>`）で同一メッセージを重複保存しない。さらに同一サーバープロセス内ではdedupe keyをメモリキャッシュし、3秒syncで同じactivityをTursoへ繰り返しupsertしない。2026-06-07以降、`FOCUSMAP_TURSO_ACTIVITY_PRIMARY` は未設定なら有効扱いにし、Turso保存成功後はSupabaseのactivity insertを省略する。Supabaseにもactivityをmirrorしたい検証時だけ `FOCUSMAP_TURSO_ACTIVITY_PRIMARY=0` を明示する。`FOCUSMAP_TURSO_OBSERVATIONS_PRIMARY=1` はobservation履歴のSupabase insert省略に使う。`ai_tasks.result` の最新summary更新は互換のため当面Supabaseに残すが、無変化pollや `codex_last_checked_at` だけの更新ではSupabaseへ書かない。
- スマホ/マップUIのCodex進捗表示は `/api/task-progress/snapshot?cursor=<updated_at>|<id>&limit=500` を読む。初回はcursorなし、以後は返却された `(user_id, updated_at, id)` cursor以降の差分だけ取得する。短周期snapshot APIでは `select('*')` / count / full scan を使わず、必ずcursor + limitで読む。`user_id, updated_at, id` と `space_id, updated_at, id` のTurso indexを使い、space経由の取得でもfull scanしない。マップ上では `source_type='mindmap'` / `source_id` があればそれを優先し、無い場合は既存 `source_task_id -> ai_task.id` の対応からsnapshot taskをマップノードへ紐づける。ノード上と看板では `pending=未送信`、`running=実行中`、`awaiting_approval/needs_input/completed=確認待ち`、元ノードが `status='done'` のsnapshotだけ `完了済み`、`failed=接続失敗` に丸めて表示する。ただし Turso snapshot の `dispatch_mode='manual'` で `needs_input`、またはthread未検出の `awaiting_approval` は `pending=未送信` として返し、外部アプリを開いただけのtaskを確認待ちへ出さない。`current_step` または `summary` の短縮表示だけを出す。`running` または `pending` / `awaiting_approval` / `needs_input` がある時、AI詳細panel/drawerを開いている時、マップのsnapshot取得は3秒pollにする。アクティブなCodex taskが無い時は45秒pollまたは手動更新にする。CodexNodePanel、リンクメモ詳細、詳細panel/drawerは開いた瞬間に `POST /api/task-progress/watch { task_id, action:'open' }`、表示中は10秒ごとに `ping`、閉じる時は `close` を送り、TTL 20秒程度のactive watchとして扱う。watch APIは期限切れから24時間超の `task_progress_watches` を軽くcleanupし、開閉の繰り返しでstorageが増え続けないようにする。マップ一覧では詳細ログを読まない。表示確認用に `?taskProgressFixture=1` または `localStorage.focusmap:task-progress-fixture=1` でrunning/completed/failed/awaiting_approvalのfixtureをマップへ重ねられる。Mac agentはCodex.app app-server/sqlite/rolloutをローカルで短周期に確認するが、Tursoへの通常snapshot送信は内容hashまたは活動時刻が変わった時だけにし、状態変化はforce送信する。チャット本文のactivity化はactive watchがあるtaskだけに限定する。
- active watch があるtaskは、通常の `focusmap-agent` monitorで通常巡回とは別に `ai_tasks.id` で追加取得する。互換runnerを `FOCUSMAP_LEGACY_CODEX_MONITOR=1` で明示有効化した検証時も同じ対象絞り込みを守る。これにより、詳細を開いている間は `pending` / `running` / `awaiting_approval` / `needs_input` の通常監視対象に加えて、既に `completed` などへ進んだwatch対象taskも即時同期・activity抽出の対象になる。スマホのChatGPT/Codexアプリへ手動で渡しただけの会話履歴はFocusmapから直接読めないため、thread未検出のmanual handoffは未送信として残し、再コピー・Codexを開く導線で人間の手動送信を継続できるようにする。既存manual handoffをUIの通常操作で `dispatch_mode='auto'` へ昇格しない。
- 2026-06-05のローカル検証では、`npm run dev` を `.env.monitoring.local` 読み込み付きで `localhost:3001` 起動し、Mac agentの `AgentApiClient` / Codex.app app-serverから `http://127.0.0.1:3001/api/task-progress` へ送ったprogressをTurso snapshot経由でマップに反映できた。API snapshotのrunning反映は約0.8秒、マップUIのrunning表示は約1.3秒、awaiting/completed/failedも表示中画面では1秒以内に反映し、dev server停止後の再読み込みでも最終状態は残った。2026-06-06以降、詳細panelを開くまで `/api/task-progress?task_id=...&limit=50` は呼ばれず、開いている間だけ3秒tail pollと3秒local `/api/codex/sync-node` になる。一方、既存の `/api/ai-tasks?source=linked&limit=300` は別の開いているdashboard/Macアプリ状態により多めに出ることがあるため、マップ表示中は `source_task_ids` で表示中ノードに絞る。完了/失敗/確認待ち/入力待ちのタスクは古い `result.codex_run_state='running'` だけでrunning扱いしない。
- Mac agentから `/api/task-progress` へ送るpayloadは、`result.live_log` / `output` / 生のCodex通知全文を含めない。`current_step` は `Codex.appが作業中です` / `確認待ち` など状態語を600文字以内、`summary` は最終活動時刻つきの稼働シグナルを1200文字以内に抑え、`progress_json` は `executor` / `codex_run_state` / `codex_thread_id` / `last_activity_at` / 直近8steps / 文字数などのcompact metadataだけにする。API側でも `live_log` / `output` / raw log / thread full history / image body 系キーは `progress_json` から落とす。これによりTursoの `ai_tasks` は一覧表示用pulse snapshot、`ai_task_progress` は短いtail履歴、`ai_task_events` は状態変化イベントを持ち、全文ログの保管場所にはしない。1 runnerのアイドル30秒heartbeatは約0.086M write/月、24時間ずっと実行中で2秒heartbeatになった最悪ケースは約1.296M write/月で、running snapshotはhashまたは活動時刻変化時のみ1秒最短、状態event/progress tailは小さく保つ。全taskが1秒ごとに毎回内容変化するケースは上振れするため、raw log保存や毎tick progress insertは禁止する。Web側3秒pollはDB writeを増やさない。チャット本文syncも1秒ごとにrolloutを確認するだけで、DB writeは新しい可視メッセージ・状態変化・初回thread検出に限定する。auto実行の `running -> awaiting_approval` 遷移では、同じ状態更新リクエストにCodex側の可視発話だけを同送して、詳細open後の初回ローカル回収待ちを発生させない。1 foreground画面を24時間開き続ける最悪ケースは約864,000 request/月で、通常の2時間/日利用なら約72,000 request/月。差分なしsnapshotはcursor index確認と空配列応答だけで、マップfallbackの `view=status` は表示中ノードIDに絞るため、20ノードでも1回あたり数KB〜十数KB程度を想定する。20ノード・10KB/回・2時間/日なら約0.72GB/月、24時間開きっぱなしでも約8.6GB/月が目安。activity本文は1 syncあたり最大16件抽出・taskごと最大50件保持で、同一dedupe keyはTurso/Supabaseへ再送しない。無料枠運用では「3秒pollは前面表示中かつアクティブtaskあり」に限定し、バックグラウンドでは停止する。
- スクショpreview試験導入はR2を使う。`src/lib/r2/client.ts` がR2 S3互換clientと署名URLをserver-onlyで持ち、`R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_SCREENSHOT_BUCKET`（または互換env）はクライアントへ出さない。`/api/screenshots` はoriginalを拒否し、thumbnail/previewだけR2へ保存し、metadataをTursoへ保存する。通常uploadは1分未満を429にし、`upload_reason=state_change|error|awaiting_approval|user_requested|manual` の時だけ間隔制限を緩める。
- スクショ画像は一覧取得で署名URLを返さない。`/api/screenshots/[id]/url?variant=preview|thumbnail` で表示時だけ60〜900秒の署名付きURLを発行する。削除は `/api/screenshots/[id]` でmetadataをsoft deleteし、R2 object削除も試みる。
- Mac agent側のスクショ原本保存とWebP圧縮は `scripts/focusmap-agent/src/screenshot-preview.ts` を使う。原本は `~/.focusmap/screenshots/<taskId>/` に保存し、クラウドへ送るのは800KB以下のpreview WebPと120KB以下のthumbnail WebPだけにする。`AgentApiClient.uploadScreenshotPreview()` はこのbundleを `/api/screenshots` へmultipart uploadする。
- Turso/R2の外部設定値を取得した後は、`.env.monitoring.local` に `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` / `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_SCREENSHOT_BUCKET` を置き、`npm run codex-monitoring:set-secrets` でGitHub Secretsへ登録し、`npm run codex-monitoring:migrate-turso` でTurso schemaを適用する。GitHub ActionsのCloud Run deployはこれらのSecretsをruntime envへ渡す。
- SupabaseからTursoへのCodex監視backfillは `npm run codex-monitoring:backfill -- --days 30 --dry-run` で必ず対象件数・推定write・既存skip候補を確認してから、必要な時だけ `--apply` で実行する。スクリプトは `.env.monitoring.local` / `.env.local` を読み、Supabase service role keyはローカル/サーバー実行だけで使う。対象はCodex系 `ai_tasks` の軽量カラム、`result` の `current_step` / `progress_summary` / tail化した表示用文言、直近件数制限付きのactivity/observationだけで、Supabase Storage画像や全文 `live_log` / raw resultは移行しない。2026-06-05の初回30日backfillでは `ai_tasks` 79件、progress 82件、events 79件をTursoへ投入し、`ai_task_activity_messages` は本番Supabase schema cacheに無かったためスキップした。

### Focusmap MacアプリMVP

- Mac版は、FocusmapのUIをSwiftUI等で作り直さない。既存のNext.js/React UIをElectronのBrowserWindow内で表示し、ブラウザではできないローカル機能だけをElectronメインプロセス側へ寄せる。
- 開発・自分用起動は `npm run mac:dev`。起動直後は軽量なローディング画面付きのメインウィンドウを先に開き、その後非同期で `http://127.0.0.1:3001/dashboard?desktop=1&source=mac` に遷移する。3001にFocusmapがいなければ、その時点で `next dev -p 3001` を自動起動し、待機中にユーザーへ画面を返す。ブラウザ版 `npm run dev` と分けるため、Macアプリ用には `npm run dev:desktop` を使う。
- Macアプリ開発時は `127.0.0.1:3001` を正規のローカルオリジンとして扱う。Next dev server の `_next/*` chunk 読み込みが `allowedDevOrigins` でブロックされると、マップなど遅延読み込みビューへの切替時に Electron 画面が `Application error` になるため、`next.config.ts` の `allowedDevOrigins` には `127.0.0.1` / `::1` を含める。
- 配布/パッケージ版は `next dev` を使わない。`npm run mac:build` で同梱した Next standalone server をElectron本体のNode実行モードで起動し、Next.js dev indicator や開発用エラーoverlayをユーザーに見せない。BrowserWindowはユーザーにURL/localhostを意識させず、内部URLへ遷移する。
- 配布/パッケージ版の内部Nextは固定3001を使わず、起動時に `127.0.0.1` の空きポートを選ぶ。選んだportはそのプロセス内の `APP_ORIGIN` として扱い、`focusmap-agent` のruntime configにも同じ `http://127.0.0.1:<port>/api` を渡す。これにより他プロジェクトや古い開発サーバーが3001を使っていても配布アプリは衝突しない。開発・スマホ確認・Cloudflare tunnelだけは従来通り3001固定にする。
- Dock/FinderからMacアプリを起動した場合、開発起動では3001がすでに接続受付中なら `/api/desktop/health` の完了を待たず先に `/dashboard?desktop=1&source=mac` へ遷移し、ヘルス確認は裏で続ける。パッケージ版ではMacアプリが起動したNextだけを正とし、`FOCUSMAP_DESKTOP_HEALTH_TOKEN` を `/api/desktop/health` で照合する。開発起動で3001を別プロジェクトや古いNextが握っている場合は、そのWebを誤って表示せず、メインウィンドウのローディング画面に「3001番を使っている古いNext/別プロジェクトを終了」と出す。ローディング画面で止まっている既存インスタンスへDockクリック/二重起動/activateが来た場合も、ウィンドウを前面化して同じ再試行を走らせる。起動ログは `~/.focusmap/logs/desktop-app.log` にも保存する。
- Dockアイコンの設定は起動を妨げない。`Resources/icon.icns` の読み込みに失敗した場合はASAR内の `assets/icon.png` を試し、それでも失敗した場合はログだけ残してウィンドウ生成とダッシュボード遷移を継続する。
- 配布/パッケージ版をFinderやDockから起動した場合、macOSのPATHには `node` が無いことがあるため、同梱Next standaloneやagent CLIは `node` コマンドに依存しない。パッケージ版ではElectron本体を `ELECTRON_RUN_AS_NODE=1` でNode実行モードにして子プロセスを起動する。子プロセスのspawn失敗はメインプロセス例外にせず、`~/.focusmap/logs/desktop-app.log` に出す。
- MacアプリのDock/Finderアイコンは、Web UI左上と同じFocusmapロゴを `desktop/focusmap-mac/assets/icon.icns` として使う。開発起動時は `desktop/focusmap-mac/assets/icon.png`、パッケージ版の起動中Dock表示は `Resources/icon.icns` を設定し、Finder表示と起動中表示でアイコンが切り替わらないようにする。Dockへの永続固定はユーザーのmacOS設定で、アプリ側は起動中に通常アプリとしてDockへ表示する。
- Macアプリの状態確認は `/api/desktop/health` を使い、重い `/dashboard` 初期化やAI/DB接続テストをヘルスチェックで走らせない。
- Macアプリ内でGoogle Calendar連携を開始した場合、Google OAuth画面はElectron内WebViewではなく既定ブラウザへ逃がす。ローカルに `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` がある場合は `/api/calendar/connect?desktop_oauth=1` でElectron内のSupabaseセッションを一時的にローカルメモリへ保持し、外部ブラウザから `/api/calendar/callback` に戻った時に同じユーザーのGoogleトークンを保存する。ローカルにGoogle OAuth設定がない場合は `https://focusmap-official.com/api/calendar/connect` を既定ブラウザで開き、ブラウザ側のFocusmap/GoogleログインCookieを使う。Google公式方針に合わせ、Google認証ページをElectron内に表示しない。
- MacアプリのFocusmapログインでGoogleを選んだ場合も、Googleアカウント選択/認証画面はElectron内WebViewではなく既定ブラウザへ逃がす。ログイン画面はElectron IPCで `FOCUSMAP_WEB_AUTH_ORIGIN`（既定 `https://focusmap-official.com`）を受け取り、外部ブラウザで `https://focusmap-official.com/auth/native-start?desktop=1&nonce=...` を開く。外部ブラウザ側でSupabase OAuthを開始し、PKCE code verifierも同じブラウザ側に保存する。`/auth/callback?desktop=1&nonce=...` は本番側の一時メモリにSupabaseセッションを保存し、Macアプリ側はElectronメインプロセス経由で本番 `/api/auth/desktop-session?nonce=...` をポーリングして `supabase.auth.setSession` する。加えて、完了ページは `focusmap://auth-complete?desktop=1&nonce=...` のカスタムURLで同じセッションをMacアプリへ直接渡す。Macアプリはログイン開始時に記録した5分TTLのnonceと一致する場合だけ受け入れ、snake_case / camelCase どちらのセッション形式でも `auth-session.json` に保存し、保存直後にCookie復元を走らせてダッシュボードへ戻す。保存に失敗した場合だけログイン画面復元へfallbackする。これによりCloud Run/Nextのプロセス内メモリhandoffが別インスタンスで外れても、1回目の外部ブラウザ認証完了を取りこぼしにくくする。一般Webログインは従来通りブラウザ内リダイレクトを使う。
- MacアプリのFocusmapログインセッションはElectronの固定プロファイル `~/Library/Application Support/focusmap-desktop-shell` に保存し、さらにログイン完了・メールログイン・トークン更新時に `auth-session.json` へ保存する。`safeStorage` が使えるMacでは暗号化し、使えない環境では権限600のローカルファイルとして保存する。`src/components/auth/desktop-auth-session-bridge.tsx` は全ページでElectron shellを検出し、ダッシュボード表示後の既存Cookie/トークン更新もローカル保存へ同期する。次回起動時はMacアプリ本体がこのローカルセッションを先に読み、access tokenが期限間近ならrefresh tokenで1回だけ更新してからSupabase SSR Cookieを固定プロファイルへ戻す。`/dashboard` がログインへ戻された場合でも、ログイン画面が同じローカルセッションを読み、`supabase.auth.setSession` してからダッシュボードへ戻す。明示ログアウト時はElectron IPCで `auth-session.json` と復元用Cookieを削除する。
- Web UI上のGoogle Calendar接続ボタンは `src/lib/external-auth-launch.ts` の `startCalendarOAuth` を通す。MacアプリではElectronのナビゲーションハンドラが既定ブラウザへ逃がし、通常ブラウザでは従来通り `/api/calendar/connect` に遷移する。
- Macアプリから起動するNext.jsには、リポジトリの `.env` / `.env.local` と `~/.focusmap/desktop.env` を読み込ませる。`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` がない場合は、空の `client_id` でGoogleへ飛ばさず、Focusmap側の `calendar_error=google_oauth_not_configured` に戻す。
- Macアプリ/常駐runnerまわりの実行ログは、リポジトリ直下の `logs/` ではなく `~/.focusmap/logs/` に出す。即時Codex実行のstdout/stderrも同じディレクトリへ寄せ、リポジトリサイズに実行ログを混ぜない。
- Macアプリは薄いWeb shell + ローカルSupervisorとして、packaged通常起動では本番 `/dashboard?desktop=1&source=mac` を表示し、`scripts/focusmap-agent/dist/cli.js`、`scripts/run-codex-app-server.sh`、Codex監視loopを同じ起動pipelineで確認する。接続不備はローディング/health/status上で「Web」「agent」「Codex app-server」「権限」のどれが足りないかを示す。ローディング画面はremote modeでは「Focusmap Web を読み込み中」、local modeでは「ローカル Next.js を起動中」と表示を分け、15秒以上進まない場合や `did-fail-load` では「もう一度開く」「ブラウザで開く」を出す。ローディング画面のIPCは同梱 `loading.html` からの再試行/外部ブラウザ起動だけ許可する。agentの設定は従来通り `~/.focusmap/config.json` を使い、Macアプリ内にservice role key等は置かない。開発起動と明示fallback時だけNext 3001をMacアプリから起動・表示する。
- 開発中のMacアプリでは、`~/.focusmap/config.json` の `api_url` が本番APIを向いていても、agent起動時だけ `~/Library/Application Support/Focusmap/agent-config.json` に一時設定を作り、`api_url` を `http://127.0.0.1:3001/api` へ向ける。この場合、agent起動前に3001のNext APIも自動起動する。これにより本番Cloud Run側の環境変数に依存せず、ローカルNext API経由で `ai_tasks` を同期できる。packaged remote modeでは同じruntime config生成を使って `api_url` を `https://focusmap-official.com/api` へ固定し、`FOCUSMAP_DESKTOP_AGENT_API_URL` がある時だけそれを優先する。
- MacアプリはWeb UIを包む薄いshellであり、ローカルSupervisor/`focusmap-agent` はagent起動、Codex app-server確認、heartbeat、Codex thread監視を担当する。Macアプリ内のメモ詳細・マップノード詳細・リンクメモ詳細でも通常本番Web、ローカルWeb、Cloudflare preview、スマホと同じ manual handoff を維持し、Focusmapはユーザー本文だけのprompt / metadata上のhandoff token / ai_task tracking packageを作る。Macアプリ内ではElectron bridge、通常ローカルWebでは `/api/codex/open-repo`、スマホではネイティブ/ChatGPT mobile bridgeでクリップボードコピーとCodex.app起動まで補助する。Electron/agent側は `ANTHROPIC_API_KEY` / `CLAUDECODE` を外した環境でローカルsqlite/rollout/app-serverを単一monitorとして監視し、Turso snapshot/eventへ同期するが、manual taskに対して勝手に `thread/start` / `turn/start` を送らない。
- 配布用の最初の形は未署名の自分用ビルドでよい。`npm run mac:build` は古い `.next` / `dist-desktop/mac-arm64` を削除してから `next build` し、Nextの `react-loadable-manifest.json` に残る存在しない静的チャンク参照を補正・検査してから `dist-desktop/` へ arm64 の `.app` ディレクトリを作る。packaged app側の `next-standalone/.next` も同じ静的参照検査を通す。実利用時は `dist-desktop/.../Focusmap.app` をDockへ固定せず、`npm run mac:install` または `npm run mac:build:install` で `/Applications/Focusmap.app` に配置してからDockへ追加する。インストールはmacOS `.framework` の相対シンボリックリンクを壊さないよう `ditto` でコピーし、ローカル実行用にad-hoc署名する。`dist-desktop` は次回ビルドで削除されるため、Dockがここを指すと `?` アイコンになる。一般配布する場合はDeveloper ID署名・notarizationを別途追加する。
- Macアプリのパッケージングは `desktop/focusmap-mac` をElectron app directoryにし、rootの巨大な `node_modules` をアプリ本体へ入れない。Next standaloneはローカルfallback用に `extraResources/next-standalone` として同梱するが、packaged通常起動のUIは本番Webを開く。`focusmap-agent` は packaged app から単体起動できるよう `scripts/focusmap-agent/dist` と同ディレクトリの `node_modules` を `extraResources/focusmap-agent` へ同梱する。`npm run mac:prepare-agent` は `scripts/focusmap-agent` の依存を確認し、欠けていれば `npm ci` 後に `npm run build` する。`mac:dev` / `mac:build` / `mac:dist` はこの準備を先に通し、packaged appが `ws` 等のruntime依存不足でagentを起動できない状態を作らない。Nextの `outputFileTracingExcludes` では `mobile/**` / `.git/**` / `dist-desktop/**` を除外し、iOS Podsやビルド成果物がMacアプリへ混入しないようにする。Cloud RunデプロイだけでMacアプリ内UIを更新でき、Electron bridge側（Codex起動・クリップボード・agent制御・IPC allowlist）を変えた時だけMacアプリ再ビルド/再インストールが必要になる。

### Focusmap iPhoneアプリMVP

- iPhone版の初期実装は `mobile/focusmap-app` のExpo/React Nativeアプリを使う。既存Next.jsのモバイルUIを捨てず、React Native側は起動画面・読み込み状態・エラー復旧・ネイティブインストール枠を担当し、アプリ本体は `react-native-webview` で `/dashboard` を表示する。
- iPhoneアプリの WebView では `mediaCapturePermissionGrantType="grantIfSameHostElsePrompt"` を指定し、同一ホストのマイク許可を再利用する。Expo `app.json` の `ios.infoPlist` には `NSMicrophoneUsageDescription` / `NSCameraUsageDescription` / `NSPhotoLibraryUsageDescription` / `NSPhotoLibraryAddUsageDescription` を日本語で設定し、画像選択やマイク許可のシステム表示が日本語ロケールに寄るよう `CFBundleDevelopmentRegion` / `CFBundleLocalizations` を `ja` にする。生成済み `mobile/focusmap-app/ios` はgit管理外なので、ソース上の正は `app.json`、`App.tsx`、`plugins/withFocusmapExternalOpener.js`。
- 標準の接続先は `https://focusmap-official.com/dashboard?source=ios-app&standalone=1`。スマホプレビューやローカル検証では、ビルド前に `EXPO_PUBLIC_FOCUSMAP_URL` でCloudflare tunnel等のURLへ差し替える。
- アプリが本番URLを読んでいる限り、Web UI/JSの変更はCloud Runデプロイで反映される。ネイティブ側の `App.tsx`、権限、bundle identifier、`EXPO_PUBLIC_FOCUSMAP_URL`、WebView bridge処理を変えた場合は、Webデプロイだけでは反映されず、iPhone実機へ再ビルド/再インストールが必要。
- iPhone版WebViewの `pullToRefreshEnabled` は無効。画面全体をリロードするネイティブpull-to-refreshではなく、Web UI側の `Todo > 予定` ヘッダーpull更新でカレンダー同期だけを実行する。
- iPhone版の起動画面はWebViewの初回描画を隠し続けない。全画面ローディングは初回の短時間だけにし、WebView/ブラウザストレージに残るダッシュボード・予定キャッシュを先に表示してから、Web側のfocus/visibilityイベントで裏側更新を走らせる。再表示や認証復帰では前回描画済みのUIを維持し、通信エラー時も既に表示できている画面をエラー画面で置き換えない。
- Apple Developer Programに入らない初期検証では、Xcodeの無料Personal Teamで実機へ直接インストールする。ホーム画面にはFocusmap専用アイコンが出るが、無料署名は7日で切れるため、継続利用には再インストールが必要。
- 実機インストールの入口は `mobile/focusmap-app/scripts/install-ios-free.sh`。Xcode本体がないMacでは実行を止め、`xcode-select` とライセンス承認の手順を表示する。`ios/` がない場合はExpo prebuildとPodsを再生成し、接続済みiPhoneを `xcrun devicectl` のJSON出力から検出する。実機ビルドは `xcodebuild -allowProvisioningUpdates -allowProvisioningDeviceRegistration` を使い、生成された `Focusmap.app` を `devicectl device install app` でiPhoneへ入れる。Expo CLI経由では無料Personal Teamのプロビジョニング自動生成オプションを渡せないため、実機インストールの標準導線は直Xcodeビルドにする。
- 無料Apple IDルートでは、XcodeのSigning & CapabilitiesでPersonal Teamを一度選ぶ必要がある。`security find-identity -v -p codesigning` にApple Development証明書がない場合、`install-ios-free.sh` は重いビルド前に止める。署名画面を開く入口は `npm run ios:signing` / `mobile/focusmap-app/scripts/open-ios-signing.sh`。初回起動で「信頼されていないデベロッパ」が出た場合は、iPhoneの `設定 > 一般 > VPNとデバイス管理` で開発元を信頼する。
- iPhoneアプリ内のGoogle認証はWebView内にGoogle画面を表示しない。`mobile/focusmap-app/App.tsx` が `accounts.google.com` / `oauth2.googleapis.com` / Supabase Auth URLを検出したらSafariへ開き、`focusmap://...` の戻りURLを受けてWebViewを更新する。
- iPhoneアプリ内の外部URL起動は、WebView側が `focusmap:openExternal` messageを送るか、React Native側の `onShouldStartLoadWithRequest` が非HTTP/外部認証URLを検出した時に `Linking.openURL(url)` でOSへ渡す。Codex mobile起動もこのbridgeを使い、WebView内で `chatgpt.com` を表示し続けない。通常テキストの `focusmap:copyText` は `expo-clipboard` で端末クリップボードへ書き込む。Codex handoffの `focusmap:copyAndOpenExternal` は初回起動では `text` だけを受け、`FocusmapExternalOpener.copyCodexHandoff()` が利用できるiOSアプリではテキストをOSクリップボードitemへ保存してから外部URLを開く。画像コピー操作は `focusmap:copyCodexImage` と `imageUrl` を受け、`FocusmapExternalOpener.copyCodexImage()` が利用できるiOSアプリで画像だけをpasteboard itemへ保存する。native moduleが無い/失敗した時はテキストコピーへfallbackし、画像はWeb UI上のコピー導線を残す。`focusmap:openExternal` に `urls` が含まれる場合は、React Native側で候補を重複排除し、ChatGPT Codex公式URLだけは `FocusmapExternalOpener.openUniversalLink()` から `UIApplication.open(..., universalLinksOnly: true)` で試す。これに失敗した場合はSafariを成功扱いにせず次候補へ進む。
- iPhoneアプリ内のGoogleログインは、ログイン画面が `/auth/native-start?native_app=ios&nonce=...` をReact Native WebView bridgeから外部ブラウザーへ渡す。Supabase OAuth URLは外部ブラウザー側で生成し、PKCE code verifierも同じブラウザーに保存する。`/auth/callback?native_app=ios&nonce=...` は外部ブラウザー側でコード交換後に一時セッションを保存し、`focusmap://auth-complete?nonce=...` でアプリへ戻す。アプリは `/auth/native-bridge?nonce=...` をWebViewで開き、`/api/auth/desktop-session` から受け取ったSupabaseセッションを `supabase.auth.setSession` してから `/dashboard?source=ios-app&standalone=1` へ戻す。
- iPhoneアプリ内のGoogle Calendar連携は、WebView内で `/api/calendar/connect?app_oauth=ios` を開始し、サーバー側で現在のSupabaseセッションをOAuth stateに紐づけてからSafariへGoogle同意画面を開く。`/api/calendar/callback` はSafari側Cookieに依存せず保存済み一時セッションで `user_calendar_settings` にトークンを保存し、`focusmap://calendar-connected` でアプリへ戻す。

### Codexログ表示方針

- Focusmapに表示する主ログは、Codexの日本語/ユーザー向け返答本文を中心にする。
- `function_call` / `custom_tool_call` / `web_search_call` / `tool_search_call` などの内部コマンド開始ログは主ログへ混ぜない。
- Codex.app bridgeが観測した追加情報は `result.codex_sync_log` に保持し、通常のチャット表示とは分ける。
- `ai_task_activity_messages` とTurso activity progress/eventをチャットUIの主データにする。`result.live_log` / `result.codex_sync_log` は互換・debug用、`result.codex_thread_snapshot` はCodex.app上のthread metadata、`codex_last_checked_at` はmonitorの同期間引き用に限定し、通常チャットはraw command logから組み立てない。
- マインドマップの `CodexNodePanel` は送信後も閉じず、`ai_tasks` とローカルCodex状態を見ながら、未送信/実行中/確認待ち/接続失敗を表示する。開始前の通常操作は `Codexに送信` を出し、開始後は再コピーや状態確認を必要最小限にして、送信した内容とCodex側の返答を読むチャット表示を主にする。画像はdeep link自動添付を前提にせず、署名URL/local path/clipboard案内とCodex.app側の手動attachを併用する。

### 関連ファイル

| 領域 | ファイル |
|------|----------|
| Codex状態判定/rollout解析 | `src/lib/codex-run-state.ts` |
| Codex監視UIの4状態丸め | `src/lib/task-progress-ui.ts` |
| Supabase JWTオフライン検証 | `src/lib/auth/verify-supabase-jwt.ts` / `src/lib/auth/supabase-auth-fetch.ts` |
| Web側のai_tasks取得/更新間隔 | `src/hooks/useAiTasks.ts` / `src/hooks/useMemoAiTasks.ts` / `src/hooks/useNoteAiTasks.ts` |
| マインドマップ表示/状態バッジ/手動更新 | `src/components/mindmap/custom-mind-map-view.tsx` |
| ダッシュボードからCodex状態を渡す層 | `src/components/dashboard/mind-map.tsx` |
| モバイルマップ/Codex看板接続 | `src/components/mobile/mobile-mind-map.tsx` |
| マップ下/モバイル下シートのCodex看板 | `src/components/task-progress/task-progress-kanban.tsx` |
| Codex progress詳細panel/drawer | `src/components/task-progress/task-progress-detail-panel.tsx` |
| メモ編集パネル/Codex手動ハンドオフ | `src/components/codex/codex-node-panel.tsx` |
| Codex.app deep link生成/起動分岐 | `src/lib/codex-app-launch.ts` |
| Codex.app起動補助 | `src/app/api/codex/open-repo/route.ts` |
| ノードに紐づくCodex thread取得 | `src/app/api/codex/node-thread/route.ts` |
| Mac supervisor/agent/Codex同期 | `desktop/focusmap-mac/main.cjs` / `scripts/focusmap-agent/src/cli.ts` / `scripts/focusmap-agent/src/executors/codex-app.ts` / `scripts/task-runner.ts`（legacy互換） |
| Focusmap Liteセットアップ | `scripts/install.sh` / `src/components/workspace/setup-step-agent.tsx` |
| Focusmap MacアプリMVP | `desktop/focusmap-mac/main.cjs` / `desktop/focusmap-mac/loading.html` |
| Focusmap iPhoneアプリMVP | `mobile/focusmap-app/App.tsx` / `mobile/focusmap-app/scripts/install-ios-free.sh` |
| アプリ外部Google認証 | `src/lib/external-auth-launch.ts` / `src/app/auth/native-start/page.tsx` / `src/app/auth/native-bridge/page.tsx` / `src/app/api/calendar/connect/route.ts` |

---

## 主要なコンポーネント一覧

### Dashboard Components (8ファイル)
- `center-pane.tsx` (1,147行) - リストビュー
- `mind-map.tsx` (2,266行) - マインドマップビュー
- `left-sidebar.tsx` (118行) - 目的・プロジェクト選択
- `right-sidebar.tsx` (90行) - カレンダーパネル
- `sidebar-calendar.tsx` (160行) - カレンダー表示・操作
- `sidebar-calendar-header.tsx` (132行) - カレンダーヘッダー
- `calendar-settings.tsx` (165行) - カレンダー設定
- `mindmap-display-settings.tsx` (186行) - マインドマップ表示設定

### Calendar Components (11ファイル)
- `calendar-view.tsx` (148行) - ビューマネージャー
- `calendar-week-view.tsx` (275行) - 週ビュー
- `calendar-3day-view.tsx` (283行) - 3日ビュー
- `calendar-day-view.tsx` (182行) - 日ビュー
- `calendar-month-view.tsx` (133行) - 月ビュー
- `calendar-header.tsx` (159行) - ナビゲーション
- `calendar-selector.tsx` (258行) - カレンダー選択
- `calendar-event-card.tsx` (143行) - イベントカード
- `calendar-task-block.tsx` (139行) - タスクブロック
- `mini-calendar.tsx` (71行) - ミニカレンダー
- `calendar-toast.tsx` (76行) - トースト通知

### Task Components (4ファイル)
- `task-calendar-select.tsx` (135行) - カレンダー選択ドロップダウン
- `task-time-input.tsx` (166行) - 所要時間入力
- `task-calendar-sync-status.tsx` (59行) - 同期ステータス表示
- `index.ts` (1行)

---

## API エンドポイント一覧

### 認証
- `GET /api/auth/callback/google` - Google OAuth コールバック

### カレンダー連携
- `POST /api/calendar/connect` - カレンダー接続
- `GET /api/calendar/callback` - 認可コールバック
- `POST /api/calendar/disconnect` - カレンダー切断
- `GET /api/calendar/status` - 接続状態確認
- `GET /api/calendar/list` - カレンダーリスト取得
- `POST /api/calendar/sync-task` - タスク→カレンダー同期
- `PATCH /api/calendar/sync-task` - カレンダーイベント更新
- `DELETE /api/calendar/sync-task` - カレンダーイベント削除
- `GET /api/calendar/events/list` - イベント取得
- `GET /api/calendar/find-free-time` - 空き時間検索

### カレンダー管理
- `GET /api/calendars` - カレンダー一覧
- `PATCH /api/calendars/[id]` - カレンダー更新

### 通知
- `GET /api/notifications/permission` - 通知権限確認
- `GET /api/notifications/settings` - 通知設定取得
- `POST /api/notifications/settings` - 通知設定更新
- `POST /api/notifications/schedule` - 通知スケジュール
- `POST /api/notifications/initialize` - 通知初期化
- `POST /api/notifications/cancel` - 通知キャンセル

### タスク
- `POST /api/tasks/[id]/schedule` - タスクスケジュール
- `POST /api/tasks/[id]/time` - タスク時間更新

---

## データベース構成

### メインテーブル
- `tasks` - タスク（親子関係、カレンダー連携）
- `task_groups` - タスクグループ
- `projects` - プロジェクト
- `goals` - 目標

### カレンダー連携
- `user_calendar_settings` - Google Calendar 設定
- `calendar_sync_log` - 同期ログ

---

## 技術スタック
- **フロントエンド**: Next.js 16.1.3 (App Router), React 19
- **UI**: Radix UI, Tailwind CSS 4, Lucide Icons
- **バックエンド**: Supabase (PostgreSQL), Google Calendar API
- **認証**: NextAuth + Supabase SSR
- **マインドマップ**: ReactFlow, Dagre
- **カレンダー**: react-day-picker, カスタム実装
- **ドラッグ&ドロップ**: @hello-pangea/dnd, カスタム
- **通知**: Web Notifications API

---

## 実装済み機能
- ✅ ユーザー認証（Google OAuth + Supabase SSR）
- ✅ マインドマップ（ReactFlow）
- ✅ タスク管理（タイマー、優先度、見積もり時間）
- ✅ Google カレンダー連携（OAuth、イベント取得・同期・キャッシュ）
- ✅ 通知システム（Service Worker）
- ✅ カレンダーUI（日/週/月ビュー、ミニカレンダー、ダークモード）
- ✅ ダッシュボード（3ペイン構成）
- ✅ 設定ページ
- ✅ タスク入力自動フォーカス（新規作成時）

---

## 実装中
なし

---

## 次のアクション
→ `/next` で次のタスクを決定

---

最終更新: 2026-02-08
