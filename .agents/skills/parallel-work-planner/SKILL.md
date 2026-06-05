---
name: parallel-work-planner
description: 並列作業の判断、複数Codex/Claudeチャット分割、readonlyサブエージェント、Git worktree計画、Planner/UI/Backend/Integration/Review用プロンプト生成に使う。Use when 並列で進めたい、複数チャットに分けたい、worktreeを使うべきか判断したい、タスク分解や統合チャット用プロンプトが欲しい、複数実装案を整理したいとき。
---

# parallel-work-planner

AIエージェント運用で、単一チャット・順次実行・readonlyサブエージェント・複数worktreeをどう使い分けるか判断し、各チャットへ渡すプロンプトを生成する。

このSkillは実行形式を強制しない。ユーザーが最終判断できるように、提案・理由・代替案をセットで出す。

## 参照

- `docs/agent-workflow/parallelization.md`
- `docs/agent-workflow/worktree_strategy.md`
- `docs/agent-workflow/prompt_templates.md`
- `AGENTS.md`
- `docs/CONTEXT.md`

## 使う場面

- 単一チャットか複数チャットか判断したい。
- サブエージェントで調査・レビューだけ並列化したい。
- Git worktree を分けて実装するか判断したい。
- UI / Backend / Integration / Review の標準フローを作りたい。
- 複数タスクや修正案を、依存関係・編集範囲・統合しやすさで分類したい。
- Codex / Claude にそのまま渡せるプロンプトを作りたい。

## 判断手順

1. タスク一覧、目的、受け入れ条件、危険操作の有無を確認する。
2. 既存 docs / specs / relevant files を必要最小限読む。
3. 変更範囲を UI / backend / DB / auth / docs / tests / refactor に分類する。
4. 同じファイルを複数 agent が触りそうか、shared type / API contract / DB schema / generated client が未確定かを見る。
5. readonly 並列化で足りるか、Planner で契約を作れば安全に分けられるかを判断する。
6. worktree が必要な場合だけ、branch/status/uncommitted changes/base/責務/allowed files/merge順を確認して計画として出す。
7. `docs/agent-workflow/prompt_templates.md` を元に、各チャット用プロンプトを生成する。

## 判断ラベル

- `SINGLE_CHAT`: 小さく明確で、1チャット内で実装・検証・コミットまで進める方が速い。
- `SEQUENTIAL`: 複数ステップだが依存が強く、同じチャットで順番に進める方が安全。
- `PARALLEL_WORKTREES`: write scope が分離でき、各 worktree を破棄・統合しやすい。
- `PARALLEL_SUBAGENTS_READONLY`: 調査・レビュー・テスト設計など、書き込みなしで観点を分ける。
- `HYBRID_PLAN_THEN_PARALLEL`: 先に設計・契約・ownership を固めれば、後続を安全に並列化できる。
- `DO_NOT_PARALLELIZE`: 危険操作・仕様曖昧・衝突高リスクなど、並列化しない方がよい。

## worktree safety

worktree は自動作成しない。まず以下を確認・提案する。

- current branch
- git status
- uncommitted changes
- base branch
- branch/worktree 名
- 各 worktree の責務
- 編集してよい範囲 / いけない範囲
- merge順
- integration worktree を作るか

禁止:

- force push
- `git reset --hard`
- `git clean -fd`
- 本番DB操作
- secret/token の表示や編集
- GCP/GCSなどの削除・停止
- ユーザー承認なしの大規模削除
- 意図しない lockfile 更新
- unrelated refactor

## 必須出力形式

このSkillを使ったら、必ず次の見出しで返す。

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

必要な場合だけ、base / branch / worktree / ownership / merge order を出す。

## 4. 各チャット用プロンプト

必要な数だけ、Planner / UI / Backend / Integration / Review / Docs Tests 用プロンプトを出す。

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

不要なロールは省略してよいが、見出し `## 1` から `## 6` は維持する。

## トーン

- 「このタスクは並列化できそうです」
- 「ただし、先にAPI契約を作った方が安全です」
- 「単一チャットの方が安全です」
- 「worktreeを分けるなら、以下の命名とmerge順を推奨します」
- 「統合チャットにはこのプロンプトを渡すのが良さそうです」

断定だけで終わらせず、判断理由と代替案を出す。
