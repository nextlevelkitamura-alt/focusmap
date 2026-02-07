# NOW: カレンダー リファクタリング → Gemini 引き継ぎ

## Phase 1: リファクタリング (Claude) ✅

- [x] Step 1: 共通定数ファイル `src/lib/calendar-constants.ts` を作成
- [x] Step 2: 共通フック `src/hooks/useCalendarDragDrop.ts` + `src/hooks/useScrollSync.ts` を作成
- [x] Step 3: Day/Week/Month ビューをリファクタ（共通フック・定数を使用）
- [x] Step 4: RightSidebar から AI Advisor ダミーを分離（削除）
- [x] Step 5: MiniCalendar のグローバルCSS → Tailwind `[&_]` セレクタに修正
- [x] Step 6: ビルド通過確認 ✅

## Phase 2: Gemini 引き継ぎドキュメント作成 ✅

- [x] Step 7: `docs/specs/calendar-ui-redesign.md` を作成

---

**最終更新:** 2026-02-07
**ステータス:** 完了。Gemini Pro への引き継ぎ準備完了。
