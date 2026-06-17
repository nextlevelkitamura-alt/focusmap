# Two Chat Runbook

Use this as the recommended route for broad Focusmap UI work.

## Roles

1. **Chat 1: UI Design Pack**  
   Research, evaluate, write proposal, define UI acceptance, create visible mockup images when needed, and save artifacts.
2. **Chat 2: Implementation Orchestrator**  
   Read approved design pack, create worker prompts, receive worker results, resolve conflicts, and integrate to local main.

Implementation worker chats are children of Chat 2. The user should not manage separate research chats.

## Order

```text
Step 1: Send Chat 1 prompt only
  ↓
Chat 1 returns "Chat 1完了"
  ↓
User reviews proposal and visible mockups
  ↓
Step 2: Send Chat 2 prompt
  ↓
Chat 2 outputs worker prompts and stops
  ↓
Run foundation worker first if required
  ↓
Run detail workers in parallel only when scopes do not overlap
  ↓
Paste all worker reports into Chat 2
  ↓
Chat 2 runs Integration Finalizer to local main
  ↓
push/deploy remains a separate explicit gate
```

## Prompt Quality Check

Before giving any prompt to the user, confirm:

- It starts with `Use $focusmap-ui-quality ...`.
- The role is clear in one sentence.
- It says what to read first.
- It says what to create and where to save it.
- It says what not to do.
- It has an explicit stop point.
- Implementation prompts include allowed files and forbidden files.
- Verification commands obey repo policy.
- Push/deploy is forbidden unless explicitly approved.

## Artifact Defaults

Check repo instructions first. If no better path exists:

- proposal: `docs/ai/plans/active/focusmap-ui-<scope>.md`
- mockups/assets: `docs/ai/plans/active/focusmap-ui-<scope>-assets/`
- implementation plan: `docs/ai/plans/active/focusmap-ui-<scope>-implementation.md`

Use a short scope such as `calendar-editor`, `dashboard-navigation`, `mobile-chat`, or `settings`.

## Chat 1: UI Design Pack Prompt

Paste this into a new chat for broad UI redesign or UI quality work. Replace bracketed values.

```md
Use $focusmap-ui-quality in design-pack mode.

あなたの役割:
Focusmap UI改善の「調査・企画・UI受け入れ条件・モックアップ担当」です。
アプリ本体の実装コードは変更しないでください。

目的:
Focusmapの対象UIを評価し、既存テーマを維持した95点以上の改善案を作り、必要ならユーザーが見られる実画像モックアップまで作成してください。
採点は診断用です。必ず95点以上へ上げる具体案まで書いてください。

リポジトリ:
/Users/kitamuranaohiro/Private/focusmap

対象画面:
- <例: Todo 3days calendar / 予定編集 / マップ右ペイン / チャット / 設定 / iOS WebView>

対象プラットフォーム:
- <Desktop Web / Mac app / Mobile Web / iOS WebView>

参考情報:
- screenshot/appshot: <path or none>
- route/url: <path or none>
- ユーザーが困っていること: <短く貼る>

最初に読むもの:
- AGENTS.md
- docs/CONTEXT.md
- .agents/skills/focusmap-ui-quality/SKILL.md
- .agents/skills/focusmap-ui-quality/workflows/design-pack-flow.md
- .agents/skills/focusmap-ui-quality/workflows/timeline-and-dependency-gates.md
- .agents/skills/focusmap-ui-quality/references/ui-constitution.md
- .agents/skills/focusmap-ui-quality/references/scoring-and-severity.md

成果物の保存先:
- proposal: docs/ai/plans/active/focusmap-ui-<scope>.md
- mockups/assets: docs/ai/plans/active/focusmap-ui-<scope>-assets/

やること:
1. 現在UIを評価する
2. DesktopとMobileを分けて、95点以上の理想状態を定義する
3. Focusmapらしさとして守る色、角丸、密度、lucide、状態表現を明記する
4. 大手UIの参考パターンは、Focusmapに転用できる原則だけにする
5. UI受け入れ条件を書く
6. 広い見た目変更がある場合、Gate B後に実画像モックアップを生成・保存・表示する
7. 画像生成プロンプトも保存する。ただしプロンプトだけで完了扱いにしない
8. 最後にChat 2へ渡す入力値だけを返す
9. docs/ai/plans/active配下など、今回作った企画書・モックアップ関連ファイルだけをcommitする。pushはしない

やらないこと:
- src/** の実装
- アプリ本体コード変更
- npm run test / lint / build / Playwright / ブラウザ確認 / curl / git diff --check
- push / deploy
- Chat 2やworkerプロンプトの構造を勝手に作り変えること

画像生成が不要な場合:
- 理由を書く
- no-imageで実装分解してよいかユーザー判断が必要なら明記する

画像生成が必要だができない場合:
- `Chat 1完了` と書かない
- `Chat 1 blocked: image generation unavailable` と書く
- 足りない画像、保存済みプロンプト、次の判断を返す

完了時に返すこと:
- `Chat 1完了`
- proposal path
- UI acceptance section/path
- mockup image paths or no-image reason
- selected/recommended direction
- unresolved decisions
- commit hash if committed
- Chat 2に貼る入力値
```

