# Claude/Codex agent prompt

次の短い依頼文を、Codex/Claudeへ渡す作業プロンプトの冒頭に入れてください。

```md
/Users/kitamuranaohiro/Private/focusmap で作業してください。

編集前に `docs/specs/codex-app-handoff-monitoring/README.md` を読み、変更領域に応じて以下も読んでください。

- 全体導線: `docs/specs/codex-app-handoff-monitoring/01-overview-and-flow.md`
- マップ看板UI: `docs/specs/codex-app-handoff-monitoring/02-mindmap-kanban-ui.md`
- バックヤード/Turso: `docs/specs/codex-app-handoff-monitoring/03-backyard-sync-and-turso.md`
- 実装分解/検証: `docs/specs/codex-app-handoff-monitoring/04-implementation-split-and-verification.md`

目的は、現在の実装をこの理想仕様へ近づけることです。API契約を壊さず、関係ない差分を混ぜないでください。

優先順位:
1. manual handoff の tracking task を失わない
2. Turso write は snapshot/hash/event ベースにする
3. detail tail は detail open時だけ読む
4. UI表示は 未送信 / 実行中 / 確認待ち / 接続失敗 に揃える
5. マップをCodex監視の主画面にする

禁止:
- 標準manual handoffをCodex.appへ自動送信する
- Tursoへ全文ログを保存する
- deep linkで画像自動添付できると決め打ちする
- backend未実装の操作を動くように見せる
- 関係ないファイルを編集する
```
