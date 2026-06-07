# Task Board

Last updated: 2026-06-07

task-router の現在地を示す軽量ボード。詳細は各 Plan を正とし、このファイルは見出し・状態・リンク・次アクションを一覧する。

## Active

| ID | Status | Task | Plan | Scope | Owner/Chat | Branch | Next | Updated |
|---|---|---|---|---|---|---|---|---|
| TASK-20260607-004 | Planned | Codex/Macローカル連携の一本化計画 | [plan](plans/active/20260607-codex-mac-agent-unification.md) | Mac app / focusmap-agent / Codex monitoring / task-progress UI | task-router parent chat | main | 実装前に契約確認し、Mac supervisor・agent monitor・API/DB・UI・legacy runner cleanupへ分割 | 2026-06-07 |

## Waiting / Blocked

| ID | Status | Task | Plan | Blocker | Needed Decision | Updated |
|---|---|---|---|---|---|---|

## Recently Completed

直近の完了だけ最大5件。月別の正本は `docs/ai/task-archive/YYYY/MM.md`。

| ID | Completed | Task | Plan | Result |
|---|---|---|---|---|
| TASK-20260607-015 | 2026-06-07 | スマホCodex返答同期と実行中ノード復帰修正 | - | Mac側Codex DB/rolloutには返答が存在したため、スマホアプリ単体ではなく `/api/codex/sync-node` のローカルホスト判定とDB更新失敗握りつぶしが原因と切り分け。`Host` / `X-Forwarded-Host` を見て同期を許可し、実データで `running` → `awaiting_approval` / activity返答表示へ復旧 |
| TASK-20260607-014 | 2026-06-07 | スマホCodex手動ハンドオフ復帰同期 | - | スマホでChatGPT/Codex外部アプリへ画面切替またはFocusmap iOS WebViewの `openExternal` bridge送信を検知した時、manual handoff taskを `awaiting_approval` / `external_app_handoff` に進め、Supabase/Turso/activityとノード詳細・リンクメモ詳細・マップ状態を確認待ち表示へ同期 |
| TASK-20260607-013 | 2026-06-07 | Focusmap iOS Codex Universal Link直行修正 | - | iOSは公式 `https://chatgpt.com/codex/mobile/` を第一候補にし、再インストール済みFocusmapアプリでは `UIApplication.open(..., universalLinksOnly: true)` でChatGPTアプリがUniversal Linkとして扱える場合だけ成功扱いにする。汎用ChatGPT schemeはfallback限定にし、Expo config pluginでnative moduleを永続生成 |
| TASK-20260607-012 | 2026-06-07 | Focusmap iOS ChatGPTアプリ起動候補fallback修正 | - | iOSでは `com.openai.chat://https://chatgpt.com/codex/mobile/` を先頭に、`chatgpt://codex/mobile` / `chatgpt://` / 公式Web URLを候補として渡す。Focusmap iOSアプリ側は `urls` 候補を順番に `Linking.openURL` で試し、インストールスクリプトはnative module追加時のPods更新を保証 |
| TASK-20260607-011 | 2026-06-07 | Focusmap iOSアプリ native clipboard bridge追加 | - | `expo-clipboard` を追加し、iOSアプリが `focusmap:copyText` を受けて端末クリップボードへ書き込む。Web側はCodex起動時に `copyText` → `openExternal` の順でbridge messageを送る |
