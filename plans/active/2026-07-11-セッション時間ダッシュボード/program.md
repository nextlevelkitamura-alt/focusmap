分類: repo ／ 種別: 新規作成 ／ 規模: ミドル

# セッション時間ダッシュボード program（personal-os-board可視化）

## 目的

personal-os の session-board が Turso に記録する状態遷移ログを、focusmap のWeb画面で見る。主役は「今日の目標」: 目標を先に宣言し、目標ごとに「メインを何分実行させ・サブを何分動かし・何分待たせているか」を一目確認する。⏸放置も拾う。

## 全体像（2026-07-11 壁打ちv2.1で確定）

- 画面: `/dashboard/workspace/sessions` 1ページ新設＋ナビ1項目。構成は ①今日の目標ツリー（主役・✔終わったこと統合・宣言のみ=未着手） ②＋ボタン（目標追加→インボックス） ③本日サマリカード4枚（メイン実行/サブ実行/待ち/稼働中N体） ④⏸滞留アラート（一律15分） ⑤日付切替◀▶。グラフ(recharts)はv1見送り（CSSミニバー代替）。
- 指標の語彙: **メイン実行=🟢区間／サブ実行=🔵区間／待ち=⏸区間のみ**（🔵中はメインが待っていても待ちに数えない・「サブの待機」は概念ごと無し）。稼働中=メイン＋サブの体数合算。
- データ: 読み=`personal-os-board`（読み取り専用トークン・env `PERSONAL_OS_BOARD_DATABASE_URL`/`_AUTH_TOKEN`）／書き=`personal-os-inbox`（目標宣言専用DB・env `PERSONAL_OS_INBOX_DATABASE_URL`/`_AUTH_TOKEN`・漏れても被害はインボックスのみ）。mdデイリーボードが正本・画面は読み取りミラー。
- 下準備済み（2026-07-11・本program化と同時に実施）: inbox DB作成＋`goals`テーブル＋idx_goals_date／boardの`sessions`へ`sub_n`列追加／inbox書き込みトークン=keychain `turso-personal-os-inbox`（値非表示）。
- 委任レーン（2026-07-11ユーザー指定）: Codex=**gpt-5.6-sol**（実在確認済み・1+1応答OK）／Claude=**Opus 4.8**。
- 偵察で判明したTurso送信の穴（03で塞ぐ）: (a) sub-start/sub-endが一切送信されない＝サブ実行時間が欠ける (b) reconcile⏸降格がイベントのみでsessions現在値を更新しない＝「いま動いている」が古い🟢を出しうる (c) addイベントはgoal=?で確定→集計はセッション単位の最新goalへ帰属（01のクエリ規則）。

## 子計画マップ

- `plans/01-focusmap接続とクエリ層.md` … Turso複数クライアント化＋board集計クエリ層（Codex sol委任・03と並列）
- `plans/02-画面とナビと目標追加.md` … page.tsx＋ナビ＋＋ボタン（Codex sol委任・01完了後）
- `plans/03-板側拡張.md` … board.py送信の穴埋め＋goal-add＋sub_n送信（Claude Opus 4.8委任・01と並列）
- `plans/04-トークン検証デプロイ.md` … トークン設置・実データ検証・main push（私＋人間ゲート）

## 決定ログ

- 2026-07-11: 記録系の一本化調査（実測＋依存マップ）→ **A案（md正本＋Tursoミラー）を維持**とユーザー決定。B案=ネット断で板停止・記録消失のため不採用、C案=ストア増で見送り。弱点（送信失敗の恒久欠測）はスプール再送（05便）で「最終的に必ず一致」へ格上げする。ミラー送信の非同期化は今回見送り。

## 人間ゲート

- main push（=Cloud Run本番デプロイ）は検証結果を人間が確認してから。
- 完了条件の正本は各子計画のレビュー項目。
