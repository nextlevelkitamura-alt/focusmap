# Integration Workflow

## Goal

複数workerのUI変更を、local mainへ統合できる品質へまとめる。

## Steps

1. 各workerのcommit、差分、報告、残リスクを読む。
2. Desktop/Mobile/Sharedのcontractがズレていないか確認する。
3. 同じファイルや共通コンポーネントの競合を解消する。
4. Readonly Test ReviewのP0/P1を確認し、残っていれば該当workerへ戻す。
5. UI仕様、同期方式、データフローが変わった場合は `docs/CONTEXT.md` を更新する。
6. repoのAGENTS.mdに従い、自分が触ったファイルだけをstageし、動く状態でcommitする。
7. pushはユーザーが明示した時だけ行う。

## Integration Gate

- P0が残っていない。
- P1が残っていない、またはユーザーが延期を明示承認した。
- DesktopとMobileの役割差が説明できる。
- Focusmapの既存テーマを壊していない。
- worker成果がlocal mainへ取り込み済み。
- `docs/CONTEXT.md` など正本が必要な範囲で更新済み。

## Final Report

- local mainへの取り込み状態
- origin/mainへのpush状態
- 本番反映状態
- 変更ファイル
- 実行した確認、または未実行の確認
- 残リスク
