# リリース前構造理解と調査/実装プロンプト設計

- Task ID: TASK-20260617-009
- Status: in_progress
- Created: 2026-06-17
- Board: `docs/ai/task-board.md`
- Mode: `SEQUENTIAL`

## Goal

AIで実装速度が上がるほどUI・設計・リリース範囲が無限に膨らむ問題を防ぐため、現行Focusmapの実装構造を把握し、2週間実装 + 1週間磨き込みに切れる単位を決める。

この親チャットは実装に入らず、構造理解、調査単位、worker用の調査プロンプト/実装プロンプト、統合条件を作る。

## Current Implementation Map

### Product Spine

- `/dashboard` は `src/app/dashboard/page.tsx` が `spaces` / `projects` / `tasks` を初期取得し、`DashboardLoader` 経由で `DashboardClient` に渡す。
- `DashboardClient` が全画面の主要状態を保持する。選択中space/project、active view、マップ同期、Todo/メモ/マップ/チャット/設定、右サイドバー、楽観的タスク反映、Undo/Redoを束ねる。
- モバイル通常導線は `BottomNav` の `Todo` / `メモ` / `マップ` / `チャット` / `設定`。
- デスクトップ通常導線は `Header` のタブと右上操作。`AI実行` はマップ側のCodex取り込みを開き、チャットは `AiView` / `UnifiedChat` へつながる。

### Core Data

- `tasks`: マインドマップ、タスク、予定、完了、所要時間、Codex元ノードの中心。
- `ideal_goals` / `memo_items`: 現行メモ画面の中心。
- `ai_tasks`: AI/Codex実行キューと最終状態。
- `ai_task_activity_messages`: AI/Codexのユーザー可視activity。
- `agent_chat_sessions`: 統合チャットの永続セッション。
- `mindmap_drafts` / `mindmap_draft_nodes` / `mindmap_draft_history`: AI案下書き、確定、Undo/Redo。
- Turso `task_progress` 系: Codex監視の高速snapshot/event/heartbeat。

### High-Risk Large Files

- `src/app/dashboard/dashboard-client.tsx`: view orchestrationと主要状態の結合点。
- `src/components/mindmap/custom-mind-map-view.tsx`: 自作マップ表示、編集、D&D、Codex状態、カレンダーD&Dの結合点。
- `src/components/chat/unified-chat.tsx`: 通常会話、プロジェクトチャット、AI実行ショートカット、履歴、添付、モデルモードの結合点。
- `src/components/codex/codex-node-panel.tsx`: ノード詳細、予定、画像、Codex手動handoff、activity表示の結合点。
- `src/components/dashboard/codex-chat-import-sidebar.tsx`: Codex thread取り込み、repo監視、activity詳細、D&D配置の結合点。
- `src/hooks/useMindMapSync.ts`: DB同期、マップキャッシュ、楽観更新、折りたたみ、削除保留の結合点。
- `scripts/focusmap-agent/src/codex-thread-monitor.ts`: Codex sqlite/rollout/app-server観測とSupabase/Turso反映の結合点。

## Candidate Work Areas

### A. UI Playbook / Design Contract

目的: 「1つ直すたびにUIを改めて考える」状態を止める。

Scope:
- `docs/CONTEXT.md` のUIビジュアル統一を現行実装ベースで具体化する。
- ボタン、シート、右サイドバー、状態バッジ、空状態、チャット入力、マップノード、メモカードの基準をまとめる。
- 既存共通UI `src/components/ui/**` と実画面の逸脱を一覧化する。

実装前の成果物:
- UI acceptance checklist
- 触ってよいUI単位
- 禁止する新規装飾/独自パレット/独自操作

### B. Release Happy Path Audit

目的: リリース時にユーザーが最初に通る導線だけを安定させる。

対象導線:
- ログイン -> dashboard初期表示
- Todo 3daysカレンダー
- メモ追加/編集/Codexに送る
- マップでノード編集/AI案確定
- チャットでプロジェクト相談/マップ整理
- 設定でMac agent/APIキー状態確認

実装前の成果物:
- release-critical flow list
- 各flowの入口ファイル/API/DB
- 壊れても後回しにできるnon-critical導線

### C. Unified Chat Cleanup

目的: `ai` と旧 `automation` の二重配線、古いchat route、残ったmode分岐をリリース前に整理できるか判断する。

