# Design Pack Flow

Use this as the first main chat for broad Focusmap UI work. It keeps discovery, synthesis, proposal, UI acceptance, and mockups in one place.

## Shape

```text
Design Pack Chat
  1. Intake
  2. Readonly multi-angle research
  3. Synthesis and Focusmap UI architecture
  4. Proposal / 企画書
  5. UI acceptance
  6. Visible mockups after Gate B
  7. User approval checkpoint
  8. Handoff to Implementation Orchestrator
```

## Step 1: Intake

Collect or infer:

- target screen: Todo calendar, event editor, settings, map, memo, chat, Mac app, iOS WebView
- target platform: desktop web, Mac app, mobile web, iOS WebView
- evidence: screenshot, appshot, URL, route, user complaint, code path
- scope: evaluate only, redesign, mockups, implementation prompts, integration
- constraints: existing theme, shared components, no image generation, no code edits, repo verification policy
- artifact paths under `docs/ai/plans/active/` unless repo rules say otherwise

## Step 2: Readonly Research

Use `workflows/research.md`.

Recommended viewpoints:

- Current Focusmap UI inventory
- Desktop mature-product patterns
- Mobile mature-product patterns
- Accessibility and interaction review
- Implementation risk review

Do not edit application code in this step.

## Step 3: Synthesis And Architecture

Gate A passes when discovery is complete.

Create:

- top P0/P1/P2 findings
- target experience
- desktop/mobile/Mac/iOS split
- layout pattern
- component inventory
- state language
- interaction rules
- UI acceptance criteria

Gate B passes only when a mockup can be judged against concrete criteria.

## Step 4: Proposal / 企画書

Write the proposal before mockups. Use `assets/design-pack-template.md`.

The proposal must say:

- what stays visually the same
- what changes
- desktop behavior
- mobile behavior
- P0/P1 acceptance
- implementation readiness

## Step 5: Mockups

Use `workflows/mock-generation.md` only after Gate B.

Mockup means visible image files that the user can inspect. Prompt files alone are not enough unless the user explicitly approves a prompt-only/no-image path.

## Step 6: Approval Checkpoint

Stop before implementation split. Ask the user to choose:

- approve proposal and visual direction
- combine parts of options
- revise architecture
- explicitly skip images and continue with a no-image exception

## Step 7: Handoff

Use `workflows/handoff-playbook.md` and include:

- proposal path
- UI acceptance path or section
- mockup image paths
- selected direction
- unresolved decisions
- Chat 1 commit hash if committed
