# Improvement Roadmap Workflow

Use this after evaluation to turn findings into a staged 95+ improvement plan.

## Steps

1. Start from P0/P1 findings, not visual polish.
2. Separate fixes into:
   - stability
   - layout and platform behavior
   - shared components/tokens
   - screen-specific implementation
   - polish
3. Decide whether visual mockups are required.
4. Write UI acceptance criteria using `assets/ui-acceptance-template.md`.
5. Label the implementation path:
   - `SINGLE_CHAT`
   - `SEQUENTIAL`
   - `PARALLEL_READONLY`
   - `HYBRID_PLAN_THEN_PARALLEL`
   - `PARALLEL_WORKTREES`
   - `DO_NOT_PARALLELIZE`
6. If broad visual change is planned, require Gate C before implementation split.

## Output

- staged plan
- dependencies
- what runs first
- what can run in parallel
- P0/P1 pass gate
- mockup requirement or no-image reason
- worker ownership draft
- user decisions needed
