---
name: focusmap-ui-quality
description: Focusmapのデスクトップ/Web/Mac/iOS/スマホUIを、既存テーマを保ったまま95点以上の完成度へ引き上げるための調査、UI憲法、並列実装分解、readonlyレビュー、統合判断に使う。UI崩れ、白画面、モバイル/デスクトップ差分、設定・カレンダー・マップ・チャット改善、subagent調査やテストレビューを組む時に使う。
---

# Focusmap UI Quality

## Purpose

Focusmap のUI変更は、実装前に「既存の見た目を維持する部分」と「壊れているので直す部分」を分ける。
採点は診断用に使うだけで、レビューや改善提案は必ず95点以上、できれば100点に近い完成形まで具体化する。

## Load Order

1. `docs/CONTEXT.md` の `UIビジュアル統一`、対象画面、`AIエージェント並列作業ポリシー` を読む。
2. ユーザーのスクリーンショット、appshot、再現説明、対象URL/画面を確認する。
3. `references/ui-constitution.md` と `references/scoring-and-severity.md` を読む。
4. 並列化やworkerプロンプトが必要なら `references/worker-prompt-clauses.md` を読む。
5. 対象コードを読んでから、必要な workflow を1つ以上選ぶ。

## Workflow Decision

- 現状調査や大手UIパターンの抽出だけなら `workflows/research.md`。
- Focusmapの守るべきルールを固めるなら `workflows/ui-constitution.md`。
- 実装前に並列workerへ分けるなら `workflows/plan-and-split.md`。
- 個別workerとして実装するなら `workflows/implementation-worker.md`。
- テスト、レビュー、スクリーンショット確認をreadonly subagent化するなら `workflows/test-review-subagent.md`。
- 複数workerの成果をmainへ統合するなら `workflows/integration.md`。
- どこから始めるか曖昧なら `workflows/intake.md`。

## Non-Negotiables

- スマホ、PC、Macアプリ、iOSアプリは同じFocusmapに見える色、状態色、アイコン、線幅、角丸、密度を使う。
- デスクトップでは全体を見ながら細部を編集できる右インスペクタ、サイドパネル、ポップオーバーを優先する。モバイル用の巨大ボトムシートをそのまま流用しない。
- モバイルでは片手操作、44px以上のタップターゲット、safe area、下部ナビ、ボトムシート/ドリルインを優先する。デスクトップの多段ペインをそのまま詰め込まない。
- 白画面、クライアント例外、操作不能、テキスト重なり、横幅の浪費、テーマ逸脱、P0/P1未解決は受け入れない。
- UIレビューは「点数だけ」で終わらせない。必ず理想状態、差分、具体的変更、守るべき既存要素、完了条件を書く。
- repoのAGENTS.mdに従い、テスト、lint、build、Playwright、ブラウザ確認、`git diff --check` はユーザーが明示した時だけ実行する。

## Output Contract

UI調査、レビュー、実装計画は次の順で出す。

1. 現在の問題
2. 守るべきFocusmapらしさ
3. 95点以上の理想UI
4. 具体的な修正方針
5. P0/P1/P2の残リスク
6. 実装worker、readonly review worker、integration の分担
7. ユーザーが明示した場合だけ実行する検証

## Completion Gate

実装を完了扱いにする前に、P0/P1が残っていないこと、スマホ/デスクトップの役割差が明確なこと、既存テーマを壊していないこと、必要な `docs/CONTEXT.md` 更新が同じ作業内に含まれていることを確認する。
