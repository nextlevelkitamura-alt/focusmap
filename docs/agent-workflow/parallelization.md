# 並列作業判断ポリシー

Focusmap の AI エージェント運用で、単一チャット・複数チャット・readonly サブエージェント・Git worktree をどう使い分けるかの正本。

この文書は「すべてを並列化する」ためではなく、タスクの性質を見て安全な進め方を提案するための判断基準をまとめる。実行時の出力は `.agents/skills/parallel-work-planner/SKILL.md` の形式に従う。Claude Code では `CLAUDE.md` から同じ docs を参照する。

## 基本方針

- 並列化は時間短縮の手段であり、目的ではない。
- タスクが大きいだけでは並列化しない。
- 編集範囲・責務・契約・統合手順が明確で、短縮メリットが統合コストを上回りそうな場合だけ並列化を提案する。
- 迷う場合は、まず `PARALLEL_SUBAGENTS_READONLY` で調査・レビューだけ並列化する。
- API contract / DB schema / shared types / generated client / auth / error format が未確定なら、実装並列化の前に `HYBRID_PLAN_THEN_PARALLEL` を選ぶ。
- worktree は worker が勝手に作らず、統括側が branch/status/uncommitted changes/base/責務/編集範囲/merge順を確認してから提案する。

## 並列化判断ラベル

| ラベル | 使う場面 |
|---|---|
| `SINGLE_CHAT` | 小さく明確で、1チャット内で実装・検証・コミットまで進める方が速い |
| `SEQUENTIAL` | 複数ステップだが依存が強く、同じチャットで順番に進める方が安全 |
| `PARALLEL_WORKTREES` | write scope が分離でき、各 worktree を破棄・統合しやすい |
| `PARALLEL_SUBAGENTS_READONLY` | 調査・レビュー・テスト設計など、書き込みなしで観点を分ける |
| `HYBRID_PLAN_THEN_PARALLEL` | 先に設計・契約・ownership を固めれば、後続を安全に並列化できる |
| `DO_NOT_PARALLELIZE` | 危険操作・仕様曖昧・衝突高リスクなど、並列化しない方がよい |

## 判断材料

時間や作業量だけで判断せず、以下を必ず見る。

- 同じファイルを複数エージェントが触りそうか。
- UI と backend のように責務が分けやすいか。
- API contract、型、DB schema、認証、エラー形式などの共通契約が未確定ではないか。
- 変更範囲がディレクトリ単位・route単位・component単位で分けられるか。
- 統合時の衝突コストが高すぎないか。
- 先に設計・契約ファイルを作れば安全に並列化できるか。
- 調査・レビュー・テスト設計のように、書き込みを伴わない並列化か。
- 失敗した場合に片方の worktree だけ破棄できるか。
- generated files / lockfile / migration files を複数 agent が触らないか。
- integration 専用チャットで回収できる粒度か。

## 並列化に向いているタスク

- UI 実装と backend 実装が分離できる機能追加。
- 画面A / 画面B のように、route や component が独立している UI 作業。
- API endpoint A / endpoint B のように、責務が分かれている backend 作業。
- 調査、設計、レビュー、テスト追加、ドキュメント整理。
- Figma / スクショ再現など、UI単体で検証できる作業。
- 既存コード調査を複数領域に分ける作業。
- セキュリティレビュー、テスト漏れレビュー、保守性レビューのような観点別レビュー。
- frontend / backend / integration のように明確なフェーズ分離ができる作業。

## 並列化に向いていないタスク

以下は原則として `SINGLE_CHAT`、`SEQUENTIAL`、または `DO_NOT_PARALLELIZE` を推奨する。

- 同じファイルを複数 agent が編集する可能性が高い作業。
- DB schema / migration / API contract がまだ決まっていない状態の実装。
- 認証・権限・課金・本番データ・secret/token・GCP/GCS削除など危険操作を含む作業。
- 大規模リファクタで影響範囲が広すぎる作業。
- 仕様が曖昧で、各 agent が勝手に解釈しそうな作業。
- 1つの小さいバグ修正で、分割するほど統合コストが高い作業。
- generated files / lockfile / migration files など衝突しやすいファイルを複数 agent が触る可能性がある作業。

