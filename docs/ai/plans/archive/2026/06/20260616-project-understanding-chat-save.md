# プロジェクト理解チャットと保存候補UI

- Task ID: TASK-20260616-006
- Status: completed
- Created: 2026-06-16
- Completed: 2026-06-17
- Board: `docs/ai/task-board.md`

## Goal

プロジェクトチャットで、マインドマップを「プロジェクト理解の構造」として深め、その理解から作業へ紐づけられる会話入口を追加する。会話中にAIが保存候補をまとめ、ユーザーがボタンで承認した時だけプロジェクト概要・蓄積コンテキストへ保存できるようにする。

## Scope

- `UnifiedChat` の空状態に「プロジェクトについて話す」入口と `じっくり話す` / `軽くアイデア出し` の2モードを追加
- agent system prompt に、親ノードは理解構造、子/葉ノードは作業候補として扱う運用を追加
- 保存候補を作るAI toolと、assistant message metadataへの捕捉
- 保存候補の `保存` / `しない` UI と、保存API
- `docs/CONTEXT.md` の現行仕様更新

## Non-goals

- 新しいDBテーブル追加
- Codexローカル `SKILL.md` をWebアプリ内で直接読み込む実行基盤
- マップ全体の描画/データモデル大改修
- 自動検証コマンド実行

## Plan

1. 既存 `project_contexts` を「箱」として使い、安定概要・背景/判断基準・現在地を保存する。
2. `prepareProjectContextSaveProposal` tool を追加し、AIが保存候補を作れるようにする。
3. `/api/ai/agent/runs` で保存候補tool outputをassistant metadataへ付与する。
4. `UnifiedChat` で保存候補カードと `保存` / `しない` ボタンを表示する。
5. `保存` ボタンは専用APIで `projects.description` / `project_contexts` を更新する。
6. プロジェクト会話スターターは、じっくりモードをgrill-me風、軽いモードを発散/候補出しとして明示する。

## Parallelization

SEQUENTIAL。UI、AI tool、run metadata、保存API、system promptが同じ保存候補payloadを共有するため、分割せず直列で実装する。

## Verification

ユーザー明示がないため自動検証コマンドは実行しない。差分確認のみ行う。

## Result

- プロジェクトチャット空状態に `プロジェクトについて話す` 入口を追加し、`じっくり話す` / `軽くアイデア出し` を選べるようにした。
- agent promptに、親/上位ノードは理解構造、子/葉ノードは作業候補として読むルールを追加した。
- `prepareProjectContextSaveProposal` toolを追加し、AIがDBへ即保存せず保存候補を作れるようにした。
- `/api/ai/agent/runs` が保存候補tool outputをassistant message metadataへ保存し、`UnifiedChat` が `保存` / `しない` ボタン付きカードを出すようにした。
- `保存` ボタン用に `/api/projects/[id]/context/proposal/apply` を追加し、承認後だけ `projects.description` と `project_contexts` を更新するようにした。
