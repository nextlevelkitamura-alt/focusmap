# 02 Menu / Sidebar State Prompt

```text
Use case: ui-mockup
Asset type: desktop settings navigation state mockup
Primary request: Design the Focusmap settings sidebar/menu selected state.
Product context: Focusmap settings are operational controls for AI execution, local Mac agent, project repo paths, Google Calendar, API keys, and appearance.
Screen: settings shell sidebar with "AI / 自動化" selected
Layout: left sidebar only plus a sliver of main content. Top contains "アプリに戻る" and a search field. Navigation is grouped into 状態, 作業環境, 管理. Each row has a lucide-style icon, label, optional small status badge/dot, and selected background.
Visible states:
- 概要: neutral
- AI / 自動化: selected, emerald "OK" chip
- プロジェクト: amber dot "1"
- 連携: blue/emerald "接続中"
- アクセス/API: small shield/key icon, neutral
- 外観: neutral
Components: grouped nav headings, selected row, attention dot, search field, back link, clear hover/focus affordance.
State requirements: selected state must be obvious without relying only on color; attention and connected states must be visible but not noisy.
Responsive note: desktop sidebar only; mobile uses list rows.
Text: Japanese short labels, no paragraphs.
Visual style: quiet dense app UI matching Focusmap dark surfaces.
Constraints: no decorative blobs, no fake product logos, no marketing copy, no oversized cards, no unreadable tiny text.
```
