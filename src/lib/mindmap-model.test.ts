import { describe, expect, test } from "vitest";
import type { Project, Task } from "@/types/database";
import { buildMindMapModel, type MindMapModel, type MindMapModelNode } from "./mindmap-model";
import { PROJECT_NODE_MAX_WIDTH, estimateProjectNodeWidth, estimateTaskNodeHeight, estimateTaskNodeWidth } from "./mindmap-geometry";

const project = {
    id: "project-1",
    title: "Project",
} as Project;

const makeTask = (overrides: Partial<Task>): Task => ({
    id: "task-1",
    title: "Task",
    parent_task_id: null,
    project_id: "project-1",
    status: "todo",
    order_index: 0,
    estimated_time: 0,
    priority: null,
    scheduled_at: null,
    memo: null,
    memo_images: null,
    source: "manual",
    node_width: null,
    mindmap_collapsed: false,
    is_habit: false,
    habit_end_date: null,
    ...overrides,
} as Task);

const getTaskNode = (model: MindMapModel, id: string) => {
    const node = model.taskById.get(id);
    if (!node) throw new Error(`Missing task node: ${id}`);
    return node;
};

const centerY = (node: MindMapModelNode) => node.y + node.height / 2;

const getSubtreeDepthBounds = (model: MindMapModel, rootId: string, relativeDepth: number) => {
    const root = getTaskNode(model, rootId);
    const nodes: MindMapModelNode[] = [];
    const visit = (node: MindMapModelNode, depth: number) => {
        if (depth === relativeDepth) {
            nodes.push(node);
            return;
        }
        for (const child of model.nodes.filter(candidate => candidate.parentId === node.id)) {
            visit(child, depth + 1);
        }
    };
    visit(root, 0);

    if (nodes.length === 0) throw new Error(`Missing relative depth ${relativeDepth} under ${rootId}`);

    return {
        minY: Math.min(...nodes.map(node => node.y)),
        maxY: Math.max(...nodes.map(node => node.y + node.height)),
    };
};

