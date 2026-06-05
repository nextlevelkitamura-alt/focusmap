# Git worktree 戦略

複数チャット・複数 worktree で実装する時の安全な提案手順。

## 原則

- worktree は worker が勝手に作らない。統括側が状態確認と計画提示を先に行う。
- `git worktree add` は実装並列化が必要な時だけ使う。
- 小さな修正、1ファイル修正、仕様が曖昧な作業では worktree を増やさない。
- 各 worktree は責務と編集許可範囲を明確にし、allowed files を重ねない。
- main merge / push / deploy はユーザー承認なしに行わない。

## 事前確認

worktree を提案する前に、統括側が以下を確認する。

```bash
git fetch --prune origin
git status --short --branch
git branch --show-current
git rev-parse --show-toplevel
```

確認して出す情報:

- current branch
- `origin/<branch>` との ahead / behind
- uncommitted changes の有無
- base branch
- 作業ごとの branch/worktree 名
- 各 worktree の責務
- 各 worktree で編集してよい範囲
- 各 worktree で編集してはいけない範囲
- merge順
- integration 用 worktree を作るかどうか

既存の未コミット変更がある場合は、勝手に混ぜない。今回の並列作業と関係ない差分は触らず、必要ならユーザーに整理を依頼する。

## 命名

Focusmap では既存運用に合わせ、通常は `main` から小さく作る。worktree を分ける必要がある場合だけ、以下を推奨する。

```text
base: main
branch: feat/<topic>-ui
branch: feat/<topic>-api
branch: feat/<topic>-integration
worktree: ../focusmap-<topic>-ui
worktree: ../focusmap-<topic>-api
worktree: ../focusmap-<topic>-integration
```

バグ修正は `fix/<topic>-...` を使ってよい。既存リポジトリやユーザー指定の命名規則がある場合はそちらを優先する。

## 提案コマンド例

コマンドは「実行」ではなく「提案」として出す。実行する場合は、統括側またはユーザーが確認してから行う。

```bash
git worktree add ../focusmap-foo-ui -b feat/foo-ui main
git worktree add ../focusmap-foo-api -b feat/foo-api main
git worktree add ../focusmap-foo-integration -b feat/foo-integration main
```

各 worker には、自分の worktree だけで作業させる。

```bash
cd ../focusmap-foo-ui
git status --short --branch
```

## Ownership 計画

worktree 計画には、必ず ownership を含める。

```markdown
| worktree | role | allowed files | forbidden files | depends on |
|---|---|---|---|---|
| feat/foo-ui | Frontend | src/components/foo/**, src/app/foo/** | db/**, src/app/api/**, package-lock.json | API_CONTRACT.md |
| feat/foo-api | Backend | src/app/api/foo/**, src/lib/foo/** | src/components/**, package-lock.json | API_CONTRACT.md |
| feat/foo-integration | Integration | 必要最小限 | 単独で仕様変更しない | ui, api |
```

shared type を両方が触る必要がある場合は、先に Planner が `OWNERSHIP.md` で責任者を決める。両方の worktree が同じ type file を編集する計画は避ける。

## Merge 順

標準の merge 順:

1. backend / DB / contract 側
2. frontend 側
3. docs / tests
4. integration
5. review 修正

ただし UI が mock で先に進む場合は、backend を先に integration へ入れ、その後 frontend の mock を実 API に接続する。

Integration チャットは以下を確認する。

- 全 worker の commit が入っている。
- API contract と UI 実装が一致している。
- mock / temporary flag / TODO が残っていない。
- generated files / lockfile が意図せず変わっていない。
- 各 worker の報告にある `contract deviations` が処理されている。

## 禁止操作

以下は禁止。必要に見えても、ユーザー承認なしに実行しない。

- `git push --force` / `git push --force-with-lease`
- `git reset --hard`
- `git clean -fd` / `git clean -fdx`
- `git restore .` / `git checkout .`
- 片側一括採用の conflict 解消
- 本番 DB 操作
- secret/token の表示や編集
- GCP/GCS などの削除・停止
- ユーザー承認なしの大規模削除
- 意図しない lockfile 更新
- unrelated refactor
- worktree / branch の強制削除

## Worker の終了報告

並列 worktree で実装する場合、各 worker には最後に以下を必ず報告させる。

- changed files
- implemented behavior
- test commands and results
- assumptions
- contract deviations
- integration notes
- risks / unresolved items

Integration チャットはこの報告を材料に、統合順と追加確認を決める。
