# UI Constitution Workflow

## Goal

調査結果を、以後のworkerが守れるルールへ変換する。

## Steps

1. `references/ui-constitution.md` を読み、既存ルールと重複する内容を統合する。
2. 対象画面固有のルールがある場合は、まず `docs/CONTEXT.md` の該当セクションに追記できるか確認する。
3. ルールは「守るもの」「変えるもの」「禁止するもの」に分ける。
4. Desktop/Mobile/Mac/iOSの差分を、見た目の別アプリ化ではなく、配置・密度・入力方式の差として書く。
5. 95点以上の完成条件をP0/P1/P2で表現する。

## Rule Format

- Context: どの画面/機能に適用するか。
- Preserve: 既存のFocusmapらしさとして維持するもの。
- Improve: 壊れているので改善するもの。
- Platform Split: Desktop/Mobile/Mac/iOSでどう分けるか。
- Anti-Pattern: やってはいけない実装。
- Acceptance: P0/P1/P2の完了条件。

## Notes

- `SKILL.md` はハブに保つ。詳細化しすぎる場合は `references/` へ逃がす。
- プロダクト仕様として永続化すべき内容は、Skill内だけでなく `docs/CONTEXT.md` にも入口または要点を残す。
