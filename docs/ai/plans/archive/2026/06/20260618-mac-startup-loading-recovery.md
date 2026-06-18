# Macアプリ初回起動ローディング復旧

## Goal

Focusmap Macアプリが初回起動時に `Focusmap 起動中` のまま止まり、いったん終了して起動し直すとログイン済みで開ける問題を直す。

## Cause

- 起動ログは `loading dashboard` の後で止まり、dashboard `loadURL` まで進む前の前処理で詰まっていた。
- remote UI cache clear を dashboard 読み込み前に await しており、Electron の cache/service worker clear が解決しない場合、retryも同じpending promiseを待ち続けてローディング画面に残る。
- `createMainWindow()` と loading画面の読み込みを fire-and-forget にしており、初回navigationとloading画面navigationが競合し得た。

## Fix

- remote UI cache clear は最大2.5秒で切り上げ、失敗・タイムアウトしてもdashboard読み込みへ進める。
- timeout後は `remoteUiCacheClearPromise` を必ず解放し、retryが古いpending promiseにぶら下がらないようにする。
- 初回起動とloading画面の手動retryでは、loading画面を読み込んでからdashboard読み込みへ進め、navigation競合を避ける。

## Verification

- `node --check desktop/focusmap-mac/main.cjs`
- `npm run mac:build:install`
- `/Applications/Focusmap.app` を起動し、`Focusmap 起動中` から `ダッシュボード | Focusmap` へ進むことを確認。
