# React Flow → 独自実装 書き換え調査・設計ドキュメント

最終更新: 2026-04-21

## 0. このドキュメントの位置付け

「React Flow から抜けて自前実装に置き換えるべきか」を判断するための材料。実装着手を前提としない調査ドキュメント。結論セクションを読んで判断 → GO なら段階的にブランチを切って進める。

---

## 1. 背景と目的

### なぜ書き換えを検討するのか

- **UI の自由度**: ノード付近の余白・アニメーション・細かなインタラクションを、React Flow の API/CSS に縛られず実装したい
- **カスタマイズ性**: 「ノードが折りたたみ時に不自然に大きく見える」など、レイアウト計算に介入したい時に React Flow 側の制約（内部 state、CSS、計算順）が壁になる
- **依存削減**: `reactflow` は約 120KB gzip。機能が特化しているならフルライブラリは過剰
- **スキル面**: 描画・座標系・イベント処理を自前化することで、マインドマップ系 UI の理解が深まる

### ユーザーヒアリング用セクション（書き換え判断前に埋める）

以下に「具体的にどの機能でReact Flowが足枷か」を記入する。足枷が抽象的なら書き換えは費用対効果が低い可能性大。

| # | 困りごと・実現したいUX | React Flow でできない理由 | 自前化すれば解決する？ |
|---|---|---|---|
| 1 | （例: ノード間エッジをアニメーション伸縮させたい） | （例: Edge コンポーネントは再レンダリングが粗い） | （例: Yes、SVG を直接制御すれば） |
| 2 |   |   |   |
| 3 |   |   |   |

**判定基準**: 3件以上の具体要件が出て、そのうち2件以上が「自前化すれば明確に解決」なら書き換えの検討価値あり。

---

## 2. 現状の React Flow 依存機能リスト

### 2.1 使用ファイル

| ファイル | 用途 |
|---|---|
| [src/components/dashboard/mind-map.tsx](../../src/components/dashboard/mind-map.tsx) | メイン実装（約3100行） |
| [src/components/mindmap/branch-edge.tsx](../../src/components/mindmap/branch-edge.tsx) | カスタムエッジ（L字型 SVG、自前実装済） |
| [src/lib/mindmap-layout.ts](../../src/lib/mindmap-layout.ts) | dagre によるレイアウト計算 |
| [src/components/mobile/mobile-mind-map.tsx](../../src/components/mobile/mobile-mind-map.tsx) | モバイル版（React Flow 依存） |

### 2.2 使用 API 一覧（mind-map.tsx）

| カテゴリ | API |
|---|---|
| Provider | `ReactFlowProvider` |
| Container | `<ReactFlow>`, `<Controls>`, `<Background>` |
| Hooks | `useReactFlow()` (`getZoom`, `zoomTo`, `getNodes`) |
| Node 管理 | `Node`, `applyNodeChanges`, `NodeChange` |
| Edge 管理 | `Edge`, `EdgeProps`, `BaseEdge` |
| イベント | `onNodesChange`, `onNodeClick`, `onNodeDragStart/Drag/Stop`, `onSelectionDragStart/Drag/Stop`, `onSelectionChange`, `onPaneClick`, `onWheel` |
| カスタム要素 | `NodeProps<T>`, `Handle`, `Position` |
| 操作設定 | `selectionMode={SelectionMode.Partial}`, `panOnDrag=[1,2]`, `selectNodesOnDrag`, `fitView`, `fitViewOptions`, `minZoom`, `maxZoom`, `deleteKeyCode={null}`, `multiSelectionKeyCode="Shift"` |

---

## 3. 書き換えで再実装が必要な機能（優先度順）

| # | 機能 | 再利用可能な既存資産 | 新規実装量 |
|---|---|---|---|
| 1 | SVG/DOM 描画層（ノード＋エッジ） | `BranchEdge` SVG 流用、TaskNode は React コンポーネント流用 | 中 |
| 2 | ビューポート（pan/zoom/fitView） | なし | 大 |
| 3 | ノード選択・矩形選択・複数選択 | 選択状態管理ロジックの一部 | 中 |
| 4 | ドラッグ（移動・多選択同時・親子変更 reparent） | ドロップ判定ロジック（distance-based） | 大 |
| 5 | キーボードナビゲーション | TaskNode 内に実装済 | 小（統合のみ） |
| 6 | HTML5 Drag API 統合（カレンダードロップ） | 既存 `handleDragStart`/`handleDragEnd` 流用 | 小 |
| 7 | IME / composition event | TaskNode 内で対応済 | なし |
| 8 | パフォーマンス（React.memo, useMemo） | そのまま流用 | なし |
| 9 | 仮想化（大規模グラフ） | 現状未対応、書き換え後も後回し可 | - |

---

## 4. 書き換えアプローチ（3案）

### 案1: 段階的置換（推奨）

React Flow を維持しつつ、内部から徐々に自前化する。

- **Phase A**: 背景グリッド・エッジ描画を完全自前化（`BranchEdge` は既に SVG 自作なので流用容易）
- **Phase B**: viewport（pan/zoom/fitView）を自前化。matrix transform による座標変換を書く
- **Phase C**: ノード選択・矩形選択・ドラッグを自前化
- **Phase D**: `ReactFlow` コンポーネント依存を削除、自前 `<Canvas>` コンポーネントに差し替え

