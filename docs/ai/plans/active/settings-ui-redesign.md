# Focusmap 設定UI改善 Design Pack

- Mode: `settings-ui-architect / design-pack`
- Created: 2026-06-17
- Status: Chat 1 design pack complete
- Scope: `/dashboard/settings`, `/dashboard/settings/projects`, `/dashboard/settings/automation`, `/dashboard/settings/integrations`, `/dashboard/settings/access`, `/dashboard/settings/appearance`
- Assets: `docs/ai/plans/active/settings-ui-redesign-assets/`
- Code implementation: out of scope

## Goal

Focusmapの設定画面を、単なる設定項目一覧ではなく「AI実行・ローカルMac・連携・権限・プロジェクト文脈の状態を一目で把握し、必要な復旧/接続/発行へ進める設定センター」にする。

Focusmapは「AIが管理・実行し、人間は俯瞰・承認するダッシュボード」なので、設定UIも通常のプロフィール/テーマ設定より、AI実行の安全性、接続状態、外部AIの権限、プロジェクト文脈の整備状況を優先して見せる。

## Inputs Read

- `AGENTS.md`
- `docs/plans/focusmap-pivot.md`
- `docs/CONTEXT.md`
- `docs/ROADMAP.md`
- `docs/ai/task-board.md`
- `docs/ai/plans/active/README.md`
- `docs/plans/features/settings-redesign.md`
- Current settings code:
  - `src/components/settings/settings-shell.tsx`
  - `src/components/settings/settings-overview.tsx`
  - `src/components/settings/automation-settings.tsx`
  - `src/components/settings/project-settings.tsx`
  - `src/components/dashboard/calendar-settings.tsx`
  - `src/components/settings/api-key-settings.tsx`
  - `src/components/settings/account-settings.tsx`
  - `src/components/settings/theme-settings.tsx`
  - route files under `src/app/dashboard/settings/**`
- Reference screenshot: `/var/folders/w2/wxq6n_0920g2cjyh5gm3sj440000gn/T/codex-clipboard-c1be98f8-6ac1-451b-9e65-5a4b7b5d1769.png`
- Settings UI benchmark sources:
  - OpenAI Codex app settings: https://developers.openai.com/codex/app/settings
  - OpenAI Codex MCP/config behavior: https://developers.openai.com/codex/mcp
  - OpenAI Codex Computer Use permission model: https://developers.openai.com/codex/app/computer-use
  - Notion workspace settings: https://www.notion.com/help/workspace-settings
  - Notion connections: https://www.notion.com/help/add-and-manage-connections-with-the-api
  - Notion members/guests: https://www.notion.com/help/add-members-admins-guests-and-groups
  - Google Workspace organizational structure: https://knowledge.workspace.google.com/admin/users/advanced/how-the-organizational-structure-works
  - Google Workspace app access control: https://knowledge.workspace.google.com/admin/apps/control-which-apps-access-google-workspace-data
  - GitHub personal access token policy: https://docs.github.com/en/organizations/managing-programmatic-access-to-your-organization/setting-a-personal-access-token-policy-for-your-organization
  - GitHub token requests/review: https://docs.github.com/en/organizations/managing-programmatic-access-to-your-organization/managing-requests-for-personal-access-tokens-in-your-organization
  - Linear workspace settings: https://linear.app/docs/workspaces
  - Linear members/roles: https://linear.app/docs/members-roles
  - Linear integrations: https://linear.app/docs/integration-directory

## Current UI Evaluation

Overall score: 67/100

Recommended next workflow: user approves this design direction, then Chat 2 runs `settings-ui-architect` in split + integrate mode.

### What Works

- `SettingsShell` already has a stable desktop sidebar + mobile back-link structure.
- `prefetch={false}` is correctly used for settings links, matching `docs/CONTEXT.md` performance guidance.
- The main categories are close to the current product shape: AI, Integrations, Projects, Access, Appearance.
- AI settings already show useful operational state through `AgentStatusBadge`, `MacCodexConnectionPanel`, Codex install/recovery, and calendar behavior.
- Integrations already show high-value Google Calendar state: connected, token expired, account, sync, selected calendars.
- Access already has API key creation, scope selection, one-time reveal, and deactivation confirmation.
- Project settings already cover three Focusmap-specific jobs: colors, repo path, and project description/context.
- Mobile affordances are partly present: drill-in settings root, bottom sheet for scan path editing, 44px-ish controls in some sections.

