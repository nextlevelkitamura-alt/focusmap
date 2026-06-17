# 01 Settings Overview Prompt

```text
Use case: ui-mockup
Asset type: desktop web app settings overview mockup
Primary request: Design the top-level settings screen for Focusmap.
Product context: Focusmap is an operational dashboard where AI manages and executes work while the human reviews and approves. The settings screen should feel like a compact control center for AI execution, local Mac agent, integrations, external API access, and project context.
Screen: /dashboard/settings overview
Layout: desktop settings shell with a 300px left sidebar, search at the top of the sidebar, grouped category navigation, and a main content area. The sidebar title/header links back to the settings top, but "概要" must not appear as a normal sidebar category row. Add a bottom account profile button in the sidebar with a circular initial/avatar, account email/name, and a small menu affordance for logout/account actions. Main content starts with four compact status tiles, then grouped settings category rows. Keep the existing dark Focusmap app feeling but use black/white/gray neutral surfaces.
Sidebar categories:
- 状態: AI / 自動化
- 作業環境: プロジェクト, 連携
- 管理: アクセス/API, 外観
Main status tiles:
- AI実行: Macエージェント オンライン, 最終更新 15:18, 待機中
- Google Calendar: 連携中, 3件選択, 最終同期 14:42
- APIキー: 2 active, 最終使用 12分前, 危険 scope なし
- プロジェクト実行先: 5 projects, 3 repo linked, 1 要確認
Components: status tiles, category rows, subtle monochrome status chips, lucide-style outline icons, one small "要対応" list, search field, sidebar category list without an overview item, bottom account profile/menu entry.
State requirements: show one normal connected state, one attention state for a project repo missing, one neutral appearance setting. The overview/top page has no selected normal sidebar category.
Responsive note: this is desktop; it should imply mobile becomes list-detail.
Text: Japanese UI labels only, concise, realistic, no lorem ipsum.
Visual style: modern restrained productivity UI, high scan efficiency, strictly black/white/gray first, state meaning carried by label text, border weight, icon shape, and hierarchy rather than bright color. Use modern smaller typography: desktop body around 13-14px, row titles around 15-16px, page title around 24-28px. Not a marketing page, not a decorative card layout.
Constraints: no decorative blobs, no fake logos, no emoji icons, no nested cards inside cards, no huge hero, no tiny unreadable text, no green/blue/purple/yellow status palette.
```
