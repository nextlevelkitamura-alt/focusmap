# メモUX改善 計画書

作成: 2026-06-04 / 状態: active / 起点: 北村の不満（メモ追加しづらい・Codex送信が遅い・不要機能が多い）

## 1. 背景・課題（ユーザーの声）
- メモの**新規追加がしづらい**（「追加」より「AIで生成/整理」が主導線に見える）
- Codex に**送るまでが遅い**（プロンプト送信までの体感）
- 全体的に**不要な機能・要素が多い**（「リストビューはいらない」等）

## 2. 診断結果（別セッション task-router + ui-ux-pro-max を本セッションで検証・補正）

### 2.1 確定した事実
- メモUIは2系統: 旧 `src/components/memo/memo-view.tsx`（**どこからも import されていない＝デッドコード**）と 現行 `WishlistView`(`src/components/wishlist/`)
- Codex送信は `src/app/api/ai-tasks/schedule/route.ts` が**毎回 `spawn` で `scripts/task-runner.ts --fast` を起動**（route.ts:32）。Codex app-server (127.0.0.1:7878) は常駐・即応答可能なのに、毎回プロセスを起こす構造が遅延の主因
- 「追加ファースト」修正は commit `1903c80` で実装済み（**要・実画面確認**。他5ファイルと混在コミットされている点に注意）
- ダッシュボード構成: `activeView`(today/map/long-term/ai/settings) + Today内 `todaySubView`('memo'=メモ+D&D / 'timeline'=旧タスクボード / 'ai'=AI実行)

### 2.2 診断の誤り（**除外**）
- ❌ 「package.json が8行に置換され dev/build/test が消えた」→ **誤診**。実際は94行の正常版・git差分なし。別セッションが cwd=`dist-desktop/.../next-standalone` の最小 package.json を読んだだけ。**旧Phase0（package.json復旧）は実施しない**（むしろ実行すると正常版を壊す危険）

## 3. UI/UX 基準（Focusmap基準・CLAUDE.md由来）
- モバイルファースト／片手操作／タップターゲット **44px以上**
- 一画面の情報量を絞る（**スクロールより画面遷移**）
- **左上から重要な判断項目**、操作は小さく密度高く
- **desktop/mobile で同じ意味・同じ導線**

### 3.1 基準に照らした現状の不適合
1. メモ空状態でツールバーに6要素（AI状況/カレンダー/フィルター/マップ化/追加/音声）→ 主導線（メモを書く・追加）が埋もれる。優先順位が不明瞭
2. desktop/mobile で追加導線が不一致（desktop=入力欄横が「生成」/ mobile=「＋」が追加）→ 「同じ導線」違反（※1903c80で一部是正済み・要確認）
3. モバイルのステータスチップ列が**横スクロールバー**を出す → モバイルファースト違反
4. メモUI 2系統併存（旧memo-viewデッドコード）→ 認知負荷・保守コスト

## 4. スコープ・優先順位・ブランチ戦略

### Scope 1: 不要機能の削除（main直接・範囲ごと小コミット）
- 1-1. 旧 `memo-view.tsx`（+連動する未使用子の確認: memo-chat-history / memo-refine-chat / note-claude-runner）を削除 — デッドコード除去
- 1-2. **「リストビュー」削除 — ※対象を確定後に実施（ユーザー確認 or 実画面特定）**
- 1-3. メモ空状態のツールバー整理（「AI状況」は実行中タスクがある時のみ表示 等）

### Scope 2: 追加ファーストの仕上げ（main直接）
- 2-1. `1903c80` の追加ファーストを実画面で検証
- 2-2. desktop/mobile の追加導線を完全一致

### Scope 3: モバイル（main直接）
- 3-1. ステータスチップ列の横スクロール解消（折返し or タブ化、44px維持）

### Scope 4: Codex送信の高速化（**feat/codex-fast-dispatch ブランチ**・要実機検証）

