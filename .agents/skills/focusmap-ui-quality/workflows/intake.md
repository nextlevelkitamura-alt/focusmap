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
   - readonly調査
   - UI憲法/仕様作成
   - 実装計画
   - 単独実装
   - 並列worker実装
   - Integration
6. ユーザーが検証コマンドの実行を明示しているか確認する。
   - 明示がなければ、テスト、lint、build、Playwright、ブラウザ確認、`git diff --check` は実行しない。

## Output

- 対象画面
- 対象プラットフォーム
- 守る既存テーマ
- P0/P1疑い
- 次に使うworkflow
- 並列化するならworker候補