既存根拠:
- `ViewContext` は `automation` を保存値から `ai` へ正規化するが、型と `DashboardClient` のrender分岐にはまだ `automation` が残る。
- `docs/plans/active/unified-agent-chat.md` には旧分離撤去が未完として残る。

実装前の成果物:
- 撤去してよい旧route/state
- 撤去できない互換経路
- `UnifiedChat` / `AiView` / `agent_chat_sessions` の正本整理

### D. Codex/Mac Reliability Boundary

目的: Codex連携を増やす前に、writer/read polling/fallbackの境界を確定する。

既存根拠:
- `docs/ai/plans/active/20260607-codex-mac-agent-unification.md` が進行中。
- `CodexNodePanel` にはまだ3秒sync定数があり、UI読み取り専用化の確認対象。
- `focusmap-agent` とTurso/Supabaseの責務分担がリリース品質に直結する。

実装前の成果物:
- UI pollingでDB writeが起きる経路の有無
- `sync-node` fallbackの残し方
- Mac app / agent / Next API / Turso / Supabase の責務境界

### E. External AI API / Settings Review

目的: 外部AIへ渡すAPIキーとプロンプトが、実際にFocusmapを操作できる状態か確認する。

既存根拠:
- `docs/ai/plans/active/20260617-external-ai-action-api.md` が進行中。
- v1 API、scope、設定画面prompt、draft-first方針は実装途中の可能性がある。

実装前の成果物:
- API keyでできる/できない操作表
- promptに入れるべき制約
- release前に必要な最小endpoint

### F. LP / Public Release Surface

目的: プロダクトの実装状態とLPの訴求を矛盾させない。

既存根拠:
- `docs/plans/active/lp-redesign.md` はAIサブスクを動かす司令地図の方向へ更新済み。
- `src/app/page.tsx` と `src/lib/plans.ts` の整合確認が必要。

実装前の成果物:
- リリース時点で言ってよい訴求
- デモ可能な画面
- OAuth開示と料金表の矛盾チェック

## Recommended Order

1. A: UI Playbook / Design Contract
2. B: Release Happy Path Audit
3. C: Unified Chat Cleanup
4. D: Codex/Mac Reliability Boundary
5. E: External AI API / Settings Review
6. F: LP / Public Release Surface

理由:
- UI基準が先にないと、B以降の修正で見た目がさらに分岐する。
- release happy pathを先に固定しないと、Codex/API/LPがそれぞれ別の完成像へ進む。
- C/D/Eは相互依存があるため、Cでチャット入口、Dでローカル実行境界、Eで外部AI操作境界を分ける。
- LPは最後に、実装済みの事実だけで表現する。

## Parallelization

Decision: `SEQUENTIAL`

理由:
- 現時点では調査対象が `DashboardClient`、`UnifiedChat`、`CustomMindMapView`、`CodexNodePanel` など同じ結合点に集中している。
- 実装並列より、まず調査プロンプトを分けて読み取り専用で構造を固める方が安全。
- 実装分割は、A/Bの成果物でUI acceptanceとrelease-critical flowが固定された後に再判断する。

後続で並列化できる候補:
- readonly調査: UI inventory / chat cleanup / Codex reliability / API settings / LP copy consistency
- 実装: allowed filesが分離できた場合のみ、UI cleanup、API review fixes、LP updateを別worktreeへ分ける。

## Research Prompts

### A. UI Playbook調査プロンプト

```md
あなたはFocusmapのUI Playbook調査担当です。書き込みは禁止です。

目的:
AI実装でUIが毎回ぶれないよう、現行FocusmapのUI基準と逸脱を構造化してください。

まず読む:
- AGENTS.md
- docs/CONTEXT.md の UIビジュアル統一 / ダッシュボードナビゲーション
- src/components/ui/**
- src/components/layout/header.tsx
- src/components/mobile/bottom-nav.tsx
- src/components/dashboard/desktop-today-panel.tsx
- src/components/wishlist/wishlist-view.tsx
- src/components/mindmap/custom-mind-map-view.tsx
- src/components/chat/unified-chat.tsx
- src/components/codex/codex-node-panel.tsx

調査すること:
1. 共通化されているUI要素と、画面ごとに独自化しているUI要素を分ける。
2. ボタン、シート、右サイドバー、状態バッジ、カード、空状態、入力欄の現行パターンをまとめる。
3. リリース前に直すべきUIぶれを high/medium/low で出す。
4. 今後AI実装に守らせるUI acceptance checklistを作る。

最後に返すこと:
- confirmed facts
- UI inventory
- drift findings with file references
- recommended UI contract
- implementation split candidates
- open questions
```

