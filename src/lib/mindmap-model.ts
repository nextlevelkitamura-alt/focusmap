import dagre from 'dagre';
import type { Project, Task } from '@/types/database';
import {
    PROJECT_NODE_HEIGHT,
    PROJECT_NODE_WIDTH,
    estimateTaskNodeHeight,
    estimateTaskNodeWidth,
} from './mindmap-geometry';

export type MindMapModelNodeKind = 'project' | 'task';

export type MindMapModelNode = {
    id: string;
    kind: MindMapModelNodeKind;
    title: string;
    parentId: string | null;
    depth: number;
    x: number;
    y: number;
    width: number;
    height: number;
    status: string;
    isDone: boolean;
    hasChildren: boolean;
    childCount: number;
    collapsed: boolean;
    priority: number | null;
    scheduledAt: string | null;
    estimatedDisplayMinutes: number;
    estimatedAutoMinutes: number;
    estimatedIsOverride: boolean;
    source: string | null;
    hasMemo: boolean;
    hasMemoImages: boolean;
    isHabit: boolean;
    parentIsHabit: boolean;
};

export type MindMapModelEdge = {
    id: string;
    source: string;
    target: string;
};

export type MindMapModel = {
    nodes: MindMapModelNode[];
    edges: MindMapModelEdge[];
    taskById: Map<string, MindMapModelNode>;
    bounds: {
        minX: number;
        minY: number;
        maxX: number;
        maxY: number;
        width: number;
        height: number;
    };
};

type BuildMindMapModelParams = {
    project: Project | null | undefined;
    groups: Task[];
    tasks: Task[];
    collapsedTaskIds?: Set<string>;
    isMobile?: boolean;
    projectNodeId?: string;
};

const hasMemoImages = (task: Task) =>
    Array.isArray(task.memo_images) && task.memo_images.some(url => typeof url === 'string' && url.trim().length > 0);

const isTaskDone = (task: Task) =>
    task.is_habit
        ? (task.status === 'done' && !!task.habit_end_date && new Date(task.habit_end_date) < new Date())
        : task.status === 'done';

const getBounds = (nodes: MindMapModelNode[]) => {
    if (nodes.length === 0) {
        return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
    }

    const minX = Math.min(...nodes.map(node => node.x));
    const minY = Math.min(...nodes.map(node => node.y));
    const maxX = Math.max(...nodes.map(node => node.x + node.width));
    const maxY = Math.max(...nodes.map(node => node.y + node.height));
    return {
        minX,
        minY,
        maxX,
        maxY,
        width: maxX - minX,
        height: maxY - minY,
    };
};

