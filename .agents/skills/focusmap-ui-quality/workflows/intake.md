# Intake Workflow

## Goal

UI作業の入口で、調査だけか、実装まで進めるか、並列化するかを決める。

## Steps

1. 対象画面を特定する。
   - 例: `Todo` カレンダー、予定編集、設定、マップ右ペイン、チャット、iOS WebView。
2. 対象プラットフォームを分ける。
   - Desktop Web
   - Mac Electron
   - Mobile Web
   - iOS WebView
3. ユーザーの証拠を整理する。
   - screenshot
   - appshot
   - 再現手順
   - 白画面/例外メッセージ
   - 期待する見え方
4. 守るべき既存要素を先に書く。
   - 色、フォント、角丸、lucide、密度、既存コンポーネント、既存導線。
5. 作業レベルを決める。
   - `fast-triage`: 白画面、例外、操作不能などのP0/P1修復。
   - `evaluate`: screenshot/appshot/route/codeの評価。
   - `design-pack`: 調査、企画、UI受け入れ条件、モックアップ。
   - `ui-runbook`: Chat 1とChat 2で広いUI改善を進める。
   - `split`: 実装workerへの分解。
   - `worker`: 割り当て済み範囲の実装。
   - `test-review`: readonlyレビュー。
   - `integrate`: worker成果の統合。
6. ユーザーが検証コマンドの実行を明示しているか確認する。
   - 明示がなければ、テスト、lint、build、Playwright、ブラウザ確認、`git diff --check` は実行しない。

## Output

- 対象画面
- 対象プラットフォーム
- 守る既存テーマ
- P0/P1疑い
- 次に使うworkflow
- 並列化するならworker候補
- ユーザーに貼ってもらう `Next Chat Handoff` が必要か
