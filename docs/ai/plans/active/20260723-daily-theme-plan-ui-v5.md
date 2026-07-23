分類: repo ／ 種別: 既存改善
規模: ライト
形態判定: 単発 ／ 理由: Theme・Plan・AI稼働表示を既存board-v2共通部品の表示変更だけで整える
並列: 不可

# Daily Theme・Plan統合UI V5

- Task ID: TASK-20260723-001
- Status: review_pending
- Created: 2026-07-23
- Board: `docs/ai/task-board.md`

## 目的

Dailyを、複数Themeの中に複数Planを束ね、各Planの進捗とCodex・Claudeの現在状態を同じカードで把握できる画面へ整理する。

## 非対象

- DB migration・新テーブル・列追加
- Themeと日付の永続的な紐付け
- PlanのTheme間移動・並び替え・追加の保存
- 「明日も継続」の保存
- Tursoクエリ・hook・loop・session-boardの変更
- push・Cloud Runデプロイ

## 現状

- `board-v2` は `Theme → Plan → 工程 → AI` の4段階と共通データ組み立てを実装済み。
- ThemeとPlanは初期状態ですべて折りたたまれ、Planを開くまで担当AIと作業内容が見えない。
- PCサイドバーとboardページは同じ `ThemeGroupCard` / `PlanCardV2` を使っている。
- Theme編集は既存server actionで動作するが、Theme見出しではなくPlan内部に置かれている。

## 実行契約

- 対象repo: `/Users/kitamuranaohiro/Private/projects/active/focusmap`
- 実行形: direct
- 変更可能範囲: `src/components/today/board-v2/**`、`src/components/dashboard/desktop-today-panel.tsx`、`src/app/dashboard/board/page.tsx`、`src/app/api/board/summary/route.ts`、`src/app/dashboard/board/_components/theme-editor.tsx`、`src/components/dashboard/board-summary-panel.tsx`、`docs/CONTEXT.md`、`docs/ai/**`
- 変更禁止範囲: `db/**`、`src/lib/turso/**`、`src/app/dashboard/board/actions.ts`、hook・loop・runtime設定
- worktree方針: クリーンな既存`main` worktreeを使用。新規branch/worktreeを作らない。
- 維持する契約: boardページとPCサイドバーは同じ共通部品を描画する。工程とAI詳細の既存操作は壊さない。
- 検証: ユーザー指示に従いtest/lint/build/ブラウザ確認は自動実行しない。差分確認だけ行う。
- 停止条件: 表示変更にDB・server action・migration変更が必要になった場合。

## 方針

1. 最初の活動中Themeだけを初期展開し、他Themeは1行サマリにする。
2. Theme見出しに目的、Plan数、進捗、稼働・確認待ち、既存編集導線を集約する。
3. 広い幅ではPlanを2カラム、狭い幅では1カラムにする。
4. 取得済みPlanのrepo情報から、すべて／repo別に表示を絞るフィルターを共通部品で提供する。
5. Planカードは閉じた状態でも進捗バーと最大2件のAI稼働行を表示する。
6. 工程時系列はPlanの「工程を見る」を選んだ時だけ既存UIで展開する。
7. Theme追加、Plan追加、ドラッグ、翌日継続は次のDB接続段階であることが分かる非永続UIとして示す。操作不能な無反応ボタンにはしない。
8. Theme/Plan構造が空の開発環境だけ、完成形を確認できる読み取り専用サンプルを共通データ契約へ差し込む。本番・Theme/Plan実データあり・DB保存経路には混ぜない。
9. PCのカレンダーとデイリーを同じ高さの独立ペインとして初期50:50にし、中央の分割バーで予定表の可読幅を残しながら調節・比率保存・50:50リセットできるようにする。カレンダーは選択した1日だけを表示し、日付移動は両ペインへ連動させる。

## レビュー項目・完了条件

- [x] `ThemeGroupCard`で最初の活動中Themeだけを初期展開でき、複数Themeを同日に並べられる。
- [x] Theme見出しで名前・目的・Plan数・進捗率・稼働/確認待ち・編集導線が読める。
- [x] Planカード内でbucket、進捗率、済/総、担当AI、稼働状態、現在作業が同時に読める。
- [x] すべて／repo別フィルターで、取得済みPlanをDB再取得なしに絞り込める。
- [x] Planの工程時系列は初期非表示で、「工程を見る」から既存の工程・AI詳細へ到達できる。
- [x] PCサイドバーとboardページで同じ共通部品・同じ情報階層を使う。
- [x] 375px相当では1カラムとなり、操作対象に44px以上の領域とaria-labelがある。
- [x] DB・Tursoクエリ・migration・hook・loopに差分がない。
- [x] `docs/CONTEXT.md`にUI段階と後続DB段階の境界が記録される。
- [x] 開発環境でDBデータが空でも、Theme複数・Plan複数・進捗・Codex/Claude状態・単発・完了一覧を確認できる。
- [x] サンプルは本番では出ず、Theme/Plan実データが1件でもあれば混在せず、サンプル内の工程は読み取り専用になる。
- [x] 広い画面の初期分割が50:50で、デイリーを360px〜予定表420pxを残す範囲でドラッグ調節できる。
- [x] 分割比率をブラウザー内へ保存し、ダブルクリックまたはEnterで50:50へ戻せる。
- [x] 日付ヘッダーや予定表の内側ではなく、カレンダーとデイリーを画面高いっぱいの左右ペインとして分割できる。
- [x] デイリー表示中のカレンダーは1日表示に固定し、日付移動はカレンダーとデイリーに同時反映される。

## 実装結果

- `ThemePlanBoard` を追加し、repo表示フィルターとTheme一覧の共通描画をboardページ・PCサイドバーへ配線した。
- `ThemeGroupCard` を複数Themeのアコーディオン、目的・進捗・active/planningサマリ、Planカードgridへ変更した。
- `PlanCardV2` の閉じた状態に進捗バーと最大2件のAI稼働行を統合し、工程は「工程を見る」まで非表示にした。
- Theme追加・Plan追加・D&D・翌日継続は非永続の次段階UIとし、押下時にDB接続後の保存であることを通知する。
- 既存Theme編集はTheme内の操作列へ移し、44pxの操作領域を維持した。
- 実データが空の開発環境向けに、2 Theme・3 Plan・3 repo・Codex/Claude稼働/確認待ち・単発・完了見出しを含む表示確認用サンプルを追加した。
- サンプルは共通 `BoardV2Data` でboardページとPCサイドバーへ同じように出し、工程展開も読み取り専用にしてDB操作を発生させない。
- PCのカレンダーとデイリーを別ペインへ組み替え、初期50:50の比率制・画面サイズ追従・広幅化・ドラッグ/キーボード操作・50:50リセットを追加した。日付操作はカレンダー側だけに置き、選択した1日を両ペインで共有する。
- DB・migration・Tursoクエリ・hook・loop・push・本番反映は未変更。
- test/lint/build/ブラウザ表示確認は、`AGENTS.md`の自動検証ポリシーに従い未実行。コード差分評価は`評価01.md`。
