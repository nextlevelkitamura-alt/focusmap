# Focusmap UI Dashboard Quality Design Pack

Date: 2026-06-18 JST
Mode: `focusmap-ui-quality` design-pack
Scope: readonly UI investigation, 95+ target design, UI acceptance, mockup artifacts
Implementation changes: none

## Problem

- Target screen: Focusmap dashboard, especially Desktop Todo / 3days calendar and event editing.
- Platforms: desktop web, Mac app shell, mobile web, iOS WebView shell.
- User complaint: a current Mac/dashboard screenshot shows a white page with a client-side exception. Desktop event editing also appears to risk mobile-style full-width sheets instead of a mature desktop inspector.
- Evidence:
  - User screenshot: `/var/folders/w2/wxq6n_0920g2cjyh5gm3sj440000gn/T/codex-clipboard-3fc8e4fa-d38f-4df2-b07a-fc66296ad4e6.png`
  - Screenshot resolution: 3840x2160 PNG.
  - Visible failure: white background, centered text: `Application error: a client-side exception has occurred while loading focusmap-official.com`.
  - No app implementation code was changed during this Design Pack.

## Read Scope

- `AGENTS.md`
- `docs/plans/focusmap-pivot.md`
- `docs/CONTEXT.md`
- `docs/ROADMAP.md`
- `docs/specs/platform-boundaries.md`
- `.agents/skills/focusmap-ui-quality/SKILL.md`
- `.agents/skills/focusmap-ui-quality/workflows/design-pack-flow.md`
- `.agents/skills/focusmap-ui-quality/workflows/timeline-and-dependency-gates.md`
- `.agents/skills/focusmap-ui-quality/workflows/mock-generation.md`
- `.agents/skills/focusmap-ui-quality/workflows/handoff-playbook.md`
- `.agents/skills/focusmap-ui-quality/references/ui-constitution.md`
- `.agents/skills/focusmap-ui-quality/references/scoring-and-severity.md`
- Dashboard and shell files inspected read-only:
  - `src/app/dashboard/dashboard-client.tsx`
  - `src/app/dashboard/dashboard-loader.tsx`
  - `src/app/dashboard/dashboard-startup-fallback.tsx`
  - `src/app/dashboard/loading.tsx`
  - `src/app/dashboard/layout.tsx`
  - `src/app/layout.tsx`
  - `src/components/dashboard/desktop-today-panel.tsx`
  - `src/components/today/today-3days-calendar.tsx`
  - `src/components/today/mobile-event-edit-modal.tsx`
  - `src/components/calendar/calendar-event-edit-modal.tsx`
  - `src/components/mobile/bottom-nav.tsx`
  - `src/components/settings/settings-shell.tsx`
  - `desktop/focusmap-mac/main.cjs`
  - `desktop/focusmap-mac/loading.html`
  - `mobile/focusmap-app/App.tsx`

## Gate Status

- Gate A, discovery complete: passed.
- Gate B, architecture and acceptance complete: passed by this document.
- Gate C, visual direction approved: pending user approval after reviewing mockups.
- Gate D, implementation contracts complete: draft only. Chat 2 should turn this into worker prompts.
- Gate E, integration complete: not started.
- Gate F, push/deploy: not approved and not requested.

## User Feedback Revision: Existing UI Baseline

User feedback on 2026-06-18:

- The right-side detail/editing direction is good.
- The earlier desktop mockups changed the UI too much from the current Focusmap look.
- Revised desktop mockups should use the attached current UI screenshot as the base:
  - black dotted canvas
  - compact top pill navigation
  - amber/yellow selected card outlines
  - small radii and dense spacing
  - current right-side panel density
- Tapping/clicking a schedule item should open detail editing from the right side.
- Desktop should not look like a generic calendar app, and should not use a mobile bottom sheet.

Revised mockups added:

