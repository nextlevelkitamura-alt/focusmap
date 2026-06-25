# agents-md-governance Skill Spec and Implementation Plan

Status: implemented / final review fixes applied; formal adoption review pending. Do not rewrite repository `AGENTS.md`, merge, delete, deploy, push, or clean up branches/worktrees from this plan without explicit human approval.
Date: 2026-06-26

## Purpose

Create a reusable Skill named `agents-md-governance` for auditing and improving repository `AGENTS.md` files as AI-coding governance constitutions. The Skill must preserve project-specific rules, make dangerous operations explicit, keep normal small work moving, and produce a concrete implementation/review plan before edits.

## Current Repo Context

- Active plan location: `/Users/kitamuranaohiro/Private/focusmap-main-ai-history-integration` on `main`.
- Local `main` is ahead of `origin/main` after implementation work. Push is not part of this task; confirm the exact ahead count with `git status --short --branch` before any future push decision.
- Existing `AGENTS.md` is 189 lines, already under the 300-line target and 400-line maximum.
- Existing Skill directory is present at `/Users/kitamuranaohiro/.agents/skills/agents-md-governance`.
- The Skill install directory is not currently Git-managed, so Skill diffs, rollback, and review history do not have their own source-of-truth repository yet.
- Existing worktrees: `main` at `focusmap-main-ai-history-integration`, `temp-cleanup-branch` at `focusmap`, and `codex/focusmap-calendar` at `focusmap-focusmap-calendar`.

## Implementation Status

Created/changed Skill files:

- `/Users/kitamuranaohiro/.agents/skills/agents-md-governance/SKILL.md`
- `/Users/kitamuranaohiro/.agents/skills/agents-md-governance/workflows/audit-agents-md.md`
- `/Users/kitamuranaohiro/.agents/skills/agents-md-governance/workflows/restructure-agents-md.md`
- `/Users/kitamuranaohiro/.agents/skills/agents-md-governance/workflows/git-inventory.md`
- `/Users/kitamuranaohiro/.agents/skills/agents-md-governance/workflows/review-implementation.md`
- `/Users/kitamuranaohiro/.agents/skills/agents-md-governance/references/rule-taxonomy.md`
- `/Users/kitamuranaohiro/.agents/skills/agents-md-governance/assets/report-template.md`
- `/Users/kitamuranaohiro/.agents/skills/agents-md-governance/scripts/agents_md_audit.py`

Resolved in the current implementation:

- The Skill now has a concise hub file plus progressive-disclosure workflows, references, report template, and read-only helper script.
- The required report output includes `Moved Rules and Reasons`, `Removed Rules and Reasons`, and `Changed Rules and Reasons`.
- Hard approval gates cover push to `main`, merge/cherry-pick/rebase into `main`, production deploy, force push, reset/clean, worktree/branch deletion, secrets, destructive DB, production data, migrations, and runtime merge/deploy while localhost/build is known broken.
- Worktree governance includes the five-worktree maximum, duplicate-branch prevention, safe naming, stale thresholds, and proposal-only cleanup.
- The helper script is read-only and intentionally avoids push, merge, reset, clean, delete, deploy, secret, migration, and write actions.

Final review fix items addressed by this patch:

- Updated this plan from planning-only to implemented/adoption-review state.
- Strengthened the helper and workflow language for count exactly five as `Worktree Limit Reached` and `Human Approval Needed`.
- Replaced the Orca-specific task-name wording with generic task/issue/PR terminology.
- Relaxed localhost-broken gating so docs-only, governance-only, and other non-runtime changes are not blocked unnecessarily, while runtime merge/deploy remains blocked when localhost/build is fully broken.

Remaining final correction items:

- None known after this patch; reviewer confirmation is still required before formal adoption.
- Decide where the Skill source of truth should live before treating this install copy as durable.

## Existing Project-Specific Rules To Protect

