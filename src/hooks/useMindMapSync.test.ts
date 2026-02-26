import { describe, test, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMindMapSync } from './useMindMapSync'
import type { Task } from '@/types/database'

// --- Supabase mock ---
const mockSupabaseChain = () => {
  const chain: Record<string, any> = {}
  chain.from = vi.fn().mockReturnValue(chain)
  chain.select = vi.fn().mockReturnValue(chain)
  chain.insert = vi.fn().mockResolvedValue({ data: null, error: null })
  chain.update = vi.fn().mockReturnValue(chain)
  chain.upsert = vi.fn().mockResolvedValue({ data: null, error: null })
  chain.delete = vi.fn().mockReturnValue(chain)
  chain.eq = vi.fn().mockImplementation(() => {
    return {
      ...chain,
      eq: chain.eq,
      select: vi.fn().mockResolvedValue({ data: [{ id: 'test' }], error: null }),
      then: (resolve: any) => resolve({ data: null, error: null }),
    }
  })
  chain.single = vi.fn().mockResolvedValue({ data: { id: 'test' }, error: null })
  return chain
}

let mockChain: ReturnType<typeof mockSupabaseChain>

vi.mock('@/utils/supabase/client', () => ({
  createClient: () => mockChain,
}))

// --- useNotificationScheduler mock ---
const mockCancelNotifications = vi.fn().mockResolvedValue(undefined)
vi.mock('@/hooks/useNotificationScheduler', () => ({
  useNotificationScheduler: () => ({
    cancelNotifications: mockCancelNotifications,
    scheduleNotifications: vi.fn(),
  }),
}))

// --- useUndoRedo mock ---
const mockPushAction = vi.fn()
const mockUndo = vi.fn().mockResolvedValue(null)
const mockRedo = vi.fn().mockResolvedValue(null)
const mockCanUndo = vi.fn().mockReturnValue(false)
const mockCanRedo = vi.fn().mockReturnValue(false)
const mockClear = vi.fn()

vi.mock('@/hooks/useUndoRedo', () => ({
  useUndoRedo: () => ({
    pushAction: mockPushAction,
    undo: mockUndo,
    redo: mockRedo,
    canUndo: mockCanUndo,
    canRedo: mockCanRedo,
    clear: mockClear,
  }),
}))

// --- fetch mock ---
const mockFetch = vi.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({ success: true }),
  text: () => Promise.resolve(''),
})
vi.stubGlobal('fetch', mockFetch)

// --- crypto.randomUUID mock ---
let uuidCounter = 0
vi.stubGlobal('crypto', {
  randomUUID: () => `test-uuid-${++uuidCounter}`,
})

