# Timeline And Dependency Gates

Use this whenever a Focusmap UI request may involve research, design, mockups, implementation splitting, or integration.

## Phase Model

Default broad UI sequence:

```text
Wave 0: Parent chat chooses mode and severity
Wave 1: Design Pack chat runs readonly discovery and research
Wave 2: Design Pack chat writes proposal and UI acceptance
Wave 3: Design Pack chat creates visible mockup images after Gate B
Wave 4: User approves visual/product direction
Wave 5: Implementation Orchestrator creates worker prompts
Wave 6: Optional foundation worker for shared shell/primitives
Wave 7: Disjoint detail workers run in parallel
Wave 8: Integration Finalizer consolidates to local main
Wave 9: Optional push/deploy gate, only with explicit approval
```

P0/P1 stop-the-bleeding sequence:

```text
Wave 0: Classify P0/P1
Wave 1: Identify likely cause from code, screenshot, appshot, logs, or recent diff
Wave 2: Make smallest safe fix
Wave 3: Report verification needed; run only user-approved checks
Wave 4: Commit local main if repo policy requires it
```

Do not force broad mockup gates onto P0 stability fixes.

## What Can Run In Parallel

Wave 1 may use readonly subagents inside one Design Pack chat:

- current UI evaluation
- desktop benchmark
- mobile benchmark
- Focusmap existing UI inventory
- accessibility and interaction review
- implementation risk discovery

Wave 7 may use implementation workers only after contracts exist:

- desktop screen
- mobile screen
- shared primitives
- data/API state
- readonly test/review

## What Should Not Run In Parallel

Keep these single-owner:

- final synthesis and decision-making
- Focusmap UI constitution changes
- UI acceptance criteria
- mockup generation based on accepted architecture
- implementation ownership assignment
- final integration
- push/deploy decision

## Gates

### Gate A: Discovery Complete

- current issue or new requirement is known
- platform scope is known: desktop web, Mac app, mobile web, iOS WebView
- risks are classified: P0/P1/P2, auth, destructive action, external write, local machine control

### Gate B: Architecture Complete

- target layout pattern is decided
- desktop/mobile split is decided
- component inventory and state language are decided
- UI acceptance criteria exist

### Gate C: Visual Direction Approved

Required before broad implementation split when visual design materially changes:

- visible mockup images are saved and reviewed, or user explicitly approved a no-image path
- accepted visual constraints are clear
- rejected directions are noted

### Gate D: Contracts Complete

Required before parallel implementation:

- allowed files per worker
- forbidden files per worker
- base commit and foundation commit if any
- shared component/API/data contracts
- verification policy
- commit/push policy
- integration owner and merge order

### Gate E: Integration Complete

- worker reports reviewed
- contract deviations resolved or documented
- UI acceptance checked
- P0/P1 resolved
- docs updated when behavior changed
- local main integration status reported separately from origin/main and production

### Gate F: Push/Deploy Explicitly Approved

- local main state is known
- verification status is known: run, skipped by policy, or explicitly deferred
- user explicitly approves push/deploy

## Common Corrections

- If mockups are proposed before evaluation and acceptance, move them after Gate B.
- If implementation prompts are proposed before Gate C, label them draft-only.
- If the design pack has prompts but no visible images, do not pass Gate C unless the user approves no-image.
- If multiple workers touch the same shared files, make one foundation worker first or run sequentially.
- If workers are complete, do not ask approval after each one unless blocked. Collect all reports and run one Integration Finalizer.
- If local main integration is complete, do not push unless explicitly approved.
