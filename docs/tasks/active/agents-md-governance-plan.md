# agents-md-governance Skill Spec and Implementation Plan

Status: planning only. Do not create the skill, rewrite `AGENTS.md`, merge, delete, deploy, or clean up branches/worktrees in this phase.
Date: 2026-06-26

## Purpose

Create a reusable Skill named `agents-md-governance` for auditing and improving repository `AGENTS.md` files as AI-coding governance constitutions. The Skill must preserve project-specific rules, make dangerous operations explicit, keep normal small work moving, and produce a concrete implementation/review plan before edits.

## Current Repo Context

- Active implementation location for this plan: `/Users/kitamuranaohiro/Private/focusmap-main-ai-history-integration` on `main`.
- `main` is ahead of `origin/main` by 1 commit. Push is not part of this task.
- Existing `AGENTS.md` is 189 lines, already under the 300-line target and 400-line maximum.
- No existing `agents-md-governance` skill directory was found under `~/.codex/skills`, `~/.agents/skills`, or `~/.claude/skills`.
- Existing worktrees: `main` at `focusmap-main-ai-history-integration`, `temp-cleanup-branch` at `focusmap`, and `codex/focusmap-calendar` at `focusmap-focusmap-calendar`.

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
- Clarify build/localhost gating: the Skill may recommend checks and block known-broken merge/deploy, but in Focusmap it must not run build/localhost checks automatically.

## Skill Specification

Draft frontmatter:

```yaml
---
name: agents-md-governance
description: Inspect, improve, and safely restructure repository AGENTS.md files as AI-coding governance constitutions. Use when auditing existing AGENTS.md rules, preserving project-specific AI development policies, classifying Hard/Soft/Optional gates, planning docs splits, inventorying stale git worktrees/branches, or reviewing AGENTS.md implementation diffs without auto merge/delete/deploy.
---
```

Default side-effect level: L1 report-only. Editing `AGENTS.md` or docs is L2 and requires an explicit implementation request. Destructive Git, production, DB, migration, and secret operations are L3 and require human approval; the Skill should normally only report and propose.

Core modes:
- `audit`: read existing `AGENTS.md`, relevant docs, and read-only Git/worktree state; produce the required report format.
- `restructure-plan`: propose a 300-line target / 400-line max constitution and docs split, with keep/move/fix decisions.
- `implement-governance`: only after explicit request, edit `AGENTS.md`/docs, preserving project-specific rules and avoiding unrelated rewrites.
- `inventory-cleanup`: classify old worktrees/branches as delete candidate high, needs confirmation medium, or delete forbidden; never delete automatically.
- `review-implementation`: review plan file, implementation diff, and changed files for safety, omissions, and over-blocking.

Hard Rules the Skill must stop without human approval: direct push to `main`, merge into `main`, production deploy, `git push --force`, `git reset --hard`, `git clean -fd`, worktree/branch/remote-branch deletion, `.env`/secret/auth display/change/delete, destructive DB operations, production data changes, migration apply, and merge/deploy while localhost/build is known to be fully broken.

Soft Rules the Skill should recommend but not over-block for Small work: Medium/Large branch+worktree+PR, worktree max 5, `git worktree list` before creating one, localhost/build checks before PR, Files changed review after PR, one AI review for Medium/Large, squash merge, and cleanup proposal after merge.

Optional Rules: planner/implementer/reviewer split, Draft PR, `docs/tasks/active/` task plan, detailed stale branch investigation, multiple AI reviews, and ADR creation.

Work size taxonomy:
- Small: wording, typo, comments, README, a few CSS lines, or 1-2 low-risk files. Worktree/PR/review optional; local main may be allowed if project rules allow it.
- Medium: UI improvement, new screen, light API change, multiple files, or existing feature impact. Branch+worktree+PR and explicit verification are recommended or project-required.
- Large: auth, DB, billing, migration, production data, large refactor, multi-feature changes, or old-branch-to-main integration. Issue/plan, worktree, Draft PR, separated AI roles, build/test, and human merge approval are required.

Required report format: Summary, Existing Project-Specific Rules, Must Fix, Should Fix, Optional, Worktree / Branch Inventory, Stale Cleanup Candidates, Proposed AGENTS.md Structure, Proposed Docs Split, Human Approval Needed, Implementation Plan.

## Proposed Skill Files

- `SKILL.md`: concise hub under 200 lines with mode routing, side-effect policy, and report format.
- `workflows/audit-agents-md.md`: inspection procedure and keep/move/fix extraction.
- `workflows/restructure-agents-md.md`: constitution rewrite and docs split procedure.
- `workflows/git-inventory.md`: read-only worktree/branch inventory and stale classification.
- `workflows/review-implementation.md`: reviewer checklist for plan + diff + files.
- `references/rule-taxonomy.md`: Hard/Soft/Optional, size taxonomy, localhost/build, docs lifecycle, and stale thresholds.
- `assets/report-template.md`: reusable markdown output template.
- Optional `scripts/git_inventory.py`: read-only helper only. It must not call push, merge, reset, clean, delete, deploy, DB, or secret commands.

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
- `main`: clean, ahead of `origin/main` by 1 commit. No push in this task.

## Implementation Plan For The Next AI

1. Read this file first, then read `AGENTS.md` and the skill-creator instructions.
2. Confirm target placement. Recommended source of truth: `~/.agents/skills/agents-md-governance` because Codex can load `~/.agents/skills`; add Codex/Claude symlinks or copies only if explicitly requested.
3. Initialize the skill using the standard skill template/init workflow; include workflows, references, assets, and only add the optional script if deterministic inventory is worth it.
4. Write the Skill as report-first and no-delete/no-merge/no-deploy by default. Keep `SKILL.md` concise; move detail into one-level references/workflows.
5. Validate the skill metadata and line counts. Do not run Focusmap app build/localhost checks unless the user explicitly asks.
6. Report created files and side-effect level. Do not edit Focusmap `AGENTS.md` in the same step unless explicitly requested.

## Review Plan

Reviewer must read this plan, the final `SKILL.md`, every workflow/reference/asset file, and the implementation diff. Review priorities: project-specific rule preservation, hard gate completeness, no automatic destructive operations, no secret-reading behavior, no over-blocking of Small work, concise progressive-disclosure structure, and exact required output format.

## Human Approval Needed

Human approval is required before editing existing `AGENTS.md`, moving existing docs, deleting/archiving any worktree or branch, merging to `main`, pushing to any remote, deploying, applying migrations, changing production data, or showing/changing/deleting secrets.