- Keep Focusmap's product premise: AI executes/manages, humans oversee/approve.
- Keep the required read order: `docs/plans/focusmap-pivot.md`, `docs/CONTEXT.md`, `docs/ROADMAP.md`.
- Keep Focusmap's current Git default: small docs/UI/code changes may be committed directly to local `main`; push requires explicit user request.
- Keep the start-of-work checks: `git fetch --prune origin`, `git status --short --branch`, and `git worktree list`.
- Keep "local main is the completion source of truth"; feature/worktree-only commits are not done.
- Keep automatic verification policy: Codex does not run `npm run build`, tests, lint, curl, Playwright, Browser, Arc, or Cloudflare checks unless explicitly asked.
- Keep Focusmap's local preview rule: development server and phone tunnel are fixed to `http://localhost:3001`; do not replace this with generic 3000/3001-3005 defaults.
- Keep Cloud Run production rule: production reflects `origin/main`; do not deploy feature branches or uncommitted changes.
- Keep platform boundaries, mobile-first UI, shared visual language, optimistic UI, `ai_tasks` flow, mindmap migration constraints, and secret-safety rules.

## What To Move Or Clarify Later

- Keep concise Git/worktree gates in `AGENTS.md`; move detailed matrices and examples to docs such as `docs/operations/git-worktree-governance.md`.
- Keep Focusmap-specific localhost 3001 rule in `AGENTS.md`; move troubleshooting detail to a local preview doc if the section grows.
- Keep only stable AI role boundaries in `AGENTS.md`; leave task-router prompts, board mechanics, and run logs under `docs/ai/`.
- Clarify the apparent conflict between "small local main commits allowed" and the new hard rule "main merge requires human approval": direct small commits to local `main` may remain project-specific; branch-to-main merge/cherry-pick for Medium/Large should require human approval unless the project explicitly says otherwise.
- Clarify build/localhost gating: the Skill may recommend checks and block known-broken runtime merge/deploy, but docs-only/governance-only/non-runtime changes should not be stopped solely because localhost is broken, and in Focusmap it must not run build/localhost checks automatically.

## Skill Specification

Implemented frontmatter:

```yaml
---
name: agents-md-governance
description: Inspects, improves, and safely restructures repository AGENTS.md files as AI-coding governance constitutions. Use when auditing AGENTS.md, preserving project-specific development rules, classifying hard approval gates, planning docs splits, inventorying stale git worktrees or branches, or reviewing AGENTS.md diffs without auto merge, delete, or deploy.
---
```

Default side-effect level: L1 report-only. Editing `AGENTS.md` or docs is L2 and requires an explicit implementation request. Destructive Git, production, DB, migration, and secret operations are L3 and require human approval; the Skill should normally only report and propose.

Implemented modes:
- `audit`: read existing `AGENTS.md`, relevant docs, and read-only Git/worktree state; produce the required report format.
- `propose`: propose a 300-line target / 400-line max constitution and docs split, with keep/move/fix decisions.
- `rewrite`: after explicit approval, generate a draft `AGENTS.md` proposal without overwriting the real file.
- `apply`: only after explicit request, edit approved `AGENTS.md`/docs, preserving project-specific rules and avoiding unrelated rewrites.
- `inventory`: classify old worktrees/branches as cleanup candidates or delete forbidden; never delete automatically.
- `review`: review plan file, implementation diff, and changed files for safety, omissions, and over-blocking.

Hard Rules the Skill must stop without human approval: direct push to `main`, merge/cherry-pick/rebase into `main`, production deploy, `git push --force`, `git reset --hard`, `git clean -fd`, worktree/branch/remote-branch deletion, `.env`/secret/auth display/change/delete, destructive DB operations, production data changes, migration apply, and merge/deploy of runtime changes while localhost/build is known to be fully broken.

Soft Rules the Skill should recommend but not over-block for Small work: Medium/Large branch+worktree+PR, worktree max 5, `git worktree list` before creating one, localhost/build checks before PR for runtime/code behavior changes when requested or required, Files changed review after PR, one AI review for Medium/Large, squash merge, and cleanup proposal after merge.

Optional Rules: planner/implementer/reviewer split, Draft PR, `docs/tasks/active/` task plan, detailed stale branch investigation, multiple AI reviews, and ADR creation.

