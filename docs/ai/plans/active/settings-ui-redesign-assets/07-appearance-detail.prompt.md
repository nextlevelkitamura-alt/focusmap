# 07 Appearance Detail Prompt

```text
Use case: ui-mockup
Asset type: desktop settings detail screen mockup
Primary request: Design the appearance settings detail screen for Focusmap.
Product context: Appearance is low-risk and should stay simple. It must use the same settings primitives as high-risk pages without becoming visually noisy.
Screen: /dashboard/settings/appearance
Layout: desktop settings shell with sidebar selected "外観". Main content is narrow, about 680px max width. Header "外観". One grouped section for theme and display preferences.
Components:
- Setting row: テーマ with segmented or select control: システム, ライト, ダーク
- Setting row: 表示密度 (future/disabled) with chip "準備中"
- Setting row: マップの配色 (future/disabled) with note "プロジェクト色はプロジェクト設定へ"
- Preview strip: small neutral preview of light/dark surfaces, not a decorative hero
State requirements: show selected "システム", one disabled/future row, no error.
Responsive note: desktop version; mobile is simple stacked rows.
Text: Japanese concise labels.
Visual style: restrained black/white/gray UI, consistent with other settings sections, no separate artistic palette. Use smaller modern admin typography.
Constraints: no marketing layout, no gradient hero, no decorative blobs, no oversized preview, no one-note purple/blue palette.
```
