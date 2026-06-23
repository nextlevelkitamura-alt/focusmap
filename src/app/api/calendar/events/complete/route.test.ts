import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
  mockGetUser,
  calendarEventsBuilder,
  eventCompletionsBuilder,
  tasksBuilder,
  setCalendarUpdateResult,
  setCompletionUpsertResult,
  setCompletionDeleteResult,
  setCompletionInsertResult,
  setTaskUpdateResult,
} = vi.hoisted(() => {
  type MockError = { code?: string; message: string } | null;

  let calendarUpdateResult: { data: unknown; error: MockError } = {
    data: [{ id: 'local-event-1', calendar_id: 'work' }],
    error: null,
  };
  let completionUpsertResult: { error: MockError } = { error: null };
  let completionDeleteResult: { error: MockError } = { error: null };
  let completionInsertResult: { error: MockError } = { error: null };
  let taskUpdateResult: { error: MockError } = { error: null };

  type MockFn = ReturnType<typeof vi.fn>;
  type CalendarEventsBuilder = {
    update: MockFn;
    eq: MockFn;
    select: MockFn;
  };
  type EventCompletionsBuilder = {
    upsert: MockFn;
    insert: MockFn;
    delete: MockFn;
    eq: MockFn;
    then: Promise<typeof completionDeleteResult>['then'];
  };
  type TasksBuilder = {
    update: MockFn;
    eq: MockFn;
    is: MockFn;
    then: Promise<typeof taskUpdateResult>['then'];
  };

  const calendarEventsBuilder = {} as CalendarEventsBuilder;
  calendarEventsBuilder.update = vi.fn(() => calendarEventsBuilder);
  calendarEventsBuilder.eq = vi.fn(() => calendarEventsBuilder);
  calendarEventsBuilder.select = vi.fn(() => Promise.resolve(calendarUpdateResult));

  const eventCompletionsBuilder = {} as EventCompletionsBuilder;
  eventCompletionsBuilder.upsert = vi.fn(() => Promise.resolve(completionUpsertResult));
  eventCompletionsBuilder.insert = vi.fn(() => Promise.resolve(completionInsertResult));
  eventCompletionsBuilder.delete = vi.fn(() => eventCompletionsBuilder);
  eventCompletionsBuilder.eq = vi.fn(() => eventCompletionsBuilder);
  eventCompletionsBuilder.then = (resolve, reject) =>
    Promise.resolve(completionDeleteResult).then(resolve, reject);

  const tasksBuilder = {} as TasksBuilder;
  tasksBuilder.update = vi.fn(() => tasksBuilder);
  tasksBuilder.eq = vi.fn(() => tasksBuilder);
  tasksBuilder.is = vi.fn(() => tasksBuilder);
  tasksBuilder.then = (resolve, reject) =>
    Promise.resolve(taskUpdateResult).then(resolve, reject);

  return {
    mockGetUser: vi.fn(),
    calendarEventsBuilder,
    eventCompletionsBuilder,
    tasksBuilder,
    setCalendarUpdateResult: (value: typeof calendarUpdateResult) => { calendarUpdateResult = value; },
    setCompletionUpsertResult: (value: typeof completionUpsertResult) => { completionUpsertResult = value; },
    setCompletionDeleteResult: (value: typeof completionDeleteResult) => { completionDeleteResult = value; },
    setCompletionInsertResult: (value: typeof completionInsertResult) => { completionInsertResult = value; },
    setTaskUpdateResult: (value: typeof taskUpdateResult) => { taskUpdateResult = value; },
  };
});

vi.mock('@/utils/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve({
    auth: { getUser: mockGetUser },
    from: (table: string) => {
      if (table === 'calendar_events') return calendarEventsBuilder;
      if (table === 'event_completions') return eventCompletionsBuilder;
      if (table === 'tasks') return tasksBuilder;
      return {};
    },
  })),
}));

import { PATCH } from './route';

const mockUser = { id: 'user-1', email: 'test@example.com' };

