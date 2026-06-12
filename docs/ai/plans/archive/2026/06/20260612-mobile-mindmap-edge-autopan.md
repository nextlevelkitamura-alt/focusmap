# スマホマップD&D端自動パン

- Task ID: TASK-20260612-006
- Status: completed
- Created: 2026-06-12
- Completed: 2026-06-12
- Board: `docs/ai/task-board.md`

## Goal

スマホのマインドマップでノードをドラッグしたまま画面端へ近づけると、その方向へマップ表示を自動移動させる。あわせて、スマホのノードD&D開始を長押し依存から改善し、移動操作として反応しやすくする。

## Scope

- `src/components/mindmap/custom-mind-map-view.tsx`
- `src/components/mindmap/custom-mind-map-view.test.tsx`
- `docs/CONTEXT.md`

## Non-goals

- React Flow版の置換
- DBスキーマ変更
- カレンダーD&D仕様変更
- Codex取り込みシートのUI変更

## Plan

1. 既存のPointerベースD&Dを保ったまま、スマホのタッチ開始をノードD&D優先にする。
2. ドラッグ中にviewport端のホットゾーンを検出し、requestAnimationFrameでpanOffsetを継続更新する。
3. 自動パン中もドラッグ中ノードの画面上位置が指に追従し続けるよう、pan差分をdrag deltaへ反映する。
4. 実ドラッグ後のclick編集を抑止し、通常タップ編集は維持する。
5. テストと `docs/CONTEXT.md` を更新する。

## Parallelization

SINGLE_CHAT。対象が共通マップコンポーネント1箇所とテスト/仕様メモに閉じ、編集範囲を分けるとD&D状態管理の整合確認コストが上がるため。

## Verification

- `npm test -- --run src/components/mindmap/custom-mind-map-view.test.tsx` は開始時点の今回差分のみでは64件通過。後続の別作業差分でCodex runner guardが混ざった後は、既存Codex取り込みトグルテスト1件が別理由で失敗。
- `npm test -- --run src/components/mindmap/custom-mind-map-view.test.tsx -t "mobile task dragging|auto-pans the mobile viewport|click after a touch drag"`
- `npm run lint -- src/components/mindmap/custom-mind-map-view.tsx src/components/mindmap/custom-mind-map-view.test.tsx`
- `npx tsc --noEmit --pretty false`
- Browser `http://127.0.0.1:3001/dashboard` at 390x800: authenticated dashboard loaded, custom map viewport/stage present, nodeCount 3, console error 0.

## Result

スマホ自作マップのノードD&Dを長押し待ちではなくタッチ移動で開始できるようにし、ドラッグ中に指が画面端へ入ると可視viewport端基準でマップを自動パンするようにした。マップviewport DOMがスマホ画面より横に広い場合でも、`window.visualViewport` / `innerWidth` との交差を使って実画面端で判定する。自動パン中も最後のタッチ座標からdrag deltaとdrop対象を更新し、ドラッグ直後のclickではモバイル編集シートを開かない。