describe("buildMindMapModel", () => {
    test("keeps sibling node widths independent when one task has a manual width", () => {
        const first = makeTask({
            id: "first",
            title: "Wide sibling",
            node_width: 420,
            order_index: 0,
        });
        const second = makeTask({
            id: "second",
            title: "Normal sibling",
            order_index: 1,
        });

        const model = buildMindMapModel({
            project,
            groups: [first, second],
            tasks: [],
            isMobile: false,
        });

        expect(model.taskById.get("first")?.width).toBe(420);
        expect(model.taskById.get("second")?.width).toBe(estimateTaskNodeWidth("Normal sibling", false));
        expect(model.taskById.get("second")?.width).toBeLessThan(420);
    });

    test("sizes the project node to its title instead of using the wide fallback", () => {
        const model = buildMindMapModel({
            project: { ...project, title: "仕事" },
            groups: [],
            tasks: [],
            isMobile: true,
        });

        const projectNode = model.nodes.find(node => node.kind === "project");
        expect(projectNode?.width).toBe(estimateProjectNodeWidth("仕事", true));
        expect(projectNode?.width).toBeLessThan(140);
    });

    test("lets long project titles grow beyond the old fixed width", () => {
        const title = "ラットレース脱出計画をスマホでも見切れず確認する";
        const model = buildMindMapModel({
            project: { ...project, title },
            groups: [],
            tasks: [],
            isMobile: true,
        });

        const projectNode = model.nodes.find(node => node.kind === "project");
        expect(projectNode?.width).toBe(estimateProjectNodeWidth(title, true));
        expect(projectNode?.width).toBeGreaterThan(220);
        expect(projectNode?.width).toBeLessThanOrEqual(PROJECT_NODE_MAX_WIDTH);
    });

    test("keeps same-depth node left edges aligned even when text widths differ", () => {
        const short = makeTask({
            id: "short",
            title: "る",
            order_index: 0,
        });
        const long = makeTask({
            id: "long",
            title: "誰でもコードが書ける時代",
            order_index: 1,
        });

        const model = buildMindMapModel({
            project,
            groups: [short, long],
            tasks: [],
            isMobile: false,
        });

        expect(model.taskById.get("short")?.width).toBeLessThan(model.taskById.get("long")?.width ?? 0);
        expect(model.taskById.get("short")?.x).toBe(model.taskById.get("long")?.x);
    });

    test("places completed root siblings below active root siblings", () => {
        const doneRoot = makeTask({
            id: "done-root",
            title: "Done root",
            status: "done",
            order_index: 0,
        });
        const activeRoot = makeTask({
            id: "active-root",
            title: "Active root",
            status: "todo",
            order_index: 1,
        });

        const model = buildMindMapModel({
            project,
            groups: [doneRoot, activeRoot],
            tasks: [],
            isMobile: false,
        });

        expect(model.taskById.get("active-root")?.y).toBeLessThan(model.taskById.get("done-root")?.y ?? 0);
    });

    test("places completed child siblings below active child siblings within the same parent", () => {
        const parent = makeTask({
            id: "parent",
            title: "Parent",
            order_index: 0,
        });
        const doneChild = makeTask({
            id: "done-child",
            title: "Done child",
            parent_task_id: "parent",
            status: "done",
            order_index: 0,
        });
        const activeChild = makeTask({
            id: "active-child",
            title: "Active child",
            parent_task_id: "parent",
            status: "todo",
            order_index: 1,
        });

        const model = buildMindMapModel({
            project,
            groups: [parent],
            tasks: [doneChild, activeChild],
            isMobile: false,
        });

        expect(model.taskById.get("active-child")?.y).toBeLessThan(model.taskById.get("done-child")?.y ?? 0);
    });

    test("centers the middle child on the parent when a parent has three children", () => {
        const parent = makeTask({
            id: "parent",
            title: "Parent",
            order_index: 0,
        });
        const childA = makeTask({
            id: "child-a",
            title: "Child A",
            parent_task_id: "parent",
            order_index: 0,
        });
        const childB = makeTask({
            id: "child-b",
            title: "Child B",
            parent_task_id: "parent",
            order_index: 1,
        });
        const childC = makeTask({
            id: "child-c",
            title: "Child C",
            parent_task_id: "parent",
            order_index: 2,
        });

        const model = buildMindMapModel({
            project,
            groups: [parent],
            tasks: [childA, childB, childC],
            isMobile: false,
        });

        const parentCenter = centerY(getTaskNode(model, "parent"));
        const childCenters = ["child-a", "child-b", "child-c"].map(id => centerY(getTaskNode(model, id)));

        expect(childCenters[1]).toBe(parentCenter);
        expect(childCenters[1] - childCenters[0]).toBe(childCenters[2] - childCenters[1]);
    });

    test("places the parent between the two middle children when a parent has four children", () => {
        const parent = makeTask({
            id: "parent",
            title: "Parent",
            order_index: 0,
        });
        const children = [0, 1, 2, 3].map(index => makeTask({
            id: `child-${index}`,
            title: `Child ${index}`,
            parent_task_id: "parent",
            order_index: index,
        }));

        const model = buildMindMapModel({
            project,
            groups: [parent],
            tasks: children,
            isMobile: false,
        });

        const parentCenter = centerY(getTaskNode(model, "parent"));
        const childCenters = children.map(child => centerY(getTaskNode(model, child.id)));
        const gaps = childCenters.slice(1).map((value, index) => value - childCenters[index]);

        expect(gaps[1]).toBe(gaps[0]);
        expect(gaps[2]).toBe(gaps[0]);
        expect(childCenters[1] + childCenters[2]).toBe(parentCenter * 2);
    });

    test("keeps direct siblings compact when only one sibling has deeper descendants", () => {
        const parent = makeTask({
            id: "parent",
            title: "Parent",
            order_index: 0,
        });
        const branch = makeTask({
            id: "branch",
            title: "Branch",
            parent_task_id: "parent",
            order_index: 0,
        });
        const sibling = makeTask({
            id: "sibling",
            title: "Sibling",
            parent_task_id: "parent",
            order_index: 1,
        });
        const grandchildA = makeTask({
            id: "grandchild-a",
            title: "Grandchild A",
            parent_task_id: "branch",
            order_index: 0,
        });
        const grandchildB = makeTask({
            id: "grandchild-b",
            title: "Grandchild B",
            parent_task_id: "branch",
            order_index: 1,
        });

        const model = buildMindMapModel({
            project,
            groups: [parent],
            tasks: [branch, sibling, grandchildA, grandchildB],
            isMobile: false,
        });

        const compactPitch = Math.ceil(
            ((getTaskNode(model, "branch").height / 2) + (getTaskNode(model, "sibling").height / 2) + 10) / 2
        ) * 2;

        expect(centerY(getTaskNode(model, "sibling")) - centerY(getTaskNode(model, "branch"))).toBe(compactPitch);
    });

    test("widens sibling pitch when same-depth child subtrees would overlap", () => {
        const parent = makeTask({
            id: "parent",
            title: "Parent",
            order_index: 0,
        });
        const branchA = makeTask({
            id: "branch-a",
            title: "Branch A",
            parent_task_id: "parent",
            order_index: 0,
        });
        const branchB = makeTask({
            id: "branch-b",
            title: "Branch B",
            parent_task_id: "parent",
            order_index: 1,
        });
        const branchAGrandchildren = [0, 1].map(index => makeTask({
            id: `branch-a-grandchild-${index}`,
            title: `Branch A grandchild ${index}`,
            parent_task_id: "branch-a",
            order_index: index,
        }));
        const branchBGrandchildren = [0, 1].map(index => makeTask({
            id: `branch-b-grandchild-${index}`,
            title: `Branch B grandchild ${index}`,
            parent_task_id: "branch-b",
            order_index: index,
        }));

        const model = buildMindMapModel({
            project,
            groups: [parent],
            tasks: [branchA, branchB, ...branchAGrandchildren, ...branchBGrandchildren],
            isMobile: false,
        });

        const compactPitch = Math.ceil(
            ((getTaskNode(model, "branch-a").height / 2) + (getTaskNode(model, "branch-b").height / 2) + 10) / 2
        ) * 2;

        expect(centerY(getTaskNode(model, "branch-b")) - centerY(getTaskNode(model, "branch-a"))).toBeGreaterThan(compactPitch);

        const branchABounds = getSubtreeDepthBounds(model, "branch-a", 1);
        const branchBBounds = getSubtreeDepthBounds(model, "branch-b", 1);
        expect(branchABounds.maxY + 10).toBeLessThanOrEqual(branchBBounds.minY);
    });

    test("prevents same-depth subtree overlap even when a leaf sibling sits between branches", () => {
        const parent = makeTask({
            id: "parent",
            title: "Parent",
            order_index: 0,
        });
        const branchA = makeTask({
            id: "branch-a",
            title: "Branch A",
            parent_task_id: "parent",
            order_index: 0,
        });
        const leaf = makeTask({
            id: "leaf",
            title: "Leaf",
            parent_task_id: "parent",
            order_index: 1,
        });
        const branchC = makeTask({
            id: "branch-c",
            title: "Branch C",
            parent_task_id: "parent",
            order_index: 2,
        });
        const branchAGrandchildren = [0, 1].map(index => makeTask({
            id: `branch-a-grandchild-${index}`,
            title: `Branch A grandchild ${index}`,
            parent_task_id: "branch-a",
            order_index: index,
        }));
        const branchCGrandchildren = [0, 1].map(index => makeTask({
            id: `branch-c-grandchild-${index}`,
            title: `Branch C grandchild ${index}`,
            parent_task_id: "branch-c",
            order_index: index,
        }));

        const model = buildMindMapModel({
            project,
            groups: [parent],
            tasks: [branchA, leaf, branchC, ...branchAGrandchildren, ...branchCGrandchildren],
            isMobile: false,
        });

        const compactPitch = Math.ceil(
            ((getTaskNode(model, "branch-a").height / 2) + (getTaskNode(model, "leaf").height / 2) + 10) / 2
        ) * 2;
        const firstGap = centerY(getTaskNode(model, "leaf")) - centerY(getTaskNode(model, "branch-a"));
        const secondGap = centerY(getTaskNode(model, "branch-c")) - centerY(getTaskNode(model, "leaf"));

        expect(firstGap).toBe(secondGap);
        expect(firstGap).toBe(compactPitch);

        const branchABounds = getSubtreeDepthBounds(model, "branch-a", 1);
        const branchCBounds = getSubtreeDepthBounds(model, "branch-c", 1);
        expect(branchABounds.maxY + 10).toBeLessThanOrEqual(branchCBounds.minY);
    });

    test("uses the widest node in a depth as the basis for the next column", () => {
        const shortParent = makeTask({
            id: "short-parent",
            title: "短い親",
            order_index: 0,
        });
        const wideSibling = makeTask({
            id: "wide-sibling",
            title: "横に長い同階層ノード",
            node_width: 420,
            order_index: 1,
        });
        const child = makeTask({
            id: "child",
            title: "子",
            parent_task_id: "short-parent",
            order_index: 0,
        });

        const model = buildMindMapModel({
            project,
            groups: [shortParent, wideSibling],
            tasks: [child],
            isMobile: false,
        });

        const wideNode = model.taskById.get("wide-sibling");
        const childNode = model.taskById.get("child");

        expect(wideNode).toBeDefined();
        expect(childNode).toBeDefined();
        expect(childNode!.x).toBeGreaterThan(wideNode!.x + wideNode!.width);
    });

    test("keeps the next column close after accounting for the widest node", () => {
        const wideParent = makeTask({
            id: "wide-parent",
            title: "横に長い親ノード",
            node_width: 360,
            order_index: 0,
        });
        const child = makeTask({
            id: "child",
            title: "子",
            parent_task_id: "wide-parent",
            order_index: 0,
        });

        const model = buildMindMapModel({
            project,
            groups: [wideParent],
            tasks: [child],
            isMobile: false,
        });

        const parentNode = model.taskById.get("wide-parent");
        const childNode = model.taskById.get("child");

        expect(parentNode).toBeDefined();
        expect(childNode).toBeDefined();
        expect(childNode!.x - (parentNode!.x + parentNode!.width)).toBe(24);
    });

    test("uses a compact mobile column gap", () => {
        const parent = makeTask({
            id: "parent",
            title: "親",
            order_index: 0,
        });
        const child = makeTask({
            id: "child",
            title: "子",
            parent_task_id: "parent",
            order_index: 0,
        });

        const model = buildMindMapModel({
            project,
            groups: [parent],
            tasks: [child],
            isMobile: true,
        });

        const parentNode = model.taskById.get("parent");
        const childNode = model.taskById.get("child");

        expect(parentNode).toBeDefined();
        expect(childNode).toBeDefined();
        expect(childNode!.x - (parentNode!.x + parentNode!.width)).toBe(20);
    });

    test("shows the total descendant count on parent nodes", () => {
        const parent = makeTask({
            id: "parent",
            title: "親",
            order_index: 0,
        });
        const childA = makeTask({
            id: "child-a",
            title: "子A",
            parent_task_id: "parent",
            order_index: 0,
        });
        const childB = makeTask({
            id: "child-b",
            title: "子B",
            parent_task_id: "parent",
            order_index: 1,
        });
        const grandchildA = makeTask({
            id: "grandchild-a",
            title: "孫A",
            parent_task_id: "child-a",
            order_index: 0,
        });
        const grandchildB = makeTask({
            id: "grandchild-b",
            title: "孫B",
            parent_task_id: "child-b",
            order_index: 0,
        });

        const model = buildMindMapModel({
            project,
            groups: [parent],
            tasks: [childA, childB, grandchildA, grandchildB],
            isMobile: false,
        });

        expect(model.taskById.get("parent")?.childCount).toBe(4);
        expect(model.taskById.get("child-a")?.childCount).toBe(1);
        expect(model.taskById.get("child-b")?.childCount).toBe(1);
    });

    test("uses persisted collapsed state when no override set is provided", () => {
        const parent = makeTask({
            id: "parent",
            title: "親",
            mindmap_collapsed: true,
            order_index: 0,
        });
        const child = makeTask({
            id: "child",
            title: "子",
            parent_task_id: "parent",
            order_index: 0,
        });

        const model = buildMindMapModel({
            project,
            groups: [parent],
            tasks: [child],
            isMobile: false,
        });

        expect(model.taskById.get("parent")?.collapsed).toBe(true);
        expect(model.taskById.has("child")).toBe(false);
    });
});

