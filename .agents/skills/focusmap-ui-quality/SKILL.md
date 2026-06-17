---
name: focusmap-ui-quality
description: Focusmapのデスクトップ/Web/Mac/iOS/スマホUIを、既存テーマを保ったまま95点以上の完成度へ引き上げるためのUI品質統括Skill。UI崩れ、白画面、クライアント例外、モバイル/デスクトップ差分、設定・カレンダー・マップ・チャット改善、デザイン調査、実画像モックアップ、並列実装分解、readonlyレビュー、Integrationを行う時に使う。
---

# Focusmap UI Quality

Use this skill as the lead UI quality architect for Focusmap. It covers settings, Todoカレンダー、予定編集、マップ、メモ、チャット、Mac Electron、iOS WebViewまで扱う。

## Start Here

First choose one mode. If the user did not name a mode, infer it and say the inferred mode briefly.

| Mode | Use When | Primary Workflow |
|---|---|---|
| `fast-triage` | 白画面、client-side exception、操作不能などP0/P1をまず止血する | `workflows/fast-triage.md` |
| `ui-runbook` | 広いUI改善を、調査/設計/モック/実装分解/統合まで進める推奨ルート | `workflows/two-chat-runbook.md` |
| `design-pack` | 現状評価、調査、UI憲法、企画書、実画像モックアップまで作る | `workflows/design-pack-flow.md` |
| `evaluate` | screenshot/appshot/route/codeのUI品質をレビューする | `workflows/audit-and-evaluation.md` |
| `improve` | 評価結果を95点以上の改善ロードマップへ変える | `workflows/improvement-roadmap.md` |
| `constitution` | Focusmapで守るUIルールやacceptanceを固める | `workflows/ui-constitution.md` |
| `mock` | Gate B後に見えるUIモックアップ画像を作る | `workflows/mock-generation.md` |
| `split` | 実装workerへ安全に分解する | `workflows/plan-and-split.md` |
| `worker` | 割り当て済み範囲だけ実装する | `workflows/implementation-worker.md` |
| `test-review` | readonlyでテスト観点/レビュー/95点案を出す | `workflows/test-review-subagent.md` |
| `integrate` | worker結果を確認してlocal mainへ統合する | `workflows/integration.md` |

For broad requests, start with `ui-runbook`. For P0 white screen or client exceptions, start with `fast-triage` and do not wait for mockups.

## Operating Model

1. First classify severity: P0/P1 fix lane or broad design lane.
2. Use one Design Pack chat for discovery, proposal, acceptance, and visible mockups. Use readonly subagents inside that chat when useful; do not make the user manage many research chats.
3. Evaluate the current UI before redesigning it.
4. Write UI acceptance criteria before mockups so images visualize decisions rather than invent them.
5. Generate and save visible mockup images after Gate B when the visual direction materially changes. Prompt files are supporting artifacts, not a substitute, unless the user explicitly approves a no-image path.
6. Ask for user approval on the proposal and visual direction before implementation split.
7. Use one Implementation Orchestrator chat to split workers, collect reports, resolve conflicts, and integrate.
8. Prefer foundation-first for broad UI changes: one shared shell/primitives worker first, then disjoint detail workers in parallel.
9. Do not pause after every worker unless there is a blocker. Collect all worker reports, then run one Integration Finalizer.
10. Every phase that hands off to another chat must end with a `Next Chat Handoff` block from `workflows/handoff-playbook.md`.
11. Integration reviews all worker reports, contract deviations, UI consistency, P0/P1 findings, and docs updates before local main completion.
12. Push/deploy is always a separate explicit gate.

## Read-On-Demand Map

Read only the files needed for the selected mode:

- `workflows/intake.md`: initial scope, platform, severity, and mode selection.
- `workflows/fast-triage.md`: P0/P1 white screen and broken UI stop-the-bleeding flow.
- `workflows/two-chat-runbook.md`: beginner-friendly two-main-chat delivery model and copy/paste prompts.
- `workflows/design-pack-flow.md`: one-chat research, proposal, UI acceptance, and mockup workflow.
- `workflows/timeline-and-dependency-gates.md`: gates, waves, and what may run in parallel.
- `workflows/handoff-playbook.md`: exact `Next Chat Handoff` block format.
- `workflows/research.md`: readonly desktop/mobile/current-UI/QA research roles.
- `workflows/audit-and-evaluation.md`: score existing UI and recommend next workflow.
- `workflows/improvement-roadmap.md`: convert findings into a staged 95+ improvement plan.
- `workflows/ui-constitution.md`: Focusmap UI rule writing.
- `workflows/mock-generation.md`: visible mockup image plan and constraints.
- `workflows/plan-and-split.md`: parallel implementation split and worker prompts.
- `workflows/implementation-worker.md`: assigned implementation worker instructions.
- `workflows/test-review-subagent.md`: readonly test/review instructions.
- `workflows/integration.md`: final integration and local main completion.

References:

- `references/ui-constitution.md`: Focusmap visual and interaction constitution.
- `references/scoring-and-severity.md`: score, severity, and pass gate.
- `references/worker-prompt-clauses.md`: reusable prompt clauses for workers.
- `references/beginner-glossary.md`: plain-language terms for non-engineers.

Templates:

- `assets/evaluation-report-template.md`
- `assets/ui-acceptance-template.md`
- `assets/design-pack-template.md`
- `assets/worker-prompt-template.md`

## Non-Negotiables

- Focusmap must look like one app across smartphone, PC, Mac app, and iOS app.
- Desktop uses overview + detail: right inspector, side panel, popover, split view.
- Mobile uses one-job-at-a-time: bottom nav, bottom sheet, drill-in, safe area, 44px tap targets.
- Do not stretch mobile sheets into desktop full-width forms.
- Do not cram desktop multi-pane UI into mobile.
- Do not introduce a new theme, icon set, radius system, font mood, or decorative style.
- White screen, client exception, operation blocked, overlapped text, wasteful full-width UI, theme drift, and unresolved P0/P1 are not acceptable.
- Scoring is diagnostic. Any review below 95 must include a concrete path to 95+.
- Follow repo `AGENTS.md`: tests, lint, build, Playwright, browser checks, curl, and `git diff --check` run only when the user explicitly asks.

## Required Outputs

Every substantial run should produce one or more of these:

- Evaluation report: findings, severity, evidence, score if useful, and recommended next workflow.
- Timeline plan: waves, gates, blocked steps, parallelizable work, and approval gates.
- Design Pack: current UI evaluation, research synthesis, proposal, UI acceptance, mockup plan, visible mockup images or explicit no-image exception.
- Next Chat Handoff: destination, purpose, exact paste-ready prompt, required attachments, expected output.
- Implementation Orchestrator Pack: worker ownership, allowed files, forbidden files, execution order, commit policy, integration prompt.
- Integration Review: included commits, contract deviations, UI acceptance, verification status, local main/origin/main/production status.

## Completion Gate

Do not mark UI work complete unless:

- P0 is zero.
- P1 is zero, or the user explicitly accepted deferral.
- Desktop and mobile behavior differ for a reason and still look like Focusmap.
- Existing theme and component language are preserved.
- Required `docs/CONTEXT.md` updates are included.
- Local main integration status, origin/main push status, and production status are reported separately.
