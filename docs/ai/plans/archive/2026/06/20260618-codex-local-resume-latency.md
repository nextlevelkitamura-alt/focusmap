# Codexローカル再開検知レイテンシ削減

## Goal

確認待ちになったCodex threadへユーザーが追加promptを送った時、Focusmap側の「実行中」反映が孤立thread取り込みやUI低頻度pollで遅れないようにする。

## Scope

- `scripts/focusmap-agent/src/codex-thread-monitor.ts`
- `scripts/focusmap-agent/codex-thread-monitor.test.ts`
- `src/hooks/useMemoAiTasks.ts`
- `docs/CONTEXT.md`
- Macアプリ同梱agentの再ビルド・再インストール確認

## Implemented

- 既知threadを持つ `running` / `awaiting_approval` / `needs_input` / pending archive taskを、孤立thread取り込みより前に同期するようにした。
- rollout JSONLをmtime/sizeでキャッシュし、無変化ファイルの全文読み直しを避けるようにした。
- マップ側の軽量同期は確認待ちCodex taskも3秒対象にし、再開後の状態取得がidle間隔へ落ちないようにした。
- Macアプリを再ビルド・再インストールし、同梱agent CLIが本番設定で起動して1秒monitor設定まで進むことを確認した。

## Verification

- `npm run test:run -- scripts/focusmap-agent/codex-thread-monitor.test.ts --test-timeout=30000`
- `npx eslint src/hooks/useMemoAiTasks.ts scripts/focusmap-agent/src/codex-thread-monitor.ts scripts/focusmap-agent/codex-thread-monitor.test.ts`
- `git diff --check`
- `npm run mac:build:install`
- `node /Applications/Focusmap.app/Contents/Resources/focusmap-agent/dist/cli.js --help`
- 同梱agentを実設定で8秒起動し、`codex thread monitor 1s / target refresh 3s / reconcile 60s` のreadyログを確認

## Result

完了。既知threadの再開検知は孤立thread取り込みの後ろへ回らず、UI側も確認待ちtaskを3秒更新の対象に戻した。
