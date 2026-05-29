import { describe, expect, test } from "vitest";
import type { Project, Task } from "@/types/database";
import { buildMindMapModel } from "./mindmap-model";
import { estimateTaskNodeWidth } from "./mindmap-geometry";

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
});
