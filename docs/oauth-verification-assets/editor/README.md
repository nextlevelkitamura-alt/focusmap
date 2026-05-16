# Focusmap OAuth Demo Editor (Remotion)

撮影素材を自動で繋いで字幕を焼き込むRemotionプロジェクト。

## 前提

- Node.js 20+
- 素材ファイルが `../raw/` に揃っていること

## 起動

```bash
cd docs/oauth-verification-assets/editor
npm install
npm run preview   # ブラウザでプレビュー（タイミング調整用）
npm run build     # ../out/focusmap-oauth-demo.mp4 を出力
```

## 構造

- `src/subtitles.ts` — 字幕の表示タイミングとテキスト（編集ポイント）
- `src/stages.ts` — ステージごとのMP4ファイル名
- `src/OAuthDemo.tsx` — 動画本体。ステージMP4を順に並べ、字幕を被せる
- `src/Root.tsx` — Remotion Composition登録

## 素材到着後のClaudeへの依頼例

> 素材を `raw/` に置いた。`stage-G-events-write.mp4` は28秒、他は10〜15秒。subtitlesのタイミングを実尺に合わせて、`npm run build` で出力して。

## 注意

- 各ステージMP4の長さに合わせて `OAuthDemo.tsx` の `STAGE_SECONDS` か Sequence の `durationInFrames` を素材ごとに変える（現状は全ステージ一律14秒の仮設定）。素材到着後に実尺で個別調整する。
- Subtitlesの `start`/`end` も同じく実尺に合わせて全体スケーリングする必要あり。