- `docs/ai/plans/active/focusmap-ui-dashboard-quality-assets/existing-style-desktop-todo-normal.png`
- `docs/ai/plans/active/focusmap-ui-dashboard-quality-assets/existing-style-desktop-event-right-drawer.png`

This revision supersedes the earlier generic desktop calendar-like visual direction. The retained product rule is still the same: desktop uses overview plus right-side detail; mobile uses a bottom sheet or drill-in. The revised visual baseline is now the current Focusmap map/right-panel UI, not Apple/Google-style calendar chrome.

## User Feedback Revision: Schedule Split Timing

User feedback after the existing-UI-baseline mockups:

- Schedule split should appear at the timing point inside the selected schedule, not as a permanent large control.
- For Desktop, the primary split affordance should appear near the selected schedule card at a 10-minute increment, such as `10:20で分割`.
- The right drawer may support the split with chips and before/after preview, but the interaction should still feel anchored to the schedule card.
- For Mobile, hover/precision affordances are inappropriate. Use an explicit `予定を分割` mode inside the bottom sheet or drill-in, with 10-minute choices and a clear preview.

Additional revised mockups added:

- `docs/ai/plans/active/focusmap-ui-dashboard-quality-assets/existing-style-desktop-schedule-split-10min.png`
- `docs/ai/plans/active/focusmap-ui-dashboard-quality-assets/existing-style-mobile-schedule-split-10min.png`

Schedule split acceptance:

- Desktop: split UI appears only after selecting a schedule item and interacting with a specific time position.
- Desktop: a near-card popover or inline affordance names the exact split time.
- Desktop: right drawer can show supporting controls, selected time chips, and before/after preview.
- Mobile: split is entered intentionally from the event edit sheet; it is not a tiny hover control.
- Mobile: 10-minute choices, selected time, before/after segments, and confirmation action are visible.
- Both: split preview uses Focusmap amber state language and keeps destructive/irreversible actions separate.

## Correction: Schedule Split Is Calendar, Not Mindmap

User clarification after the schedule split mockups:

- The schedule split interaction is a calendar interaction.
- The previous `existing-style-*-schedule-split-10min` mockups incorrectly placed the idea on a map/node canvas.
- Correct behavior belongs on the calendar event block:
  - Desktop: the split point is a horizontal line inside the vertical calendar event block, because time runs top-to-bottom.
  - Desktop: the near-event popover says the exact split time, e.g. `10:20で分割`.
  - Desktop: the right drawer remains supporting UI for chips, preview, and confirmation.
  - Mobile: the calendar event can show selected context, but the precise split selection happens in a bottom-sheet/drill-in mode.

Corrected calendar mockups added:

- `docs/ai/plans/active/focusmap-ui-dashboard-quality-assets/calendar-desktop-event-split-10min.png`
- `docs/ai/plans/active/focusmap-ui-dashboard-quality-assets/calendar-mobile-event-split-10min.png`

Implementation guidance:

- Use the corrected `calendar-*event-split-10min` mockups for schedule split.
- Do not implement schedule split from the map-style `existing-style-*-schedule-split-10min` intermediate images.
- The map-style images remain in the asset folder only as history of the design iteration.

## Current UI Evaluation

### Overall Score

- Current availability score for affected session: P0, effectively 0 for that session because the dashboard cannot be used.
- Current UI maturity if the crash is excluded: 72 / 100.
- Overall current score including crash and desktop edit mismatch: 54 / 100.
- Target score after this plan: 96 / 100.

The score is not the conclusion. The concrete path to 95+ is: catch runtime failures with a dark recovery UI, replace desktop event editing with an inspector/popover pattern, preserve the mobile bottom sheet only on mobile, and unify state language across calendar, settings, map, memo, and chat.

### P0 Findings