### Findings

| Severity | Area | Finding | Evidence | Fix Direction |
|---|---|---|---|---|
| P1 | IA / navigation | Root page is labeled `一般` in sidebar but acts as a settings overview. This weakens wayfinding. | `NAV_ITEMS` has `/dashboard/settings` label `一般`, while `SettingsOverview` is a category launcher. | Rename nav label to `概要` or `全体`, and make the root a status dashboard rather than a detail category. |
| P1 | IA / visibility | `スペース共有` appears on overview but not in the desktop sidebar and is outside this redesign scope. | `SECONDARY_ITEMS` includes `/dashboard/settings/spaces`; `NAV_ITEMS` does not. | Either add it deliberately as a lower-priority admin category, or remove from top-level launchers until ready. For this scope, keep it out of the primary nav. |
| P1 | State clarity | Status is rich inside detail pages but not summarized on settings top. | Agent/calendar/API/project status are scattered across detail routes. | Add top-level status tiles: Mac agent, Google Calendar, API keys, project repos/context. |
| P1 | Risk separation | `アクセス` mixes account logout/delete with API keys, but the difference between normal account actions and external write permissions is not visually strong enough. | `AccessSettingsPage` places `ApiKeySettings` and `AccountSettings` side by side. | In `Access`, lead with API key risk/status, isolate account danger zone, and use explicit scope/last used/revoke language. |
| P1 | Mobile ergonomics | Project and integration detail pages can become long control stacks without a mobile section map or high-priority action area. | `ProjectSettings` includes color tables, repo pickers, descriptions, scan settings; `CalendarSettings` includes connection, import, calendar list. | Mobile detail should be one job per screen section with sticky action/status where needed, not a long mixed settings page. |
| P2 | Visual consistency | Existing settings mix iOS grouped lists, shadcn Cards, custom dark surfaces, and several radii (`rounded-lg`, `rounded-xl`, `rounded-2xl`). | `SettingsOverview`, `ProjectSettings`, `CalendarSettings`, `ApiKeySettings` use different section primitives. | Define shared primitives: `SettingsSection`, `SettingRow`, `StatusTile`, `ConnectionRow`, `DangerZone`. |
| P2 | Search / filter | The current settings UI has no settings search, while the Codex reference screenshot and mature admin settings rely on search for larger surfaces. | `SettingsShell` has no search box. | Add search/filter at top of desktop sidebar and top of mobile overview. MVP can filter categories and section labels only. |
| P2 | Save feedback | Some writes are optimistic but feedback language is inconsistent. | Project color/repo saves use spinner only; API key errors mostly `console.error`; account uses `window.confirm` / `alert`. | Standardize `saving / saved / failed` row feedback and replace browser dialogs for destructive settings over time. |

## Benchmark Synthesis

### Reusable Patterns

- Codex: left sidebar grouped by user, integrations, coding, archived areas; selected state is obvious; permissions are grouped with explanatory copy and toggles. Focusmap should copy the pattern of "capability category + explicit permission/state", not the exact Codex labels.
- Codex MCP/config: local/project-scoped configuration is shared across surfaces. Focusmap should make local Mac agent, repo path, and API key scopes visible as settings state because these affect execution behavior outside the web app.
- Codex Computer Use: sensitive local-machine capabilities need explicit install/permission state and revocable allow lists. Focusmap should treat Mac agent/Codex/app control as a risk-bearing connection, not just an on/off toggle.
- Notion: workspace-level settings separate connections, members, and workspace customization; connection management shows who can access or disconnect integrations. Focusmap should separate personal/account settings from workspace/project/automation settings.
- Google Workspace Admin: inherited vs overridden settings and trusted/limited/blocked app states make admin state explainable. Focusmap can use a similar state language for "local only", "workspace scoped", "project scoped", and "requires Mac".
- GitHub: token policies, pending requests, token review, and revocation are dense but explicit. Focusmap API keys should show scope, last used, risk, and revoke action in a table/list with confirmation.
- Linear: members see product settings while admins/owners see Administration. Focusmap should keep owner/admin-like settings such as API keys, members, and space sharing grouped separately from day-to-day preferences.

### Anti-Patterns To Avoid

