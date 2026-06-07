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
| TASK-20260607-012 | 2026-06-07 | Focusmap iOS ChatGPTアプリ起動候補fallback修正 | - | iOSでは `com.openai.chat://https://chatgpt.com/codex/mobile/` を先頭に、`chatgpt://codex/mobile` / `chatgpt://` / 公式Web URLを候補として渡す。Focusmap iOSアプリ側は `urls` 候補を順番に `Linking.openURL` で試し、インストールスクリプトはnative module追加時のPods更新を保証 |
| TASK-20260607-011 | 2026-06-07 | Focusmap iOSアプリ native clipboard bridge追加 | - | `expo-clipboard` を追加し、iOSアプリが `focusmap:copyText` を受けて端末クリップボードへ書き込む。Web側はCodex起動時に `copyText` → `openExternal` の順でbridge messageを送る |
| TASK-20260607-010 | 2026-06-07 | Focusmap iOSアプリ内Codex起動bridge修正 | - | Focusmap iOSアプリWebViewでは `ReactNativeWebView` bridgeで `focusmap:openExternal` を送ってChatGPT Codex mobile URLをOSへ渡し、通常ブラウザ/Cloudflareでは従来のアンカー遷移を維持 |
| TASK-20260607-009 | 2026-06-07 | スマホCodex公式URL起動ボタン統一 | - | 公式Codex mobile URLを使い、スマホの未送信/開始前UIの主操作を `Codexを開く` に統一。ボタン押下で同期コピーを始め、アンカーの通常遷移でChatGPT Codex mobile入口を開く |
| TASK-20260607-008 | 2026-06-07 | スマホCodexアプリ起動とプロンプトコピー修正 | - | スマホ手動handoffでタップ直後に端末クリップボードコピーとChatGPT Codex入口起動を開始し、`.local` / CloudflareでもMacローカルAPIへ逃がさないよう修正 |
