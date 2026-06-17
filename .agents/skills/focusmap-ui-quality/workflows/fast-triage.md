# Fast Triage Workflow

Use this for P0/P1 UI failures: white screen, client-side exception, route unusable, broken navigation, or blocked critical operation.

## Goal

Restore usability first. Do not wait for benchmark research, broad redesign, or mockups when the app is broken.

## Steps

1. Classify severity.
   - P0: white screen, client exception, route unusable, critical action impossible.
   - P1: severe layout or interaction issue, but the app still works.
2. Gather evidence.
   - screenshot/appshot
   - URL/route
   - user action before failure
   - recent changed files or current git diff
   - console/log evidence only if the user asked for browser/runtime checks
3. Read the likely affected code and `docs/CONTEXT.md` section.
4. Make the smallest safe fix that restores the UI.
5. Preserve Focusmap theme. Do not redesign while triaging.
6. If the fix changes UI behavior or data flow, update `docs/CONTEXT.md`.
7. Run checks only when the user explicitly asked. Otherwise list the checks that should be run.
8. Commit only this fix if repo policy requires a commit.

## Stop Conditions

Stop and report instead of guessing when:

- root cause cannot be found from code/appshot/screenshot
- reproduction requires login/browser access not available
- a destructive data operation seems necessary
- multiple unrelated failures are mixed together

## Output

- severity
- suspected cause
- files inspected
- fix made or blocker
- checks run or skipped by policy
- remaining P0/P1 risk
- local main/origin/main/production status if committed