1. White screen / client-side exception reaches the user.
   - The screenshot proves the runtime exception escapes into the default white Next.js client error page.
   - `src/app/dashboard/loading.tsx` and `DashboardStartupFallback` provide a dark loading shell, but they only cover loading/startup, not runtime component exceptions after hydration.
   - `desktop/focusmap-mac/loading.html` and `mobile/focusmap-app/App.tsx` provide dark network/startup fallback states, but Web runtime exceptions inside the page can still render the white app error.
   - `find src/app -name error.tsx -o -name global-error.tsx` returned no dashboard/global error boundary files.
   - Impact: a Mac app or web user sees a separate, broken product instead of Focusmap.

2. P0 diagnosis requires console stack or production logs before root cause is claimed.
   - The code-level gap is clear: missing dark runtime error boundary.
   - The exact thrown exception is not known from the screenshot alone.
   - Browser, Playwright, curl, build, lint, and tests were explicitly out of scope for this chat, so Chat 2 should require an implementation worker to identify the stack only if the user permits the relevant check.

### P1 Findings

1. Desktop event edit uses a mobile bottom sheet.
   - `src/components/dashboard/desktop-today-panel.tsx` imports `MobileEventEditModal` and renders it for desktop event editing.
   - `MobileEventEditModal` is a fixed bottom sheet with `h-[88dvh]`, rounded top corners, mobile-safe-area behavior, and full-width overlay assumptions.
   - This is correct for mobile, but it is not a mature desktop editing interaction.

2. Desktop loses overview while editing detail.
   - Desktop calendar users need to keep the 3days timeline visible while editing a selected event.
   - Mature desktop products like Calendar, Notion, YouTube Studio, and Google Workspace avoid turning compact detail edits into mobile-sized sheets when a side inspector or anchored popover can preserve context.
   - Target: click event -> selected card stays highlighted -> right inspector or near-card popover opens -> calendar remains visible and usable.

3. Error recovery language is inconsistent across platform shells.
   - Mac shell and iOS shell have dark startup/error recovery concepts.
   - Web runtime exception currently falls through to a default white failure page.
   - Target: one Focusmap dark recovery state reused conceptually across web, Mac app, and iOS WebView.

4. Visual consistency is mostly good but not contractually protected.
   - Settings, calendar, memo, map, and chat are all broadly dark and operational.
   - However, each area can drift through separate hard-coded neutrals, radius, and state labels.
   - Target: write acceptance rules that force shared status language and component proportions.

### P2 Findings

1. Desktop density can be improved after the P0/P1 fixes.
   - The 3days grid is a good base, including all-lane overlap rendering when `show3DayOverflowChips={false}`.
   - The next refinement is not more whitespace. It is better alignment, selected-event state, inspector width, and compact editing sections.

2. Mixed labels and language should be tightened.
   - The desktop control currently uses English mode labels such as `Day`, `3days`, and `Month` while other dashboard surfaces use Japanese labels.
   - This is not a blocker, but a 95+ UI should use consistent language or a deliberate bilingual rule.

3. Destructive actions need subtle consistency.
   - Mobile event editing correctly separates delete actions near the bottom.
   - Desktop inspector should follow the same structure: low-emphasis destructive area, confirmation, inline error if it fails.

## What Already Works

- Focusmap already has a strong dark operational direction, not a marketing-page aesthetic.
- Mobile bottom navigation is conceptually correct: Todo, memo, map, chat, settings.
- Mobile event editing has the right shape for mobile: bottom sheet, safe-area awareness, dense fields, inline save/delete states.
- The Mac app shell uses a dark background and hiddenInset titlebar, which is consistent with Focusmap.
- The iOS WebView shell has a dark native startup calendar shell and native reload/Safari fallback.
- The Desktop 3days calendar already has a serious timeline foundation:
  - time gutter
  - three day columns
  - sticky header
  - overlapping lane calculation
  - all-overlap display when overflow chips are disabled
  - drag-resize concepts

## Research Synthesis

### Desktop Mature-Product Principles