## UI / Backend 並列の標準フロー

UI と backend を並列で進める場合は、いきなり実装に入らず以下を提案する。

1. Architect / Planner チャットで設計・契約を作る。
2. 必要に応じて `API_CONTRACT.md` / `UI_ACCEPTANCE.md` / `TEST_PLAN.md` / `OWNERSHIP.md` を作る。
3. Frontend 用チャットのプロンプトを出す。
4. Backend 用チャットのプロンプトを出す。
5. 必要ならそれぞれ Git worktree を分ける。
6. 最後に Integration 用チャットのプロンプトを出す。
7. 統合後に Review サブエージェントで観点別レビューを行う。

契約ファイルを置く場所はタスクの寿命で決める。

- 1回限りの実装計画: `docs/plans/active/<topic>.md`
- 長く参照する仕様: `docs/specs/<topic>/requirements.md` / `delivery-plan.md`
- agent 作業手順: `docs/agent-workflow/*`
- 短期の並列実装メモ: `docs/plans/active/<topic>-parallel-plan.md`

## 複数タスクがある場合

ユーザーが複数の実装案・修正案・タスク一覧を出した場合は、すぐ実装せず先に整理する。

1. タスクを一覧化する。
2. 依存関係を確認する。
3. 同じファイル・同じ機能領域を触るものをまとめる。
4. UI系 / backend系 / DB系 / auth系 / docs系 / tests系 / refactor系 に分類する。
5. 単一チャット向き、順次実行向き、parallel worktree 向き、readonly サブエージェント向きを分類する。
6. 並列化する場合は、各チャットの目的・編集範囲・禁止範囲・完了条件を出す。
7. 最後に Integration チャットへ渡すプロンプトも出す。

数で機械的に分けない。「3つタスクがあるから3チャット」ではなく、依存関係・編集範囲・統合しやすさで分ける。

## 必須出力形式

`parallel-work-planner` Skill を使う時は、必ずこの順序で出す。

```markdown
## 1. 並列化判断

<SINGLE_CHAT | SEQUENTIAL | PARALLEL_WORKTREES | PARALLEL_SUBAGENTS_READONLY | HYBRID_PLAN_THEN_PARALLEL | DO_NOT_PARALLELIZE>

理由:
- ...

代替案:
- ...

## 2. タスク分解

- Architect / Planner: ...
- Frontend: ...
- Backend: ...
- Integration: ...
- Review: ...
- Docs / Tests: ...
- Other: ...

## 3. worktree計画

- base: ...
- worktree 1: ...
- worktree 2: ...
- merge order:
  1. ...
  2. ...

## 4. 各チャット用プロンプト

### Planner用プロンプト
...

### UI用プロンプト
...

### Backend用プロンプト
...

### Integration用プロンプト
...

### Review用プロンプト
...

## 5. 統合条件

- typecheck
- lint
- unit test
- E2E
- manual check
- API contract一致
- UI状態確認
- docs更新
- PR summary

## 6. 注意点

- ...
```

不要なロールや worktree 計画は省略してよい。ただし見出し `## 1` から `## 6` は維持する。

## 完了条件の考え方

統合条件はタスクに合わせて選ぶ。

- コード共通: `npm run typecheck`、`npm run lint`、関連 unit test。
- UI: `http://localhost:3001` 固定で dev server、desktop/mobile viewport、主要フロー、console/network確認。
- API: request/response schema、認証、エラー形式、DB read/write、rate limit。
- DB: migration dry-run、rollback方針、generated types の更新責任。
- Docs: `docs/CONTEXT.md`、該当 `docs/plans/*` / `docs/specs/*`、Skill references の更新。
- Integration: API contract と UI 実装の一致、mock の除去、未解決事項の明示。

## 注意点の観点

出力の `## 6. 注意点` では、特に以下を明示する。

- API contract が未確定。
- 同じ型ファイルを UI/backend 両方が触る可能性。
- migration が必要。
- UI が mock 前提になりそう。
- backend が response schema を変えそう。
- generated client の更新タイミング。
- lockfile が意図せず更新されそう。
- auth / permission / billing / production data / secret/token を扱う。
- 統合時に E2E が必要。
