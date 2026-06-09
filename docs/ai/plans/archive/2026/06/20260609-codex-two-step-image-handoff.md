# Codex画像handoffの2段階化

## 目的

Codex手動handoffで、初回操作はpromptを確実にクリップボードへコピーしてCodex入口を開く。画像がある場合は、Focusmap側に画像単体コピーをすぐ押せるUIを残し、ユーザーが同じCodex入力欄へ続けて貼り付けられるようにする。

## 範囲

- メモ詳細の `Codexに送る`
- マップノード詳細の `Codexを開く`
- Web/Electron/ローカルAPI/iOS bridge の画像単体コピー
- `docs/CONTEXT.md` のCodex handoff仕様

## 実装方針

- 初回のCodex起動payloadから画像URLを外し、promptコピーと外部アプリ起動だけを標準にする。
- 保存済み画像がある時は、Codexパネル内に画像ごとのコピーアイコンを表示する。
- 画像コピーは `copyCodexImageToClipboard()` に集約し、Electron bridge、Focusmap iOS bridge、ローカルAPI、ブラウザClipboard APIの順で試す。
- 画像コピーは `ai_tasks` を作らない。既存のmanual handoff task/thread紐付けは初回prompt送信時の `ai_tasks` とCodex監視を正にする。

## 検証

- 関連unit test
- typecheck / lint / diff check
- ローカル3001 APIでprompt-only copyとimage-only copyのpasteboard readback
- dashboardを `http://localhost:3001/dashboard` で開ける状態にする
