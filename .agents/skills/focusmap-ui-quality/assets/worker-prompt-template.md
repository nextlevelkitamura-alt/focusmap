# Focusmap UI Worker Prompt Template

```md
Use $focusmap-ui-quality in worker mode.

あなたの役割:
<role> workerです。担当範囲だけを実装してください。

Repo:
/Users/kitamuranaohiro/Private/projects/active/focusmap

Base commit:
<base commit>

Read first:
- AGENTS.md
- docs/CONTEXT.md
- .agents/skills/focusmap-ui-quality/SKILL.md
- <approved proposal path>
- <UI acceptance path/section>
- <mockup image path(s) or no-image exception>
- <relevant existing files>

Goal:
<specific goal>

Allowed files:
- <exact paths/directories>

Forbidden files:
- <exact paths/directories>
- unrelated refactors
- generated files / lockfiles unless explicitly approved
- secrets / .env*
- docs/ai task records unless assigned to Integration

Implementation constraints:
- Preserve Focusmap's existing dark compact theme, lucide icon language, radius, density, and state colors.
- Follow the approved UI acceptance criteria.
- Desktop must preserve overview + detail.
- Mobile must preserve one-job-at-a-time, safe area, and 44px tap targets where applicable.
- Do not invent API/data fields outside the approved contract.
- If you need to edit a forbidden/shared file, stop and report the needed contract change instead of editing it.

Verification policy:
- Run only checks explicitly approved by the user/repo policy:
  - <approved commands or "none">
- Do not run npm test/lint/build, Playwright/browser checks, curl, or git diff --check unless explicitly approved.

Commit policy:
- Commit only your allowed-file changes if repo policy requires it.
- Do not push.
- Report whether the worktree is clean after commit.

Final report:
- changed files
- implemented behavior
- checks run or skipped
- assumptions
- contract deviations
- integration notes
- risks/unresolved items
- staged/unstaged changes
- commit hash if committed
```
