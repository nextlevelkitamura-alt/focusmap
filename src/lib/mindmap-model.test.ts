import { describe, expect, test } from "vitest";
import type { Project, Task } from "@/types/database";
import { buildMindMapModel } from "./mindmap-model";
import { estimateProjectNodeWidth, estimateTaskNodeHeight, estimateTaskNodeWidth } from "./mindmap-geometry";

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
    is_habit: false,
    habit_end_date: null,
    ...overrides,
} as Task);

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
});

describe("mindmap geometry", () => {
    test("keeps parent nodes with one visual line at the compact single-line height", () => {
        const width = estimateTaskNodeWidth("誘因を増やす", false, { hasChildren: true, childCount: 1 });

        expect(estimateTaskNodeHeight("誘因を増やす", false, width, false, true, 1)).toBe(36);
    });

    test("keeps short leaf nodes compact on desktop", () => {
        expect(estimateTaskNodeWidth("Task", false)).toBeLessThan(110);
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
