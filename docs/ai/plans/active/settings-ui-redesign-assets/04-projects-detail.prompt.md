# 04 Projects Detail Prompt

```text
Use case: ui-mockup
Asset type: desktop settings detail screen mockup
Primary request: Design the project settings detail screen for Focusmap.
Product context: Projects define where AI work lands: color identity, local repo path for Codex/Mac execution, project description/context, and repo scan paths.
Screen: /dashboard/settings/projects
Layout: desktop settings shell with sidebar selected "プロジェクト". Main content has a header and a status chip "1件 要確認". Use sections, not decorative cards.
Sections:
- Project execution targets: table/list of projects with repo path, status chip, action "変更"
- Project context health: rows showing description/context state, "チャットで更新" action
- Visual identity: compact color swatches for projects, workspaces, tags
- Repository auto scan: Mac host row, scan paths count, last scan, action "再スキャン"
Components: dense list rows, swatches, repo path monospace text, status chips, action buttons, bottom sheet hint for scan path editor.
State requirements: show one project with repo linked, one missing repo "要設定", one context "古い", one scan "同期中".
Responsive note: desktop version; mobile should drill into repo/context sections instead of showing three columns.
Text: Japanese concise labels; repo paths can be realistic but short like ~/Private/focusmap.
Visual style: operational, dense, readable, Focusmap black/white/gray dark neutral. Project colors should be shown as muted grayscale swatches in this mockup, not colorful decoration. Use smaller modern admin typography.
Constraints: no nested cards inside cards, no huge color palette wall, no fake logos, no decorative blobs, no unreadable table text, no bright status color palette.
```