- Do not copy Google Admin's deep enterprise tree for a single-user/Mac-first product.
- Do not put local Mac execution and external AI API keys under generic `一般`.
- Do not make every category a decorative card; settings should scan like a control surface.
- Do not hide error or disconnected states only inside detail pages.
- Do not add a landing-page style hero or marketing explanation inside settings.

## Gate A: Discovery Complete

Gate A is satisfied.

- Current UI inventory is complete for the requested routes.
- Product constraints are confirmed: mobile-first, shared Focusmap visual language, no app implementation in this chat, no automatic verification commands.
- Benchmark patterns are mapped to Focusmap-specific jobs.

## Settings Architecture

### Product Assumptions

- Primary user is the Focusmap owner/operator, often using Mac + web + iPhone.
- Settings must answer "can AI execute safely right now?" faster than "what color theme am I using?"
- External AI and local Mac agent capabilities are high-risk compared with visual preferences.
- Settings should remain compact and operational, not become a full enterprise admin console.

### Recommended Category Map

| Category | Route | Priority | Risk | Main Jobs | Notes |
|---|---|---:|---|---|---|
| 概要 | `/dashboard/settings` | 1 | Low | See all critical setup states, search settings, jump to the right place | Rename from `一般`. This is not a settings form. |
| AI / 自動化 | `/dashboard/settings/automation` | 1 | High | Mac agent status, Codex state, thread import, calendar behavior, install/recovery | Keep route, but label should show both AI and automation intent. |
| プロジェクト | `/dashboard/settings/projects` | 2 | Medium | Project colors, repo paths, project descriptions/context, scan paths | Split visual/color vs execution/repo state inside the page. |
| 連携 | `/dashboard/settings/integrations` | 2 | Medium | Google Calendar connection, selected calendars, token health, import behavior | Add status summary row and clearer sync/error language. |
| アクセス / API | `/dashboard/settings/access` | 1 | High | API keys, external AI prompt, scopes, last used, account, danger zone | Rename label to `アクセス/API` if width allows. |
| 外観 | `/dashboard/settings/appearance` | 3 | Low | Theme, density/display preferences later | Keep simple; do not compete with operational categories. |
| スペース共有 | `/dashboard/settings/spaces` | Later | High | Members and permissions | Existing route can remain, but do not include in primary redesign unless user expands scope. |

### Navigation Model

- Desktop: keep persistent left sidebar, add search input above category groups.
- Sidebar groups:
  - `状態`: 概要, AI / 自動化
  - `作業環境`: プロジェクト, 連携
  - `管理`: アクセス/API, 外観
- Show selected state, icon, and compact status chip/error dot in the sidebar when a category has attention needed.
- Keep `アプリに戻る` at top. In Mac app, respect native titlebar spacing from existing dashboard rules.
- Mobile: root settings page is a list-detail launcher. Each row has title, short subtitle, and status chip. Detail screens use the existing back link.
- Search MVP: filter category labels and known section labels locally; it does not need cross-route server search in Phase 1.

### Layout Pattern

- Root overview:
  - Top operational summary: `AI実行`, `Google Calendar`, `APIキー`, `プロジェクト実行先`.
  - Below: category rows grouped by job.
  - Right side on wide desktop: short "要対応" list, not a marketing panel.
- Detail screens:
  - Header with title, one-sentence purpose, primary state chip.
  - First section is current state and highest-frequency action.
  - Then settings rows grouped by job.
  - Danger/destructive/account actions at bottom in an isolated `DangerZone`.
- Avoid nested cards inside cards. Sections can be bordered surfaces, repeated rows can be grouped lists.

### Component Inventory

- `SettingsShell`: keep, but add sidebar search/status/grouping.
- `SettingsOverview`: redesign as status dashboard + grouped category list.
- `SettingsStatusTile`: compact status tile for agent/calendar/API/project state.
- `SettingsSection`: shared section primitive with heading, description, optional trailing action.
- `SettingRow`: shared row with icon/title/description/control/state message.
- `ConnectionRow`: connection provider row with avatar/icon, status chip, last sync, connect/reconnect/disconnect.
- `ScopeKeyRow`: API key row with name, prefix, scopes, last used, revoke action.
- `DangerZone`: isolated destructive/account actions.
- `MobileSettingsList`: mobile root list with status chips.
- `SaveStateText`: row-level saving/saved/failed language.

### State Language