- Keep the main working context visible while editing details.
- Use a right inspector, side panel, split view, or anchored popover for small-to-medium edits.
- Avoid full-screen overlays for routine edits on wide screens.
- Use selected states instead of modal isolation.
- Save and error states should live near the changed field or action.
- Destructive controls stay visually separated and subdued until needed.

### Mobile Mature-Product Principles

- One screen, one purpose.
- Bottom navigation for primary app areas.
- Bottom sheet or drill-in for details.
- 44px minimum tap targets.
- Safe-area and keyboard behavior are part of the design, not afterthoughts.
- Do not cram desktop inspectors into mobile.

### Focusmap Existing UI DNA To Preserve

- Dark compact operational theme.
- Backgrounds:
  - app base near `#050505` / `#060606`
  - panel base near neutral/zinc 900-950
  - borders at white 8-12 percent opacity
- State color direction:
  - active / primary: blue around `#58a6ff`
  - running / current / success: green to emerald, including existing `#9ee493` / `#8ee8c1` feel
  - caution / awaiting: amber
  - failed / destructive: red, low area dominance until confirmed
- Radius:
  - controls and event cards: 6-8px
  - mobile sheets can keep a larger top radius, around 16px, because they are platform affordances
- Icons:
  - lucide-style line icons, 16-20px in dense desktop controls, 20-22px for mobile primary nav/actions
- Density:
  - desktop should use compact 11-14px type and high information density
  - mobile should reduce simultaneous content, not enlarge every desktop field
- No decorative gradient orbs, hero treatments, oversized cards, or single-hue novelty palette.

## Target Experience

### Desktop Web

- Default Todo opens in 3days calendar.
- The timeline uses most available width.
- Clicking an event selects it and opens a right inspector, approximately 384-408px wide.
- The calendar remains visible, scrollable, and spatially stable.
- The selected event card has a clear but restrained selected state.
- Inspector sections:
  - header with calendar dot, time summary, close icon
  - title and completion state
  - schedule: start/end, duration, date
  - calendar and reminder
  - memo
  - linked subtasks or task context
  - save/sync state
  - subtle destructive section at bottom
- If the viewport is too narrow for a persistent inspector, use an anchored popover near the selected card before falling back to mobile sheet behavior.
- Desktop should never show the mobile full-width bottom sheet unless the viewport is genuinely mobile.

### Mobile Web

- Keep the current mobile bottom-sheet model for event editing.
- Preserve one task per screen: edit the event, not a multi-pane dashboard.
- Use safe-area padding and keyboard-aware scrolling.
- Keep tap targets at 44px minimum.
- Prefer progressive disclosure for complex choices:
  - collapsed calendar row -> picker
  - reminder row -> option list
  - subtasks -> inline compact list
- The same event fields and status labels should exist as desktop, but in mobile layout.

### Mac App

- Keep the hiddenInset titlebar and dark shell.
- Preserve `desktop=1` behavior for Mac desktop layout.
- A client runtime exception must show a dark Focusmap recovery UI, not the white Next.js error.
- The recovery UI should offer:
  - reload
  - open in browser
  - copy diagnostics
  - optional cached last-known dashboard skeleton
- Do not create a Mac-only product UI. Mac differences should be shell, chrome, and recovery affordances.

### iOS WebView

- Keep the native startup calendar shell and reload/Safari fallback.
- Product UI remains in Web.
- Native shell stays thin.
- Web runtime exceptions should be caught by the web app dark error boundary so the WebView does not show a white page.

## UI Architecture

### Layout

- Desktop dashboard uses a three-zone mental model:
  - global dashboard navigation/header
  - primary work canvas, e.g. 3days calendar
  - contextual inspector, only when a detail is selected
- Mobile dashboard uses a two-zone model:
  - current tab content
  - bottom navigation plus bottom sheet/drill-in for details

### Navigation

- Preserve current dashboard tabs and mobile bottom nav.
- Keep `Todo` as the main operational entry.
- Do not introduce a marketing landing page or explanatory onboarding inside the dashboard.

### Components

