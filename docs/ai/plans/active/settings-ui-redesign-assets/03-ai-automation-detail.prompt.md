# 03 AI / Automation Detail Prompt

```text
Use case: ui-mockup
Asset type: desktop settings detail screen mockup
Primary request: Design the AI / automation settings detail screen for Focusmap.
Product context: AI execution depends on a Mac agent, Codex Desktop/app-server, Codex thread import, calendar behavior, and installation/recovery actions. This is a high-risk operational settings page.
Screen: /dashboard/settings/automation
Layout: desktop settings shell with sidebar selected "AI / 自動化". Main content starts with a header "AI / 自動化" and a status chip "接続中". First section is a Mac agent operational panel. Below are grouped rows for Codex, thread import, calendar behavior, and install/recovery.
Components:
- Hero status row: Macエージェント オンライン, 最終更新, 巡回状態, running/idle
- Three connection rows: Macエージェント, Codex, Codex thread取り込み
- Buttons: 接続/復旧, 診断更新, Codexを入れる (only if needed)
- Toggle row: 予定作成時に毎回カレンダーを聞く
- Collapsible setup section: Macエージェントを導入/再設定, command copy
- Status chips: 接続中, 要確認, 未確認, Macが必要
State requirements: show connected Mac agent, Codex ready, thread import ready, and one amber stale/attention line. Show loading/saving feedback as small row text, not a full-page spinner.
Responsive note: desktop version; rows should translate to mobile stacked sections.
Text: Japanese concise labels, no long prose blocks.
Visual style: compact control center, dark neutral Focusmap surfaces, high confidence but not flashy.
Constraints: no marketing hero, no decorative blobs, no fake logos, no nested cards inside cards, no tiny logs, no terminal wall of text except a short command preview in the setup details.
```
