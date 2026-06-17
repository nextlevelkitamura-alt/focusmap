# 06 Access / API Detail Prompt

```text
Use case: ui-mockup
Asset type: desktop settings detail screen mockup
Primary request: Design the access and API settings detail screen for Focusmap.
Product context: Access settings manage external AI API keys, scopes, one-time key reveal, account email, logout, and destructive account deletion. This is a high-risk settings page.
Screen: /dashboard/settings/access
Layout: desktop settings shell with sidebar selected "アクセス/API". Main content has a header with "2 active API keys" status. Use a two-column desktop layout: API keys as the main column, account/danger zone as side column. On mobile, stack API first then account danger zone.
Components:
- API key table/list rows: key name, prefix sk_focusmap_..., scopes chips, last used, created date, revoke icon button
- Primary action: 新しいAPIキーを作成
- Collapsible guide: 外部AI連携ガイド with "コピー"
- Scope summary chips: mindmap:read, mindmap:drafts, calendar:write
- Account panel: email, logout
- Danger zone: アカウント削除 with red outline and confirmation note
State requirements: show one active key recently used, one inactive/revoked key muted, one broad write scope marked "危険", one no-error normal state.
Responsive note: desktop version; mobile stacks and requires confirmation sheet for destructive actions.
Text: Japanese short labels; use realistic but short scope labels.
Visual style: dense developer/admin settings, risk visible but not alarmist.
Constraints: no fake secrets beyond prefix, no full raw API key displayed, no decorative blobs, no nested cards, no tiny table text, no browser confirm UI.
```
