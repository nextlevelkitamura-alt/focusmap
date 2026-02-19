# 🗺️ mind-map.tsx リファクタリング計画

**ファイル**: `src/components/dashboard/mind-map.tsx`
**現在の規模**: 2,328行 (⚠️ 危機的に大きい)
**目標**: 10ファイルに分割 + 各ファイル <300行

---

## I. 現在の問題分析

### A. 責務の混在

```
mind-map.tsx (2,328行)
├── 1. UI レンダリング (ReactFlow基本)
├── 2. ノード定義 (ProjectNode, TaskNode)
├── 3. エッジ定義 (接続線)
├── 4. ドラッグ&ドロップロジック
├── 5. キーボード操作ハンドリング
├── 6. レイアウト計算 (Dagre)
├── 7. データ同期ロジック (useMindMapSync)
├── 8. UI状態管理 (expandedNodes等)
├── 9. スタイル・theme処理
└── 10. イベントハンドリング
```

### B. 影響を受ける側面

| 側面 | 影響 | 具体的な問題 |
|------|------|-----------|
| テスト | 🔴 不可能 | 2,328行全体をテストする必要 |
| 保守性 | 🔴 低い | バグ修正が他の部分に波及 |
| 新機能追加 | 🔴 困難 | どこに追加すべきか不明確 |
| コードレビュー | 🔴 苦しい | レビューに数時間必要 |
| パフォーマンス | 🟡 不明 | 最適化ポイントが不明 |

---

## II. 分割戦略

### 目標構成

```
src/components/dashboard/mindmap/
├── MindMap.tsx (200行)           ← メインコンポーネント
├── nodes/
│   ├── ProjectNode.tsx (150行)
│   ├── TaskNode.tsx (200行)
│   └── nodeTypes.ts (50行)        ← nodeTypes定義
├── edges/
│   ├── edgeTypes.ts (80行)
│   └── edgeStyles.ts (60行)
├── hooks/
│   ├── useMindMapLayout.ts (150行) ← Dagre layout
│   ├── useMindMapDragDrop.ts (180行) ← D&D処理
│   ├── useMindMapKeyboard.ts (120行) ← キーボード
│   └── useMindMapState.ts (150行) ← UI状態管理
├── utils/
│   ├── layoutCalculation.ts (200行) ← Dagre計算
│   ├── nodeHelpers.ts (150行)    ← ノード操作補助
│   └── styleHelpers.ts (100行)    ← スタイル生成
└── types.ts (80行)               ← ローカル型定義
```

**合計**: 11ファイル, 約1,700行（当初の 73% カット）

---

## III. ファイル別詳細設計

### 1. MindMap.tsx (200行)

```typescript
import React, { useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
} from 'reactflow';
import { useProject } from '@/hooks/useMindMapSync';
import { useMindMapLayout } from './hooks/useMindMapLayout';
import { useMindMapDragDrop } from './hooks/useMindMapDragDrop';
import { useMindMapKeyboard } from './hooks/useMindMapKeyboard';
import { useMindMapState } from './hooks/useMindMapState';
import { nodeTypes } from './nodes/nodeTypes';
import { edgeTypes } from './edges/edgeTypes';

export function MindMap({
  projectId,
  selectedTaskId,
  onTaskSelect,
}: MindMapProps) {
  // データ取得
  const { project, tasks } = useProject(projectId);

  // Hooks
  const { nodes, edges } = useMindMapLayout(tasks);
  const { onNodeDragStop } = useMindMapDragDrop(projectId);
  const { onKeyDown } = useMindMapKeyboard(selectedTaskId);
  const { expandedNodes, toggleNode } = useMindMapState();

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodeDragStop={onNodeDragStop}
      onKeyDown={onKeyDown}
      // ...その他の props
    >
      <Background />
      <Controls />
      <MiniMap />
    </ReactFlow>
  );
}
```

**責務**: マウントと合成のみ

---

### 2. nodes/ProjectNode.tsx (150行)

```typescript
import React from 'react';
import { Handle, Position } from 'reactflow';
import { TaskNode as TaskType } from '@/types/database';

export function ProjectNode({ data }: { data: TaskType }) {
  return (
    <div className="px-3 py-2 bg-blue-100 rounded-lg border">
      <Handle type="target" position={Position.Top} />
      <div className="font-semibold">{data.title}</div>
      <div className="text-xs text-gray-600">
        {data.children?.length || 0} tasks
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
```

