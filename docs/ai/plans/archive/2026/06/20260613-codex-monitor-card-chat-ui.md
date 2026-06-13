# Codex監視カードとチャット導線の視覚統一

- Task ID: TASK-20260613-002
- Status: completed
- Created: 2026-06-13
- Completed: 2026-06-13
- Board: `docs/ai/task-board.md`

## Goal

スマホ/PCのCodex監視一覧と取り込み一覧を、マインドマップ上のCodex状態表現と同じ色味・実行中アニメーションに揃える。thread IDは表示せず、必要な場合はCodexチャットへ移動するボタンとして出す。スマホでもCodexチャット詳細を全画面で見られるようにする。

## Scope

- `src/components/task-progress/task-progress-kanban.tsx`
- `src/components/task-progress/task-progress-detail-panel.tsx`
- `src/components/dashboard/codex-chat-import-sidebar.tsx`
- `src/components/mobile/mobile-mind-map.tsx`
- `src/app/globals.css`
- `docs/CONTEXT.md`

## Non-goals

- Codex.app側のthread URL仕様やMac agent同期方式の変更
- DBマイグレーション
- チャット/エージェント実行ロジックの変更

## Plan

1. 監視カードに状態別の枠線・背景・左アクセントを付け、runningではマップと同じオービット風アニメーションを表示する。
2. デスクトップ/スマホの取り込みカードからthread IDチップを外し、threadがある場合は `Codexチャット` ボタンにする。
3. スマホのCodex詳細パネルを全画面シートにし、取り込みカードから同じ詳細パネルを開けるようにする。
4. 仕様メモとテストを更新し、lint/typecheck/対象テストを実行する。

## Parallelization

SINGLE_CHAT。Codex監視UI、取り込みカード、詳細パネル、モバイルマップ連携が同じ状態表示契約を共有しているため、単一チャットでまとめて実装する。

## Verification

- `npm run test:run -- src/components/task-progress/task-progress-kanban.test.tsx src/components/dashboard/codex-chat-import-sidebar.test.tsx`
- `npx eslint src/components/task-progress/task-progress-kanban.tsx src/components/task-progress/task-progress-detail-panel.tsx src/components/dashboard/codex-chat-import-sidebar.tsx src/components/mobile/mobile-mind-map.tsx src/components/dashboard/mind-map.tsx src/components/today/ai-execution-timeline.tsx src/lib/task-progress-ui.ts src/components/task-progress/task-progress-kanban.test.tsx src/components/dashboard/codex-chat-import-sidebar.test.tsx`
- `npx tsc --noEmit --pretty false`
- `git diff --check`
- Playwright CLI desktop: `/dashboard` マップでCodex看板とチャット取り込みサイドバーを表示、console error 0
- Playwright CLI mobile 390x844: モバイルマップからCodexシートを開き、取り込み/看板タブ・Mac online・リポ監視・空状態を確認、console error 0

## Result

Codex看板カード、デスクトップのチャット取り込み行、スマホ取り込みカードを共通の状態色とrunning orbitへ揃えた。thread IDはカード上に表示せず、threadがある場合は `Codexチャット` ボタンから `codex://threads/<thread id>` を開く。スマホ取り込みカードは `チャットを見る` でprogress詳細drawerを全画面表示し、詳細panel/drawerとAI実行タイムラインにも同じCodexチャット導線を追加した。

## Links

- `docs/CONTEXT.md`