### B. Release Happy Path調査プロンプト

```md
あなたはFocusmapのリリース導線調査担当です。書き込みは禁止です。

目的:
2週間で作って1週間で詰める対象を決めるため、リリース時に壊してはいけないhappy pathを抽出してください。

まず読む:
- AGENTS.md
- docs/plans/focusmap-pivot.md
- docs/CONTEXT.md
- src/app/dashboard/page.tsx
- src/app/dashboard/dashboard-client.tsx
- src/components/dashboard/desktop-today-panel.tsx
- src/components/wishlist/wishlist-view.tsx
- src/components/ai/ai-view.tsx
- src/components/ai/mobile-ai-execution-view.tsx
- src/components/mindmap/custom-mind-map-view.tsx
- src/components/chat/unified-chat.tsx
- src/components/settings/settings-overview.tsx

調査すること:
1. ログイン後にユーザーが通る主要導線を5-7個に絞る。
2. 各導線の入口component、主要hook、API、DBテーブルを対応付ける。
3. その導線で未実装/不安定/重複している箇所を出す。
4. 3週間リリースで入れるもの、切るもの、磨くだけのものを分類する。

最後に返すこと:
- release-critical flows
- dependency map
- must-fix before release
- can-defer list
- recommended 2-week build scope and 1-week polish scope
```

### C. Unified Chat Cleanup調査プロンプト

```md
あなたはFocusmapの統合チャット整理調査担当です。書き込みは禁止です。

目的:
通常チャット/自動化チャットの旧分離がどこに残っているか調べ、リリース前に安全に整理できる単位を決めてください。

まず読む:
- docs/plans/active/unified-agent-chat.md
- docs/CONTEXT.md のチャット仕様
- src/contexts/ViewContext.tsx
- src/app/dashboard/dashboard-client.tsx
- src/components/ai/ai-view.tsx
- src/components/ai/mobile-ai-execution-view.tsx
- src/components/chat/unified-chat.tsx
- src/hooks/useAgentChatSessions.ts
- src/lib/ai/agent-chat-background.ts
- src/lib/ai/agent-tools.ts
- src/app/api/ai/agent/runs/route.ts
- src/app/api/ai/agent/sessions/route.ts

調査すること:
1. `automation` view、旧route、旧state、旧UI分岐の残存箇所を一覧化する。
2. 削除してよいもの、互換として残すもの、docs更新が必要なものを分ける。
3. チャットからマップ/メモ/カレンダーへ反映するイベント境界を確認する。
4. 実装タスクをallowed files単位で提案する。

最後に返すこと:
- old/new chat wiring map
- removal candidates
- compatibility risks
- implementation prompt draft
- tests/manual checks to request if user asks for verification
```

### D. Codex/Mac Reliability調査プロンプト

```md
あなたはFocusmapのCodex/Mac連携境界調査担当です。書き込みは禁止です。

目的:
UI polling、local monitor、Turso/Supabase writer、manual handoffが混ざっていないか確認し、リリース前の安定化範囲を決めてください。

まず読む:
- docs/ai/plans/active/20260607-codex-mac-agent-unification.md
- docs/specs/codex-app-handoff-monitoring/03-backyard-sync-and-turso.md
- src/components/codex/codex-node-panel.tsx
- src/components/dashboard/codex-chat-import-sidebar.tsx
- src/hooks/useCodexRunnerStatus.ts
- src/hooks/useTaskProgressSnapshot.ts
- src/app/api/codex/sync-node/route.ts
- src/app/api/task-progress/snapshot/route.ts
- src/app/api/task-progress/runner-heartbeats/route.ts
- scripts/focusmap-agent/src/codex-thread-monitor.ts
- scripts/focusmap-agent/src/heartbeat.ts

調査すること:
1. UI表示がDB writeを誘発する経路が残っているか確認する。
2. `sync-node` の現行用途を通常/手動sync/debug/fallbackへ分類する。
3. SupabaseとTursoに保存する情報の境界がdocsと一致しているか確認する。
4. リリース前にやるべき最小安定化を提案する。

最後に返すこと:
- read/write boundary map
- remaining duplicate writer risks
- fallback policy
- implementation split candidates
- verification commands to run only if user explicitly asks
```

