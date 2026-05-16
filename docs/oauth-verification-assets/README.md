# OAuth Verification 動画素材

## 使い方（北村）

1. `docs/plans/oauth-verification.md` §2 に沿って画面録画する
2. 撮れたMP4を `raw/` 配下に **以下のファイル名で** 置く:
   - `stage-A-opening.mp4`
   - `stage-B-privacy.mp4`
   - `stage-C-signin.mp4`
   - `stage-D-consent.mp4` ← 最重要
   - `stage-E-calendarlist.mp4`
   - `stage-F-events-read.mp4`
   - `stage-G-events-write.mp4` ← 最重要
   - `stage-H-revoke.mp4`
   - `stage-I-closing.mp4`（無くてもRemotion側で生成）
3. ロゴを `logo/focusmap-logo.png`（120x120 透過PNG）に配置
4. 「素材揃った」とClaudeに伝える

## Claudeが素材を受け取ってからやること

1. `editor/` で `npm install`
2. `npm run preview` で確認、字幕タイミング調整
3. `npm run build` → `out/focusmap-oauth-demo.mp4` 生成
4. 北村に出力動画を見てもらい、必要なら微調整
5. 確定したらYouTubeにアップ（手動、Unlisted）

## 撮影時の必須条件（再掲）

- ブラウザ言語: **English (US)**
- 解像度: **1920x1080, 30fps以上**
- アドレスバー: 常時表示
- 音声: **無音 or マイクOFF**（後で字幕レイヤーをのせるため）
- 各ステージ1ファイル、途中でカットしてOK