---

### 3. nodes/TaskNode.tsx (200行)

```typescript
import React, { useState } from 'react';
import { Handle, Position } from 'reactflow';
import { TaskNode as TaskType } from '@/types/database';
import { getTaskColor, getPriorityBadge } from '../utils/styleHelpers';

export function TaskNode({
  data,
  selected,
  onSelect,
}: {
  data: TaskType;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      className={`px-3 py-2 rounded-lg border ${
        selected ? 'ring-2 ring-blue-500' : ''
      }`}
      style={{ backgroundColor: getTaskColor(data.priority) }}
      onClick={() => onSelect(data.id)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <Handle type="target" position={Position.Top} />
      <div className="font-medium text-sm">{data.title}</div>

      {/* 優先度バッジ */}
      {getPriorityBadge(data.priority)}

      {/* 進捗 */}
      {data.completed && <span className="text-green-600">✓</span>}

      {isHovered && (
        <div className="text-xs text-gray-600 mt-1">
          {data.estimated_time}分
        </div>
      )}

      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
```

---

### 4. hooks/useMindMapLayout.ts (150行)

```typescript
import { useMemo } from 'react';
import { Node, Edge } from 'reactflow';
import dagre from 'dagre';
import { Task } from '@/types/database';
import {
  createTaskNodes,
  createTaskEdges,
} from '../utils/layoutCalculation';

export function useMindMapLayout(tasks: Task[]) {
  return useMemo(() => {
    if (!tasks || tasks.length === 0) {
      return { nodes: [], edges: [] };
    }

    // ノード・エッジ作成
    let nodes = createTaskNodes(tasks);
    let edges = createTaskEdges(tasks);

    // Dagre レイアウト計算
    const dagreGraph = new dagre.graphlib.Graph();
    dagreGraph.setDefaultEdgeLabel(() => ({}));

    nodes.forEach((node) => {
      dagreGraph.setNode(node.id, { width: 200, height: 100 });
    });

    edges.forEach((edge) => {
      dagreGraph.setEdge(edge.source, edge.target);
    });

    dagre.layout(dagreGraph);

    // 計算結果を反映
    nodes = nodes.map((node) => {
      const dagreNode = dagreGraph.node(node.id);
      return {
        ...node,
        position: { x: dagreNode.x - 100, y: dagreNode.y - 50 },
      };
    });

    return { nodes, edges };
  }, [tasks]);
}
```

---

### 5. hooks/useMindMapDragDrop.ts (180行)

```typescript
import { useCallback } from 'react';
import { NodeDragStopEvent } from 'reactflow';
import { useMindMapSync } from '@/hooks/useMindMapSync';
import { calculateNewParent } from '../utils/nodeHelpers';

export function useMindMapDragDrop(projectId: string) {
  const { updateTaskPosition } = useMindMapSync();

  const onNodeDragStop = useCallback(
    async (event: NodeDragStopEvent) => {
      const { node } = event;
      const newParentId = calculateNewParent(node, event);

      if (newParentId) {
        await updateTaskPosition(node.id, newParentId);
      }
    },
    [projectId, updateTaskPosition]
  );

  return { onNodeDragStop };
}
```

---

### 6. hooks/useMindMapKeyboard.ts (120行)

```typescript
import { useCallback } from 'react';
import { useMindMapSync } from '@/hooks/useMindMapSync';

export function useMindMapKeyboard(selectedTaskId?: string) {
  const { createTask, deleteTask } = useMindMapSync();

  const onKeyDown = useCallback(
    async (event: React.KeyboardEvent) => {
      if (!selectedTaskId) return;

      switch (event.key) {
        case 'Enter':
          event.preventDefault();
          await createTask({
            parent_task_id: selectedTaskId,
          });
          break;

        case 'Delete':
          event.preventDefault();
          await deleteTask(selectedTaskId);
          break;

        case 'Escape':
          // デセレクト処理
          break;
      }
    },
    [selectedTaskId, createTask, deleteTask]
  );

  return { onKeyDown };
}
```

---

### 7. hooks/useMindMapState.ts (150行)

