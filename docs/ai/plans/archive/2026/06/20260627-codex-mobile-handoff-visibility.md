# Codex mobile handoff visibility hardening

## Status

Completed on 2026-06-27.

## Problem

スマホから始めたCodex作業がCodex.app / Focusmap側へ見えない原因を、UI handoff、Mac agent/CLI、DB/APIの3方向でreadonlyサブエージェント調査した。

主因は、スマホ導線がMac Codex.appへの自動実行ではなくChatGPT/Codex mobileへのmanual handoffであり、repo_path保存・handoff token・manual handoff照合が弱く、Mac側にthreadが現れても既存taskへ紐づきにくいことだった。Codex CLI自体は `/Applications/Codex.app` bundled CLIのapp-serverが動いていたが、global CLIとの差異は診断対象として残る。

## Changes

- `projects.repo_path` 解決で、Cloud Run/スマホからでも `ai_runners.repo_paths` に完全一致するMac側repo pathを保存できるようにした。
- manual handoff prompt末尾へ `Focusmap同期ID: FM-...` を1行だけ追加し、表示側では同期IDを隠すようにした。
- tokenが削られた場合のfallbackを壊さないよう、prompt prefix比較は同期IDを除いた本文で行うようにした。
- 未紐づけmanual handoffのagent監視窓を10分から24時間へ延長した。
- `source_task_id` だけでなく `source_note_id` / `source_ideal_goal_id` を持つmanual handoffも既存taskとして紐づけるようにした。
- `sync-node` / `focusmap-agent` / legacy `task-runner` のfallback検索とTurso source種別を同じ契約へ寄せた。
- `docs/CONTEXT.md` と Codex monitoring spec を更新した。

## Verification

テスト/lint/build/browser確認は未実行。ユーザー明示がないため、AGENTS.mdの自動検証ポリシーに従った。差分確認のみ。

## Follow-up

この変更はlocal mainに入るまで完了扱い。origin/main / 本番反映には明示的なpushが必要。
