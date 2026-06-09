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

    test("sizes explicit two-line nodes to two text lines", () => {
        expect(estimateTaskNodeHeight("codex プロンプト注入\nこれ早急に", true, 180, false)).toBe(66);
    });
});
