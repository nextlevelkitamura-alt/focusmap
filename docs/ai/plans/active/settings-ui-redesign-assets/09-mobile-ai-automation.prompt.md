# 09 Mobile AI / Automation Prompt

```text
Use case: ui-mockup
Asset type: mobile web/iOS settings detail mockup
Primary request: Design the mobile AI / automation settings detail screen for Focusmap.
Product context: This is the highest-risk mobile settings flow because it controls Mac agent, Codex connection, thread import, and AI calendar behavior.
Screen: /dashboard/settings/automation mobile detail
Canvas: iPhone-sized portrait mockup, dark Focusmap UI.
Layout: top back link "設定", title "AI / 自動化", status chip "接続中". Then stacked sections. First section is Macエージェント status. Second is Codex connection rows. Third is calendar behavior toggle. Bottom has a safe primary action "診断更新"; destructive/disconnect actions are secondary and not visually dominant.
Components:
- Status summary row: Macエージェント オンライン, 最終更新 15:18
- Connection rows: Macエージェント, Codex, thread取り込み
- Toggle row: 予定作成時に毎回カレンダーを聞く
- Collapsible "導入/再設定"
- Inline amber notice for stale state
State requirements: normal connected state plus one amber "要確認" row.
Responsive note: all tap targets at least 44px; no horizontal tables.
Text: Japanese concise labels, no long paragraphs.
Visual style: mobile Focusmap control surface, not a settings brochure.
Constraints: no fake logos, no decorative blobs, no tiny diagnostic logs, no nested cards, no oversized button blocks, no emoji icons.
```
