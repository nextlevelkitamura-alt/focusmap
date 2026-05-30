---
status: active
category: feature
priority: high
created: 2026-05-30
updated: 2026-05-30
related: [mindmap-node-codex-relay.md]
---

# マインドマップ ノードメニューUI（顔の最小化 + 統合ポップ + Codex作業の可視化）

## 概要

マインドマップのノードは情報過多で過密。これを解消しつつ、Codex実行（relay）の
「**どこで作業しているか**」「**何を頼んで何が起きたか**」を判断できるようにする。

方針：**ノードの顔は最小化**し、詳細・操作・Codex作業は **≡から開く統合ポップ**に集約する。
マップ全体は各ノードのCodex状態色で**作業の俯瞰ビュー**になる。

設計原則：**プログレッシブ・ディスクロージャー**。
「タスク管理アプリとして入れた人」にも「AIを使い込む人」にも優しく。
Codexは**後付けで足せるレイヤー**として扱い、未使用/未セットアップ時は顔・ポップを汚さない。

> 注: マインドマップのノードの実体は **`tasks`**（project/task ツリー、`source='memo'|'wishlist'` or `hasMemo` が「メモ由来ノード」）。
> relay 設計書(mindmap-node-codex-relay.md)の `ideal_items` 記述は実装上 `tasks` が正。

## 確定した設計判断（壁打ち結果）

| 領域 | 決定 |
|---|---|
| ノードの顔 | `完了チェック ＋ タイトル ＋ Codex状態 ＋ メモサイン ＋ 子件数` のみ。所要時間/優先度/予定日/メタ行/メモバッジ/Codex実行ボタンは**全てポップへ** |
| Codex状態 | 🟡作業中 → 🟢完了 / 🔴失敗 の読み取り専用アイコン。**未使用ノードは表示なし**。承認待ち(🟠)は無し（後述） |
| 入口 | 現「≡」(関連メモ)を **「ノード詳細/メニュー」に格上げ** → 統合ポップ。**Codex状態アイコンタップでCodexセクション直行** |
| Codexモデル | **1ノード＝1継続会話**（resume）。完了で終わり。「新しい会話」切替は無し |
| 実行 | **メニュー（ポップ）から**。メモ由来/単純の**両ノード種**で可。単純ノードは情報不足になりやすいので編集ボックスで肉付けを促す |
| プロンプト再注入 | ポップに**編集ボックス**。ノードから自動生成された文面を**毎回確認・編集して注入**。`↻ノード内容から作り直す`あり |
| 承認 | **無し**。relayは全開・全自動で完走（Codexの好きにやらせる）。ヘッドレスでは承認者が居ないため承認UIは設けない |
| 通知 | **セッション終了時**に **A: Mac通知(FocusMapアイコン) ＋ B: アプリ内(ノード🟢+トースト)**。Web Push は将来 |
| 2つの完了 | `完了チェック`(自分が決めるタスク完了) ⊥ `Codex状態`(作業の進行)。**別軸・非連動** |
| ユーザー層 | 当面=Codex利用者。将来=ワンボタン/コピペのセットアップ簡易化（別タスク）。未セットアップ時は「有効化案内」 |

## ノードの顔（最小）

```
[✓] タイトル      🟡  📝  ⌄3
 │     │           │   │   └ 子件数(折りたたみ)
 │     │           │   └ メモサイン(メモ由来のみ・小)
 │     │           └ Codex状態(未使用なら無し)
 │     └ タイトル
 └ 完了チェック(自分のタスク完了・独立)
```
- メモ由来ノードは従来通り左アンバーバー/縁で区別（サインは最小化）

## 統合ポップ（≡ から / 全画面シート on モバイル）

```
┌ {ノードタイトル} ─────────────────┐
│ ▸ Codex作業                              │  ← Codex使用時 or 「有効化」CTA
│   状態: 🟢完了   作業場所: …/career-site [変更] │
│   ▼ 送るプロンプト（編集可・自動生成）        │
│   [ … 編集ボックス … ] [↻作り直す][注入して実行] │
│   Codexの返信: …（要約/全文トグル）          │
│   ⧉ Codexアプリで開く                      │
│ ▸ メモ（メモ由来ノードのみ）                 │  ← 関連メモ編集（既存onOpenLinkedMemos相当）
│ ▸ 予定 / 優先度 / 所要時間                   │  ← 顔から移設
│ ▸ アクション: 完了 / 削除 / 子追加 …          │
└────────────────────────────┘
```
- **作業場所の[変更]** は実装済みの `CodexDirPicker`（履歴/Finder/手入力）を再利用
- **未セットアップ時**：Codex作業セクションは「AI(Codex)機能を有効にする」案内に置換（壊れ表示にしない）