export function buildMindMapModel({
    project,
    groups,
    tasks,
    collapsedTaskIds = new Set(),
    isMobile = false,
    projectNodeId = 'project-root',
}: BuildMindMapModelParams): MindMapModel {
    const graph = new dagre.graphlib.Graph();
    graph.setDefaultEdgeLabel(() => ({}));
    graph.setGraph({
        rankdir: 'LR',
        nodesep: isMobile ? 2 : 4,
        ranksep: isMobile ? 24 : 36,
        edgesep: 4,
        ranker: 'network-simplex',
    });

    const nodes: MindMapModelNode[] = [];
    const edges: MindMapModelEdge[] = [];
    const taskById = new Map<string, MindMapModelNode>();
    const rawTaskById = new Map<string, Task>();
    const childrenByParent = new Map<string, Task[]>();

    for (const task of [...groups, ...tasks]) {
        if (!task?.id || rawTaskById.has(task.id)) continue;
        rawTaskById.set(task.id, task);
    }

    for (const task of tasks) {
        if (!task?.id || !task.parent_task_id) continue;
        const children = childrenByParent.get(task.parent_task_id) ?? [];
        children.push(task);
        childrenByParent.set(task.parent_task_id, children);
    }
    for (const [, children] of childrenByParent) {
        children.sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
    }

    const getChildren = (taskId: string) => childrenByParent.get(taskId) ?? [];

    const getTaskEffectiveMinutes = (taskId: string, seen = new Set<string>()): number => {
        if (seen.has(taskId)) return 0;
        seen.add(taskId);
        const task = rawTaskById.get(taskId);
        if (!task) return 0;
        const children = getChildren(taskId);
        if (children.length === 0) return task.estimated_time ?? 0;
        if ((task.estimated_time ?? 0) > 0) return task.estimated_time;
        return children.reduce((sum, child) => sum + getTaskEffectiveMinutes(child.id, new Set(seen)), 0);
    };

    const getTaskAutoMinutes = (taskId: string) =>
        getChildren(taskId).reduce((sum, child) => sum + getTaskEffectiveMinutes(child.id), 0);

    const projectNode: MindMapModelNode = {
        id: projectNodeId,
        kind: 'project',
        title: project?.title ?? 'Project',
        parentId: null,
        depth: -1,
        x: 0,
        y: 0,
        width: PROJECT_NODE_WIDTH,
        height: PROJECT_NODE_HEIGHT,
        status: 'active',
        isDone: false,
        hasChildren: groups.length > 0,
        childCount: groups.length,
        collapsed: false,
        priority: null,
        scheduledAt: null,
        estimatedDisplayMinutes: 0,
        estimatedAutoMinutes: 0,
        estimatedIsOverride: false,
        source: null,
        hasMemo: false,
        hasMemoImages: false,
        isHabit: false,
        parentIsHabit: false,
    };
    nodes.push(projectNode);

    const addTask = (task: Task, parentId: string, depth: number) => {
        const children = getChildren(task.id);
        const taskHasChildren = children.length > 0;
        const estimatedIsOverride = taskHasChildren && ((task.estimated_time ?? 0) > 0);
        const estimatedAutoMinutes = taskHasChildren ? getTaskAutoMinutes(task.id) : 0;
        const estimatedDisplayMinutes = taskHasChildren
            ? (estimatedIsOverride ? (task.estimated_time ?? 0) : estimatedAutoMinutes)
            : (task.estimated_time ?? 0);
        const taskHasMemo = typeof task.memo === 'string' && task.memo.trim().length > 0;
        const taskHasMemoImages = hasMemoImages(task);
        const hasInfoRow =
            estimatedDisplayMinutes > 0 ||
            task.priority != null ||
            !!task.scheduled_at ||
            taskHasMemo ||
            taskHasMemoImages ||
            task.source === 'memo' ||
            task.source === 'wishlist';
        const nodeWidth = task.node_width ?? estimateTaskNodeWidth(task.title || '', isMobile);
        const nodeHeight = estimateTaskNodeHeight(task.title || '', hasInfoRow, nodeWidth, isMobile);
        const parentTask = task.parent_task_id ? rawTaskById.get(task.parent_task_id) : null;

        const node: MindMapModelNode = {
            id: task.id,
            kind: 'task',
            title: task.title || 'Task',
            parentId,
            depth,
            x: 0,
            y: 0,
            width: nodeWidth,
            height: nodeHeight,
            status: task.status ?? 'todo',
            isDone: isTaskDone(task),
            hasChildren: taskHasChildren,
            childCount: children.length,
            collapsed: collapsedTaskIds.has(task.id),
            priority: task.priority ?? null,
            scheduledAt: task.scheduled_at ?? null,
            estimatedDisplayMinutes,
            estimatedAutoMinutes,
            estimatedIsOverride,
            source: task.source ?? null,
            hasMemo: taskHasMemo,
            hasMemoImages: taskHasMemoImages,
            isHabit: task.is_habit ?? false,
            parentIsHabit: parentTask?.is_habit ?? false,
        };
        nodes.push(node);
        taskById.set(node.id, node);
        edges.push({ id: `e-${parentId}-${task.id}`, source: parentId, target: task.id });

        if (collapsedTaskIds.has(task.id)) return;
        for (const child of children) {
            addTask(child, task.id, depth + 1);
        }
    };

    for (const group of [...groups].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))) {
        if (!group?.id) continue;
        addTask(group, projectNodeId, 0);
    }

    const nodeById = new Map(nodes.map(node => [node.id, node]));
    const parentToChildren = new Map<string, MindMapModelNode[]>();
    for (const edge of edges) {
        const child = nodeById.get(edge.target);
        if (!child || child.kind !== 'task') continue;
        const siblings = parentToChildren.get(edge.source) ?? [];
        siblings.push(child);
        parentToChildren.set(edge.source, siblings);
    }
    for (const [, siblings] of parentToChildren) {
        if (siblings.length < 2) continue;
        const maxWidth = Math.max(...siblings.map(node => node.width));
        for (const node of siblings) {
            const rawTask = rawTaskById.get(node.id);
            if (!rawTask || rawTask.node_width != null || node.width === maxWidth) continue;
            node.width = maxWidth;
            const hasInfoRow =
                node.estimatedDisplayMinutes > 0 ||
                node.priority != null ||
                !!node.scheduledAt ||
                node.hasMemo ||
                node.hasMemoImages ||
                node.source === 'memo' ||
                node.source === 'wishlist';
            node.height = estimateTaskNodeHeight(node.title, hasInfoRow, maxWidth, isMobile);
        }
    }

    for (const node of nodes) {
        graph.setNode(node.id, {
            width: node.kind === 'project' ? PROJECT_NODE_WIDTH : node.width,
            height: node.kind === 'project' ? PROJECT_NODE_HEIGHT : node.height,
        });
    }
    for (const edge of edges) {
        graph.setEdge(edge.source, edge.target);
    }
    dagre.layout(graph);

    for (const node of nodes) {
        const positioned = graph.node(node.id);
        if (!positioned) continue;
        node.x = Math.round(positioned.x - node.width / 2);
        node.y = Math.round(positioned.y - node.height / 2);
    }

    return {
        nodes,
        edges,
        taskById,
        bounds: getBounds(nodes),
    };
}
