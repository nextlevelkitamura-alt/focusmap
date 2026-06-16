# Dashboard Right Chat And Memo Controls

- Task ID: TASK-20260617-004
- Status: completed
- Created: 2026-06-17
- Completed: 2026-06-17
- Board: `docs/ai/task-board.md`

## Goal

デスクトップの `Todo` / `メモ` / `マップ` 上部操作を、チャットアイコンと右サイドバー基準へ揃える。

## Scope

- `src/components/layout/header.tsx`
- `src/app/dashboard/dashboard-client.tsx`
- `docs/CONTEXT.md`
- task-router 記録ファイル

## Non-goals

- `UnifiedChat` の会話UI本体変更
- Codex取り込みサイドバーの内部仕様変更
- モバイル下部ナビ変更
- API / DB schema 変更

## Plan

1. `Todo` カレンダー画面の右上に `Bot` アイコン + `AI実行` 文字の入口を出す。
2. `マップ` 画面のチャット入口は文字なしの `MessageCircle` アイコンにし、サイドバー見出しも `チャット` にする。
3. `メモ` 画面にも同じチャットアイコンを出し、選択中プロジェクトのチャットを右サイドバーで開く。
4. マップ画面のメモボタンは左分割ではなく、カレンダー/チャットと同じ右サイドバー枠で開く。
5. 実装に合わせて `docs/CONTEXT.md` を更新する。

## Parallelization

SINGLE_CHAT。ヘッダーの表示条件、ダッシュボード右ペインの排他制御、仕様文言が同じUI契約にまとまっているため、分割しない。

## Verification

未実行。AGENTS.md の自動検証ポリシーに従い、ユーザー明示なしで `npm run lint` / `npm run build` / ブラウザ確認は実行していない。差分確認のみ。

## Result

- `Todo` カレンダー画面の右上にも `AI実行` 文字付きボタンを表示するようにした。
- `マップ` 画面のチャット入口を文字なしのチャットアイコンへ変更し、右サイドバー見出しを `チャット` にした。
- `メモ` 画面にもチャットアイコンを追加し、同じ右サイドバーに選択中プロジェクトのチャットを開くようにした。
- マップ画面のメモボタンは左分割ではなく右サイドバーへ表示するようにした。
- `docs/CONTEXT.md` のダッシュボードナビゲーション仕様を更新した。

## Links

- `docs/CONTEXT.md`
