# 01 Settings Overview Prompt

```text
Use case: ui-mockup
Asset type: desktop web app settings overview mockup
Primary request: Design the top-level settings screen for Focusmap.
Product context: Focusmap is an operational dashboard where AI manages and executes work while the human reviews and approves. The settings screen should feel like a compact control center for AI execution, local Mac agent, integrations, external API access, and project context.
Screen: /dashboard/settings overview
Layout: desktop settings shell with a 300px left sidebar, search at the top of the sidebar, grouped category navigation, and a main content area. Main content starts with four compact status tiles, then grouped settings category rows. Keep the existing dark Focusmap app feeling but use restrained neutral surfaces.
Sidebar categories:
- 状態: 概要, AI / 自動化
- 作業環境: プロジェクト, 連携
- 管理: アクセス/API, 外観
Main status tiles:
- AI実行: Macエージェント オンライン, 最終更新 15:18, 待機中
- Google Calendar: 連携中, 3件選択, 最終同期 14:42
- APIキー: 2 active, 最終使用 12分前, 危険 scope なし
- プロジェクト実行先: 5 projects, 3 repo linked, 1 要確認
Components: status tiles, category rows, subtle status chips, lucide-style icons, one small "要対応" list, search field, selected sidebar item.
State requirements: show one normal connected state, one attention state for a project repo missing, one neutral appearance setting.
Responsive note: this is desktop; it should imply mobile becomes list-detail.
Text: Japanese UI labels only, concise, realistic, no lorem ipsum.
Visual style: modern restrained productivity UI, high scan efficiency, not a marketing page, not a decorative card layout.
Constraints: no decorative blobs, no fake logos, no emoji icons, no nested cards inside cards, no huge hero, no tiny unreadable text, no one-note purple/blue gradient palette.
```
