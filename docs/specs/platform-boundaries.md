# Platform Boundaries

Last updated: 2026-06-10

Focusmap is one product with four runtime surfaces. The repository is mostly separated by folder today, but Windows Store work must not blur those boundaries. This document is the safe default when adding Windows support, Microsoft Store packaging, or new local automation.

## Current Assessment

Verdict: folder separation is good enough to build on, but not yet safe enough to treat the Mac desktop shell as cross-platform.

| Surface | Current folder | Status | Notes |
|---|---|---|---|
| Web app / PWA | `src/`, `public/` | separated | Owns product UI, API routes, Supabase/Turso access, service worker, and PWA manifest. Must stay deployable to Cloud Run without any desktop/mobile runtime. |
| Mac desktop shell | `desktop/focusmap-mac/` | separated but Mac-specific | Electron shell. Owns local Next startup, auth session restore, local process supervision, OS clipboard, `codex://`, and Codex app-server startup. The folder name is accurate: this is not a Windows shell yet. |
| iOS app shell | `mobile/focusmap-app/` | separated | Expo/React Native WebView wrapper. Owns native external-open, clipboard, and Keychain auth-session bridges for iOS. It should stay a thin shell over the Web app. |
| Local agent | `scripts/focusmap-agent/` | separated but Mac-biased | Node CLI sidecar. Owns ai_task claiming, heartbeat, Playwright/GWS/local command execution, and Codex monitoring. The code should become platform-adapted here before Windows automation is shipped. |
| Legacy Mac install scripts | `scripts/install.sh`, `scripts/run-*.sh`, `scripts/*.plist` | Mac-specific | Keep these as Mac setup/compatibility paths. Do not reuse them for Windows packaging. |

## Ownership Rules

### Web App

Owned paths:

- `src/app/**`
- `src/components/**`
- `src/hooks/**`
- `src/lib/**`
- `src/types/**`
- `public/**`

Allowed responsibilities:

- Browser-safe UI and API behavior.
- Supabase, Turso, Google Calendar, Stripe, and Cloud Run server behavior.
- PWA manifest/service worker behavior.
- Remote status display for Mac/Windows agents through server APIs.

Forbidden responsibilities:

- Importing from `desktop/**`, `mobile/**`, or `scripts/focusmap-agent/**`.
- Assuming `process.platform === "darwin"` or local filesystem paths in client components.
- Triggering local Codex sqlite/rollout scanning from normal UI polling.
- Starting desktop local processes from Cloud Run, normal browsers, or mobile WebViews.

### Mac Desktop Shell

Owned paths:

- `desktop/focusmap-mac/**`
- Mac-only packaging scripts and installer helpers under `scripts/**` when clearly named Mac-only.

Allowed responsibilities:

- Start or connect to a local Next instance.
- Start or connect to `focusmap-agent`.
- Start or connect to Codex app-server on the Mac.
- Store desktop auth session locally.
- Use Electron clipboard, shell, local process, URL scheme, and macOS paths.

Forbidden responsibilities:

- Becoming the shared desktop abstraction by accident.
- Adding Windows behavior inline without a platform adapter.
- Changing normal Codex handoff from `dispatch_mode='manual'` to auto unless a separately labeled auto-execution UI is added.

### iOS App Shell

Owned paths:

- `mobile/focusmap-app/**`

Allowed responsibilities:

- Load `https://focusmap-official.com/dashboard` or configured preview URL in a WebView.
- Add `source=ios-app&standalone=1`.
- Handle iOS external URL opening and clipboard bridge messages.
- Store and restore the Focusmap Supabase session in iOS Keychain through a narrow WebView message bridge.
- Inject resume/focus events into the WebView.

Forbidden responsibilities:

- Reading local Codex state, local git repositories, or desktop agent files.
- Reimplementing product UI that belongs in `src/**`.
- Adding desktop or Windows automation logic.

### Local Agent

Owned paths:

- `scripts/focusmap-agent/**`

Allowed responsibilities:

- Claim and execute local automation tasks.
- Send runner heartbeat.
- Read local Codex state and app-server signals.
- Handle Playwright/GWS/file/terminal work within explicit safety rules.

Forbidden responsibilities:

- Importing React, Next UI, or Electron shell code.
- Assuming macOS-specific paths inside shared executor logic.
- Writing raw logs/full thread history to Supabase/Turso.

## Windows Store Strategy

There are two separate tracks. Do not combine them into one risky rewrite.

### Track A: Microsoft Store PWA

Use this for the fastest store release.

- Scope: `public/site.webmanifest`, `public/service-worker.js`, icons, app metadata, Store listing assets.
- Runtime: Cloud Run Web app.
- No local Codex runner, no desktop local process control.
- Safe because it does not touch `desktop/focusmap-mac/**` or `scripts/focusmap-agent/**`.

### Track B: Windows Desktop App

Use this when Focusmap needs Windows local automation.

Recommended target shape:

```text
desktop/
  focusmap-mac/          # existing Mac shell, keep stable
  focusmap-windows/      # Windows-specific shell only if divergence is large
  focusmap-desktop/      # optional future shared shell after adapters exist

scripts/focusmap-agent/src/platform/
  darwin.ts
  win32.ts
  index.ts
```

Start with platform adapters before moving folders:

- `desktop/focusmap-mac/main.cjs` can stay Mac-only.
- Windows code should not be added by sprinkling `if (process.platform === "win32")` across Mac-specific functions.
- Shared behavior should be extracted only after the Mac behavior is covered by verification.

Windows-specific adapter responsibilities:

- Codex executable discovery on Windows.
- `%USERPROFILE%\.codex` state path handling.
- PowerShell/WSL command execution policy.
- Windows clipboard and external-open behavior.
- Startup/background behavior through a Store-acceptable mechanism.
- Windows packaging/signing/MSIX or Win32 listing configuration.

## Safe Change Gate

Before any change that touches more than one runtime surface, create or update a plan under `docs/ai/plans/active/` with:

- target surface: Web / Mac shell / iOS shell / agent / Windows shell
- allowed files
- forbidden files
- shared contract being changed
- verification command for each touched surface
- rollback plan

Default routing:

| Change type | Default route |
|---|---|
| Web/PWA metadata only | single small commit |
| Mac desktop shell only | single chat, Mac verification |
| iOS WebView shell only | single chat, mobile typecheck |
| Agent executor/monitor only | single chat, agent build/tests |
| Windows Store PWA | single chat, docs + PWA packaging verification |
| Windows desktop local automation | planned task, platform adapter first, no Mac behavior rewrite |

## Verification Matrix

Use the relevant rows only.

| Surface | Minimum verification |
|---|---|
| Web | `npm run test:run` for touched tests, targeted ESLint, `npx tsc --noEmit --pretty false` when TypeScript contracts change |
| PWA/Store metadata | manifest validation, icon presence, app URL smoke check |
| Mac shell | `node --check desktop/focusmap-mac/main.cjs`, `node --check desktop/focusmap-mac/preload.cjs`, Mac app smoke when runtime changed |
| iOS shell | `npm --prefix mobile/focusmap-app run typecheck`, iOS build/install only when native bridge or config changed |
| Agent | `npm --prefix scripts/focusmap-agent run build`, focused agent tests |
| Windows shell | Windows package/build verification on Windows before claiming releasable |

## Current Safe Next Step

For Microsoft Store release work, start with Track A PWA packaging and listing preparation. Keep Track B Windows desktop automation behind a separate plan so Mac app, Web app, and iOS app remain stable while Windows adapters are built.