```typescript
import { useState, useCallback } from 'react';

interface MindMapStateProps {
  expandedNodes: Set<string>;
  selectedNodeId?: string;
  draggedNodeId?: string;
  contextMenu?: { x: number; y: number; nodeId: string };
}

export function useMindMapState() {
  const [state, setState] = useState<MindMapStateProps>({
    expandedNodes: new Set(),
  });

  const toggleNode = useCallback((nodeId: string) => {
    setState((prev) => {
      const newExpanded = new Set(prev.expandedNodes);
      if (newExpanded.has(nodeId)) {
        newExpanded.delete(nodeId);
      } else {
        newExpanded.add(nodeId);
      }
      return { ...prev, expandedNodes: newExpanded };
    });
  }, []);

  const selectNode = useCallback((nodeId: string) => {
    setState((prev) => ({ ...prev, selectedNodeId: nodeId }));
  }, []);

  return { ...state, toggleNode, selectNode };
}
```

---

### 8. utils/layoutCalculation.ts (200行)

```typescript
import { Node, Edge } from 'reactflow';
import { Task } from '@/types/database';
import { getTaskColor } from './styleHelpers';

export function createTaskNodes(tasks: Task[]): Node[] {
  return tasks.map((task) => ({
    id: task.id,
    data: {
      label: task.title,
      priority: task.priority,
      completed: task.completed,
      estimated_time: task.estimated_time,
    },
    position: { x: 0, y: 0 },
    nodeType: task.parent_task_id ? 'task' : 'project',
    style: {
      background: getTaskColor(task.priority),
      border: task.completed ? '2px solid green' : '1px solid #ccc',
    },
  }));
}

export function createTaskEdges(tasks: Task[]): Edge[] {
  return tasks
    .filter((task) => task.parent_task_id)
    .map((task) => ({
      id: `edge-${task.parent_task_id}-${task.id}`,
      source: task.parent_task_id!,
      target: task.id,
      type: 'smoothstep',
    }));
}
```

---

### 9. utils/nodeHelpers.ts (150行)

```typescript
import { Node, NodeDragStopEvent } from 'reactflow';

export function calculateNewParent(
  node: Node,
  event: NodeDragStopEvent
): string | null {
  // ドラッグ後の位置からターゲットノードを検出
  const { position } = node;

  // 近くのノードを検索
  const nearbyNodes = event.nodes.filter((n) => {
    if (n.id === node.id) return false;

    const distance = Math.hypot(
      n.position.x - position.x,
      n.position.y - position.y
    );

    return distance < 200; // 200px以内
  });

  // 最も近いノードをターゲット（親）に設定
  if (nearbyNodes.length > 0) {
    nearbyNodes.sort((a, b) => {
      const distA = Math.hypot(
        a.position.x - position.x,
        a.position.y - position.y
      );
      const distB = Math.hypot(
        b.position.x - position.x,
        b.position.y - position.y
      );
      return distA - distB;
    });

    return nearbyNodes[0].id;
  }

  return null;
}

export function findNodePath(nodeId: string, nodes: Node[]): Node[] {
  // nodeIdから root までのパスを返す
  const path: Node[] = [];

  // 実装...

  return path;
}
```

---

### 10. utils/styleHelpers.ts (100行)

```typescript
import { Priority } from '@/types/database';

const PRIORITY_COLORS: Record<Priority, string> = {
  high: '#fee2e2',
  medium: '#fef3c7',
  low: '#dcfce7',
};

export function getTaskColor(priority?: Priority): string {
  if (!priority) return '#f3f4f6';
  return PRIORITY_COLORS[priority];
}

export function getPriorityBadge(priority?: Priority) {
  if (!priority) return null;

  const badges = {
    high: <span className="text-red-600 font-bold">🔴</span>,
    medium: <span className="text-yellow-600 font-bold">🟡</span>,
    low: <span className="text-green-600 font-bold">🟢</span>,
  };

  return badges[priority];
}

export function getEdgeColor(isActive: boolean): string {
  return isActive ? '#3b82f6' : '#d1d5db';
}

export function getNodeClassName(selected: boolean, priority?: Priority) {
  return `node-${priority} ${selected ? 'selected' : ''}`;
}
```

---

### 11. types.ts (80行)

