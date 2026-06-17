# Plan And Split Workflow

## Goal

UI改善を安全に並列化し、テスト/reviewをreadonly subagentとして組み込む。

## Gate

Read `workflows/timeline-and-dependency-gates.md` first.

Do not create executable worker prompts until Gate D is complete:

- accepted UI acceptance criteria
- approved mockup images or explicit no-image exception when visual direction changed
- desktop/mobile split
- shared component/API/data contracts
- allowed files per worker
- forbidden files per worker
- verification policy
- commit/push policy
- integration owner

If Gate C or Gate D is missing, output draft worker roles only and label them `not ready for execution`.

## When To Parallelize

並列化してよい条件:

- DesktopとMobileで触るファイルが明確に分かれる。
- Shared componentのcontractが先に決まっている。
- 仕様、状態名、API、デザイントークンが未確定ではない。
- Integration担当が競合解消と最終UI判断を持てる。

直列にする条件:

- 同じshared componentを複数workerが大きく触る。
- Desktop/Mobile差分の前提がまだ曖昧。
- DB/API contract、auth、Realtime、保存方式が未確定。
- P0の白画面/例外修正で原因が未特定。
- 必要なモックアップ画像がなく、ユーザーのno-image例外承認もない。

## Standard Roles

- Planner: 調査結果、UI憲法、acceptance、ownershipを作る。
- Desktop UI Worker: デスクトップWeb/Mac表示の実装。
- Mobile UI Worker: Mobile Web/iOS WebView表示の実装。
- Shared UI Worker: 共通コンポーネント、tokens、hooksを最小範囲で整える。乱用しない。
- Readonly Test Review: 実装せず、P0/P1/P2と95点案をレビューする。
- Integration: worker成果をmainへ統合し、P0/P1解消、docs更新、最終報告を行う。

## Split Contract

workerを出す前に、次を必ず書く。

- Objective
- Allowed files
- Do not touch files
- Existing UI to preserve
- 95-point target UI
- Desktop/Mobile split
- P0/P1 acceptance
- Tests/visual checks allowed only if explicitly requested
- Expected report format

Use `assets/worker-prompt-template.md` for each worker. Each prompt must be understandable without reading the parent chat.

## Foundation-First Pattern

Use this when broad UI work needs shared shell, primitives, navigation, or reusable panels.

1. Create one Foundation Worker.
2. Foundation Worker commits first.
3. Treat that commit as base for detail workers.
4. Detail workers may import foundation files but may not edit them.
5. Run detail workers in parallel only when allowed files do not overlap.
6. Collect all detail worker reports before Integration unless a blocker appears.

## Board / Docs

非自明な並列実装では、repoのAGENTS.mdとtask-routerに従い、必要に応じて `docs/ai/task-board.md` と `docs/ai/plans/active/` を使う。
workerのcommitは中間成果であり、Integrationがlocal mainへ取り込むまで完了扱いにしない。

## Output

````md
## Parallelization Decision

Decision: <SINGLE_CHAT | SEQUENTIAL | PARALLEL_READONLY | HYBRID_PLAN_THEN_PARALLEL | PARALLEL_WORKTREES | DO_NOT_PARALLELIZE>
Reason:
- ...

## Ownership
| Worker | Allowed Files | Forbidden Files | Commit? | Notes |
|---|---|---|---|---|

## Merge Order
1. ...

## Worker Prompts
### Worker A
```md
...
```

## Integration Conditions
- Gate D passed
- P0/P1 acceptance met
- contract deviations resolved
- docs updated if behavior changed
- verification run only if user approved
````
