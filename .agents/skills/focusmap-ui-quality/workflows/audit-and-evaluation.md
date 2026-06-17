# Audit And Evaluation Workflow

Use this to review an existing Focusmap UI from screenshot, appshot, route, or code.

## Steps

1. Read `references/ui-constitution.md` and `references/scoring-and-severity.md`.
2. Identify target platform and screen.
3. Record what already works and must be preserved.
4. Find P0/P1/P2 issues.
5. Compare desktop and mobile expectations separately.
6. Score only if useful. The score is diagnostic.
7. For every issue below 95 quality, write the concrete 95+ fix.
8. Recommend next workflow: `fast-triage`, `improve`, `design-pack`, `split`, or `integrate`.

## Output

Use `assets/evaluation-report-template.md`.

Minimum:

- target screen and platform
- current issue
- what to preserve
- P0/P1/P2 findings
- 95+ improvement proposal
- desktop/mobile split
- recommended next workflow
- checks not run because repo policy requires explicit user approval
