import dagre from 'dagre';
import type { Project, Task } from '@/types/database';
import {
    PROJECT_NODE_HEIGHT,
    estimateProjectNodeWidth,
    estimateTaskTitleLineCount,
    estimateTaskNodeHeight,
    estimateTaskNodeWidth,
} from './mindmap-geometry';

export type MindMapModelNodeKind = 'project' | 'task';

export type MindMapModelNode = {
    id: string;
    kind: MindMapModelNodeKind;
    title: string;
    titleLineCount: number;
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
    calendarId: string | null;
    estimatedTime: number | null;
    estimatedDisplayMinutes: number;
    estimatedAutoMinutes: number;
    estimatedIsOverride: boolean;
    source: string | null;
    memo: string | null;
    hasMemo: boolean;
    hasMemoImages: boolean;
    isHabit: boolean;
    parentIsHabit: boolean;
    /** Codex relay の作業状態（'running'|'done'|'failed'|null）。顔の状態アイコン用 */
    codexStatus: string | null;
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

const COLUMN_GAP = 18;
const COLUMN_GAP_MOBILE = 16;
const SIBLING_NODE_GAP = 10;
const SIBLING_NODE_GAP_MOBILE = 14;

type VerticalColumnExtent = {
    top: number;
    bottom: number;
};

type VerticalColumnExtents = Map<number, VerticalColumnExtent>;

const hasMemoImages = (task: Task) =>
    Array.isArray(task.memo_images) && task.memo_images.some(url => typeof url === 'string' && url.trim().length > 0);

const isTaskDone = (task: Task) =>
    task.is_habit
        ? (task.status === 'done' && !!task.habit_end_date && new Date(task.habit_end_date) < new Date())
        : task.status === 'done';

const compareTaskDisplayOrder = (a: Task, b: Task) => {
    const doneDelta = Number(isTaskDone(a)) - Number(isTaskDone(b));
    if (doneDelta !== 0) return doneDelta;
    return (a.order_index ?? 0) - (b.order_index ?? 0);
};

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

const alignChildrenAroundParents = (
    nodes: MindMapModelNode[],
    projectNodeId: string,
    siblingGap: number,
) => {
    const nodeById = new Map(nodes.map(node => [node.id, node]));
    const childrenByParent = new Map<string, MindMapModelNode[]>();

    for (const node of nodes) {
        if (!node.parentId) continue;
        const children = childrenByParent.get(node.parentId) ?? [];
        children.push(node);
        childrenByParent.set(node.parentId, children);
    }

    const extentById = new Map<string, VerticalColumnExtents>();
    const childCenterOffsetsByParentId = new Map<string, number[]>();

    const mergeColumnExtent = (
        extents: VerticalColumnExtents,
        depth: number,
        top: number,
        bottom: number,
    ) => {
        const current = extents.get(depth);
        extents.set(depth, {
            top: Math.max(current?.top ?? top, top),
            bottom: Math.max(current?.bottom ?? bottom, bottom),
        });
    };

    const getRequiredCenterDistance = (
        previous: VerticalColumnExtents,
        next: VerticalColumnExtents,
    ) => {
        let requiredDistance = 0;
        for (const [depth, previousExtent] of previous) {
            const nextExtent = next.get(depth);
            if (!nextExtent) continue;
            requiredDistance = Math.max(
                requiredDistance,
                previousExtent.bottom + nextExtent.top + siblingGap
            );
        }
        return requiredDistance;
    };

    const roundGap = (gap: number) => Math.ceil(gap / 2) * 2;

    const calculateChildCenterOffsets = (
        children: MindMapModelNode[],
        childExtents: VerticalColumnExtents[],
    ) => {
        if (children.length === 0) return [];
        if (children.length === 1) return [0];

        const gaps = children.slice(0, -1).map((_, index) => {
            const previousExtent = childExtents[index];
            const nextExtent = childExtents[index + 1];
            if (!previousExtent || !nextExtent) {
                return roundGap(
                    (children[index]?.height ?? 0) / 2 +
                    (children[index + 1]?.height ?? 0) / 2 +
                    siblingGap
                );
            }
            return roundGap(getRequiredCenterDistance(previousExtent, nextExtent));
        });

        for (let previousIndex = 0; previousIndex < children.length; previousIndex += 1) {
            for (let nextIndex = previousIndex + 2; nextIndex < children.length; nextIndex += 1) {
                const previousExtent = childExtents[previousIndex];
                const nextExtent = childExtents[nextIndex];
                if (!previousExtent || !nextExtent) continue;

                const requiredDistance = roundGap(getRequiredCenterDistance(previousExtent, nextExtent));
                const currentDistance = gaps
                    .slice(previousIndex, nextIndex)
                    .reduce((sum, gap) => sum + gap, 0);
                const extraDistance = requiredDistance - currentDistance;
                if (extraDistance <= 0) continue;

                // Keep unrelated outer siblings compact by adding overlap clearance only inside this interval.
                const affectedGapCount = nextIndex - previousIndex;
                const extraPerGap = roundGap(extraDistance / affectedGapCount);
                for (let gapIndex = previousIndex; gapIndex < nextIndex; gapIndex += 1) {
                    gaps[gapIndex] += extraPerGap;
                }
            }
        }

        const centers = [0];
        for (const gap of gaps) {
            centers.push((centers[centers.length - 1] ?? 0) + gap);
        }

        const spanCenter = ((centers[0] ?? 0) + (centers[centers.length - 1] ?? 0)) / 2;
        return centers.map(center => center - spanCenter);
    };

    const getExtent = (node: MindMapModelNode, seen = new Set<string>()): VerticalColumnExtents => {
        const cached = extentById.get(node.id);
        if (cached) return cached;

        if (seen.has(node.id)) {
            return new Map([[0, { top: node.height / 2, bottom: node.height / 2 }]]);
        }
        const nextSeen = new Set(seen);
        nextSeen.add(node.id);

        const children = childrenByParent.get(node.id) ?? [];
        const extents: VerticalColumnExtents = new Map([
            [0, { top: node.height / 2, bottom: node.height / 2 }],
        ]);

        if (children.length > 0) {
            const childExtents = children.map(child => getExtent(child, nextSeen));
            const childCenterOffsets = calculateChildCenterOffsets(children, childExtents);
            children.forEach((_, index) => {
                const offset = childCenterOffsets[index] ?? 0;
                const childExtent = childExtents[index];
                if (!childExtent) return;
                for (const [depth, extent] of childExtent) {
                    mergeColumnExtent(
                        extents,
                        depth + 1,
                        extent.top - offset,
                        extent.bottom + offset
                    );
                }
            });

            childCenterOffsetsByParentId.set(node.id, childCenterOffsets);
        }

        extentById.set(node.id, extents);
        return extents;
    };

    const placeChildren = (node: MindMapModelNode, centerY: number, seen = new Set<string>()) => {
        if (seen.has(node.id)) return;
        const nextSeen = new Set(seen);
        nextSeen.add(node.id);

        node.y = Math.round(centerY - node.height / 2);

        const children = childrenByParent.get(node.id) ?? [];
        if (children.length === 0) return;

        const childCenterOffsets = childCenterOffsetsByParentId.get(node.id) ?? calculateChildCenterOffsets(
            children,
            children.map(child => getExtent(child, nextSeen))
        );
        children.forEach((child, index) => {
            placeChildren(child, centerY + (childCenterOffsets[index] ?? 0), nextSeen);
        });
    };

    const projectNode = nodeById.get(projectNodeId);
    if (!projectNode) return;

    getExtent(projectNode);
    placeChildren(projectNode, projectNode.y + projectNode.height / 2);
};

export function buildMindMapModel({
    project,
    groups,
    tasks,
    collapsedTaskIds,
    isMobile = false,
    projectNodeId = 'project-root',
}: BuildMindMapModelParams): MindMapModel {
    const graph = new dagre.graphlib.Graph();
    graph.setDefaultEdgeLabel(() => ({}));
    graph.setGraph({
        rankdir: 'LR',
        nodesep: isMobile ? 14 : 10,
        ranksep: isMobile ? 20 : 24,
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

    const effectiveCollapsedTaskIds = collapsedTaskIds ?? new Set(
        [...groups, ...tasks]
            .filter(task => task.mindmap_collapsed === true)
            .map(task => task.id)
    );

    for (const task of tasks) {
        if (!task?.id || !task.parent_task_id) continue;
        const children = childrenByParent.get(task.parent_task_id) ?? [];
        children.push(task);
        childrenByParent.set(task.parent_task_id, children);
    }
    for (const [, children] of childrenByParent) {
        children.sort(compareTaskDisplayOrder);
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

    const getTaskDescendantCount = (taskId: string, seen = new Set<string>()): number => {
        if (seen.has(taskId)) return 0;
        seen.add(taskId);
        return getChildren(taskId).reduce(
            (sum, child) => sum + 1 + getTaskDescendantCount(child.id, new Set(seen)),
            0
        );
    };

    const projectTitle = project?.title ?? 'Project';
    const projectNode: MindMapModelNode = {
        id: projectNodeId,
        kind: 'project',
        title: projectTitle,
        titleLineCount: 1,
        parentId: null,
        depth: -1,
        x: 0,
        y: 0,
        width: estimateProjectNodeWidth(projectTitle, isMobile),
        height: PROJECT_NODE_HEIGHT,
        status: 'active',
        isDone: false,
        hasChildren: groups.length > 0,
        childCount: groups.length,
        collapsed: false,
        priority: null,
        scheduledAt: null,
        calendarId: null,
        estimatedTime: null,
        estimatedDisplayMinutes: 0,
        estimatedAutoMinutes: 0,
        estimatedIsOverride: false,
        source: null,
        memo: null,
        hasMemo: false,
        hasMemoImages: false,
        isHabit: false,
        parentIsHabit: false,
        codexStatus: null,
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
        const childCount = getTaskDescendantCount(task.id);
        const nodeWidth = task.node_width ?? estimateTaskNodeWidth(task.title || '', isMobile, {
            hasChildren: taskHasChildren,
            childCount,
        });
        const titleLineCount = estimateTaskTitleLineCount(task.title || '', nodeWidth, isMobile, {
            hasChildren: taskHasChildren,
            childCount,
        });
        const nodeHeight = estimateTaskNodeHeight(task.title || '', hasInfoRow, nodeWidth, isMobile, taskHasChildren, childCount);
        const parentTask = task.parent_task_id ? rawTaskById.get(task.parent_task_id) : null;

        const node: MindMapModelNode = {
            id: task.id,
            kind: 'task',
            title: task.title || 'Task',
            titleLineCount,
            parentId,
            depth,
            x: 0,
            y: 0,
            width: nodeWidth,
            height: nodeHeight,
            status: task.status ?? 'todo',
            isDone: isTaskDone(task),
            hasChildren: taskHasChildren,
            childCount,
            collapsed: effectiveCollapsedTaskIds.has(task.id),
            priority: task.priority ?? null,
            scheduledAt: task.scheduled_at ?? null,
            calendarId: task.calendar_id ?? null,
            estimatedTime: task.estimated_time ?? null,
            estimatedDisplayMinutes,
            estimatedAutoMinutes,
            estimatedIsOverride,
            source: task.source ?? null,
            memo: task.memo ?? null,
            hasMemo: taskHasMemo,
            hasMemoImages: taskHasMemoImages,
            isHabit: task.is_habit ?? false,
            parentIsHabit: parentTask?.is_habit ?? false,
            codexStatus: task.codex_status ?? null,
        };
        nodes.push(node);
        taskById.set(node.id, node);
        edges.push({ id: `e-${parentId}-${task.id}`, source: parentId, target: task.id });

        if (effectiveCollapsedTaskIds.has(task.id)) return;
        for (const child of children) {
            addTask(child, task.id, depth + 1);
        }
    };

    for (const group of [...groups].sort(compareTaskDisplayOrder)) {
        if (!group?.id) continue;
        addTask(group, projectNodeId, 0);
    }

    for (const node of nodes) {
        graph.setNode(node.id, {
            width: node.width,
            height: node.height,
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

    const leftByDepth = new Map<number, number>();
    const maxWidthByDepth = new Map<number, number>();
    for (const node of nodes) {
        const current = leftByDepth.get(node.depth);
        leftByDepth.set(node.depth, current == null ? node.x : Math.min(current, node.x));
        maxWidthByDepth.set(node.depth, Math.max(maxWidthByDepth.get(node.depth) ?? 0, node.width));
    }

    const columnGap = isMobile ? COLUMN_GAP_MOBILE : COLUMN_GAP;
    let previousRight: number | null = null;
    for (const depth of [...leftByDepth.keys()].sort((a, b) => a - b)) {
        const currentLeft: number = leftByDepth.get(depth) ?? 0;
        const alignedLeft: number = previousRight == null
            ? currentLeft
            : Math.max(currentLeft, previousRight + columnGap);
        leftByDepth.set(depth, alignedLeft);
        previousRight = alignedLeft + (maxWidthByDepth.get(depth) ?? 0);
    }

    for (const node of nodes) {
        const alignedX = leftByDepth.get(node.depth);
        if (alignedX != null) node.x = alignedX;
    }

    alignChildrenAroundParents(
        nodes,
        projectNodeId,
        isMobile ? SIBLING_NODE_GAP_MOBILE : SIBLING_NODE_GAP
    );

    return {
        nodes,
        edges,
        taskById,
        bounds: getBounds(nodes),
    };
}
