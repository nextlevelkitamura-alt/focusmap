# 05 Integrations Detail Prompt

```text
Use case: ui-mockup
Asset type: desktop settings detail screen mockup
Primary request: Design the integrations settings detail screen for Focusmap.
Product context: Current primary integration is Google Calendar. The screen must show connection state, account, token health, sync status, import period, and selected calendars.
Screen: /dashboard/settings/integrations
Layout: desktop settings shell with sidebar selected "連携". Header "連携" with status chip "Google Calendar 接続中". First section is a connection summary row, then import settings and selected calendar list.
Components:
- Connection provider row: Google Calendar icon-style generic calendar mark, connected account email, last sync, buttons 更新 and 連携解除
- Warning callout for token expired state shown as an alternate small row/callout
- Toggle row: イベント取り込み
- Select row: 取り込み期間 1ヶ月
- Calendar list: checkboxes, color dots, selected count, primary badge, 全選択/全解除
- State footer: 保存済み/保存中/失敗 row-level message
State requirements: show connected normal state, selected calendar count, one disabled/unselected calendar, and one inline sync state.
Responsive note: desktop version; mobile becomes a provider detail with calendar list below.
Text: Japanese concise labels, no long paragraphs.
Visual style: familiar integration settings, restrained, high clarity, not Google Admin-heavy.
Constraints: no fake Google logo if uncertain, no nested cards, no decorative blobs, no oversized connection card, no unreadable tiny text.
```
