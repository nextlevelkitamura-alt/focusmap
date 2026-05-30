# スマホ実機プレビュー

ローカルのFocusmapをCloud Runへデプロイせず、スマホから一時URLで確認するための手順。

## 使い方

```bash
npm run dev:phone
```

`cloudflared` が入っていれば、`https://*.trycloudflare.com` の一時URLが表示される。スマホでそのURLを開く。

Codex Remote ControlからURLを発行して確認したい場合は、バックグラウンド用のtmuxセッションを使う。

```bash
npm run dev:phone:bg
```

状態確認と停止:

```bash
npm run dev:phone:status
npm run dev:phone:stop
```

## 初回だけ必要

```bash
brew install cloudflared
```

## 動き

- `localhost:3001` で既にFocusmapが起動していれば、そのプロセスを使う
- 起動していなければ `next dev -H 0.0.0.0 -p 3001` を起動する
- Cloudflare Tunnelで一時URLを発行する
- `Ctrl+C` でスクリプトを止める

## ngrokを使う場合

```bash
FOCUSMAP_PHONE_TUNNEL=ngrok npm run dev:phone
```

## 注意

一時URLを知っている人はアクセスできる。認証情報や管理機能の確認中はURLを共有しない。