- New or refactored implementation should produce a desktop event inspector instead of reusing `MobileEventEditModal` on desktop.
- Mobile can keep `MobileEventEditModal` with shared field labels and validation logic where practical.
- Error fallback should be a shared concept:
  - dashboard route error boundary for runtime failures
  - global fallback only if needed
  - Mac/iOS shell fallback remains for network/native shell failures

### State Language

- Loading: dark skeleton or cached shell, never white.
- Saving: small inline `保存中` state near the inspector action or field.
- Saved: quiet confirmation, no blocking toast required.
- Failed: inline error near the action; retry available.
- Awaiting approval: amber/outline status, not red.
- Running: green/emerald pulse or status chip, not a large loader.
- Destructive: separated low-emphasis section, confirmation before irreversible actions.

### Error, Loading, Empty

- P0 error state must cover runtime client exceptions.
- Error screen must visually belong to Focusmap:
  - dark background
  - compact panel or shell
  - no generic white browser/Next page
  - clear action buttons
  - diagnostics hidden behind copy/details
- Empty calendar state should occupy the grid quietly, not replace the dashboard.

## UI Acceptance

### Scope

- Feature/screen: dashboard Todo 3days calendar, event editing, runtime error recovery.
- Platforms: desktop web, Mac app shell, mobile web, iOS WebView shell.
- User goal: manage today's and near-future work while keeping enough context to approve, edit, and recover without losing trust.

### Must Preserve

- Focusmap dark compact operational theme.
- Existing shared components/tokens where applicable.
- lucide icon language.
- Current data/API behavior unless explicitly changed.
- Existing mobile bottom navigation concepts.
- Existing Mac and iOS shell boundaries from `docs/specs/platform-boundaries.md`.

### P0 Acceptance

- A runtime client exception inside the dashboard renders a dark Focusmap recovery UI.
- No user-facing white application error page remains for dashboard runtime failures.
- Recovery UI includes reload, open externally where supported, and copy diagnostics or error details.
- Dashboard loading fallback remains dark and does not regress.
- Mac app and iOS WebView do not need product-specific forks to fix web runtime errors.
- Exact exception cause is identified before implementation claims the crash is fixed.

### Desktop Acceptance

- Desktop event editing does not render `MobileEventEditModal` as a full-width bottom sheet.
- Event click keeps the 3days calendar visible.
- Detail editor uses:
  - right inspector at wide widths, target 384-408px
  - anchored popover at medium widths if needed
  - mobile bottom sheet only below the mobile breakpoint
- Selected event state is visible in the calendar.
- Inspector contains all current mobile edit capabilities that are relevant on desktop:
  - title
  - completion/task link where applicable
  - date/time/duration
  - calendar selection
  - reminder
  - memo
  - subtasks if linked
  - delete with confirmation
- Long titles, many subtasks, narrow desktop widths, loading, empty, and failed save states do not break layout.
- Calendar drag/resize affordances remain usable when no inspector field is actively focused.

### Mobile Acceptance

- Mobile keeps a bottom sheet or drill-in pattern for event editing.
- Tap targets are at least 44px where applicable.
- Safe area and keyboard states are handled.
- The user edits one event at a time.
- Desktop multi-pane inspector is not squeezed into mobile.
- Mobile and desktop use the same field labels, state concepts, and event color meanings.

### Cross-Platform Acceptance

- Same concepts use same labels, icons, and state language across Todo, calendar, map, memo, chat, and settings.
- Platform differences are layout and input differences, not visual-brand differences.
- Colors, radii, borders, and icon stroke feel like one Focusmap.
- P0/P1 findings in this document are resolved or explicitly deferred with a reason.

### Interaction Acceptance

- User actions use optimistic UI where Focusmap already expects immediate reflection.
- Saving, saved, failed, disabled, empty, and loading states are visible.
- Errors appear near the action that caused them.
- Destructive actions are visually separated and confirmed when needed.

### Verification Policy

