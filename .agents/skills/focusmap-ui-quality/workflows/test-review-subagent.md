# Test Review Subagent Workflow

## Goal

テスト/レビュー担当をreadonly subagentとして使い、実装workerとは責務を分ける。

## Scope

- コード、差分、スクリーンショット、appshot、仕様を読む。
- P0/P1/P2を付ける。
- 95点以上の改善案を具体化する。
- ユーザーが明示した時だけ、指定された検証コマンドや表示確認を実行する。

## Review Checklist

- 白画面、例外、Hydration、主要操作不能がないか。
- Desktopで主画面を見ながら詳細編集できるか。
- Mobileで片手操作、safe area、44pxタップ、キーボード表示が成立するか。
- 同じFocusmapに見えるテーマ、lucide、角丸、線幅、状態色になっているか。
- 長文、件数増加、狭幅/広幅、空状態、保存中、エラーで崩れないか。
- 楽観的UIと失敗時復元があるか。
- 画面ごとに別アプリのようなデザインになっていないか。

## Output

1. Findings first。P0/P1を上に置く。
2. 95点以上へ上げる具体的修正案。
3. Desktop/Mobileの差分評価。
4. 既存テーマ維持の評価。
5. 明示されていないため実行していない検証。
6. 必要なら診断点。ただし点数だけで終わらせない。

## Boundaries

readonly reviewは実装しない。
修正が必要な場合は、Implementation WorkerまたはIntegrationへ戻す。
