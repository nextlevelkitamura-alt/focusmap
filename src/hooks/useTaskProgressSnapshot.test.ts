import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { fetchWithSupabaseAuth } from '@/lib/auth/supabase-auth-fetch'
import { useTaskProgressSnapshot } from './useTaskProgressSnapshot'
import type { TaskProgressSnapshotTask } from '@/types/task-progress'

vi.mock('@/lib/auth/supabase-auth-fetch', () => ({
  fetchWithSupabaseAuth: vi.fn(),
}))

const fetchWithSupabaseAuthMock = vi.mocked(fetchWithSupabaseAuth)

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

const baseTask: TaskProgressSnapshotTask = {
  id: 'task-1',
  title: 'Codex task',
  status: 'running',
  executor: 'codex_app',
  codex_thread_id: 'thread-1',
  current_step: '確認中',
  progress_percent: 40,
  summary: '処理中',
  updated_at: '2026-06-08T01:00:00.000Z',
  source_type: 'mindmap',
  source_id: 'node-1',
}

const completedTask: TaskProgressSnapshotTask = {
  ...baseTask,
  status: 'completed',
  current_step: '完了',
  summary: '処理済み',
}

describe('useTaskProgressSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('無変更の差分取得では表示用stateを更新せず、次回取得用cursorだけ進める', async () => {
    fetchWithSupabaseAuthMock
      .mockResolvedValueOnce(jsonResponse({
        source: 'turso',
        server_time: '2026-06-08T01:00:01.000Z',
        cursor: '2026-06-08T01:00:01.000Z',
        tasks: [completedTask],
      }))
      .mockResolvedValueOnce(jsonResponse({
        source: 'turso',
        server_time: '2026-06-08T01:00:02.000Z',
        cursor: '2026-06-08T01:00:02.000Z',
        tasks: [],
      }))
      .mockResolvedValueOnce(jsonResponse({
        source: 'turso',
        server_time: '2026-06-08T01:00:03.000Z',
        cursor: '2026-06-08T01:00:03.000Z',
        tasks: [],
      }))

    const { result } = renderHook(() => useTaskProgressSnapshot())

    await waitFor(() => expect(result.current.cursor).toBe('2026-06-08T01:00:01.000Z'))
    const tasksRef = result.current.tasks

    await act(async () => {
      await result.current.refresh()
    })

    expect(result.current.cursor).toBe('2026-06-08T01:00:01.000Z')
    expect(result.current.serverTime).toBe('2026-06-08T01:00:01.000Z')
    expect(result.current.tasks).toBe(tasksRef)

    await act(async () => {
      await result.current.refresh()
    })

    expect(fetchWithSupabaseAuthMock).toHaveBeenLastCalledWith(
      expect.stringContaining('updated_after=2026-06-08T01%3A00%3A02.000Z'),
    )
  })

  test('task内容が変わった時だけ表示用stateとcursorを更新する', async () => {
    fetchWithSupabaseAuthMock
      .mockResolvedValueOnce(jsonResponse({
        source: 'turso',
        server_time: '2026-06-08T01:00:01.000Z',
        cursor: '2026-06-08T01:00:01.000Z',
        tasks: [completedTask],
      }))
      .mockResolvedValueOnce(jsonResponse({
        source: 'turso',
        server_time: '2026-06-08T01:00:02.000Z',
        cursor: '2026-06-08T01:00:02.000Z',
        tasks: [{
          ...completedTask,
          current_step: '情報を更新しました',
          updated_at: '2026-06-08T01:00:02.000Z',
        }],
      }))

    const { result } = renderHook(() => useTaskProgressSnapshot())

    await waitFor(() => expect(result.current.cursor).toBe('2026-06-08T01:00:01.000Z'))

    await act(async () => {
      await result.current.refresh()
    })

    expect(result.current.cursor).toBe('2026-06-08T01:00:02.000Z')
    expect(result.current.tasks[0]?.current_step).toBe('情報を更新しました')
  })

  test('active taskを検出した直後に追加refreshし、3秒pollへ切り替える', async () => {
    fetchWithSupabaseAuthMock
      .mockResolvedValueOnce(jsonResponse({
        source: 'turso',
        server_time: '2026-06-08T01:00:01.000Z',
        cursor: '2026-06-08T01:00:01.000Z',
        tasks: [baseTask],
      }))
      .mockResolvedValueOnce(jsonResponse({
        source: 'turso',
        server_time: '2026-06-08T01:00:02.000Z',
        cursor: '2026-06-08T01:00:02.000Z',
        tasks: [],
      }))

    const { result } = renderHook(() => useTaskProgressSnapshot())

    await waitFor(() => expect(result.current.hasActive).toBe(true))
    expect(result.current.pollIntervalMs).toBe(3000)
    await waitFor(() => expect(fetchWithSupabaseAuthMock).toHaveBeenCalledTimes(2))
    expect(fetchWithSupabaseAuthMock).toHaveBeenLastCalledWith(
      expect.stringContaining('updated_after=2026-06-08T01%3A00%3A01.000Z'),
    )
  })

  test('detailOpenがfalseからtrueになった直後に追加refreshする', async () => {
    fetchWithSupabaseAuthMock
      .mockResolvedValueOnce(jsonResponse({
        source: 'turso',
        server_time: '2026-06-08T01:00:01.000Z',
        cursor: '2026-06-08T01:00:01.000Z',
        tasks: [completedTask],
      }))
      .mockResolvedValueOnce(jsonResponse({
        source: 'turso',
        server_time: '2026-06-08T01:00:02.000Z',
        cursor: '2026-06-08T01:00:02.000Z',
        tasks: [],
      }))

    const { result, rerender } = renderHook(
      ({ detailOpen }) => useTaskProgressSnapshot({ detailOpen }),
      { initialProps: { detailOpen: false } },
    )

    await waitFor(() => expect(result.current.cursor).toBe('2026-06-08T01:00:01.000Z'))

    rerender({ detailOpen: true })

    expect(result.current.pollIntervalMs).toBe(3000)
    await waitFor(() => expect(fetchWithSupabaseAuthMock).toHaveBeenCalledTimes(2))
    expect(fetchWithSupabaseAuthMock).toHaveBeenLastCalledWith(
      expect.stringContaining('updated_after=2026-06-08T01%3A00%3A01.000Z'),
    )
  })
})
