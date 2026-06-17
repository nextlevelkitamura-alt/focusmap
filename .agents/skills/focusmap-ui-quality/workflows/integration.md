# Integration Workflow

## Goal

複数workerのUI変更を、local mainへ統合できる品質へまとめる。

## Inputs

- UI proposal or fast-triage objective.
- UI acceptance criteria.
- Approved mockup image paths, or explicit no-image exception if visual direction changed.
- Worker reports: changed files, checks, assumptions, deviations, commit hashes.
- Base commit, foundation commit if any, worktree paths, and intended local main target.
- Current git status and branch/worktree state.

## Steps

1. Read `workflows/timeline-and-dependency-gates.md` and identify passed/skipped/violated gates.
2. 各workerのcommit、差分、報告、残リスクを読む。
3. allowed files / forbidden files 逸脱を確認する。
4. Desktop/Mobile/Sharedのcontractがズレていないか確認する。
5. 同じファイルや共通コンポーネントの競合を解消する。
6. Readonly Test ReviewのP0/P1を確認し、残っていれば該当workerへ戻す。
7. UI仕様、同期方式、データフローが変わった場合は `docs/CONTEXT.md` を更新する。
8. repoのAGENTS.mdに従い、自分が触ったファイルだけをstageし、動く状態でcommitする。
9. pushはユーザーが明示した時だけ行う。

## Integration Gate

- P0が残っていない。
- P1が残っていない、またはユーザーが延期を明示承認した。
- DesktopとMobileの役割差が説明できる。
- Focusmapの既存テーマを壊していない。
- worker成果がlocal mainへ取り込み済み。
- `docs/CONTEXT.md` など正本が必要な範囲で更新済み。
- local main、origin/main、本番反映状態を分けて報告できる。

## Final Report

```md
## Integration Review

### Included Work
- ...

### Gate Status
- Gate A:
- Gate B:
- Gate C:
- Gate D:
- Gate E:

### Contract Deviations
- ...

### UI Acceptance
- pass/fail/partial

### Remaining Findings
- [P1] ...

### Verification
- <commands run or skipped by policy>

### Repository Status
- local main:
- origin/main:
- production:

### Final Recommendation
- ready for push
- needs fixes before push
- needs user decision
```
