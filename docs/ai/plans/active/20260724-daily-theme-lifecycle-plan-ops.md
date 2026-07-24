分類: repo ／ 種別: 既存改善
規模: フル
形態判定: Program子相当 ／ 理由: Theme日次履歴・Plan紐付け・session所属・ローカルGit状態遷移を、別々の正本を壊さず一体化するため
並列: DB契約確定後にUI、Plan遷移bridgeはその後

# Daily Theme継承・Plan紐付け・実行状態の実運用化

- Task ID: TASK-20260724-001
- Status: review_pending
- Created: 2026-07-24
- Parent: `~/Private/personal-os/my-brain/areas/ai運用/plans/active/2026-07-17-当日ボードSQL化/program.md`
- Board: `docs/ai/task-board.md`

## 目的

Themeを毎朝作り直さず、未完了なら翌日に自動継続し、昨日の状態も参照できるようにする。DailyではThemeの中へactive/planning Planと実行中sessionを正しく束ね、Plan未紐付けThemeや終了済みsessionを「消失」「計画外」「実行中」と誤表示しない。

## 正本境界

- Themeの名前・目的・完了条件・ライフサイクル: Turso `themes`
- 日ごとの採用・持越し・並び順: Turso `theme_days`
- ThemeとPlanの紐付け: Turso `theme_plan_links`（slug参照のみ）
- Themeとrepoの紐付け: Turso `theme_repos`
- AIが見つけた新Theme候補: Turso `theme_candidates`（採用前の候補箱）
- Plan本文・Plan状態: 各repoのMarkdownと計画フォルダ
- Planの表示キャッシュ: Turso `plan_docs`（plansyncの一方向ミラー）
- sessionの現在状態: board DB `sessions` と `session_events`
- Planフォルダ移動: Mac側 `bucketctl`。Cloud Runから直接ファイルを動かさない

## 非対象

- Plan本文をFocusmap/Tursoから編集すること
- 汎用shellをWeb UIから自由実行すること
- Theme本体を日ごとに複製すること
- prompt本文、token、credentialを監査データへ保存すること

## 現状の根因

1. `themes`は永続データだが日別の採用履歴がなく、前日の正確なTheme一覧を再現できない。
2. repoフィルターが`plan_docs.path`だけを見るため、Plan未紐付けThemeが画面から消える。
3. routing proposalを採用しても`sessions.theme_id / plan_slug`へ適用されず、表示は計画外のまま。
4. no-transcript sessionのreconcileに12時間上限があり、それを超えたghost runが永久に残る。
5. `themes.plan_refs` JSONはDnD・並び替え・重複防止に弱い。
6. UIはplanning Planを読む一方、plansyncはplanningを同期対象にしていない。

## 実行契約

- 対象repo: `/Users/kitamuranaohiro/Private/projects/active/focusmap`
- 連携repo: `/Users/kitamuranaohiro/Private/personal-os/AIエージェント基盤`
- 実行形: DB契約 → UI → session適用 → Plan遷移bridge → 統合評価の直列
- 変更可能範囲: `db/turso/migrations/**`、`src/lib/turso/**`、`src/app/api/board/**`、`src/components/today/board-v2/**`、`src/components/dashboard/board-summary-panel.tsx`、`scripts/focusmap-agent/**`、session-boardのrouting/reconcile、`docs/CONTEXT.md`、`docs/ai/**`
- 変更禁止範囲: Plan本文のDB正本化、既存Plan本文のWeb編集、任意shell API、既存未コミット差分の巻き戻し
- rollback: migrationはadditive。UI/APIは旧`plan_refs`読取へ戻せるよう移行期間中カラムを残す。Plan遷移は`bucketctl`のdry-runとGit履歴で回復可能にする
- 検証: 対象unit test、typecheck/build、Turso migration readback、session reconcile readback、ローカルDailyで今日/昨日・DnD・rollback・repo filterを確認

## 方針

