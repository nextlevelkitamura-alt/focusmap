# Focusmap UI Acceptance

## Scope

- Feature/screen:
- Platforms:
- User goal:

## Must Preserve

- Focusmap dark compact operational theme
- Existing shared components/tokens where applicable
- lucide icon language
- Current data/API behavior unless explicitly changed

## Desktop Acceptance

- Main context remains visible while editing details.
- Details use right inspector, side panel, popover, or split view where appropriate.
- No mobile bottom sheet stretched across desktop width.
- Long titles, many items, loading, empty, and error states do not break layout.

## Mobile Acceptance

- Primary controls are reachable with one hand.
- Tap targets are at least 44px where applicable.
- Safe area and keyboard states are handled.
- Detail editing uses bottom sheet, drill-in, or progressive disclosure.
- Desktop multi-pane UI is not crammed into mobile.

## Cross-Platform Acceptance

- Same concepts use same labels, icons, and state language.
- Platform differences are layout/input differences, not different visual brands.
- P0/P1 findings are resolved.

## Interaction Acceptance

- Optimistic UI where expected.
- Saving, saved, failed, disabled, empty, and loading states are clear.
- Errors appear near the action that caused them.
- Destructive actions are visually separated and confirmed when needed.

## Verification Policy

- Allowed checks:
- Explicitly not allowed unless user asks:
  - npm run test
  - npm run lint
  - npm run build
  - Playwright/browser checks
  - curl
  - git diff --check
