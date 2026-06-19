# Codex履歴のプロンプト/添付要約表示

- Task ID: TASK-20260619-005
- Status: completed
- Created: 2026-06-19
- Completed: 2026-06-19
- Board: `docs/ai/task-board.md`

## Goal

Codexへ渡された生の入力ログをFocusmapのチャット履歴にそのまま出さず、ユーザー入力本文と添付ファイルの分類・件数だけを表示する。

## Scope

- Codex履歴表示用テキストのsanitize処理
- Codexチャット取り込みサイドバー/API activity表示で既存sanitizeを通る経路
- `docs/CONTEXT.md` の仕様メモ

## Non-goals

- Codexへ送る実際のプロンプト内容を変更しない
- 保存済みactivityやTurso/Supabase同期のデータ構造を変更しない
- PDFやAppshotの中身を解析しない

## Plan

1. `sanitizeCodexDisplayText` で `Files mentioned by the user` と `Applications mentioned by the user` の詳細を表示から除外する。
2. `My request for Codex` 以降の本文だけを表示本文にする。
3. 添付は拡張子/種別ごとに `PDF: 2件`、`Appshot: 1件` の形式で末尾に出す。
4. 「プロンプト」という見出しやローカルパス、appshot詳細、環境情報は表示しない。
5. 表示用の単体テストを追加し、検証コマンドはユーザー明示がないため実行しない。

## Parallelization

SINGLE_CHAT。変更点は表示用sanitizeに集約でき、複数worktree化すると既存未コミット差分との統合コストが上がる。

## Verification

- テストは追加した。
- `npm run test:run` / lint / build / ブラウザ確認はAGENTS.mdの自動検証ポリシーに従い、ユーザー明示がないため実行していない。
- 差分確認で、同期保存データではなく表示用sanitizeだけが変わっていることを確認した。

## Result

- `Files mentioned by the user` のファイル名/ローカルパスは表示しない。
- Appshotやimageタグの詳細本文は表示しない。
- `My request for Codex` の見出しを外し、本文だけを表示する。
- 添付は `添付ファイル` の下に分類と件数だけ表示する。

## Links