- This Design Pack did not run tests, lint, build, Playwright, browser checks, curl, or `git diff --check`.
- Chat 2 and implementation workers must follow the repo policy:
  - do not run verification unless the user explicitly requests it
  - `git status`, `git diff`, and `git diff --cached` are allowed only to scope commits
  - report needed verification instead of running it automatically

## Mockup Plan

Asset directory: `docs/ai/plans/active/focusmap-ui-dashboard-quality-assets/`

Required images:

1. `desktop-3days-calendar-normal.png`
   - Desktop 3days calendar normal state.
   - Proves dense dark overview, 3 equal days, no oversized form.
2. `desktop-event-edit-inspector.png`
   - Desktop event clicked with right inspector.
   - Proves overview plus detail.
3. `mobile-event-edit-bottom-sheet.png`
   - Mobile same event edit in bottom sheet/drill-in state.
   - Proves mobile one-purpose layout.
4. `dark-recovery-ui.png`
   - White-screen/client-exception recovery UI.
   - Proves dark brand-owned failure state.

Revised existing-UI-baseline images:

5. `existing-style-desktop-todo-normal.png`
   - Desktop normal state based on the current Focusmap screenshot.
   - Proves the UI stays close to the current black dotted canvas and amber card language.
6. `existing-style-desktop-event-right-drawer.png`
   - Desktop schedule item clicked with a right-side editing drawer.
   - Proves the editing surface feels like the current Focusmap right panel, not a separate app design.
7. `existing-style-desktop-schedule-split-10min.png`
   - Desktop schedule split at a 10-minute point inside the selected schedule card.
   - Proves the split affordance appears at the timing point while the right drawer supports preview/confirmation.
8. `existing-style-mobile-schedule-split-10min.png`
   - Mobile schedule split mode inside a bottom sheet.
   - Proves mobile uses deliberate drill-in/bottom-sheet selection rather than precision hover controls.

Corrected calendar schedule split images:

9. `calendar-desktop-event-split-10min.png`
   - Desktop 3days calendar event split at a 10-minute point inside the selected event block.
   - Proves the split line belongs to the calendar event block, while the right drawer supports preview/confirmation.
10. `calendar-mobile-event-split-10min.png`
   - Mobile calendar event split mode inside a bottom sheet.
   - Proves mobile calendar split uses deliberate time-choice UI instead of hover.

Prompt files:

- `docs/ai/plans/active/focusmap-ui-dashboard-quality-assets/prompts/desktop-3days-calendar-normal.prompt.txt`
- `docs/ai/plans/active/focusmap-ui-dashboard-quality-assets/prompts/desktop-event-edit-inspector.prompt.txt`
- `docs/ai/plans/active/focusmap-ui-dashboard-quality-assets/prompts/mobile-event-edit-bottom-sheet.prompt.txt`
- `docs/ai/plans/active/focusmap-ui-dashboard-quality-assets/prompts/dark-recovery-ui.prompt.txt`
- `docs/ai/plans/active/focusmap-ui-dashboard-quality-assets/prompts/calendar-desktop-event-split-10min.prompt.txt`
- `docs/ai/plans/active/focusmap-ui-dashboard-quality-assets/prompts/calendar-mobile-event-split-10min.prompt.txt`

No-image exception:

- If image generation is unavailable, do not mark Chat 1 complete.
- Report `Chat 1 blocked: image generation unavailable`.
- List saved prompts, missing images, and next user decision.

## 95+ Improvement Plan

### Step 1: Stop The White Screen

- Add a dashboard runtime error boundary with the Focusmap dark recovery UI.
- Consider a global error boundary only if dashboard-local handling does not catch the failure class.
- Preserve existing startup loading shells.
- Add copyable diagnostics without exposing raw stack traces by default.
- Outcome: P0 availability issue moves from user-facing white failure to recoverable Focusmap state.

### Step 2: Replace Desktop Mobile Sheet With Inspector

