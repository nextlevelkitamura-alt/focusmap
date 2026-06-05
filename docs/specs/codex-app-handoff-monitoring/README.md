# Codex.app handoff + monitoring

Status: living spec
Created: 2026-06-05
Updated: 2026-06-05

このフォルダは、Focusmap の Codex.app handoff + monitoring が目指す理想状態の正本です。

今後、Codex.app 連携、Mac agent、Turso同期、マップ内Codex看板、ノード詳細、task progress API を触るエージェントは、この README から必要な章を読んでください。

## まず読む

1. [01. 全体原則と標準導線](01-overview-and-flow.md)
2. [02. マインドマップ看板UI](02-mindmap-kanban-ui.md)
3. [03. バックヤード同期とTurso節約](03-backyard-sync-and-turso.md)
4. [04. 実装分解と検証](04-implementation-split-and-verification.md)

エージェントへ作業を渡す時:

- [AGENTS.md](AGENTS.md)
- [CLAUDE_AGENT.md](CLAUDE_AGENT.md)

## 一言でいう理想

Focusmap は Codex.app の代替ではありません。

Focusmap は、Codex.appへ渡す prompt / 画像参照 / handoff package を作り、マップ上で「今どのCodex作業を見るべきか」を俯瞰させるダッシュボードです。Codex.app の thread 履歴が会話の正であり、標準導線では人間が Codex.app で最終送信します。

## 5つの不変条件

1. 標準導線は manual handoff。Codex.appへ自動送信しない。
2. Focusmapのtracking taskを失わない。Codex.appを開く前、または同時に作る。
3. マップをCodex監視の主画面にする。チャットtabへ逃がさない。
4. Tursoには軽量snapshot/eventだけを保存する。全文ログを保存しない。
5. detail tail は detail panel / drawer を開いた時だけ読む。

## 表示状態の正

| 内部状態・条件 | 表示 |
|---|---|
| `pending` / thread未検出 | `未送信` |
| `running` | `実行中` |
| `awaiting_approval` / `needs_input` / Codex側完了後の人間確認前 | `確認待ち` |
| `failed` / monitoring lost / thread検出失敗 | `接続失敗` |

Codex側の `completed` は Focusmapノードの完了ではありません。人間がチェックボックスで完了するまで、確認対象として扱います。

## フォルダ構成

| ファイル | 役割 |
|---|---|
| [01-overview-and-flow.md](01-overview-and-flow.md) | プロダクト原則、manual handoff、handoff package、thread検出 |
| [02-mindmap-kanban-ui.md](02-mindmap-kanban-ui.md) | マップ内Codex看板、モバイル下シート、ノード詳細、UI受け入れ条件 |
| [03-backyard-sync-and-turso.md](03-backyard-sync-and-turso.md) | Mac local監視、Turso保存ルール、無料枠、backend受け入れ条件 |
| [04-implementation-split-and-verification.md](04-implementation-split-and-verification.md) | 実装分解、担当範囲、検証チェックリスト、未決定事項 |
| [AGENTS.md](AGENTS.md) | この領域を触るエージェントの作業ルール |
| [CLAUDE_AGENT.md](CLAUDE_AGENT.md) | Claude/Codexへ渡す短縮プロンプト |

## 修正時の最低チェック

- `git fetch --prune origin`
- `git status --short --branch`
- 既存未コミット差分を混ぜない
- `docs/specs/codex-app-handoff-monitoring/README.md` から該当章を読む
- API契約、Turso節約、manual handoff標準導線を壊していないか確認する