## 実装対象ファイル（重要）

- [ ] 変更:
  - `src/components/mindmap/custom-mind-map-view.tsx` — 顔の最小化（メタ行/バッジ/Codexボタン撤去）、Codex状態アイコン追加、≡を詳細ポップtrigger化
  - `src/components/dashboard/mind-map.tsx` — 統合ポップの状態/配線、`handleRunCodex`→ポップ内の編集ボックス経由に再設計
  - `scripts/codex-rpc-bridge.ts` / `scripts/task-runner.ts` — 完了通知（terminal-notifier）、`tasks.codex_thread_id/codex_status` 書き戻し
- [ ] 作成:
  - `src/components/codex/codex-node-panel.tsx` — 統合ポップ内の「Codex作業」セクション（状態/場所/編集ボックス/返信/アプリで開く）
  - `src/components/mindmap/node-detail-popup.tsx` — ≡ から開く統合ポップ本体（Codex/メモ/予定/アクションのセクション束ね）
  - `supabase/migrations/XXXX_task_codex_status.sql` — `tasks.codex_thread_id` / `tasks.codex_status` 追加
- [ ] 流用（実装済み）:
  - `src/components/codex/codex-dir-picker.tsx`（作業場所変更）
  - `/api/codex/choose-folder`（Finder）, `/api/ai-tasks/schedule`（投入・resume）

## 実装フェーズ

### Phase 1: 顔の最小化
- [ ] custom-mind-map-view から メタ行/メモバッジ/Codexボタン を撤去
- [ ] Codex状態アイコン（🟡/🟢/🔴・未使用なら無）を顔に追加（`tasks.codex_status` 参照）
- [ ] 移設先（ポップ）が未完なので、まず「≡=詳細ポップ」の器だけ用意

### Phase 2: 統合ポップの器
- [ ] `node-detail-popup.tsx`（全画面シート対応）。≡ で開く。メモ/予定/優先度/時間/アクションを移設
- [ ] Codex状態アイコンタップ → ポップのCodexセクションへスクロール

### Phase 3: Codexセクション（再注入）
- [ ] `codex-node-panel.tsx`：状態・作業場所([変更]=CodexDirPicker)・**プロンプト編集ボックス**・[↻作り直す]・[注入して実行]・返信(要約/全文)・⧉アプリで開く
- [ ] 投入は `/api/ai-tasks/schedule`（resume 継続）。1ノード=1会話（`tasks.codex_thread_id`）
- [ ] 未セットアップ検知 → 「有効化案内」表示

### Phase 4: 通知（A＋B）
- [ ] A: task-runner 完了時に `terminal-notifier -appIcon <FocusMapアイコン>`（無ければ導入手順）
- [ ] B: 完了で `tasks.codex_status='done'` → マップでノード🟢＋アプリ内トースト

### Phase 5: データ/紐付け
- [ ] `tasks.codex_thread_id`（現在の会話）/ `tasks.codex_status`（状態キャッシュ）migration
- [ ] schedule 投入時に source node(task) を紐付け、bridge 完了で codex_status 更新

## 完了条件

- [ ] ノードの顔が「完了+タイトル+Codex状態+メモサイン+子件数」に減っている
- [ ] ≡ で統合ポップが開き、メモ/予定/優先度/Codexが一元表示される
- [ ] Codexセクションで「場所・送った指示(編集可)・返信・状態」が判断できる
- [ ] プロンプトを編集して再注入（resume継続）できる
- [ ] セッション終了で Mac通知(FocusMapアイコン)＋ノード🟢
- [ ] Codex未使用ノードは顔・ポップを汚さない（タスク管理だけの人に優しい）

## メモ

- 承認(🟠)はこの版では無し。将来「on-request＋FocusMap承認」を入れるなら別途（relay設計書 Phase 4 参照）。
- セットアップ簡易化（ワンボタン/コピペ）は別ロードマップ。本UIは「未セットアップに優しい」止まり。
- Web Push は配布拡大時に追加（外出先・OS横断通知）。