## Chat 2: Implementation Orchestrator Prompt

Use this after Chat 1 is complete and the user approves the proposal/visual direction.

```md
Use $focusmap-ui-quality in split + integrate mode.

あなたの役割:
Focusmap UI改善の「実装分解・統合担当」です。
最初はworkerプロンプト作成だけを行い、worker結果が戻ったら統合まで担当してください。

リポジトリ:
/Users/kitamuranaohiro/Private/focusmap

入力:
- proposal path: <Chat 1のproposal path>
- UI acceptance: <Chat 1のacceptance path/section>
- mockup image paths: <Chat 1の画像一覧 / no-image例外ならその承認>
- selected direction: <ユーザーが選んだ方向>
- Chat 1 commit hash: <あれば>

最初に読むもの:
- AGENTS.md
- docs/CONTEXT.md
- proposal
- mockup image paths or no-image exception
- .agents/skills/focusmap-ui-quality/SKILL.md
- .agents/skills/focusmap-ui-quality/workflows/plan-and-split.md
- .agents/skills/focusmap-ui-quality/workflows/integration.md
- .agents/skills/focusmap-ui-quality/workflows/timeline-and-dependency-gates.md
- .agents/skills/focusmap-ui-quality/workflows/handoff-playbook.md

Part A: 実装分解
1. git status と worktree状態を確認する
2. Gate C/Gate Dが満たされているか確認する
3. no-image例外がないのに必要な画像がない場合は停止する
4. shared shell/primitivesが必要なら foundation worker を1本だけ先に作る
5. allowed filesが重ならない範囲だけdetail workerに分ける
6. 並列が危ない場合は順番にする
7. 各worker用の日本語プロンプトを作る
8. workerプロンプトには必ず role / repo / base commit / allowed files / forbidden files / acceptance / verification policy / commit policy / final report を入れる
9. まずworkerプロンプトを出したところで停止する

Part B: 統合
私が全worker結果を貼った後だけ実行してください。
1. worker reports, commit hashes, changed files, contract deviationsを確認する
2. allowed files外の変更がないか確認する
3. P0/P1が残っていないか確認する
4. 競合は意図を見て解消する
5. UI仕様・同期方式・主要挙動が変わった場合は docs/CONTEXT.md を更新する
6. local mainへ統合commitを作る
7. pushは明示依頼があるまでしない
8. 検証が必要なら勝手に実行せず、実行候補として提示する

Part A完了時に返すこと:
- parallelization decision
- worker一覧
- 実行順
- 各workerへ貼るプロンプト
- foundation workerが必要な場合のbase commit更新手順
- worker完了後にこのチャットへ貼る情報
- Integration Finalizer prompt

Part B完了時に返すこと:
- integration commit
- included worker commits
- changed files
- allowed files逸脱の有無
- docs/CONTEXT.md更新の有無
- checks run or skipped by policy
- local main status
- origin/main status
- production status
- push前に推奨する確認
```

## Integration Finalizer Prompt

Paste this into Chat 2 after all workers complete.

```md
Use $focusmap-ui-quality in integrate mode.

全workerが完了しました。
Integration Finalizerとして、全worker成果を確認し、local mainへ統合してください。
pushは明示許可があるまでしないでください。

Base commit:
<base commit>

Foundation commit:
<あれば>

Worker commits:
- W1:
- W2:
- W3:

Worker reports:
<各workerの最終報告>

Worktree paths:
- <path>

Allowed/forbidden file contracts:
<Chat 2 Part Aの表>

やること:
1. git status / worktree状態を確認する
2. 各worker commitのchanged filesを確認する
3. allowed files逸脱を確認する
4. P0/P1が残っていないか確認する
5. worker成果を安全な順に取り込む
6. 競合があれば意図を見て解消する
7. 必要なら docs/CONTEXT.md を更新する
8. local mainに統合commitを作る
9. pushはしない
10. npm test / lint / build / Playwright / browser / curl / git diff --check は、明示許可なしに実行しない

完了時に返すこと:
- integration commit hash
- included worker commits
- changed files
- allowed files逸脱の有無
- P0/P1の残り
- docs/CONTEXT.md更新の有無
- verification status
- local main / origin/main / production status
- push前に推奨する確認
```

## Rule

Worker commits are intermediate. The task is complete only after Integration confirms local main status, or explicitly reports why local main integration is blocked.