describe("mindmap geometry", () => {
    test("keeps parent nodes with one visual line at the compact single-line height", () => {
        const width = estimateTaskNodeWidth("誘因を増やす", false, { hasChildren: true, childCount: 1 });

        expect(estimateTaskNodeHeight("誘因を増やす", false, width, false, true, 1)).toBe(36);
    });

    test("keeps short leaf nodes compact on desktop", () => {
        expect(estimateTaskNodeWidth("Task", false)).toBeLessThan(110);
    });

    test("lets long mobile project names use more horizontal space", () => {
        const width = estimateProjectNodeWidth("Focus map制作とモバイル表示改善プロジェクト", true);

        expect(width).toBeGreaterThan(220);
        expect(width).toBeLessThanOrEqual(320);
    });

    test("increases node height when a long single line wraps", () => {
        const oneLine = estimateTaskNodeHeight("されているのはないかなどうするのがいいのかな", false, 160, false);
        const shortLine = estimateTaskNodeHeight("る", false, 160, false);
        const explicitTwoLines = estimateTaskNodeHeight("誰でもコードが\n書ける時代", false, 160, false);

        expect(oneLine).toBeGreaterThan(shortLine);
        expect(explicitTwoLines).toBeGreaterThan(shortLine);
    });

    test("adds clearance for nodes that visually wrap to three or more lines", () => {
        expect(estimateTaskNodeHeight("codex プロンプト注入\nこれ早急に", true, 180, false)).toBe(76);
    });
});
