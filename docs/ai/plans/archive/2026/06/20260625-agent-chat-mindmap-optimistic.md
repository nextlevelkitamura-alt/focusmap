# チャット経由マップ変更の即時反映

- Task ID: TASK-20260625-001
- Status: completed
- Created: 2026-06-25
- Completed: 2026-06-25
- Board: `docs/ai/task-board.md`

## Goal

チャット経由のマップ変更を、DB保存完了後の再取得だけでなく、tool結果に含まれるtask情報で先に表示中マップへ反映する。

## Scope

- `src/app/api/ai/agent/runs/route.ts`
- `src/lib/ai/agent-chat-progress.ts`
- `src/hooks/useAgentChatSessions.ts`
- `src/app/dashboard/dashboard-client.tsx`
- `src/lib/ai/tools/index.ts`
- `docs/CONTEXT.md`

## Non-goals

- DB migration、認証、課金、外部送信、deployは扱わない。
- チャット実行前に未保存の仮ノードを作るところまではやらない。
- 別projectの即時描画はproject切替後の再取得へ寄せる。

## Plan

1. マップ変更toolの成功結果に、変化したtask本体を返す。
2. agent runのprogress metadataへ、マップ変更payloadを小さく載せる。
3. `useAgentChatSessions` がpayloadを `MINDMAP_DATA_CHANGED_EVENT.detail` へ渡す。
4. dashboard側は表示中projectなら `upsertTaskFromServer` で先に描画し、その後silent refreshする。
5. 仕様を `docs/CONTEXT.md` に残す。

## Parallelization

SINGLE_CHAT。Agent chat progress、dashboard、mindmap syncが同じ契約でつながるため、分割するとpayload形状のズレが出やすい。

## Verification

AGENTS.mdの自動検証ポリシーに従い、ユーザー明示がないため test/lint/build/browser は実行しない。差分確認とgit状態確認のみ行う。

## Result

`addTask` / `addMindmapGroup` / `addMindmapTask` / `updateMindmapNode` / `moveMindmapNode` の成功progressへ、マップ描画用に丸めた `mindmapMutation` を保存し、`MINDMAP_DATA_CHANGED_EVENT.detail.mutations` としてブラウザへ渡すようにした。表示中projectに該当するtaskは `upsertTaskFromServer` で先にローカル反映し、その後silent refreshでDB正本へ収束する。

検証はAGENTS.mdに従い未実行。差分確認とgit状態確認のみ。

## Links

- `docs/CONTEXT.md`
