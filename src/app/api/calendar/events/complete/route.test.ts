import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
  mockGetUser,
  calendarEventsBuilder,
  eventCompletionsBuilder,
  setCalendarUpdateResult,
  setCompletionUpsertResult,
  setCompletionDeleteResult,
} = vi.hoisted(() => {
  let calendarUpdateResult: { data: unknown; error: { message: string } | null } = {
    data: [{ id: 'local-event-1', calendar_id: 'work' }],
    error: null,
  };
  let completionUpsertResult: { error: { message: string } | null } = { error: null };
  let completionDeleteResult: { error: { message: string } | null } = { error: null };

  type MockFn = ReturnType<typeof vi.fn>;
  type CalendarEventsBuilder = {
    update: MockFn;
    eq: MockFn;
    select: MockFn;
  };
  type EventCompletionsBuilder = {
    upsert: MockFn;
    delete: MockFn;
    eq: MockFn;
    then: Promise<typeof completionDeleteResult>['then'];
  };

  const calendarEventsBuilder = {} as CalendarEventsBuilder;
  calendarEventsBuilder.update = vi.fn(() => calendarEventsBuilder);
  calendarEventsBuilder.eq = vi.fn(() => calendarEventsBuilder);
  calendarEventsBuilder.select = vi.fn(() => Promise.resolve(calendarUpdateResult));

  const eventCompletionsBuilder = {} as EventCompletionsBuilder;
  eventCompletionsBuilder.upsert = vi.fn(() => Promise.resolve(completionUpsertResult));
  eventCompletionsBuilder.delete = vi.fn(() => eventCompletionsBuilder);
  eventCompletionsBuilder.eq = vi.fn(() => eventCompletionsBuilder);
  eventCompletionsBuilder.then = (resolve, reject) =>
    Promise.resolve(completionDeleteResult).then(resolve, reject);

  return {
    mockGetUser: vi.fn(),
    calendarEventsBuilder,
    eventCompletionsBuilder,
    setCalendarUpdateResult: (value: typeof calendarUpdateResult) => { calendarUpdateResult = value },
    setCompletionUpsertResult: (value: typeof completionUpsertResult) => { completionUpsertResult = value },
    setCompletionDeleteResult: (value: typeof completionDeleteResult) => { completionDeleteResult = value },
  };
});

vi.mock('@/utils/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve({
    auth: { getUser: mockGetUser },
    from: (table: string) => {
      if (table === 'calendar_events') return calendarEventsBuilder;
      if (table === 'event_completions') return eventCompletionsBuilder;
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
      onConflict: 'user_id,google_event_id,completed_date',
    });
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
      onConflict: 'user_id,google_event_id,completed_date',
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
  });
});