Use the same labels across categories:

- `接続中`: remote/local connection is usable.
- `要確認`: connection exists but needs attention or last status is stale.
- `未接続`: not configured.
- `同期中`: background refresh or scan in progress.
- `失敗`: user-visible error with retry/reconnect action.
- `保存中`: optimistic UI is applied; save in progress.
- `保存済み`: brief row-level confirmation.
- `未保存`: local edits differ from saved values.
- `権限が必要`: permission or plan/role gate blocks action.
- `Macが必要`: action only works inside Focusmap Mac app.
- `危険`: destructive, secret, broad write, or local machine access.

Color guidance:

- Good/connected: restrained emerald.
- Attention/stale: amber.
- Error/danger: red, used sparingly.
- Neutral/off: zinc.
- Primary action: existing Focusmap blue/neutral button style; do not introduce a separate palette.

### Mobile Behavior

- Settings root shows only high-signal categories and status chips. Avoid full desktop sidebar on mobile.
- Detail screens use one primary job per screen section.
- Tap targets are at least 44px.
- Long tables become grouped rows or drill-in sheets.
- Repo scan path editor remains a bottom sheet, but should share section/action styling with other settings.
- Destructive actions require a styled confirmation dialog/sheet, not browser `confirm`.
- Status/action rows should avoid long paragraphs; supporting detail can collapse into "詳細".

## Gate B: Architecture Complete

Gate B is satisfied.

- Category model is fixed enough for mockups.
- Navigation model is fixed enough for mockups.
- Component primitives and state language are defined.
- Mobile behavior and risk controls are defined.
- Acceptance criteria below can judge visual mockups and implementation.

## UI Acceptance Criteria

### Scope

- Screens: settings overview, AI/automation, projects, integrations, access/API, appearance.
- Platforms: desktop web/Mac shell, mobile web/iOS WebView.
- Out of scope: app body implementation in Chat 1, billing UI, enterprise SSO, Windows-specific settings.

### Information Architecture

- `/dashboard/settings` is an overview/status dashboard, not a "general" settings form.
- AI execution, local Mac/Codex, Google Calendar, API keys, project repo/context, and appearance are separated by user job and risk.
- Space sharing is either explicitly added to nav or removed from primary overview for this scope.
- Search/filter is present in the sidebar/overview, at least for category/section labels.

### Layout

- Desktop settings shell remains sidebar + content.
- Sidebar shows category groups and selected state.
- Root overview shows current operational status before category navigation.
- Detail screens put current state and recovery/primary action first.
- Mobile root is a list of categories with status chips; detail screens drill in.
- No nested cards inside cards; repeated settings are rows/lists.

### Controls

- Toggles are used only for binary persistent settings.
- Status chips accompany connection/sync/permission state.
- Selects are used for theme/import period; not for binary options.
- Tables/lists are used for API keys, calendars, projects, and repo scan paths.
- Destructive actions sit in a dedicated danger zone with confirmation.

### Accessibility

- Touch targets are at least 44px.
- Controls have visible labels or `aria-label`.
- Keyboard focus ring remains visible.
- Text does not rely on color alone for state.
- Long labels wrap or truncate with accessible full text.
- Reduced-motion users are not forced into decorative animation.

### Implementation Readiness

- Implement shared settings primitives before rewriting detail screens.
- Keep existing route files and data APIs unless Chat 2 identifies a contract gap.
- Do not change ai_tasks, runner cadence, Codex monitor behavior, or API scopes without updating `docs/CONTEXT.md`.
- Do not run test/lint/build/Playwright unless user explicitly approves.

## Improvement Roadmap

Target level: structured cleanup with visual redesign.

### Phase 0: Contract

- Approve category names, sidebar grouping, state labels, and shared component primitives.
- Decide whether `スペース共有` is in or out of this redesign.

### Phase 1: Shell And Overview

- Rename root sidebar label to `概要`.
- Add sidebar search/filter and category groups.
- Redesign settings overview into operational status dashboard.
- Keep existing `prefetch={false}` behavior.

### Phase 2: High-Risk Details

- Redesign `AI / 自動化`, `連携`, and `アクセス/API` using shared status/section/row primitives.
- Make connection, stale, error, revoke, and Mac-only states visible.
- Keep existing APIs and behavior unless a state cannot be represented.

### Phase 3: Project And Appearance Details

