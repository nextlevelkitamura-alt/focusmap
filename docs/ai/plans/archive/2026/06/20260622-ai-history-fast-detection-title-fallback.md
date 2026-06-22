# AI履歴の高速検知と仮見出しfallback

- Task ID: TASK-20260622-004
- Status: completed
- Created: 2026-06-22
- Completed: 2026-06-22
- Board: `docs/ai/task-board.md`

## Goal

Codexへpromptを送った後のAI履歴検知・確認待ち反映が遅くなった状態を戻し、Codex sidebar見出しがまだ無いthreadでも履歴カードが全部 `新しいチャット` に見える状態を避ける。

## Scope

- `scripts/focusmap-agent/src/codex-thread-monitor.ts`
- `scripts/focusmap-agent/codex-thread-monitor.test.ts`
- `src/lib/turso/ai-history.ts`
- `src/lib/turso/ai-history.test.ts`
- `docs/CONTEXT.md`
- task-router記録ファイル

## Non-goals

- Codex state DB schemaやTurso migrationは増やさない。
- Web UIのカードレイアウトは変えない。
- Tursoへrunning秒数を毎秒writeする仕組みには戻さない。
- push/deployは行わない。

## Plan

1. focusmap-agentのAI履歴 hot-sync と既知running/awaiting/prompt_waiting taskのrollout監視を、fingerprintが同じ場合でも1秒後に再解析へ進める。
2. Codex sidebar見出しがまだ無いthreadは、`first_user_message` / `preview` の表示用sanitize済み依頼文先頭を仮見出しにする。
3. `AGENTS.md`、`environment_context`、`skill`、Appshot、`My request for Codex` などの入力包みは仮見出しから落とす。
4. Turso保存時は `prompt_fallback` / `placeholder` で既存の非placeholder titleを上書きせず、正式見出しが来た時だけ更新できるようにする。
5. `docs/CONTEXT.md` とtask-router記録を更新する。

## Parallelization

`SINGLE_CHAT`。原因はagent監視キャッシュ、title fallback、Turso upsertの同一契約にまたがるが、変更点は狭く、分割すると `新しいチャット` の扱いがworker間でズレる。

## Verification

ユーザー明示がないため、自動テスト/lint/build/browser確認は実行しない。差分確認と自分の変更範囲確認のみ行う。

## Result

- AI履歴 hot-sync と既知task fast-watchは、1秒後にrollout本文の再解析へ進むようにした。これでmtime/sizeやrow fingerprintだけを見て中身を読まない待ち時間を減らす。
- Codex sidebar titleがまだ無い場合でも、ユーザー依頼文の先頭1行を仮見出しとして表示できるようにした。
- 内部包みやAppshotを仮見出しへ混ぜず、実際の依頼文が取れない場合だけ `新しいチャット` を使う。
- `prompt_fallback` / `placeholder` は短時間のtitle再読込対象に残し、正式なCodex sidebar titleが来たら更新できるようにした。
- TursoのAI履歴upsertは、`prompt_fallback` / `placeholder` titleで既存の非placeholder titleを上書きしない。
- `docs/CONTEXT.md` に高速検知とtitle fallbackの正本仕様を追記した。

## Verification Result

- 自動テスト/lint/build/browser確認は未実行（ユーザー明示なし。AGENTS.mdの自動検証ポリシーに従う）。
- `git diff` / `git status` による差分確認のみ。
