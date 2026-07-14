# Focusmapのloop root

このフォルダは、Focusmapが所有する新規の定時・間隔自動実行（repo-local loop）の実体正本。
基盤側へ実装をコピーせず、`implementation-links/Focusmap` はこのrootへの人間用入口だけとする。

`CLAUDE.md` はこの `AGENTS.md` への相対symlink。`AGENTS.html` は人間向けの派生説明であり、
AIの実行導線・正本にはしない。

## 置くもの・置かないもの

- loop: 時刻または間隔で自動発火し、同じ責務を繰り返す処理。
- hook: runtimeイベント直後に動く処理。repo-local hookまたは基盤のhooks-registryに置く。
- 手動コマンド: 所有Skillまたは既存の `scripts/` に置く。
- 人の方向修正を要するAI実装・レビュー・采配: Skill / orchestration / 可視ペインに置く。

## 新規loopの標準

```text
loops/
  <loop-id>/
    loop.md                目的・所有・発火・runner・停止手順
    *.plist                launchdを使う時だけ。launchd正本
    scripts/               実装が必要な時だけ
    logs/                  ファイルログが必要な時だけ。gitignore
```

- 新規loopで自動作成するのは `loop.md` だけとする。plist、`scripts/`、`logs/` は必要な時だけ追加し、空フォルダを標準として増やさない。
- `loop-id` は英小文字・数字・ハイフンで一意にする。plist labelもFocusmap内で一意にする。
- 新設・変更はGlobal Skill `loop-creator` を必ず通す。Skillを迂回して新規loopを作らない。
- `loop.md` と実装、plist、テストを同じ変更単位で更新する。目的、発火、runner、label、canonical pathが変わる時は、その時点のregistry正本も同時に更新する。

## 既存実装との境界

- `scripts/focusmap-agent/`、`scripts/task-runner.ts`、既存の `scripts/`、および既存launchd実装を、このrootへ勝手に移動しない。
- 既存loopを移す時は、対象実装、依存、LaunchAgentsの実体/symlink、backup、rollback、read-only検証を計画へ書き、人間承認後にだけ行う。
- 新規rootを作っただけではlaunchdを有効化・再登録・停止しない。周期・有効化変更は人間ゲート。

## state・log・成果物・secret

- lockは原則 `/tmp` に置く。永続stateは、そのloopが `loop.md` で明示したFocusmapの既存DB・既存正本へ置き、汎用の `state/` は作らない。
- ファイルログが必要な時だけrepo外またはgitignoreされた `logs/` に置く。`logs/`をGit追跡しない。
- 成果物は対象repoの既存カテゴリ、dashboard、DBなど目的に合う正本へ置く。汎用の `output/` は作らない。
- `tests/`は影響度とrepoの既存規約に応じて追加する。新規loopの定型にはしない。
- credential、token、利用者データをplist、loop.md、HTML、Git、基盤リンクへ書かない。