**現状（確認済み）**: `src/app/api/ai-tasks/schedule/route.ts` の `requestImmediateCodexAppDispatch()` が、タスク登録ごとに `spawn('tsx scripts/task-runner.ts --task-id <id> --fast')` を detached 起動する。`spawn` 自体はノンブロッキング（API応答は待たない）だが、**体感遅延の実体は spawn 後の `tsx` 起動コスト + task-runner の DB読込→Codex app-server接続→送信のリードタイム**。Codex app-server は `127.0.0.1:7878` で常駐 LISTEN 済み（即応答可能）。

**実装前の必須確認**: `scripts/task-runner.ts`（1200行超）を精読し、(a) Codex app-server への接続プロトコル (b) 結果の ai_tasks への書き戻し (c) `--fast` の意味 を把握する。理解前に route.ts を書き換えない。

- 4-1.（推奨・低リスク案）task-runner を**常駐デーモン化**し、新タスクは HTTP/IPC で通知（spawn廃止）。task-runner のロジックを再利用するので壊れにくい。
- 4-1'.（高速・高リスク案）route.ts から直接 Codex app-server(7878) へ投入。task-runner のプロトコル/結果同期を route 側に再実装する必要があり、壊すと送信が全滅。
- 4-2. どちらの案でも**失敗時は従来の task-runner spawn にフォールバック**（後退防止）。
- 4-3. **実機検証必須**: 実際にメモを Codex へ送り ①送信が速くなったか ②結果が ai_tasks に正しく書き戻るか ③失敗時フォールバックが働くか を確認。検証できる環境（メモ＋repo_path＋Codex.app稼働）で行う。

### Scope 5: Codex状態表示の明確化（低リスク・main直接可）
- 5-1. `route.ts` の `result.message`/`steps` と `wishlist-card-detail.tsx`（状態表示・1650行付近）を、**登録済み→接続中→送信済み→完了待ち** の段階表示に統一
- 5-2. ボタン文言（「Codexで実行」「自動送信」）と押下後表示（「キューに追加」「起動待ち」）の不一致を解消し、実際に送られたか分かるようにする

## 5. 受け入れ条件
- メモ追加が **1アクション**（入力→追加）で完了、AI整理は副次
- desktop/mobile で追加導線が**同一**
- モバイルで**横スクロールバーが出ない**
- Codex送信: ボタン押下→送信までの体感短縮（spawn廃止）、送信状態が画面で分かる
- `npm run build` と `npm test`(vitest) が通る

## 6. 非対象
- package.json の「復旧」（誤診のため）
- React Flow マップ置換（別計画 `react-flow-migration.md`）

## 7. 進め方
- Plan（本書）→ 実装（Scope1-3 はこのまま main、Scope4 はブランチ）→ 各段階で検証＆**範囲ごとにコミット（混ぜない）**
- 自動コミット(`auto:`)は粒度を壊すため、実装中は範囲ごとに手動コミットを優先

## 8. 進捗（2026-06-04 時点）
- ✅ Scope 1-1: 旧 `memo-view.tsx` 削除（-1430行デッドコード, commit `1277747`）
- ✅ Scope 1-3: メモ空状態のツールバー整理（AI状況ボタンは実行中AIタスクがある時のみ表示, commit `f6aba14`）
- ✅ Scope 2: 追加ファースト（コード上既に実装済み 1903c80 を確認 + desktop も Enter=追加 に統一, commit `f6aba14`）
- ✅ Scope 3: モバイルのステータスチップ横スクロールバー非表示（commit `f6aba14`）
- ⛔️ Scope 1-2「リストビュー削除」: **取り下げ**（ユーザーが「いる」と判断）
- ⏳ Scope 4（Codex高速化）: 未着手。実機検証必須のため別セッションで慎重に。本番pushはローカル/実機確認後。
- ⏳ Scope 5（Codex状態表示）: 未着手。低リスクだが効果確認に実画面が要る。
- 検証: `npm run build` ✅ / `tsc --noEmit` ✅ / 実画面はユーザーの手元ブラウザで確認予定（kimi-webbridgeはfocusmapの常時ポーリングでnavigate不可のため使えず）
- UI分(Scope1-3)は **ローカル実画面確認 → OKなら push（本番デプロイ）** の方針