**工数**: 各 Phase 3〜5 日 × 4 = **12〜20 日**
**リスク**: 中。各 Phase で動作確認でき、問題があれば退避可能。

### 案2: 一気に置換

`mind-map-v2.tsx` を並行実装し、動作同等になったら切替。

**工数**: **3〜4 週間**
**リスク**: 高。既存機能の見落としや UX 退行の危険。

### 案3: React Flow を維持してカスタマイズを極める

- `reactflow` v11 → v12 更新（型変更あり、要対応 1〜2 日）
- CSS 変数・カスタムノード・カスタムエッジの書き込みで多くの要求は解決可
- 一部、React Flow の内部仕様に踏み込む必要はある

**工数**: **2〜5 日**
**リスク**: 低。ただし「もっと自由度が欲しい」要求には答えきれない可能性あり。

---

## 5. メリット・デメリット評価

| 観点 | React Flow 維持 | 独自実装 |
|------|---|---|
| 開発速度（短期） | ◎ すぐ作れる | △ 基盤構築に時間 |
| 自由度 | △ API制約あり | ◎ 任意のUX実装可 |
| パフォーマンス | ○ 数百ノードは問題なし | ◎ 必要最低限に最適化可 |
| バンドルサイズ | △ reactflow 約120KB gzip | ◎ 削減可（-100KB 程度期待） |
| 保守性 | ○ 公式メンテナンス | △ 自前メンテ必要 |
| バグ対応 | △ upstream 依存 | ◎ 自分で直せる |
| スキルアップ | - | ◎ 描画・座標系の理解深まる |
| AI 実装との相性 | ○ ライブラリ仕様を理解させる必要 | ◎ 自前コードなので AI が全体把握しやすい |

---

## 6. リスクと注意点

### 6.1 見えない依存

- `reactflow/dist/style.css` に含まれる微細なスタイリング（カーソル、ハンドル、ドロップシャドウ、パネルの枠線等）を全て再現する必要がある
- モバイルタッチイベント（pinch zoom, two-finger pan）が暗黙的に扱われている

### 6.2 複雑なイベントの共存

- `panOnDrag=[1,2]` + `selectionOnDrag` + ノード個別ドラッグ の3モード共存はライブラリ側で巧妙に制御されている。自前化するとエッジケースで挙動破綻しがち

### 6.3 モバイル版との整合性

- [src/components/mobile/mobile-mind-map.tsx](../../src/components/mobile/mobile-mind-map.tsx) も React Flow 依存
- 両方書き換えるか、片方だけ書き換えるかを先に決めるべき
- モバイル版は縦スクロール列型UIなので、そもそもデスクトップ版とはレンダリング要件が違う。書き換えスコープから外す選択肢あり

### 6.4 applyNodeChanges の置き換え

- ドラッグ中の座標更新、多選択ドラッグ、fitView など、`applyNodeChanges` が担ってくれている変更マージロジックを自前で書く必要がある
- 特に fitView は全ノードの bounding box 計算 + 適切な zoom/translate 算出が必要

### 6.5 テスト不足のリスク

- 現状、マインドマップの E2E テストは限定的（Playwright スクリプトで目視確認のみ）
- 書き換え時は退行検出が困難。Playwright による自動回帰テストを**書き換え前に整備**しないと危険

---

## 7. 推奨結論

### 短期（今すぐやるべきこと）

**案3（React Flow 維持）** を採用。並行して以下を進める:
1. 「ヒアリング用セクション」（本ドキュメント §1）を埋める
2. 具体的な不満点が 3 件以上、かつ 2 件以上が「自前化で明確解決」になったら案1へ移行判断
3. Playwright による E2E 回帰テストを書いておく（書き換え時の安全網）

### 中期（判断後）

- GO なら **案1（段階的置換）** で Phase A から着手
- プロトタイプとして `src/components/mindmap/custom-viewport.tsx` を試作（pan/zoom のみ、1〜2 日）
- プロトが問題なく動けば Phase B → C → D へ進行

### NO GO の場合

- React Flow v12 への更新を検討（TypeScript 型が刷新されてより柔軟）
- CSS 変数 + カスタムノード/エッジで細かな UX 改善を積み重ねる

---

## 8. 次アクション

| 優先 | アクション | 担当 | 完了条件 |
|---|---|---|---|
| 高 | §1 ヒアリングテーブルを埋める | ユーザー | 3件以上の具体要件 |
| 高 | 書き換え GO/NO GO 判断 | ユーザー + AI | 判定基準クリアorクリアせず |
| 中 | Playwright E2E 回帰テスト整備 | AI | ノード作成・ドラッグ・折りたたみの自動テスト |
| 低 | `custom-viewport.tsx` プロトタイプ試作（GO 時） | AI | pan/zoom が React Flow 相当動作 |

---

## 9. 参考情報

### 9.1 主要依存ライブラリのバージョン

- `reactflow`: v11.11.4（最新は v12 系）
- `dagre`: v0.8.5
- `@xyflow/react`: 未使用（v12 以降の新しい名前空間）

### 9.2 関連調査ログ

- 2026-04-21: 本ドキュメント初版作成。ノード空間肥大問題（dagre nodesep）の修正と同時に調査開始
- 修正PR: nodesep 固定化 + 空タスク自動削除 + collapsed状態localStorage永続化