function patchReq(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/calendar/events/complete', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: mockUser }, error: null });
  setCalendarUpdateResult({
    data: [{ id: 'local-event-1', calendar_id: 'work' }],
    error: null,
  });
  setCompletionUpsertResult({ error: null });
  setCompletionDeleteResult({ error: null });
  setCompletionInsertResult({ error: null });
  setTaskUpdateResult({ error: null });
});

describe('PATCH /api/calendar/events/complete', () => {
  test('cached Google event updates calendar_events and records completion sidecar', async () => {
    const res = await PATCH(patchReq({
      google_event_id: 'google-event-1',
      completed_date: '2026-05-18',
      is_completed: true,
    }) as Parameters<typeof PATCH>[0]);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(calendarEventsBuilder.update).toHaveBeenCalledWith({ is_completed: true });
    expect(eventCompletionsBuilder.upsert).toHaveBeenCalledWith({
      user_id: 'user-1',
      google_event_id: 'google-event-1',
      calendar_id: 'work',
      completed_date: '2026-05-18',
    }, {
      onConflict: 'user_id,calendar_id,google_event_id,completed_date',
    });
    expect(tasksBuilder.update).toHaveBeenCalledWith({ status: 'done', stage: 'done' });
    expect(tasksBuilder.eq).toHaveBeenCalledWith('source', 'google_event');
    expect(tasksBuilder.eq).toHaveBeenCalledWith('calendar_id', 'work');
    expect(tasksBuilder.is).toHaveBeenCalledWith('deleted_at', null);
  });

  test('uncached Google event still records completion when calendar_id is provided', async () => {
    setCalendarUpdateResult({ data: [], error: null });

    const res = await PATCH(patchReq({
      google_event_id: 'google-event-2',
      calendar_id: 'work',
      completed_date: '2026-05-18',
      is_completed: true,
    }) as Parameters<typeof PATCH>[0]);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(eventCompletionsBuilder.upsert).toHaveBeenCalledWith({
      user_id: 'user-1',
      google_event_id: 'google-event-2',
      calendar_id: 'work',
      completed_date: '2026-05-18',
    }, {
      onConflict: 'user_id,calendar_id,google_event_id,completed_date',
    });
  });

  test('falls back to legacy delete/insert when composite completion conflict target is missing', async () => {
    setCompletionUpsertResult({
      error: {
        code: '42P10',
        message: 'there is no unique or exclusion constraint matching the ON CONFLICT specification',
      },
    });

    const res = await PATCH(patchReq({
      google_event_id: 'google-event-legacy',
      calendar_id: 'work',
      completed_date: '2026-05-18',
      is_completed: true,
    }) as Parameters<typeof PATCH>[0]);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(eventCompletionsBuilder.delete).toHaveBeenCalled();
    expect(eventCompletionsBuilder.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(eventCompletionsBuilder.eq).toHaveBeenCalledWith('google_event_id', 'google-event-legacy');
    expect(eventCompletionsBuilder.eq).toHaveBeenCalledWith('completed_date', '2026-05-18');
    expect(eventCompletionsBuilder.insert).toHaveBeenCalledWith({
      user_id: 'user-1',
      google_event_id: 'google-event-legacy',
      calendar_id: 'work',
      completed_date: '2026-05-18',
    });
  });

  test('unchecking deletes completion sidecar even if cache row is absent', async () => {
    setCalendarUpdateResult({ data: [], error: null });

    const res = await PATCH(patchReq({
      google_event_id: 'google-event-3',
      calendar_id: 'work',
      completed_date: '2026-05-18',
      is_completed: false,
    }) as Parameters<typeof PATCH>[0]);

    expect(res.status).toBe(200);
    expect(eventCompletionsBuilder.delete).toHaveBeenCalled();
    expect(eventCompletionsBuilder.eq).toHaveBeenCalledWith('google_event_id', 'google-event-3');
    expect(eventCompletionsBuilder.eq).toHaveBeenCalledWith('completed_date', '2026-05-18');
    expect(eventCompletionsBuilder.eq).toHaveBeenCalledWith('calendar_id', 'work');
    expect(tasksBuilder.update).toHaveBeenCalledWith({ status: 'todo', stage: 'scheduled' });
  });
});
