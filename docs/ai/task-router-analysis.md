# Task Router Analysis

## Summary

- Last reviewed: 2026-06-06
- Runs reviewed: 7 (`20260605-1922-task-router-board-standard`, `20260605-2140-codex-monitoring-manual-handoff`, `20260605-2220-codex-monitoring-handoff-patches`, `20260606-0010-codex-monitoring-5s-pulse`, `20260606-2208-task-router-improvement-logs`, `20260606-2200-codex-chat-node-status-sync`, `20260606-2250-task-router-parallel-policy`)
- Parallel positive: none yet
- Parallel neutral: 7 runs used `SINGLE_CHAT`
- Parallel negative: none recorded
- Common mistake: none recorded
- Current routing rule: Decompose tasks freely, but do not equate decomposition with parallel execution. Monitoring, handoff, chat sync, and task-router Skill policy changes are contract-coupled, so keep them in one chat unless write scopes can be separated without contract drift.

## Findings

| Pattern | Evidence | Change |
|---|---|---|
| Codex monitoring / handoff work has shared API, runner, UI, and docs contracts | task-runs entries 2-4 all ended `single_chat_best` with no merge conflicts | Default to `SINGLE_CHAT` for tightly coupled monitoring changes; use readonly review instead of implementation split when extra confidence is needed |
| task-router meta-policy changes need Skill and workflow consistency | `20260606-2208-task-router-improvement-logs` updated `SKILL.md`, telemetry, heavy-flow, task-board, parallelization gate, and worker templates together | Put durable mandatory rules in `SKILL.md`; keep templates, read granularity, and review cadence in `workflows/telemetry-and-mistakes.md` |
| Codex official guidance favors read-heavy subagents and cautions on write-heavy parallel workflows | OpenAI Codex docs checked 2026-06-06: subagents, worktrees, best practices, review | Task-router now treats readonly subagents as explicit-request-only, and implementation parallelism as separate Codex chats/worktrees after contract, ownership, and Integration responsibility are fixed |
| Codex chat/node status sync is contract-coupled | `20260606-2200-codex-chat-node-status-sync` ended `single_chat_best`; API activity, sync-node, hooks, map/detail UI shared one status contract | Keep status semantics and polling interval changes in one chat unless a prior contract file fully freezes API and UI behavior |