// --- Test helpers ---
function createMockTask(overrides: Partial<Task> = {}): Task {
  return {
    id: `task-${Math.random().toString(36).slice(2, 8)}`,
    user_id: 'user-1',
    project_id: 'project-1',
    parent_task_id: null,
    is_group: false,
    title: 'Test Task',
    status: 'todo',
    stage: 'plan',
    priority: null,
    order_index: 0,
    scheduled_at: null,
    estimated_time: 0,
    actual_time_minutes: 0,
    google_event_id: null,
    calendar_event_id: null,
    calendar_id: null,
    total_elapsed_seconds: 0,
    last_started_at: null,
    is_timer_running: false,
    source: 'manual',
    deleted_at: null,
    google_event_fingerprint: null,
    is_habit: false,
    habit_frequency: null,
    habit_icon: null,
    habit_start_date: null,
    habit_end_date: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

// ルートタスク（グループ）作成ヘルパー
function createMockRootTask(overrides: Partial<Task> = {}): Task {
  return createMockTask({
    id: `root-${Math.random().toString(36).slice(2, 8)}`,
    is_group: true,
    title: 'Test Root Task',
    ...overrides,
  })
}

// 安定した参照の defaultProps（renderHookの外で定義）
const EMPTY_ROOT_TASKS: Task[] = []
const EMPTY_TASKS: Task[] = []

// --- Tests ---

beforeEach(() => {
  vi.clearAllMocks()
  uuidCounter = 0
  mockChain = mockSupabaseChain()
})

describe('useMindMapSync', () => {
  // ===========================
  // groups / tasks 計算プロパティ
  // ===========================
  describe('groups / tasks 計算プロパティ', () => {
    test('初期データからルートタスク(groups)と子タスク(tasks)を正しく分離する', () => {
      const group1 = createMockRootTask({ id: 'g1', title: 'Group 1', order_index: 0 })
      const group2 = createMockRootTask({ id: 'g2', title: 'Group 2', order_index: 1 })
      const task1 = createMockTask({ id: 't1', parent_task_id: 'g1', order_index: 0 })
      const task2 = createMockTask({ id: 't2', parent_task_id: 'g1', order_index: 1 })
      const task3 = createMockTask({ id: 't3', parent_task_id: 'g2', order_index: 0 })

      // renderHook外で安定した参照のpropsを作成
      // （useEffectの依存配列で無限ループを防止）
      const initialRootTasks = [group1, group2]
      const initialTasks = [task1, task2, task3]

      const { result } = renderHook(() =>
        useMindMapSync({
          projectId: 'project-1',
          userId: 'user-1',
          initialRootTasks,
          initialTasks,
        })
      )

      // groups = ルートタスク (parent_task_id === null)
      expect(result.current.groups).toHaveLength(2)
      expect(result.current.groups[0].title).toBe('Group 1')
      expect(result.current.groups[1].title).toBe('Group 2')

      // tasks = 子タスク (parent_task_id !== null)
      expect(result.current.tasks).toHaveLength(3)
    })

    test('order_index でソートされる', () => {
      const group1 = createMockRootTask({ id: 'g1', title: 'Second', order_index: 1 })
      const group2 = createMockRootTask({ id: 'g2', title: 'First', order_index: 0 })
      const initialRootTasks = [group1, group2]

      const { result } = renderHook(() =>
        useMindMapSync({
          projectId: 'project-1',
          userId: 'user-1',
          initialRootTasks,
          initialTasks: EMPTY_TASKS,
        })
      )

      expect(result.current.groups[0].title).toBe('First')
      expect(result.current.groups[1].title).toBe('Second')
    })
  })

  // ===========================
  // createGroup
  // ===========================
  describe('createGroup', () => {
    test('楽観的にグループを作成しstateに追加する', async () => {
      const { result } = renderHook(() =>
        useMindMapSync({
          projectId: 'project-1',
          userId: 'user-1',
          initialRootTasks: EMPTY_ROOT_TASKS,
          initialTasks: EMPTY_TASKS,
        })
      )

      let newGroup: Task | null = null
      await act(async () => {
        newGroup = await result.current.createGroup('New Group')
      })

      expect(newGroup).not.toBeNull()
      expect(newGroup!.title).toBe('New Group')
      expect(newGroup!.is_group).toBe(true)
      expect(newGroup!.parent_task_id).toBeNull()
      expect(result.current.groups).toHaveLength(1)
      expect(result.current.groups[0].title).toBe('New Group')
    })

    test('projectIdがnullの場合nullを返す', async () => {
      const { result } = renderHook(() =>
        useMindMapSync({
          projectId: null,
          userId: 'user-1',
          initialRootTasks: EMPTY_ROOT_TASKS,
          initialTasks: EMPTY_TASKS,
        })
      )

      let newGroup: Task | null = null
      await act(async () => {
        newGroup = await result.current.createGroup('New Group')
      })

      expect(newGroup).toBeNull()
      expect(result.current.groups).toHaveLength(0)
    })

    test('undo/redoアクションがpushされる', async () => {
      const { result } = renderHook(() =>
        useMindMapSync({
          projectId: 'project-1',
          userId: 'user-1',
          initialRootTasks: EMPTY_ROOT_TASKS,
          initialTasks: EMPTY_TASKS,
        })
      )

      await act(async () => {
        await result.current.createGroup('Undo Test')
      })

      expect(mockPushAction).toHaveBeenCalledTimes(1)
      expect(mockPushAction).toHaveBeenCalledWith(
        expect.objectContaining({
          description: expect.stringContaining('Undo Test'),
        })
      )
    })
  })

  // ===========================
  // createTask
  // ===========================
  describe('createTask', () => {
    test('楽観的にタスクを作成しstateに追加する', async () => {
      const group = createMockRootTask({ id: 'g1', title: 'Group' })
      const initialRootTasks = [group]

      const { result } = renderHook(() =>
        useMindMapSync({
          projectId: 'project-1',
          userId: 'user-1',
          initialRootTasks,
          initialTasks: EMPTY_TASKS,
        })
      )

      let newTask: Task | null = null
      await act(async () => {
        newTask = await result.current.createTask('g1', 'New Task')
      })

      expect(newTask).not.toBeNull()
      expect(newTask!.title).toBe('New Task')
      expect(newTask!.parent_task_id).toBe('g1')
      expect(newTask!.is_group).toBe(false)
      expect(result.current.tasks).toHaveLength(1)
    })

    test('parentTaskId指定時に正しいparent_task_idを設定する', async () => {
      const group = createMockRootTask({ id: 'g1', title: 'Group' })
      const parentTask = createMockTask({ id: 't1', parent_task_id: 'g1' })
      const initialRootTasks = [group]
      const initialTasks = [parentTask]

      const { result } = renderHook(() =>
        useMindMapSync({
          projectId: 'project-1',
          userId: 'user-1',
          initialRootTasks,
          initialTasks,
        })
      )

      let newTask: Task | null = null
      await act(async () => {
        newTask = await result.current.createTask('g1', 'Child Task', 't1')
      })

      expect(newTask!.parent_task_id).toBe('t1')
    })
  })

  // ===========================
  // updateTask
  // ===========================
  describe('updateTask', () => {
    test('stateを楽観的に更新する', async () => {
      const group = createMockRootTask({ id: 'g1' })
      const task = createMockTask({ id: 't1', parent_task_id: 'g1', title: 'Old Title' })
      const initialRootTasks = [group]
      const initialTasks = [task]

      const { result } = renderHook(() =>
        useMindMapSync({
          projectId: 'project-1',
          userId: 'user-1',
          initialRootTasks,
          initialTasks,
        })
      )

      await act(async () => {
        await result.current.updateTask('t1', { title: 'New Title' })
      })

      expect(result.current.tasks.find(t => t.id === 't1')?.title).toBe('New Title')
    })

    test('status=doneで全兄弟が完了なら親を自動完了する', async () => {
      const group = createMockRootTask({ id: 'g1' })
      const task1 = createMockTask({ id: 't1', parent_task_id: 'g1', status: 'done' })
      const task2 = createMockTask({ id: 't2', parent_task_id: 'g1', status: 'todo' })
      const initialRootTasks = [group]
      const initialTasks = [task1, task2]

      const { result } = renderHook(() =>
        useMindMapSync({
          projectId: 'project-1',
          userId: 'user-1',
          initialRootTasks,
          initialTasks,
        })
      )

      // t2 を done にする → 全兄弟が done → 親(g1) も done
      await act(async () => {
        await result.current.updateTask('t2', { status: 'done' })
      })

      // 親グループの status が 'done' に自動変更
      const parentGroup = result.current.groups.find(g => g.id === 'g1')
      expect(parentGroup?.status).toBe('done')
      expect(
        mockFetch.mock.calls.some(([url, init]) =>
          url === '/api/tasks/g1' &&
          typeof init === 'object' &&
          init &&
          'body' in init &&
          JSON.parse(String((init as RequestInit).body)).status === 'done'
        )
      ).toBe(true)
    })

    test('status=todoで親がdoneなら親を自動未完了に戻す', async () => {
      const group = createMockRootTask({ id: 'g1' })
      const task1 = createMockTask({ id: 't1', parent_task_id: 'g1', status: 'done' })
      const initialRootTasks = [group]
      const initialTasks = [task1]

      const { result } = renderHook(() =>
        useMindMapSync({
          projectId: 'project-1',
          userId: 'user-1',
          initialRootTasks,
          initialTasks,
        })
      )

      // まず親の status を done にする（t1がdone → 全兄弟done → 親auto-complete）
      await act(async () => {
        await result.current.updateTask('t1', { status: 'done' })
      })

      // 次に t1 を todo に戻す → 親を auto-uncomplete
      await act(async () => {
        await result.current.updateTask('t1', { status: 'todo' })
      })

      const parentGroup = result.current.groups.find(g => g.id === 'g1')
      expect(parentGroup?.status).toBe('todo')
      expect(
        mockFetch.mock.calls.some(([url, init]) =>
          url === '/api/tasks/g1' &&
          typeof init === 'object' &&
          init &&
          'body' in init &&
          JSON.parse(String((init as RequestInit).body)).status === 'todo'
        )
      ).toBe(true)
    })
  })

  // ===========================
  // deleteTask
  // ===========================
  describe('deleteTask', () => {
    test('タスクと子孫を一括削除する', async () => {
      const group = createMockRootTask({ id: 'g1' })
      const parentTask = createMockTask({ id: 't1', parent_task_id: 'g1' })
      const childTask = createMockTask({ id: 't2', parent_task_id: 't1' })
      const initialRootTasks = [group]
      const initialTasks = [parentTask, childTask]

      const { result } = renderHook(() =>
        useMindMapSync({
          projectId: 'project-1',
          userId: 'user-1',
          initialRootTasks,
          initialTasks,
        })
      )

      expect(result.current.tasks).toHaveLength(2)

      await act(async () => {
        await result.current.deleteTask('t1')
      })

      // t1 と子孫の t2 両方が削除される
      expect(result.current.tasks).toHaveLength(0)
    })

    test('通知をキャンセルする', async () => {
      const group = createMockRootTask({ id: 'g1' })
      const task = createMockTask({ id: 't1', parent_task_id: 'g1' })
      const initialRootTasks = [group]
      const initialTasks = [task]

      const { result } = renderHook(() =>
        useMindMapSync({
          projectId: 'project-1',
          userId: 'user-1',
          initialRootTasks,
          initialTasks,
        })
      )

      await act(async () => {
        await result.current.deleteTask('t1')
      })

      expect(mockCancelNotifications).toHaveBeenCalledWith('task', 't1')
    })
  })

  // ===========================
  // deleteGroup
  // ===========================
  describe('deleteGroup', () => {
    test('グループと配下のタスクを全て削除する', async () => {
      const group = createMockRootTask({ id: 'g1' })
      const task1 = createMockTask({ id: 't1', parent_task_id: 'g1' })
      const task2 = createMockTask({ id: 't2', parent_task_id: 'g1' })
      const initialRootTasks = [group]
      const initialTasks = [task1, task2]

      const { result } = renderHook(() =>
        useMindMapSync({
          projectId: 'project-1',
          userId: 'user-1',
          initialRootTasks,
          initialTasks,
        })
      )

      expect(result.current.groups).toHaveLength(1)
      expect(result.current.tasks).toHaveLength(2)

      await act(async () => {
        await result.current.deleteGroup('g1')
      })

      expect(result.current.groups).toHaveLength(0)
      expect(result.current.tasks).toHaveLength(0)
    })
  })

  // ===========================
  // moveTask
  // ===========================
  describe('moveTask', () => {
    test('parent_task_idを変更する', async () => {
      const group1 = createMockRootTask({ id: 'g1', order_index: 0 })
      const group2 = createMockRootTask({ id: 'g2', order_index: 1 })
      const task = createMockTask({ id: 't1', parent_task_id: 'g1' })
      const initialRootTasks = [group1, group2]
      const initialTasks = [task]

      const { result } = renderHook(() =>
        useMindMapSync({
          projectId: 'project-1',
          userId: 'user-1',
          initialRootTasks,
          initialTasks,
        })
      )

      await act(async () => {
        await result.current.moveTask('t1', 'g2')
      })

      const movedTask = result.current.tasks.find(t => t.id === 't1')
      expect(movedTask?.parent_task_id).toBe('g2')
    })
  })

  // ===========================
  // getChildTasks / getParentTasks
  // ===========================
  describe('getChildTasks / getParentTasks', () => {
    test('指定された親の子タスクをorder_index順で返す', () => {
      const group = createMockRootTask({ id: 'g1' })
      const task1 = createMockTask({ id: 't1', parent_task_id: 'g1', order_index: 1, title: 'Second' })
      const task2 = createMockTask({ id: 't2', parent_task_id: 'g1', order_index: 0, title: 'First' })
      const task3 = createMockTask({ id: 't3', parent_task_id: 'g1', order_index: 2, title: 'Third' })
      const initialRootTasks = [group]
      const initialTasks = [task1, task2, task3]

      const { result } = renderHook(() =>
        useMindMapSync({
          projectId: 'project-1',
          userId: 'user-1',
          initialRootTasks,
          initialTasks,
        })
      )

      const children = result.current.getChildTasks('g1')
      expect(children).toHaveLength(3)
      expect(children[0].title).toBe('First')
      expect(children[1].title).toBe('Second')
      expect(children[2].title).toBe('Third')
    })

    test('getParentTasksはgetChildTasksと同じ結果を返す', () => {
      const group = createMockRootTask({ id: 'g1' })
      const task = createMockTask({ id: 't1', parent_task_id: 'g1' })
      const initialRootTasks = [group]
      const initialTasks = [task]

      const { result } = renderHook(() =>
        useMindMapSync({
          projectId: 'project-1',
          userId: 'user-1',
          initialRootTasks,
          initialTasks,
        })
      )

      const childTasks = result.current.getChildTasks('g1')
      const parentTasks = result.current.getParentTasks('g1')
      expect(childTasks).toEqual(parentTasks)
    })
  })

  // ===========================
  // reorderTask
  // ===========================
  describe('reorderTask', () => {
    test('above位置に正しく並び替える', async () => {
      const group = createMockRootTask({ id: 'g1' })
      const task1 = createMockTask({ id: 't1', parent_task_id: 'g1', order_index: 0, title: 'Task 1' })
      const task2 = createMockTask({ id: 't2', parent_task_id: 'g1', order_index: 1, title: 'Task 2' })
      const task3 = createMockTask({ id: 't3', parent_task_id: 'g1', order_index: 2, title: 'Task 3' })
      const initialRootTasks = [group]
      const initialTasks = [task1, task2, task3]

      const { result } = renderHook(() =>
        useMindMapSync({
          projectId: 'project-1',
          userId: 'user-1',
          initialRootTasks,
          initialTasks,
        })
      )

      // t3 を t1 の上に移動
      await act(async () => {
        await result.current.reorderTask('t3', 't1', 'above')
      })

      const children = result.current.getChildTasks('g1')
      expect(children[0].id).toBe('t3')
      expect(children[1].id).toBe('t1')
      expect(children[2].id).toBe('t2')
    })

    test('below位置に正しく並び替える', async () => {
      const group = createMockRootTask({ id: 'g1' })
      const task1 = createMockTask({ id: 't1', parent_task_id: 'g1', order_index: 0, title: 'Task 1' })
      const task2 = createMockTask({ id: 't2', parent_task_id: 'g1', order_index: 1, title: 'Task 2' })
      const task3 = createMockTask({ id: 't3', parent_task_id: 'g1', order_index: 2, title: 'Task 3' })
      const initialRootTasks = [group]
      const initialTasks = [task1, task2, task3]

      const { result } = renderHook(() =>
        useMindMapSync({
          projectId: 'project-1',
          userId: 'user-1',
          initialRootTasks,
          initialTasks,
        })
      )

      // t1 を t3 の下に移動
      await act(async () => {
        await result.current.reorderTask('t1', 't3', 'below')
      })

      const children = result.current.getChildTasks('g1')
      expect(children[0].id).toBe('t2')
      expect(children[1].id).toBe('t3')
      expect(children[2].id).toBe('t1')
    })
  })

  // ===========================
  // promoteTaskToGroup
  // ===========================
  describe('promoteTaskToGroup', () => {
    test('タスクをルートに昇格する', async () => {
      const group = createMockRootTask({ id: 'g1', order_index: 0 })
      const task = createMockTask({ id: 't1', parent_task_id: 'g1', title: 'Promoted' })
      const initialRootTasks = [group]
      const initialTasks = [task]

      const { result } = renderHook(() =>
        useMindMapSync({
          projectId: 'project-1',
          userId: 'user-1',
          initialRootTasks,
          initialTasks,
        })
      )

      expect(result.current.groups).toHaveLength(1)
      expect(result.current.tasks).toHaveLength(1)

      await act(async () => {
        await result.current.promoteTaskToGroup('t1')
      })

      // t1 がルートタスク(group)になる
      expect(result.current.groups).toHaveLength(2)
      expect(result.current.tasks).toHaveLength(0)

      const promoted = result.current.groups.find(g => g.id === 't1')
      expect(promoted?.parent_task_id).toBeNull()
      expect(promoted?.title).toBe('Promoted')
    })

    test('既にルートタスクの場合は何もしない', async () => {
      const group = createMockRootTask({ id: 'g1', order_index: 0 })
      const initialRootTasks = [group]

      const { result } = renderHook(() =>
        useMindMapSync({
          projectId: 'project-1',
          userId: 'user-1',
          initialRootTasks,
          initialTasks: EMPTY_TASKS,
        })
      )

      const groupsBefore = result.current.groups.length

      await act(async () => {
        await result.current.promoteTaskToGroup('g1')
      })

      expect(result.current.groups).toHaveLength(groupsBefore)
    })
  })

  // ===========================
  // bulkDelete
  // ===========================
  describe('bulkDelete', () => {
    test('複数タスクと子孫を一括削除する', async () => {
      const group = createMockRootTask({ id: 'g1' })
      const task1 = createMockTask({ id: 't1', parent_task_id: 'g1' })
      const task2 = createMockTask({ id: 't2', parent_task_id: 'g1' })
      const child1 = createMockTask({ id: 'c1', parent_task_id: 't1' })
      const initialRootTasks = [group]
      const initialTasks = [task1, task2, child1]

      const { result } = renderHook(() =>
        useMindMapSync({
          projectId: 'project-1',
          userId: 'user-1',
          initialRootTasks,
          initialTasks,
        })
      )

      expect(result.current.tasks).toHaveLength(3)

      await act(async () => {
        await result.current.bulkDelete([], ['t1', 't2'])
      })

      // t1, t2, c1 (t1の子) 全て削除
      expect(result.current.tasks).toHaveLength(0)
    })

    test('グループごと一括削除できる', async () => {
      const group1 = createMockRootTask({ id: 'g1', order_index: 0 })
      const group2 = createMockRootTask({ id: 'g2', order_index: 1 })
      const task1 = createMockTask({ id: 't1', parent_task_id: 'g1' })
      const initialRootTasks = [group1, group2]
      const initialTasks = [task1]

      const { result } = renderHook(() =>
        useMindMapSync({
          projectId: 'project-1',
          userId: 'user-1',
          initialRootTasks,
          initialTasks,
        })
      )

      await act(async () => {
        await result.current.bulkDelete(['g1'], [])
      })

      // g1 と配下の t1 が削除、g2 は残る
      expect(result.current.groups).toHaveLength(1)
      expect(result.current.groups[0].id).toBe('g2')
      expect(result.current.tasks).toHaveLength(0)
    })
  })

  // ===========================
  // updateGroupTitle
  // ===========================
  describe('updateGroupTitle', () => {
    test('グループタイトルを楽観的に更新する', async () => {
      const group = createMockRootTask({ id: 'g1', title: 'Old Title' })
      const initialRootTasks = [group]

      const { result } = renderHook(() =>
        useMindMapSync({
          projectId: 'project-1',
          userId: 'user-1',
          initialRootTasks,
          initialTasks: EMPTY_TASKS,
        })
      )

      await act(async () => {
        await result.current.updateGroupTitle('g1', 'New Title')
      })

      expect(result.current.groups[0].title).toBe('New Title')
    })
  })

  // ===========================
  // updateProjectTitle
  // ===========================
  describe('updateProjectTitle', () => {
    test('プロジェクトタイトルをSupabaseで更新する', async () => {
      const { result } = renderHook(() =>
        useMindMapSync({
          projectId: 'project-1',
          userId: 'user-1',
          initialRootTasks: EMPTY_ROOT_TASKS,
          initialTasks: EMPTY_TASKS,
        })
      )

      await act(async () => {
        await result.current.updateProjectTitle('project-1', 'New Project Title')
      })

      expect(mockChain.from).toHaveBeenCalledWith('projects')
    })
  })

  // ===========================
  // isLoading
  // ===========================
  describe('isLoading', () => {
    test('初期値はfalse', () => {
      const { result } = renderHook(() =>
        useMindMapSync({
          projectId: 'project-1',
          userId: 'user-1',
          initialRootTasks: EMPTY_ROOT_TASKS,
          initialTasks: EMPTY_TASKS,
        })
      )
      expect(result.current.isLoading).toBe(false)
    })
  })
})
