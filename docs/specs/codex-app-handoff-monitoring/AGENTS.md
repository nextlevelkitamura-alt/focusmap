# AGENTS: Codex.app handoff + monitoring

このフォルダ配下の仕様は、Focusmap の Codex.app handoff + monitoring の理想状態を示す正本です。

## 作業前に読む

1. `README.md`
2. 変更領域に応じた章
   - 全体導線: `01-overview-and-flow.md`
   - マップ看板UI: `02-mindmap-kanban-ui.md`
   - バックヤード/Turso: `03-backyard-sync-and-turso.md`
   - 実装分解/検証: `04-implementation-split-and-verification.md`

## この領域の不変条件

- 標準導線は manual handoff。
- Codex.appへの自動送信を標準に戻さない。
- tracking task を失わない。
- マップをCodex監視の主画面にする。
- Tursoへ全文ログを保存しない。
- detail tail はdetail open時だけ読む。
- UI状態は `未送信` / `実行中` / `確認待ち` / `接続失敗` に揃える。

## 編集時の注意

- API契約を破壊しない。
- backend未実装の操作を動くボタンとして出さない。
- Supabase Storage画像移行を混ぜない。
- 関係ないUI改修を混ぜない。
- 既存未コミット差分を混ぜない。

## 完了前

- 関連lint/testを実行する。
- `git diff --check` を実行する。
- localhost確認が必要なUI変更では `http://localhost:3001/dashboard?taskProgressFixture=1` を使う。
- 検証できなかった項目は、理由を具体的に報告する。