- Keep `MobileEventEditModal` for mobile.
- Introduce a desktop event inspector or calendar event detail panel.
- Wire desktop event selection to inspector state.
- Keep event creation/edit data contracts unchanged where possible.
- Outcome: desktop reaches mature overview-plus-detail behavior.

### Step 3: Harmonize Event Editing Across Breakpoints

- Share field labels, validation messages, and state language between mobile sheet and desktop inspector.
- Preserve mobile interaction: bottom sheet, safe area, 44px taps.
- Preserve desktop interaction: right inspector/popover, keyboard-friendly controls, compact density.
- Outcome: same Focusmap, not same layout.

### Step 4: Tighten Cross-Surface Visual Contract

- Use existing dark tokens and lucide icon language.
- Keep event colors subdued and informative.
- Align button/radius/border language across settings, calendar, map, memo, and chat.
- Avoid new palettes or platform-specific decoration.
- Outcome: dashboard surfaces feel like one app.

### Step 5: Document Implementation Impact

- If implementation changes sync flow, event editing behavior, error recovery, or desktop/mobile boundaries, update `docs/CONTEXT.md` in the same implementation work.
- Keep this Design Pack as the design artifact, not the source of runtime truth.

## Implementation Readiness

Ready for split: yes, after user approval of visual direction.

Recommended worker sequence:

1. P0 foundation worker: dashboard runtime error boundary and dark recovery component.
2. Desktop event editor worker: right inspector/popover and `DesktopTodayPanel` integration.
3. Mobile parity worker: ensure mobile sheet keeps the same labels/states and does not regress.
4. Integration finalizer: check contracts, docs update, local main commit.

Foundation worker needed: yes. P0 error recovery should land before broader desktop redesign if the app is currently crash-prone.

Allowed file ownership draft for Chat 2:

- Read first:
  - `AGENTS.md`
  - this Design Pack
  - `docs/CONTEXT.md`
  - `docs/specs/platform-boundaries.md`
- Likely implementation files:
  - `src/app/dashboard/error.tsx`
  - `src/app/global-error.tsx` only if dashboard-local is insufficient
  - `src/app/dashboard/dashboard-client.tsx`
  - `src/components/dashboard/desktop-today-panel.tsx`
  - `src/components/today/today-3days-calendar.tsx`
  - `src/components/today/mobile-event-edit-modal.tsx`
  - a new desktop inspector component under `src/components/dashboard/` or `src/components/calendar/`
  - `docs/CONTEXT.md` if behavior or platform boundaries change
- Avoid unless explicitly required:
  - `desktop/**`
  - `mobile/**`
  - database migrations
  - API contract changes
  - theme rewrites

User decisions needed before broad implementation:

1. Approve the existing-UI-baseline right drawer direction for desktop event editing.
2. Decide whether the right drawer should replace the current right panel content or stack as a temporary slide-over on top of it.
3. Decide whether medium desktop widths should use the same right drawer or an anchored popover.
4. Decide whether P0 error recovery should be implemented immediately before any visual redesign.

## Next Chat Handoff

次に送るチャット:
Chat 2: Implementation Orchestrator

目的:
Focusmap dashboard UI quality planを実装タスクへ分解し、P0復旧UIとdesktop event inspectorを安全に進める。

貼るもの:

