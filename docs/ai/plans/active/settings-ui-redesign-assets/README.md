# Settings UI Redesign Mockup Assets

This directory stores image-generation prompts and generated mockup images for the Focusmap settings redesign. No app code is implemented in Chat 1.

Recommended direction: `Focusmap Control Center`.

Final visual direction after image review: black/white/gray settings UI, compact modern typography, no duplicated `概要` sidebar row, and an account profile/logout entry at the bottom of the settings navigation.

## Screen Coverage

| File | Screen | Purpose |
|---|---|---|
| `01-settings-overview.prompt.md` | Settings top / overall screen | Shows operational status first, then categories. |
| `02-menu-state.prompt.md` | Sidebar/menu selected state | Shows grouped sidebar, search, badges, selected category. |
| `03-ai-automation-detail.prompt.md` | AI / automation detail | Shows Mac agent, Codex, import, calendar behavior. |
| `04-projects-detail.prompt.md` | Projects detail | Shows project identity, repo path, context health, scan paths. |
| `05-integrations-detail.prompt.md` | Integrations detail | Shows Google Calendar connection, sync, selected calendars. |
| `06-access-detail.prompt.md` | Access/API detail | Shows API keys, scopes, last used, account danger zone. |
| `07-appearance-detail.prompt.md` | Appearance detail | Shows theme/display settings using same primitives. |
| `08-mobile-overview.prompt.md` | Mobile settings overview | Shows list-detail launcher with status chips. |
| `09-mobile-ai-automation.prompt.md` | Mobile AI/automation | Shows highest-risk mobile flow. |
| `10-alternate-directions.prompt.md` | Alternate visual directions | Gives conservative/mobile/admin variants if Direction A needs revision. |

## Generated Images

| File | Source Prompt | Screen |
|---|---|---|
| `01-settings-overview.png` | `01-settings-overview.prompt.md` | Settings top / overall screen |
| `02-menu-state.png` | `02-menu-state.prompt.md` | Sidebar/menu selected state with account footer |
| `03-ai-automation-detail.png` | `03-ai-automation-detail.prompt.md` | AI / automation detail |
| `04-projects-detail.png` | `04-projects-detail.prompt.md` | Projects detail |
| `05-integrations-detail.png` | `05-integrations-detail.prompt.md` | Integrations detail |
| `06-access-detail.png` | `06-access-detail.prompt.md` | Access/API detail |
| `07-appearance-detail.png` | `07-appearance-detail.prompt.md` | Appearance detail |
| `08-mobile-overview.png` | `08-mobile-overview.prompt.md` | Mobile settings overview with account row |
| `09-mobile-ai-automation.png` | `09-mobile-ai-automation.prompt.md` | Mobile AI/automation detail |

`10-alternate-directions.prompt.md` was not generated because Direction A is adopted.

## Use

Use these prompts with an image generation tool if visual review is needed before implementation. The generated images are decision aids; implementation should follow `../settings-ui-redesign.md` acceptance criteria when text or layout details differ.
