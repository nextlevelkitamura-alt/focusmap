分類: repo ／ 種別: 既存改善
規模: ライト
形態判定: 単発 ／ 理由: セッション画面の表示構造・ヘッダー導線・既存データの見せ方を同じ変更単位で整える
並列: 不可

# Dailyセッション画面の単一表示化

- Task ID: TASK-20260721-001
- Status: in_progress
- Created: 2026-07-21
- Board: `docs/ai/task-board.md`

## 目的

`/dashboard/workspace/sessions` を、ワークスペース管理画面ではなく、日付ごとのDaily記録を確認する単一画面へ整理する。ロゴ横の `デイリー` プルダウン、既存の日付切替、目標選択、選択した目標の時間・記録表示を残す。

## 非対象

- Google Calendar のイベント同期やデータモデルの変更
- セッション以外の既存workspaceルートの削除
- `spaces` / プラン情報のDBスキーマ変更
- モバイル下部ナビゲーションの変更

## 現状

- `WorkspaceLayout` が `Workspace 管理`、スペース・プラン選択、複数タブを表示している。
- セッション画面は日付ごとの目標・実行時間・完了記録を取得済みだが、見出しに `セッション時間` が残り、目標を選ぶ導線がない。
- ユーザー承認済みモックでは、Dailyの内容切替をロゴ横へ置き、日付切替は従来位置に残す。

## 実行契約

- 対象repo: `/Users/kitamuranaohiro/Private/projects/active/focusmap`
- 実行形: direct
- 最初に読む順番:
  1. `AGENTS.md`
  2. この計画
  3. `docs/CONTEXT.md` のPersonal OS連携節
- 依存成果: ユーザー承認済みのモックアップと内容すり合わせ
- 変更可能範囲: `src/app/dashboard/workspace/**`、`src/components/layout/dashboard-brand-bar.tsx`、追加する同画面用UI、`docs/CONTEXT.md`、task-router記録
- 変更禁止範囲: Tursoクエリ層、DB migration、Google Calendar同期、他workspaceルートの機能
- ファイル担当マップ: 不要（単一チャットで順次実装）
- worktree方針: 不要（クリーンな既存 `main` worktree）
- 維持する契約: 日付切替、既存の目標追加、Turso読み取り・Inbox書き込み、モバイル下部ナビ
- 検証: ユーザー指示に従い、ローカルのtest/lint/build/ブラウザ確認は自動実行しない。本番反映は `main` へのpush後のGitHub Actions成功で確認する。
- 停止・エスカレーション条件: 既存目標データを選択表示できない、又はデプロイが失敗した場合
- 完了時に返す情報: result packet（status / base_commit / result_commit / changed_paths / tests / assumptions / blockers / remaining_risks / out_of_scope_findings）

## 方針

1. workspace親レイアウトから管理見出し・スペース/プラン選択・タブ列を外す。
2. セッション画面ではグローバルなworkspace切替を出さず、Focusmapロゴの横に内容種別 `デイリー` のプルダウンを置く。
3. 日付切替は従来の矢印と日付表示を維持し、目標はURL状態を持つプルダウンで選択する。
4. 選んだ目標だけの時間内訳・進行・終わったことを詳細として表示し、画面見出しに `セッション` を使わない。
5. 目標がない日は既存の日付表示と空状態を保つ。

## 完了条件

- [ ] `WorkspaceLayout` が画面内のWorkspace管理ヘッダー、スペース/プラン選択、タブ列を描画しない。
- [ ] `/dashboard/workspace/sessions` のロゴ横に内容種別 `デイリー` のプルダウンがあり、日付切替は従来どおり動作する。
- [ ] `今日の目標` で選んだ目標だけの時間・進行・完了記録が表示され、画面見出しに `セッション` がない。
- [ ] `docs/CONTEXT.md` が新しいUI構成を正として説明し、変更はlocal `main`へコミット・pushされる。

## 実装結果

実装後にplanctlが追記・更新する。実行前は記入しない。

## 終了記録

archive時に必須。実行中は記入しない。