- `/Users/kitamuranaohiro/Private/focusmap-codex-reconcile-main/docs/ai/plans/active/focusmap-ui-dashboard-quality.md`
- `/Users/kitamuranaohiro/Private/focusmap-codex-reconcile-main/docs/ai/plans/active/focusmap-ui-dashboard-quality-assets/existing-style-desktop-todo-normal.png`
- `/Users/kitamuranaohiro/Private/focusmap-codex-reconcile-main/docs/ai/plans/active/focusmap-ui-dashboard-quality-assets/existing-style-desktop-event-right-drawer.png`
- `/Users/kitamuranaohiro/Private/focusmap-codex-reconcile-main/docs/ai/plans/active/focusmap-ui-dashboard-quality-assets/existing-style-desktop-schedule-split-10min.png`
- `/Users/kitamuranaohiro/Private/focusmap-codex-reconcile-main/docs/ai/plans/active/focusmap-ui-dashboard-quality-assets/existing-style-mobile-schedule-split-10min.png`
- `/Users/kitamuranaohiro/Private/focusmap-codex-reconcile-main/docs/ai/plans/active/focusmap-ui-dashboard-quality-assets/calendar-desktop-event-split-10min.png`
- `/Users/kitamuranaohiro/Private/focusmap-codex-reconcile-main/docs/ai/plans/active/focusmap-ui-dashboard-quality-assets/calendar-mobile-event-split-10min.png`
- `/Users/kitamuranaohiro/Private/focusmap-codex-reconcile-main/docs/ai/plans/active/focusmap-ui-dashboard-quality-assets/mobile-event-edit-bottom-sheet.png`
- `/Users/kitamuranaohiro/Private/focusmap-codex-reconcile-main/docs/ai/plans/active/focusmap-ui-dashboard-quality-assets/dark-recovery-ui.png`

そのまま貼るプロンプト:

```md
Use $focusmap-ui-quality as Chat 2: Implementation Orchestrator.

Repo:
/Users/kitamuranaohiro/Private/focusmap

Read first:
- AGENTS.md
- docs/CONTEXT.md
- docs/specs/platform-boundaries.md
- docs/ai/plans/active/focusmap-ui-dashboard-quality.md
- docs/ai/plans/active/focusmap-ui-dashboard-quality-assets/README.md

Role:
You are the Implementation Orchestrator. Do not implement code in this chat unless explicitly asked. Split the approved Design Pack into safe implementation work, define file ownership, worker prompts, merge order, and acceptance checks.

Priorities:
1. P0: eliminate dashboard white screen / client-side exception fallback by adding a dark Focusmap runtime recovery UI.
2. P1: replace desktop event editing mobile bottom sheet with a right-side drawer that visually matches the current Focusmap side panel and keeps the current canvas/calendar context visible.
3. Add schedule split behavior using the corrected `calendar-*event-split-10min` mockups: Desktop shows the split affordance as a horizontal line inside the selected calendar event block; Mobile uses an explicit bottom-sheet split mode.
4. Preserve mobile bottom sheet editing, safe area, 44px tap targets, and existing mobile navigation.
5. Use the `existing-style-*` mockups as the desktop visual baseline. Do not implement the earlier generic Apple/Google-style calendar mockup direction.
6. Preserve Focusmap visual DNA: black dotted canvas, compact pill navigation, amber/yellow selected outlines, lucide icons, small radius on desktop controls, dense right panel, and clear status language.
7. Do not implement schedule split from the superseded map-style `existing-style-*-schedule-split-10min` mockups.

Must follow:
- Do not run npm test/lint/build, Playwright, Browser, curl, or git diff --check unless the user explicitly asks.
- Do not push or deploy.
- If implementation changes major UI behavior or platform boundaries, include docs/CONTEXT.md updates in the implementation plan.
- Prefer a P0 foundation worker before broader UI workers.
- Do not mix unrelated existing uncommitted changes.

Return:
- Worker split with owner names
- Allowed files and forbidden files for each worker
- Exact prompts for each worker
- Integration order
- Acceptance criteria copied from the Design Pack
- Verification that should be requested from the user, but not run automatically
- Stop before starting workers
```

そのチャットから返してほしいもの:

- P0 foundation worker prompt.
- Desktop inspector worker prompt.
- Mobile parity/review worker prompt if needed.
- Integration finalizer prompt.
- File ownership table.
- Merge order and documentation update requirements.

まだやらないこと:

- Implementation worker execution.
- Push/deploy.
- Browser/Playwright/curl/build/lint/test verification unless explicitly approved.