```typescript
import { Task } from '@/types/database';

export interface MindMapProps {
  projectId: string;
  selectedTaskId?: string;
  onTaskSelect?: (taskId: string) => void;
  onTaskCreate?: (task: Partial<Task>) => void;
  onTaskDelete?: (taskId: string) => void;
  onTaskUpdate?: (taskId: string, updates: Partial<Task>) => void;
}

export interface TaskNodeData extends Task {
  isExpanded?: boolean;
  isSelected?: boolean;
}

export interface MindMapState {
  expandedNodes: Set<string>;
  selectedNodeId?: string;
  draggedNodeId?: string;
  contextMenuNode?: { x: number; y: number; nodeId: string };
}
```

---

## IV. 移行手順

### Step 1: ディレクトリ構造作成（15分）

```bash
mkdir -p src/components/dashboard/mindmap/{nodes,edges,hooks,utils}
```

### Step 2: 新しいファイルを作成（2-3時間）

各ファイルを上記の設計に従って実装。

### Step 3: 既存 mind-map.tsx からコードを抽出（1-2時間）

- ノード定義 → nodes/
- エッジ定義 → edges/
- Hookロジック → hooks/
- ユーティリティ → utils/

### Step 4: MindMap.tsx を新規作成（30分）

合成コンポーネントとしての MindMap.tsx を作成。

### Step 5: インポート パス更新（1時間）

既存の import を新しいパスに更新:
```typescript
// Before
import { MindMap } from '@/components/dashboard/mind-map';

// After
import { MindMap } from '@/components/dashboard/mindmap';
```

### Step 6: テスト実行（30分）

```bash
npm run test
npm run dev
```

### Step 7: 旧ファイル削除（5分）

```bash
rm src/components/dashboard/mind-map.tsx
```

**総工数**: 6-8時間（1日分）

---

## V. テスト戦略

### Phase 1: Unit テスト（各ファイル）

```typescript
// nodes/ProjectNode.test.tsx
describe('ProjectNode', () => {
  it('renders project node with children count', () => {
    const mockData = {
      id: '1',
      title: 'Project Alpha',
      children: [{}, {}],
    };

    render(<ProjectNode data={mockData} />);
    expect(screen.getByText('2 tasks')).toBeInTheDocument();
  });
});

// hooks/useMindMapLayout.test.ts
describe('useMindMapLayout', () => {
  it('creates proper graph layout for tasks', () => {
    const mockTasks = [
      { id: '1', title: 'Task 1', parent_task_id: null },
      { id: '2', title: 'Task 2', parent_task_id: '1' },
    ];

    const { result } = renderHook(() => useMindMapLayout(mockTasks));

    expect(result.current.nodes).toHaveLength(2);
    expect(result.current.edges).toHaveLength(1);
  });
});
```

### Phase 2: 統合テスト

```typescript
// MindMap.test.tsx
describe('MindMap Integration', () => {
  it('renders complete mindmap with tasks', () => {
    const mockProject = { id: '1', tasks: [...] };

    render(<MindMap projectId="1" />);

    // ノード表示確認
    // ドラッグ操作確認
    // キーボード操作確認
  });
});
```

---

## VI. 効果測定

| 指標 | Before | After | 改善度 |
|------|--------|-------|--------|
| **ファイルサイズ** | 2,328行 | 1,700行 | -27% |
| **テスト可能性** | 🔴 0% | 🟢 90% | +90% |
| **保守性** | 🔴 低い | 🟢 高い | - |
| **新機能追加時間** | 2-4時間 | 30分 | -75% |
| **バグ修正時間** | 1-2時間 | 15分 | -87% |
| **コードレビュー時間** | 2-4時間 | 30分 | -75% |

---

## VII. リスク・対策

| リスク | 対策 |
|--------|------|
| インポートパス間違い | ESLint + TypeScript型チェック |
| 機能の破壊 | ユニット + 統合テスト追加 |
| レイアウト崩れ | ビジュアルレグレッションテスト |
| パフォーマンス低下 | Profiler で確認 |

---

**推奨スケジュール**: 次の開発スプリント (1-2週間後)
**優先度**: 🔴 最高（テスト化の前提条件）
**関連**: [ROADMAP.md - Phase 4](../ROADMAP.md)
