親計画: ../program.md ／ 分類: repo ／ 種別: 新規作成 ／ 委任: Codex（gpt-5.6-sol）

# 01 focusmap接続とクエリ層

## 目的

focusmapのTurso接続を単一DB前提から名前付き複数クライアントへ一般化し、personal-os-board / personal-os-inbox を読むクエリ層を作る（UIはここでは作らない）。

## 対象ファイル（3ファイル以内）

1. `src/lib/turso/client.ts` … 一般化。既存 `getTursoClient()` の挙動は完全互換で維持し、`getPersonalOsBoardClient()`（env `PERSONAL_OS_BOARD_DATABASE_URL`/`PERSONAL_OS_BOARD_AUTH_TOKEN`）と `getPersonalOsInboxClient()`（env `PERSONAL_OS_INBOX_DATABASE_URL`/`PERSONAL_OS_INBOX_AUTH_TOKEN`）を追加。
2. `src/lib/turso/personal-os-board.ts` … 新設のクエリ層。
3. `.env.example`（無ければ相当ファイル） … 新env4つの記載（値は空）。

## クエリ層の関数（すべて日付JST・数字の定義は保存SQLと同一）

- `getDailyTotals(date)` … run/wait/sub の3値合計＋稼働中数。正本: hooks-registry/hooks/session-board/queries/daily-totals.sql
- `getGoalRollup(date)` … goal別 run/sub/wait 分（画面①用）。**goal帰属はsession_key単位の最新goal**（addイベントはgoal=?で確定するため、イベント行のgoalをそのまま使わない）
- `getSessionBreakdown(date)` … session_key別 run/wait/sub 分＋最新goal・ラベル。正本: session-durations.sql
- `getStuckWait(thresholdMin=15)` … 最新状態がwaitのままN分超の一覧。正本: stuck-wait.sql
- `getCurrentSessions()` … sessionsテーブル現在値（goal/now/state/sub_n）。**stateはsession_eventsの各session_key最新イベントで補正**（reconcile降格の未反映に対する保険）
- `getFinishedLogs(date)` … session_logs の当日分（✔表示用・時刻昇順）
- `getDeclaredGoals(date)` … inboxのgoals当日分（宣言・未着手判定用）

## 集計の規則（正本SQLからの移植条件）

- 区間集計はLEADウィンドウ相当（次イベントまでの分）。最終区間は `DATETIME('now','+9 hours')` 止め・1区間720分上限。
- 待ち=state 'wait' のみ。'sub' は待ちに入れない。
- 数字が保存SQL3本の結果と一致すること（検証は04で実施するが、定義の逸脱をしない）。

## 制約

- ブランチ `feat/sessions-dashboard` を作って作業しコミット（push禁止）。
- 既存 `getTursoClient()` 利用箇所に回帰を出さない。型チェック/lint（package.jsonにあるもの）を通す。
- secret・トークン値をコード・コミットに書かない（envのみ）。

## 完了条件（レビュー項目）

- [ ] 既存接続と新2クライアントが共存し、既存画面に回帰がない（ビルド/lint通過）。
- [ ] クエリ層7関数が上記規則どおり実装され、goal帰属・最新イベント補正・720分capが入っている。
- [ ] env4つが.env.example相当に記載され、値はどこにも書かれていない。
- [ ] feat/sessions-dashboard にコミットされている（push無し）。
