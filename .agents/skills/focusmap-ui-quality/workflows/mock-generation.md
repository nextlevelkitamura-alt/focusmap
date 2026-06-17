# Mock Generation Workflow

Use this only after Gate B: architecture and UI acceptance are concrete.

## Purpose

Generate visible UI mockup images so the user can judge the direction before implementation. Image prompts are supporting artifacts, not the deliverable.

## Coverage Plan

For broad UI changes, decide the minimum image set:

- desktop overview or primary working screen
- selected/editing state
- highest-risk detail panel, popover, or inspector
- mobile equivalent for the same task
- Mac/iOS shell state if platform-specific chrome affects layout

For P0 triage and tiny UI fixes, mockups are usually unnecessary.

## Image Direction Rules

- Keep Focusmap dark, compact, operational, and product-like.
- Preserve existing tone: restrained colors, lucide-style icons, compact typography, small radius, dense information.
- Do not invent a new brand, pastel theme, marketing hero, decorative gradients, or large card-based landing-page composition.
- Desktop mockups must preserve overview + detail.
- Mobile mockups must preserve one-job-at-a-time and safe area.

## Required Artifacts

For each image:

- image file
- prompt file
- screen name
- platform
- purpose
- what it proves
- implementation risk

Create an index file in the mockup asset directory listing all images and prompts.

## Completion Rule

Do not say `Chat 1完了` for a broad visual redesign unless:

- proposal is saved
- required visible images are saved
- image paths are shown or listed
- each image has a prompt file
- image index exists
- user decisions needed before implementation are clear

If image generation is unavailable, report:

```text
Chat 1 blocked: image generation unavailable
```

Then list saved prompts, missing images, and the user decision needed.