- Split project page into visual identity, execution repo, project context, and repo scan sections.
- Keep appearance minimal, but use the same section/row style.

### Phase 4: Mobile And Polish

- Ensure root list, detail back navigation, long-row wrapping, and bottom sheet actions pass mobile-first rules.
- Replace browser confirm/alert flows for account deletion and logout with app-native confirmation when implementing.

## Mockup Plan

Mockup image generation prompts are saved under:

- `docs/ai/plans/active/settings-ui-redesign-assets/README.md`
- `docs/ai/plans/active/settings-ui-redesign-assets/01-settings-overview.prompt.md`
- `docs/ai/plans/active/settings-ui-redesign-assets/02-menu-state.prompt.md`
- `docs/ai/plans/active/settings-ui-redesign-assets/03-ai-automation-detail.prompt.md`
- `docs/ai/plans/active/settings-ui-redesign-assets/04-projects-detail.prompt.md`
- `docs/ai/plans/active/settings-ui-redesign-assets/05-integrations-detail.prompt.md`
- `docs/ai/plans/active/settings-ui-redesign-assets/06-access-detail.prompt.md`
- `docs/ai/plans/active/settings-ui-redesign-assets/07-appearance-detail.prompt.md`
- `docs/ai/plans/active/settings-ui-redesign-assets/08-mobile-overview.prompt.md`
- `docs/ai/plans/active/settings-ui-redesign-assets/09-mobile-ai-automation.prompt.md`
- `docs/ai/plans/active/settings-ui-redesign-assets/10-alternate-directions.prompt.md`

Recommended visual direction: Direction A, `Focusmap Control Center`.

Rationale:

- It preserves the existing settings shell and mobile drill-in model.
- It makes AI/local execution state the first visible concern.
- It is compatible with Focusmap's dense operational dashboard style.
- It avoids a heavy enterprise admin console while still borrowing mature state language.

### Prompt Self-Review

I revised the prompts to avoid these issues:

- Too many decorative icon cards on the overview.
- A generic SaaS admin palette that would make settings feel unrelated to Focusmap.
- Desktop-only table layouts that collapse poorly on mobile.
- Hidden danger/account/API actions.
- Marketing or onboarding text inside settings.
- Fake logos or overly tiny text in generated mockups.

Remaining risk:

- Prompt-generated text may be slightly inaccurate in Japanese. Implementation should follow this plan's category labels and acceptance criteria rather than copying mockup text exactly.

## User Decisions Needed

- Approve root category rename: `一般` -> `概要`.
- Decide whether `スペース共有` belongs in this redesign now or stays secondary/out of scope.
- Decide whether sidebar search is MVP Phase 1 or deferred until after the overview/status redesign.
- Decide whether `アクセス` should be displayed as `アクセス/API` in the sidebar.
- Decide whether API keys stay under `アクセス/API` or become a separate `開発者` category later. Recommendation: keep under `アクセス/API` for now.

## Implementation Readiness Decision

Ready for Chat 2 after user approval of the recommended direction.

Do not start implementation until the user chooses:

- Use Direction A as-is.
- Combine Direction A with an alternate direction.
- Revise the architecture before implementation.

## Chat 2 Input Values

Chat 2用プロンプトはこのDesign Packでは新規作成しない。正本は `settings-ui-architect` skill の `workflows/two-chat-runbook.md` にある「Chat 2: Implementation Orchestrator Prompt」を使う。

その正本プロンプトへ埋める入力値だけをここに残す。

- 企画書パス: `docs/ai/plans/active/settings-ui-redesign.md`
- モックアップ/プロンプト保存先: `docs/ai/plans/active/settings-ui-redesign-assets/`
- 推奨UI案: Direction A「Focusmap Control Center」
- まだユーザー判断が必要な点:
  - `一般` を `概要` へ改名してよいか
  - `スペース共有` を今回の設定UI改善に含めるか、現時点では二次カテゴリ/対象外にするか
  - サイドバー検索をPhase 1で入れるか、概要/状態表示の改善後に回すか
  - サイドバー表示名を `アクセス` のままにするか、`アクセス/API` へ変えるか
  - APIキーを当面 `アクセス/API` に置くか、後で `開発者` カテゴリへ分けるか
- Chat 1 commit hash: `<Chat 1完了後のcommit hashを貼る>`
