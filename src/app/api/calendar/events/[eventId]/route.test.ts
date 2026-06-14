import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
  mockGetUser,
  mockCalendarGet,
  mockCalendarMove,
  mockCalendarUpdate,
  setTaskSourceCalendarId,
  setExistingCalendarEvent,
  setWritableCalendars,
  createQuery,
} = vi.hoisted(() => {
  type Filter = { column: string; value: unknown };
  type ExistingEvent = { id: string; calendar_id: string; google_event_id: string } | null;
  type WritableCalendar = { google_calendar_id: string; access_level: string | null };

  let taskSourceCalendarId: string | null = null;
  let existingCalendarEvent: ExistingEvent = null;
  let writableCalendars: WritableCalendar[] = [];

  const mockGetUser = vi.fn();
  const mockCalendarGet = vi.fn();
  const mockCalendarMove = vi.fn();
  const mockCalendarUpdate = vi.fn();

  function resolveSelect(table: string, columns: string | undefined) {
    if (table === 'calendar_events') {
      if (columns === 'id, calendar_id, google_event_id') {
        return { data: existingCalendarEvent, error: null };
      }
      return { data: [], error: null };
    }

    if (table === 'tasks') {
      if (columns === 'calendar_id') {
        return {
          data: taskSourceCalendarId ? [{ calendar_id: taskSourceCalendarId }] : [],
          error: null,
        };
      }
      return { data: [], error: null };
    }

    if (table === 'user_calendars') {
      return { data: writableCalendars, error: null };
    }

    if (table === 'ideal_goals') {
      return { data: [], error: null };
    }

    return { data: [], error: null };
  }

  function createQuery(table: string) {
    const filters: Filter[] = [];
    let operation: 'select' | 'update' | 'upsert' | null = null;
    let columns: string | undefined;
    let payload: unknown;

    const query = {
      select: vi.fn((selectedColumns?: string) => {
        operation = 'select';
        columns = selectedColumns;
        return query;
      }),
      update: vi.fn((nextPayload: unknown) => {
        operation = 'update';
        payload = nextPayload;
        return query;
      }),
      delete: vi.fn(() => {
        operation = 'update';
        payload = null;
        return query;
      }),
      upsert: vi.fn((nextPayload: unknown) => {
        operation = 'upsert';
        payload = nextPayload;
        return Promise.resolve({ data: payload, error: null });
      }),
      eq: vi.fn((column: string, value: unknown) => {
        filters.push({ column, value });
        if (table === 'calendar_events' && column === 'id' && typeof value === 'string' && value.startsWith('gevt-')) {
          return Promise.resolve({
            data: null,
            error: { message: 'invalid input syntax for type uuid' },
          });
        }
        return query;
      }),
      not: vi.fn(() => query),
      in: vi.fn(() => query),
      limit: vi.fn(() => Promise.resolve(resolveSelect(table, columns))),
      maybeSingle: vi.fn(() => Promise.resolve(resolveSelect(table, columns))),
      then: (
        resolve: (value: { data: unknown; error: null }) => unknown,
        reject?: (reason: unknown) => unknown
      ) => {
        if (operation === 'update' || operation === 'upsert') {
          return Promise.resolve({ data: payload, error: null }).then(resolve, reject);
        }
        return Promise.resolve(resolveSelect(table, columns)).then(resolve, reject);
      },
    };

    return query;
  }

  return {
    mockGetUser,
    mockCalendarGet,
    mockCalendarMove,
    mockCalendarUpdate,
    setTaskSourceCalendarId: (value: string | null) => { taskSourceCalendarId = value },
    setExistingCalendarEvent: (value: ExistingEvent) => { existingCalendarEvent = value },
    setWritableCalendars: (value: WritableCalendar[]) => { writableCalendars = value },
    createQuery,
  };
});

vi.mock('@/utils/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve({
    auth: { getUser: mockGetUser },
    from: (table: string) => createQuery(table),
  })),
}));

vi.mock('@/lib/google-calendar', () => ({
  getCalendarClient: vi.fn(() => Promise.resolve({
    calendar: {
      events: {
        get: mockCalendarGet,
        move: mockCalendarMove,
        update: mockCalendarUpdate,
      },
    },
  })),
}));

import { PATCH } from './route';

const mockUser = { id: 'user-1', email: 'test@example.com' };

function patchReq(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/calendar/events/gevt-existing', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: mockUser }, error: null });
  mockCalendarMove.mockResolvedValue({ data: { id: 'gevt-existing' } });
  mockCalendarUpdate.mockResolvedValue({ data: { id: 'gevt-existing' } });
  mockCalendarGet.mockResolvedValue({ data: { id: 'gevt-existing' } });
  setExistingCalendarEvent(null);
  setTaskSourceCalendarId(null);
  setWritableCalendars([
    { google_calendar_id: 'source-cal', access_level: 'writer' },
    { google_calendar_id: 'dest-cal', access_level: 'writer' },
  ]);
});

describe('PATCH /api/calendar/events/[eventId]', () => {
  test('moves an uncached non-UUID Google event from the linked task calendar', async () => {
    setTaskSourceCalendarId('source-cal');

    const res = await PATCH(patchReq({
      title: 'Focus work',
      start_time: '2026-05-30T07:15:00.000Z',
      end_time: '2026-05-30T08:15:00.000Z',
      googleEventId: 'gevt-existing',
      calendarId: 'dest-cal',
    }) as Parameters<typeof PATCH>[0], { params: Promise.resolve({ eventId: 'gevt-existing' }) });

    expect(res.status).toBe(200);
    expect(mockCalendarMove).toHaveBeenCalledWith({
      calendarId: 'source-cal',
      eventId: 'gevt-existing',
      destination: 'dest-cal',
    });
    expect(mockCalendarUpdate).toHaveBeenCalledWith(expect.objectContaining({
      calendarId: 'dest-cal',
      eventId: 'gevt-existing',
    }));
  });

  test('discovers the source calendar when cache and task source are missing', async () => {
    mockCalendarGet.mockImplementation(({ calendarId }) => {
      if (calendarId === 'source-cal') return Promise.resolve({ data: { id: 'gevt-existing' } });
      return Promise.reject({ status: 404, message: 'Not Found' });
    });

    const res = await PATCH(patchReq({
      title: 'Focus work',
      start_time: '2026-05-30T07:15:00.000Z',
      end_time: '2026-05-30T08:15:00.000Z',
      googleEventId: 'gevt-existing',
      calendarId: 'dest-cal',
    }) as Parameters<typeof PATCH>[0], { params: Promise.resolve({ eventId: 'gevt-existing' }) });

    expect(res.status).toBe(200);
    expect(mockCalendarGet).toHaveBeenCalledWith({
      calendarId: 'source-cal',
      eventId: 'gevt-existing',
    });
    expect(mockCalendarMove).toHaveBeenCalledWith({
      calendarId: 'source-cal',
      eventId: 'gevt-existing',
      destination: 'dest-cal',
    });
  });
});