1. `themes`は長期Theme本体として維持し、`theme_days(theme_id, board_date, state, carried_from_date, sort_order)`を追加する。
2. 今日を初めて開いた時、前日の`active` Themeを`INSERT OR IGNORE`で今日へ冪等継承する。Theme本体は複製しない。
3. 前日表示は`theme_days`を読む。移行前データは、その日のtodo参照またはmigration時backfillで補い、現在activeを過去へ無条件投影しない。
4. `theme_plan_links(theme_id, plan_slug, sort_order)`へJSON参照を正規化し、Planは一度に1Themeへ所属する。DnDはこの表だけを原子的に更新する。
5. `theme_repos`でThemeのworkspace所属を持ち、Plan未紐付けThemeも正しいrepoに表示する。未指定Themeは「全体」で見える状態を保ち、沈黙させない。
6. routing proposalの採用とsession所属更新を同一の専用操作にし、`sessions.theme_id / plan_slug / todo_id`へ冪等適用する。
7. session表示はreconcileを正としつつ、UIでも鮮度を示す。staleは「実行中」ではなく「状態不明/確認待ち」へ倒す。
8. Plan bucket変更はtyped `plan_transition` commandとしてMac agentへ渡し、`bucketctl dry-run → apply/commit → plansync → readback`を実行する。DBだけでactive/archiveを偽装しない。
9. Theme編集は現在のインラインUIを維持し、目的・完了条件・goal参照・管理状況を同じカード内で編集する。管理状況の語彙は既存Theme lifecycleと日別stateを先に使い、新しい主観列は必要性を確認してから追加する。
10. 人がDailyで追加したThemeは即時に`themes + theme_days + theme_repos`へ保存する。AI判断は`theme_candidates`へ提案として置き、人がチェックした時だけ同じ3表へtransactionで昇格する。

## 工程

- [x] 01 実装: ghost sessionのreconcile上限バグを修正し実DBをreadbackする  評価: 都度
- [x] 02 実装: `theme_days`・`theme_plan_links`・`theme_repos` migrationとdomain service/APIを追加する  評価: 都度
- [x] 03 実装: Dailyの今日/昨日・自動持越し・repo filter・管理情報表示を接続する  評価: まとめ
- [x] 04 実装: PlanのTheme間DnDとキーボード代替、楽観更新/rollbackを接続する  評価: まとめ
- [x] 05 実装: accepted routingをsession所属へ適用し「計画外」を正しく減らす  評価: 都度
- [x] 06 実装: planningをplansync対象へ入れ、typed Plan遷移bridgeを追加する  評価: 都度
- [x] 07 実装: 人の即追加とAI Theme候補の採用・却下をTurso/Dailyへ接続する  評価: 都度
- [x] 08 評価: DB/API/UI/agent/plan正本境界を統合確認する  評価: まとめ

## 完了条件

- [x] 7月23日に見えていたThemeが未完了なら7月24日にも自動で表示され、Theme本体の重複行は増えない。
- [x] 「昨日」表示で前日のTheme・目的・進捗・持越し結果を参照できる。
- [x] Plan未紐付けThemeがrepo filterで消えず、Themeに設定したrepoで表示される。
- [x] PlanをThemeへDnDすると即時表示が移り、API失敗時は元へ戻る。同一Planが複数Themeへ重複しない。
- [x] accepted routing後、sessionが同じTheme/Plan配下へ表示され、計画外欄に残らない。
- [x] transcriptのない12時間超sessionが実行中に残らず、現存sessionは誤降格しない。
- [x] Planのplanning→active等は`bucketctl`の規約・容量・評価・終了条件を通り、plansync readback後だけ確定表示になる。
- [x] Themeの目的・完了条件・ゴール参照・継続状態がカードから確認/編集できる。
- [x] Plan本文とbucketの正本がrepo Markdown/フォルダのままで、Tursoに本文の逆書込み経路がない。
- [x] 人がその日に思いついたThemeをDaily上で追加でき、当日行とrepo所属まで保存される。
- [x] AIの新Theme判断は候補として表示され、人が採用するまで正式Themeや当日Themeを増やさない。

## 実装結果

- `theme_days` / `theme_plan_links` / `theme_repos`を本番Tursoへadditive migrationし、2026-07-23の未完了3Themeを2026-07-24へ重複なしで継承した。
- `theme_candidates`を追加し、session routingの`theme_candidate`提案を候補箱へ冪等記録するようにした。Dailyでは採用・見送りができ、採用時だけTheme本体・当日行・repo所属へ昇格する。
- Dailyへ人間用の`Themeを追加`インライン入力を置き、保存結果を即座に閉じたThemeカードとして表示する。
- Theme/Plan DnDは`theme_plan_links.version`、日次完了は`theme_days.version`で競合を検知し、失敗時に楽観表示を戻す。
- `plan_transition`はtyped commandだけをMac agentへ渡し、`bucketctl dry-run → commit → plansync → readback`を実行する。
- routing採用はproposalとsession所属を同一transactionで更新し、ghost sessionは12時間超でも実体がなければ確認待ちへ降格する。
- 検証: Focusmap対象21 test、routing 45、Theme CLI 30、reconcile 22、plansync 25、TypeScript typecheck、Mac agent build、対象eslint、diff checkがPASS。
- 本番Turso readback: `theme_candidates`表あり・候補0件、active 3Themeのrepo所属は`focusmap/ai-platform`へ補完済み。コードの本番反映はpush/deploy後。

## 終了記録

archive時に追記する。
