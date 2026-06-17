# Implementation Worker Workflow

## Goal

割り当てられたUI範囲だけを、Focusmapらしさを保ったまま95点以上へ実装する。

## Steps

1. `SKILL.md`、`references/ui-constitution.md`、`references/scoring-and-severity.md`、対象の `docs/CONTEXT.md` を読む。
2. allowed filesとdo-not-touch filesを確認する。
3. 既存コンポーネント、hooks、tokens、lucideアイコンを優先して使う。
4. Desktop/Mobileで同じ実装を無理に共用しない。共通化するのは意味、状態、tokens、部品の最小単位にする。
5. 変更が主要UI仕様、同期方式、データフローへ影響する場合は `docs/CONTEXT.md` も同じ作業内で更新する。
6. 自分の変更範囲だけを差分確認し、repoのAGENTS.mdに従ってコミットする。

## Desktop Defaults

- 右インスペクタ、サイドバー、ポップオーバー、スプリットビューを優先する。
- 主画面の文脈を残しながら詳細編集する。
- モバイルシートを横幅いっぱいに拡大しない。

## Mobile Defaults

- 下部ナビ、ボトムシート、ドリルイン、44pxタップ、safe areaを優先する。
- キーボード、復帰、狭幅、長文で崩れないようにする。
- 一画面に詰め込みすぎない。

## Do Not

- 新しいテーマ、独自アイコンセット、過度なグラデーションを持ち込まない。
- unrelated refactorをしない。
- テスト、lint、build、Playwright、ブラウザ確認、`git diff --check` をユーザー明示なしに実行しない。
- P0/P1を「あとで直す」として完了報告しない。

## Report

- 変更ファイル
- 守った既存テーマ
- 95点以上にするための実装判断
- 未実行の確認
- 残リスク