Work size taxonomy:
- Small: wording, typo, comments, README, a few CSS lines, or 1-2 low-risk files. Worktree/PR/review optional; local main may be allowed if project rules allow it.
- Medium: UI improvement, new screen, light API change, multiple files, or existing feature impact. Branch+worktree+PR and explicit verification are recommended or project-required.
- Large: auth, DB, billing, migration, production data, large refactor, multi-feature changes, or old-branch-to-main integration. Issue/plan, worktree, Draft PR, separated AI roles, build/test, and human merge approval are required.

Required report format: Summary, Existing Project-Specific Rules, Must Fix, Should Fix, Optional, Worktree / Branch Inventory, Stale Cleanup Candidates, Proposed AGENTS.md Structure, Proposed Docs Split, Moved Rules and Reasons, Removed Rules and Reasons, Changed Rules and Reasons, Human Approval Needed, Next Actions.

## Implemented Skill Files

- `SKILL.md`: concise hub under 200 lines with mode routing, side-effect policy, and report format.
- `workflows/audit-agents-md.md`: inspection procedure and keep/move/fix extraction.
- `workflows/restructure-agents-md.md`: constitution rewrite and docs split procedure.
- `workflows/git-inventory.md`: read-only worktree/branch inventory and stale classification.
- `workflows/review-implementation.md`: reviewer checklist for plan + diff + files.
- `references/rule-taxonomy.md`: Hard/Soft/Optional, size taxonomy, localhost/build, docs lifecycle, and stale thresholds.
- `assets/report-template.md`: reusable markdown output template.
- `scripts/agents_md_audit.py`: read-only helper only. It must not call push, merge, reset, clean, delete, deploy, DB, migration, or secret commands.

## Proposed AGENTS.md Structure For Target Repos

1. Product/project premise and mandatory reading.
2. Project-specific non-negotiables.
3. Work size classification.
4. Hard human-approval gates.
5. Git/worktree/PR/merge rules.
6. Localhost/build/deploy gates.
7. AI role separation and review expectations.
8. Documentation lifecycle and docs split links.
9. Cleanup/inventory policy.
10. Safety notes for secrets, DB, production data, and migrations.

## Worktree / Branch Inventory Notes

- Current worktree count is 3, below the proposed limit of 5.
- `temp-cleanup-branch`: last commit 2026-06-23, has an untracked file in that worktree. Delete forbidden until intent and untracked file are resolved.
- `codex/focusmap-calendar`: last commit 2026-06-18, clean locally but not merged into `main`. Strong stale-review candidate by age, but delete forbidden until PR/open work/unpushed/merge status is checked.
- `main`: clean and ahead of `origin/main`. No push in this task; confirm the exact ahead count before any future push decision.

## Pre-Adoption Remaining Tasks

1. Have the reviewer confirm the final patch, especially worktree limit wording, localhost runtime/docs distinction, and required output sections.
2. Decide Git source-of-truth management for personal Skills.
3. Recommended long-term source: a separate private repository that syncs into `~/.agents/skills`, treating the home-directory Skill folder as the install target.
4. Short-term alternative: initialize Git under `~/.agents/skills`, with `.env`, secrets, auth files, and personal machine settings excluded by `.gitignore`.
5. Do not mix this generic Skill source into the Focusmap repository.
6. After formal adoption, keep this plan as implementation history or archive it under the repo's task archive if that lifecycle is still desired.

## Review Plan

Reviewer must read this plan, the final `SKILL.md`, every workflow/reference/asset/script file, and the implementation diff. Review priorities: project-specific rule preservation, hard gate completeness, no automatic destructive operations, no secret-reading behavior, no over-blocking of Small work, worktree limit handling at exactly five, localhost runtime/docs distinction, concise progressive-disclosure structure, and exact required output format.

## Human Approval Needed

Human approval is required before editing existing `AGENTS.md`, moving existing docs, deleting/archiving any worktree or branch, merging to `main`, pushing to any remote, deploying, applying migrations, changing production data, or showing/changing/deleting secrets.
