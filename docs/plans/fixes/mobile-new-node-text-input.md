---
fix: mobile-new-node-text-input
type: fix
created: 2026-02-18
status: in_progress
---

# 修正計画: モバイル新規ノード追加時のテキスト入力

## エラー内容
- 新規ノード追加時にキーボードが閉じる
- テキストカーソルが点滅せず、テキストを入力できない

## 原因分析
- iOS Safari は `.focus()` をユーザージェスチャーのコールスタック外から呼ぶとキーボードを開かない
- 現在: bridge.focus(gesture内) → createTask(async) → bridge.blur + input.focus(setInterval内) → ジェスチャー外
- bridge.blur() でキーボードが閉じ、input.focus() では再度開けない

## 修正方針
テキストプロキシパターン:
1. bridge input をフォーカスしたまま（キーボード維持、ジェスチャー内）
2. bridge の onChange で入力テキストを取得
3. 新ノードに proxyText として表示（偽カーソル付き）
4. Enter/blur で保存して proxy 終了

## 修正対象ファイル
- src/components/mobile/mobile-mind-map.tsx
