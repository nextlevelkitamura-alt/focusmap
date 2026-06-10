# Platform Boundaries and Windows Safety Plan

- Task ID: `TASK-20260610-009`
- Status: `completed`
- Created: `2026-06-10`
- Completed: `2026-06-10`
- Scope: repository structure, platform ownership, Microsoft Store readiness guardrails

## Purpose

Clarify whether Focusmap is safely separated across Web, Mac app, iOS app, and local agent surfaces, then add guardrails so Windows/Microsoft Store work does not accidentally break existing Mac, Web, or smartphone behavior.

## Findings

- The repo is physically separated enough to continue: Web lives in `src/**`, Mac Electron shell in `desktop/focusmap-mac/**`, iOS WebView shell in `mobile/focusmap-app/**`, and local runner in `scripts/focusmap-agent/**`.
- The risky part is not folder presence. The risky part is that desktop/agent code still has Mac-specific assumptions such as macOS paths, `launchd`, shell scripts, Codex app locations, and local Codex state paths.
- Windows Store PWA can be treated separately from Windows local automation. PWA release should not require changing Mac app or agent code.

## Decision

Use `docs/specs/platform-boundaries.md` as the boundary contract for future platform work.

Default strategy:

1. Microsoft Store PWA first for the fastest low-risk release.
2. Windows desktop automation later, through platform adapters.
3. Keep existing `desktop/focusmap-mac/**` Mac-only until a shared desktop abstraction is intentionally extracted.

## Acceptance

- Document current platform boundaries and unsafe coupling points.
- Add AGENTS rules so future agents do not mix platform responsibilities.
- Do not edit current Mac/Web/iOS/agent runtime behavior in this task.

## Verification

- `git diff --check`
- Documentation review by reading `AGENTS.md` and `docs/specs/platform-boundaries.md`

## Result

Added a platform boundary specification and updated repository instructions. No runtime files were changed.