### E. External AI API調査プロンプト

```md
あなたはFocusmap外部AI API/設定画面のレビュー担当です。書き込みは禁止です。

目的:
APIキーとコピー用promptだけで外部AIが安全にFocusmapを操作できるか確認してください。

まず読む:
- docs/ai/plans/active/20260617-external-ai-action-api.md
- docs/CONTEXT.md の外部AI/API関連記述
- src/lib/api-key.ts
- src/lib/api-scopes.ts
- src/components/settings/api-key-settings.tsx
- src/components/settings/api-key-create-dialog.tsx
- src/components/settings/api-key-mcp-guide.tsx
- src/app/api/v1/**/route.ts

調査すること:
1. planに書かれたendpointが実在し、必要scopeと一致しているか確認する。
2. draft-firstが大きなマップ変更の既定になっているか確認する。
3. 設定画面のpromptが実際のendpoint名/制約と一致しているか確認する。
4. リリース前に足りない最小修正を出す。

最後に返すこと:
- endpoint coverage table
- prompt/API mismatch findings
- minimum release fixes
- implementation prompt draft
- risks / unresolved items
```

### F. LP / Public Surface調査プロンプト

```md
あなたはFocusmapの公開LP/リリース表現調査担当です。書き込みは禁止です。

目的:
LP、料金、OAuth開示、プロダクト実装状態が矛盾していないか確認してください。

まず読む:
- docs/plans/active/lp-redesign.md
- docs/CONTEXT.md の公開LP
- src/app/page.tsx
- src/lib/plans.ts
- src/app/privacy/page.tsx
- src/app/terms/page.tsx

調査すること:
1. 旧B2SMB/API再販/seat課金/Enterprise主導線の残存を確認する。
2. 実装済み画面でデモ可能な訴求と、まだ言うべきでない訴求を分ける。
3. Google OAuth開示が残っているか確認する。
4. リリース前LP修正の最小単位を提案する。

最後に返すこと:
- copy/product mismatch findings
- claims safe to make now
- claims to avoid
- minimum LP implementation scope
- implementation prompt draft
```

## Implementation Prompt Template

調査結果が戻った後、各実装workerには次の型で渡す。

```md
あなたは <領域名> 実装チャットです。

目的:
<調査結果で確定した1つの目的だけ>

まず読む:
- AGENTS.md
- docs/CONTEXT.md
- <対象plan>
- <調査結果>

編集してよい範囲:
- <allowed files>

編集してはいけない範囲:
- allowed files以外
- secrets / .env*
- package-lock.json（明示がない限り）
- docs/ai/task-board.md
- docs/ai/task-runs.jsonl
- docs/ai/mistakes.md
- docs/ai/task-router-analysis.md
- docs/ai/task-archive/**
- 本番DB/GCP/GCS操作

実装制約:
- UIはFocusmap UI Playbookに従う。
- 既存データフローを勝手に変えない。
- 仕様変更がある場合は docs/CONTEXT.md の該当セクションも更新する。
- ユーザーが明示していない検証コマンドは実行せず、必要なら完了報告で提案する。

完了条件:
- <acceptance criteria>
- 自分が触ったファイルだけをcommitする。
- pushしない。

最後に返すこと:
- changed files
- implemented behavior
- verification not run / run results
- assumptions
- contract deviations
- integration notes
- risks / unresolved items
- staged / unstaged changes
- commit hash
```

## Integration Conditions

- allowed files外の変更がない。
- `docs/CONTEXT.md` が仕様変更と同期している。
- active plan / boardの状態が現実と一致している。
- old view/routeを削る場合は互換経路が明記されている。
- UI変更はモバイル/デスクトップ両方の導線差分を説明できる。
- 検証コマンドはユーザーが明示した場合だけ実行する。

## Open Questions

- 3週間リリースの対象は「自分用の実運用リリース」か「外部ユーザー向け公開」か。
- 今回はLP/課金/公開導線まで含めるか、まずMac/AI実行ダッシュボードの実運用品質に絞るか。
- 外部AI APIを今回のリリース必須にするか、内部Codex/Mac連携を優先するか。
- 実装workerを別Codexチャット/worktreeへ分けるか、この親チャットで順次進めるか。
