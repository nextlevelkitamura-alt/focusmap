# Focusmap UI Dashboard Quality Assets

Design Pack: `../focusmap-ui-dashboard-quality.md`

## Mockup Index

| Screen | Platform | Image | Prompt | Purpose |
| --- | --- | --- | --- | --- |
| Corrected Calendar Desktop event split at 10min | Desktop web / Mac app | `calendar-desktop-event-split-10min.png` | `prompts/calendar-desktop-event-split-10min.prompt.txt` | Corrected direction: schedule split belongs to the calendar event block, with a horizontal 10:20 split line and supporting right drawer. |
| Corrected Calendar Mobile event split at 10min | Mobile web / iOS WebView | `calendar-mobile-event-split-10min.png` | `prompts/calendar-mobile-event-split-10min.prompt.txt` | Corrected direction: mobile calendar event split uses a bottom-sheet mode with 10-minute choices and before/after preview. |
| Existing-style Desktop Todo normal | Desktop web / Mac app | `existing-style-desktop-todo-normal.png` | `prompts/existing-style-desktop-todo-normal.prompt.txt` | Revised direction after user feedback: preserve the current Focusmap dotted canvas, amber outlines, compact top nav, and map-like density. |
| Existing-style Desktop event right drawer | Desktop web / Mac app | `existing-style-desktop-event-right-drawer.png` | `prompts/existing-style-desktop-event-right-drawer.prompt.txt` | Revised direction after user feedback: tapped schedule item opens a right drawer that looks like the current Focusmap side panel. |
| Superseded map-style Desktop schedule split at 10min | Desktop web / Mac app | `existing-style-desktop-schedule-split-10min.png` | `prompts/existing-style-desktop-schedule-split-10min.prompt.txt` | Superseded by corrected calendar mockup; kept only as an intermediate artifact. |
| Superseded map-style Mobile schedule split at 10min | Mobile web / iOS WebView | `existing-style-mobile-schedule-split-10min.png` | `prompts/existing-style-mobile-schedule-split-10min.prompt.txt` | Superseded by corrected calendar mockup; kept only as an intermediate artifact. |
| Desktop 3days calendar normal | Desktop web / Mac app | `desktop-3days-calendar-normal.png` | `prompts/desktop-3days-calendar-normal.prompt.txt` | Proves dense dark calendar overview without mobile sheet or wasted whitespace. |
| Desktop event edit inspector | Desktop web / Mac app | `desktop-event-edit-inspector.png` | `prompts/desktop-event-edit-inspector.prompt.txt` | Proves event editing keeps calendar context visible through a right inspector. |
| Mobile event edit bottom sheet | Mobile web / iOS WebView | `mobile-event-edit-bottom-sheet.png` | `prompts/mobile-event-edit-bottom-sheet.prompt.txt` | Proves the same event edit remains mobile-native with one-purpose bottom sheet behavior. |
| Dark recovery UI | Web / Mac app / iOS WebView concept | `dark-recovery-ui.png` | `prompts/dark-recovery-ui.prompt.txt` | Proves white screen/client exception fallback becomes a branded dark recovery state. |

## Acceptance Notes

- These images are direction-setting mockups, not implementation screenshots.
- The `calendar-*event-split-10min` images are the primary source for schedule split UI.
- The earlier `existing-style-*-schedule-split-10min` images used a map-like node canvas and should not be used for calendar implementation.
- The `existing-style-*` images supersede the earlier generic calendar-like desktop mockups for Desktop visual direction.
- The implementation source of truth remains the Design Pack and `docs/CONTEXT.md` after implementation.
- Do not use these images to justify changing platform boundaries or adding decorative visual language.
