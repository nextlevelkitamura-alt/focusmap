import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { fetchWithSupabaseAuth } from '@/lib/auth/supabase-auth-fetch'
import type { TaskProgressSnapshotTask } from '@/types/task-progress'
import { TaskProgressKanban } from './task-progress-kanban'

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

function progressTask(overrides: Partial<TaskProgressSnapshotTask> = {}): TaskProgressSnapshotTask {
  return {
    id: 'task-1',
    title: 'Codexタスク',
    status: 'awaiting_approval',
    executor: 'codex_app',
    codex_thread_id: null,
    current_step: '確認待ちです',
    progress_percent: null,
    summary: null,
    updated_at: new Date().toISOString(),
    source_type: 'mindmap',
    source_id: 'node-1',
    ...overrides,
  }
}

function sourceTask(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    status: 'todo',
    title: id,
    deleted_at: null,
    ...overrides,
  }
}

function renderMobileKanban(
  tasks: TaskProgressSnapshotTask[] = [],
  sourceTasksById = new Map<string, ReturnType<typeof sourceTask>>(),
) {
  render(
    <TaskProgressKanban
      tasks={tasks}
      sourceTasksById={sourceTasksById}
      isMobile
      pollIntervalMs={3000}
      onRefresh={vi.fn()}
      onOpenTask={vi.fn()}
    />,
  )
}

function renderDesktopKanban({
  tasks = [progressTask({ title: '看板操作テスト' })],
  sourceTasksById = new Map([['node-1', sourceTask('node-1')]]),
  spaces,
  projects,
  selectedSpaceId,
  selectedProjectId,
  onSelectSpace,
  onSelectProject,
  closeSignal = 0,
  onOpenTask = vi.fn(),
  onRunSourceTask = vi.fn(),
  onToggleSourceTaskComplete = vi.fn(),
  onDeleteSourceTask = vi.fn(),
}: {
  tasks?: TaskProgressSnapshotTask[]
  sourceTasksById?: Map<string, ReturnType<typeof sourceTask>>
  spaces?: Array<{ id: string; title: string; user_id: string; description: string | null; status: string; default_calendar_id: string | null; icon: string | null; color: string | null; created_at: string }>
  projects?: Array<{ id: string; user_id: string; space_id: string; title: string; description: string; purpose: string | null; category_tag: string | null; priority: number; status: string; color_theme: string; repo_path: string | null; created_at: string }>
  selectedSpaceId?: string | null
  selectedProjectId?: string | null
  onSelectSpace?: ReturnType<typeof vi.fn>
  onSelectProject?: ReturnType<typeof vi.fn>
  closeSignal?: number
  onOpenTask?: ReturnType<typeof vi.fn>
  onRunSourceTask?: ReturnType<typeof vi.fn>
  onToggleSourceTaskComplete?: ReturnType<typeof vi.fn>
  onDeleteSourceTask?: ReturnType<typeof vi.fn>
} = {}) {
  const renderKanban = (nextCloseSignal = closeSignal) => (
    <TaskProgressKanban
      tasks={tasks}
      sourceTasksById={sourceTasksById}
      spaces={spaces}
      projects={projects}
      selectedSpaceId={selectedSpaceId}
      selectedProjectId={selectedProjectId}
      onSelectSpace={onSelectSpace}
      onSelectProject={onSelectProject}
      closeSignal={nextCloseSignal}
      pollIntervalMs={3000}
      onRefresh={vi.fn()}
      onOpenTask={onOpenTask}
      onRunSourceTask={onRunSourceTask}
      onToggleSourceTaskComplete={onToggleSourceTaskComplete}
      onDeleteSourceTask={onDeleteSourceTask}
    />
  )
  const view = render(renderKanban())
  return {
    ...view,
    rerenderKanban: (nextCloseSignal: number) => view.rerender(renderKanban(nextCloseSignal)),
    onOpenTask,
    onRunSourceTask,
    onToggleSourceTaskComplete,
    onDeleteSourceTask,
  }
}

describe('TaskProgressKanban', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    fetchWithSupabaseAuthMock.mockResolvedValue(jsonResponse({ source: 'turso', heartbeats: [] }))
  })

  test('スマホのCodexボタンにMac onlineを表示する', async () => {
    fetchWithSupabaseAuthMock.mockResolvedValue(jsonResponse({
      source: 'turso',
      heartbeats: [
        {
          runner_id: 'runner-1',
          status: 'online',
          last_seen_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
    }))

    renderMobileKanban()

    expect(await screen.findByText('online')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Mac状態はオンライン/ })).toBeInTheDocument()
    })
  })

  test('古いheartbeatはスマホのCodexボタンでoffline扱いにする', async () => {
    const staleSeenAt = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    fetchWithSupabaseAuthMock.mockResolvedValue(jsonResponse({
      source: 'turso',
      heartbeats: [
        {
          runner_id: 'runner-1',
          status: 'online',
          last_seen_at: staleSeenAt,
          updated_at: staleSeenAt,
        },
      ],
    }))

    renderMobileKanban()

    expect(await screen.findByText('offline')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Mac状態はオフライン/ })).toBeInTheDocument()
    })
  })

  test('非表示中はMac heartbeatを読まず、表示復帰時に読む', async () => {
    const visibilitySpy = vi.spyOn(document, 'visibilityState', 'get')
    try {
      visibilitySpy.mockReturnValue('hidden')

      renderMobileKanban()

      await new Promise(resolve => window.setTimeout(resolve, 0))
      expect(fetchWithSupabaseAuthMock).not.toHaveBeenCalled()

      visibilitySpy.mockReturnValue('visible')
      document.dispatchEvent(new Event('visibilitychange'))

      await waitFor(() => {
        expect(fetchWithSupabaseAuthMock).toHaveBeenCalledTimes(1)
      })
    } finally {
      visibilitySpy.mockRestore()
    }
  })

  test('iOSアプリ復帰イベントでMac heartbeatを即再取得する', async () => {
    let nowMs = Date.now()
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => nowMs)
    try {
      renderMobileKanban()

      expect(await screen.findByText('offline')).toBeInTheDocument()
      await waitFor(() => {
        expect(fetchWithSupabaseAuthMock).toHaveBeenCalledTimes(1)
      })

      nowMs += 1_000
      act(() => {
        window.dispatchEvent(new Event('focusmap:native-app-resume'))
      })

      await waitFor(() => {
        expect(fetchWithSupabaseAuthMock).toHaveBeenCalledTimes(2)
      })
    } finally {
      nowSpy.mockRestore()
    }
  })

  test('スマホ看板はステータスタブで表示レーンを切り替える', async () => {
    renderMobileKanban([
      progressTask({
        id: 'running-task',
        title: '実行中のCodexタスク',
        status: 'running',
        source_id: 'node-running',
      }),
      progressTask({
        id: 'review-task',
        title: '確認待ちのCodexタスク',
        status: 'awaiting_approval',
        source_id: 'node-review',
      }),
    ], new Map([
      ['node-running', sourceTask('node-running')],
      ['node-review', sourceTask('node-review')],
    ]))

    fireEvent.click(await screen.findByRole('button', { name: /Codexを開く/ }))

    expect(screen.getByText('確認待ちのCodexタスク')).toBeInTheDocument()
    expect(screen.queryByText('実行中のCodexタスク')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /実行中 1件/ }))

    expect(screen.getByText('実行中のCodexタスク')).toBeInTheDocument()
    expect(screen.queryByText('確認待ちのCodexタスク')).not.toBeInTheDocument()
  })

  test('completedのCodex taskは元ノード未完了なら確認待ち、チェック済みなら完了済みに出す', async () => {
    renderMobileKanban([
      progressTask({
        id: 'completed-review',
        title: '確認が必要な完了Codex',
        status: 'completed',
        source_id: 'node-review',
      }),
      progressTask({
        id: 'completed-done',
        title: 'チェック済みCodex',
        status: 'completed',
        source_id: 'node-done',
      }),
    ], new Map([
      ['node-review', sourceTask('node-review')],
      ['node-done', sourceTask('node-done', { status: 'done' })],
    ]))

    fireEvent.click(await screen.findByRole('button', { name: /Codexを開く/ }))

    expect(screen.getByRole('tab', { name: /確認待ち 1件/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /完了済み 1件/ })).toBeInTheDocument()
    expect(screen.getByText('確認が必要な完了Codex')).toBeInTheDocument()
    expect(screen.queryByText('チェック済みCodex')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /完了済み 1件/ }))

    expect(screen.getByText('チェック済みCodex')).toBeInTheDocument()
    expect(screen.queryByText('確認が必要な完了Codex')).not.toBeInTheDocument()
  })

  test('マインドマップから削除済みのCodex taskは看板に出さない', async () => {
    renderMobileKanban([
      progressTask({
        id: 'visible-task',
        title: '残っているノードのCodexタスク',
        source_id: 'node-visible',
      }),
      progressTask({
        id: 'deleted-task',
        title: '削除済みノードのCodexタスク',
        source_id: 'node-deleted',
      }),
    ], new Map([
      ['node-visible', sourceTask('node-visible')],
    ]))

    fireEvent.click(await screen.findByRole('button', { name: /Codexを開く/ }))

    expect(screen.getByText('残っているノードのCodexタスク')).toBeInTheDocument()
    expect(screen.queryByText('削除済みノードのCodexタスク')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /確認待ち 1件/ })).toBeInTheDocument()
  })

  test('現在のマップノードに紐づかないCodex taskは看板に出さない', async () => {
    renderMobileKanban([
      progressTask({
        id: 'visible-task',
        title: '現在ノードのCodexタスク',
        source_id: 'node-visible',
      }),
      progressTask({
        id: 'unscoped-task',
        title: '紐付かない古いCodexタスク',
        source_type: null,
        source_id: null,
      }),
    ], new Map([
      ['node-visible', sourceTask('node-visible')],
    ]))

    fireEvent.click(await screen.findByRole('button', { name: /Codexを開く/ }))

    expect(screen.getByText('現在ノードのCodexタスク')).toBeInTheDocument()
    expect(screen.queryByText('紐付かない古いCodexタスク')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /確認待ち 1件/ })).toBeInTheDocument()
  })

  test('スマホCodexシートはAIチャット履歴カードを長押しドラッグで配置へ進める', async () => {
    const onMobileImportDrag = vi.fn()
    const onOpenTask = vi.fn()
    const importItem = {
      id: 'chat-node-1',
      aiTaskId: 'ai-task-1',
      title: 'チャットがアーカイブされたのか',
      snippet: 'この確認に必要な返信期限と背景を取り込む',
      repoPath: '/Users/me/focusmap',
      threadId: 'thread-abcdef123456',
      status: 'awaiting_approval',
      statusLabel: '確認待ち',
      updatedLabel: '最終 6/12 08:10',
      updatedAtIso: '2026-06-12T08:10:00.000Z',
    }

    const { rerender } = render(
      <TaskProgressKanban
        tasks={[]}
        sourceTasksById={new Map()}
        isMobile
        mobileTriggerVisible={false}
        mobileOpenSignal={0}
        mobileImportItems={[importItem]}
        pollIntervalMs={3000}
        onRefresh={vi.fn()}
        onOpenTask={onOpenTask}
        onMobileImportDrag={onMobileImportDrag}
      />
    )

    expect(screen.queryByRole('button', { name: /Codexを開く/ })).not.toBeInTheDocument()

    rerender(
      <TaskProgressKanban
        tasks={[]}
        sourceTasksById={new Map()}
        isMobile
        mobileTriggerVisible={false}
        mobileOpenSignal={1}
        mobileImportItems={[importItem]}
        pollIntervalMs={3000}
        onRefresh={vi.fn()}
        onOpenTask={onOpenTask}
        onMobileImportDrag={onMobileImportDrag}
      />
    )

    expect(await screen.findByText('AIチャット履歴')).toBeInTheDocument()
    expect(await screen.findByText('チャットがアーカイブされたのか')).toBeInTheDocument()
    expect(screen.getByText('この確認に必要な返信期限と背景を取り込む')).toBeInTheDocument()
    expect(screen.getByText('focusmap')).toBeInTheDocument()
    expect(screen.queryByText(/thread-abcdef123456/)).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /確認待ち 1件/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Codexチャットを開く/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '履歴を見る' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '配置先を選ぶ' })).not.toBeInTheDocument()

    const row = screen.getByLabelText('「チャットがアーカイブされたのか」のチャットを見る')
    vi.useFakeTimers()
    try {
      fireEvent.pointerDown(row, { pointerId: 8, pointerType: 'touch', button: 0, clientX: 180, clientY: 520 })
      act(() => {
        vi.advanceTimersByTime(650)
      })
      fireEvent.pointerMove(window, { pointerId: 8, pointerType: 'touch', clientX: 176, clientY: 480 })
      fireEvent.pointerUp(window, { pointerId: 8, pointerType: 'touch', clientX: 174, clientY: 450 })
    } finally {
      vi.useRealTimers()
    }

    expect(onMobileImportDrag).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'start',
      item: importItem,
      clientY: 520,
    }))
    expect(onMobileImportDrag).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'end',
      item: importItem,
      clientY: 450,
    }))
    expect(onOpenTask).not.toHaveBeenCalled()
  })

  test('スマホAIチャット履歴カードから履歴を削除できる', async () => {
    const onDeleteSourceTask = vi.fn().mockResolvedValue(undefined)
    const importItem = {
      id: 'chat-node-delete',
      aiTaskId: 'ai-task-delete',
      title: '削除するCodex履歴',
      snippet: '不要な履歴',
      repoPath: '/Users/me/focusmap',
      threadId: 'thread-delete',
      status: 'awaiting_approval',
      statusLabel: '確認待ち',
      updatedLabel: '最終 6/12 08:10',
      updatedAtIso: '2026-06-12T08:10:00.000Z',
    }

    const renderKanban = (mobileOpenSignal: number) => (
      <TaskProgressKanban
        tasks={[]}
        sourceTasksById={new Map()}
        isMobile
        mobileTriggerVisible={false}
        mobileOpenSignal={mobileOpenSignal}
        mobileImportItems={[importItem]}
        pollIntervalMs={3000}
        onRefresh={vi.fn()}
        onOpenTask={vi.fn()}
        onDeleteSourceTask={onDeleteSourceTask}
      />
    )
    const { rerender } = render(renderKanban(0))
    rerender(renderKanban(1))

    fireEvent.click(await screen.findByRole('button', { name: 'AIチャット履歴を削除 削除するCodex履歴' }))

    await waitFor(() => {
      expect(onDeleteSourceTask).toHaveBeenCalledWith('chat-node-delete')
    })
  })

  test('スマホAIチャット履歴はステータス横スクロールタブで絞り込める', async () => {
    const reviewItem = {
      id: 'chat-review',
      aiTaskId: 'ai-review',
      title: '確認待ちチャット',
      snippet: '確認が必要な履歴',
      repoPath: '/Users/me/focusmap',
      threadId: 'thread-review',
      status: 'awaiting_approval',
      statusLabel: '確認待ち',
      updatedLabel: '最終 6/12 08:10',
      updatedAtIso: '2026-06-12T08:10:00.000Z',
    }
    const runningItem = {
      id: 'chat-running',
      aiTaskId: 'ai-running',
      title: '実行中チャット',
      snippet: 'Codexが処理している履歴',
      repoPath: '/Users/me/focusmap',
      threadId: 'thread-running',
      status: 'running',
      statusLabel: '実行中',
      updatedLabel: '最終 6/12 09:20',
      updatedAtIso: '2026-06-12T09:20:00.000Z',
    }

    const renderKanban = (mobileOpenSignal: number) => (
      <TaskProgressKanban
        tasks={[]}
        sourceTasksById={new Map()}
        isMobile
        mobileTriggerVisible={false}
        mobileOpenSignal={mobileOpenSignal}
        mobileImportItems={[reviewItem, runningItem]}
        pollIntervalMs={3000}
        onRefresh={vi.fn()}
        onOpenTask={vi.fn()}
      />
    )
    const { rerender } = render(renderKanban(0))
    rerender(renderKanban(1))

    expect(await screen.findByText('確認待ちチャット')).toBeInTheDocument()
    expect(screen.queryByText('実行中チャット')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /実行中 1件/ }))

    expect(screen.getByText('実行中チャット')).toBeInTheDocument()
    expect(screen.queryByText('確認待ちチャット')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /すべて 2件/ }))

    expect(screen.getByText('確認待ちチャット')).toBeInTheDocument()
    expect(screen.getByText('実行中チャット')).toBeInTheDocument()
  })

  test('スマホ取り込みカードからチャット詳細を開き戻るでAIチャット履歴一覧へ復帰できる', async () => {
    const onOpenTask = vi.fn()
    fetchWithSupabaseAuthMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url === '/api/codex/sync-node') return jsonResponse({ success: true, task_id: 'ai-task-1' })
      if (url.startsWith('/api/ai-tasks/ai-task-1/activity')) {
        return jsonResponse({
          messages: [
            {
              id: 'msg-user',
              task_id: 'ai-task-1',
              user_id: 'user-1',
              role: 'user',
              kind: 'sent',
              body: 'スマホでもチャット詳細を全画面で開く',
              importance: 'normal',
              metadata: {},
              created_at: '2026-06-12T09:20:00.000Z',
            },
            {
              id: 'msg-status',
              task_id: 'ai-task-1',
              user_id: 'user-1',
              role: 'status',
              kind: 'progress',
              body: 'プロジェクト更新完了',
              importance: 'normal',
              metadata: {},
              created_at: '2026-06-12T09:20:30.000Z',
            },
            {
              id: 'msg-codex',
              task_id: 'ai-task-1',
              user_id: 'user-1',
              role: 'codex',
              kind: 'progress',
              body: 'Codexの返答をチャット形式で表示します',
              importance: 'normal',
              metadata: {},
              created_at: '2026-06-12T09:21:00.000Z',
            },
          ],
        })
      }
      return jsonResponse({ source: 'turso', heartbeats: [] })
    })
    const importItem = {
      id: 'chat-node-1',
      aiTaskId: 'ai-task-1',
      title: '実行中チャットを見る',
      snippet: 'スマホでもチャット詳細を全画面で開く',
      repoPath: '/Users/me/focusmap',
      threadId: 'thread-running123',
      status: 'running',
      statusLabel: '実行中',
      updatedLabel: '最終 6/12 09:20',
      updatedAtIso: '2026-06-12T09:20:00.000Z',
    }

    const renderKanban = (mobileOpenSignal: number) => (
      <TaskProgressKanban
        tasks={[]}
        sourceTasksById={new Map()}
        isMobile
        mobileTriggerVisible={false}
        mobileOpenSignal={mobileOpenSignal}
        mobileImportItems={[importItem]}
        pollIntervalMs={3000}
        onRefresh={vi.fn()}
        onOpenTask={onOpenTask}
      />
    )
    const { rerender } = render(renderKanban(0))
    rerender(renderKanban(1))

    expect(await screen.findByText('実行中チャットを見る')).toBeInTheDocument()

    expect(screen.queryByRole('button', { name: 'チャットを見る' })).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /実行中 1件/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '履歴を見る' }))

    expect(onOpenTask).not.toHaveBeenCalled()
    expect(screen.queryByRole('tab', { name: /実行中 1件/ })).not.toBeInTheDocument()
    expect(screen.getByText('実行中チャットを見る')).toBeInTheDocument()
    expect(screen.queryByText('AIチャット履歴')).not.toBeInTheDocument()
    expect(screen.getByText('実行中')).toBeInTheDocument()
    expect(screen.getByText('focusmap')).toBeInTheDocument()
    expect(screen.getByText('最終 6/12 09:20')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Codexで開く' })).toHaveAttribute(
      'href',
      'codex://threads/thread-running123',
    )
    expect(screen.queryByText('質問してみましょう')).not.toBeInTheDocument()
    expect(screen.queryByText('プロジェクト更新完了')).not.toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('Codexの返答をチャット形式で表示します')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: '戻る' }))

    expect(screen.getByRole('tab', { name: /実行中 1件/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '履歴を見る' })).toBeInTheDocument()
  })

  test('スマホCodexシートで取り込みリポを選択・解除・監視できる', async () => {
    fetchWithSupabaseAuthMock.mockResolvedValue(jsonResponse({
      source: 'turso',
      heartbeats: [
        {
          runner_id: 'runner-1',
          status: 'online',
          last_seen_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
    }))
    const onSelectRepoPath = vi.fn()
    const onToggleImport = vi.fn()
    const onRefreshRepos = vi.fn()

    const renderKanban = (mobileOpenSignal: number) => (
      <TaskProgressKanban
        tasks={[]}
        sourceTasksById={new Map()}
        isMobile
        mobileTriggerVisible={false}
        mobileOpenSignal={mobileOpenSignal}
        mobileImportItems={[]}
        mobileImportRepoControl={{
          selectedRepoPath: '/Users/me/work',
          selectedRepoLabel: 'work',
          importEnabled: true,
          importOwnerLabel: '仕事',
          repoOptions: [
            { id: 'work', label: 'work', path: '/Users/me/work', sourceLabel: '仕事' },
            { id: 'sns', label: 'sns', path: '/Users/me/sns', sourceLabel: 'SNS用' },
          ],
          onSelectRepoPath,
          onToggleImport,
          onRefreshRepos,
        }}
        pollIntervalMs={3000}
        onRefresh={vi.fn()}
        onOpenTask={vi.fn()}
      />
    )
    const { rerender } = render(renderKanban(0))
    rerender(renderKanban(1))

    const monitorSwitch = await screen.findByRole('switch', { name: 'リポ監視' })
    expect(monitorSwitch).toBeChecked()
    expect(screen.getByText('仕事')).toBeInTheDocument()

    fireEvent.click(monitorSwitch)
    expect(onToggleImport).toHaveBeenCalledTimes(1)

    fireEvent.change(screen.getByRole('combobox', { name: '取り込みリポを選択' }), {
      target: { value: '/Users/me/sns' },
    })
    expect(onSelectRepoPath).toHaveBeenCalledWith('/Users/me/sns')

    fireEvent.click(screen.getByRole('button', { name: 'リポ候補を更新' }))
    expect(onRefreshRepos).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'リポ選択を解除' }))
    expect(onSelectRepoPath).toHaveBeenCalledWith(null)
  })

  test('スマホCodexシートのリポ監視はMac offlineでは切り替えられない', async () => {
    const staleSeenAt = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    fetchWithSupabaseAuthMock.mockResolvedValue(jsonResponse({
      source: 'turso',
      heartbeats: [
        {
          runner_id: 'runner-1',
          status: 'online',
          last_seen_at: staleSeenAt,
          updated_at: staleSeenAt,
        },
      ],
    }))
    const onToggleImport = vi.fn()

    const renderKanban = (mobileOpenSignal: number) => (
      <TaskProgressKanban
        tasks={[]}
        sourceTasksById={new Map()}
        isMobile
        mobileTriggerVisible={false}
        mobileOpenSignal={mobileOpenSignal}
        mobileImportItems={[]}
        mobileImportRepoControl={{
          selectedRepoPath: '/Users/me/work',
          selectedRepoLabel: 'work',
          importEnabled: false,
          repoOptions: [{ id: 'work', label: 'work', path: '/Users/me/work' }],
          onToggleImport,
        }}
        pollIntervalMs={3000}
        onRefresh={vi.fn()}
        onOpenTask={vi.fn()}
      />
    )
    const { rerender } = render(renderKanban(0))
    rerender(renderKanban(1))

    const monitorSwitch = await screen.findByRole('switch', { name: 'リポ監視' })
    expect(monitorSwitch).toBeDisabled()
    fireEvent.click(monitorSwitch)
    expect(onToggleImport).not.toHaveBeenCalled()
    expect(screen.getByText('offline')).toBeInTheDocument()
  })

  test('デスクトップ看板カードから元ノードを完了チェック・削除できる', async () => {
    const callbacks = renderDesktopKanban()
    await screen.findByText('Mac offline')

    fireEvent.click(screen.getByRole('button', { expanded: false }))

    fireEvent.click(screen.getByRole('checkbox', { name: /看板操作テスト.+完了にする/ }))
    expect(callbacks.onToggleSourceTaskComplete).toHaveBeenCalledWith('node-1', true)
    expect(callbacks.onOpenTask).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /看板操作テスト.+詳細を開く/ }))
    expect(callbacks.onOpenTask).toHaveBeenCalledWith(expect.objectContaining({ id: 'task-1' }))

    fireEvent.click(screen.getByRole('button', { name: /看板操作テスト.+削除/ }))
    expect(callbacks.onDeleteSourceTask).toHaveBeenCalledWith('node-1')
    expect(callbacks.onOpenTask).toHaveBeenCalledTimes(1)
  })

  test('デスクトップ看板カードはthread IDを隠してCodexチャットボタンを出す', async () => {
    renderDesktopKanban({
      tasks: [
        progressTask({
          title: 'リンク付きCodexタスク',
          codex_thread_id: 'thread-abcdef123456',
        }),
      ],
    })
    await screen.findByText('Mac offline')

    fireEvent.click(screen.getByRole('button', { expanded: false }))

    expect(screen.queryByText(/thread-abcdef123456/)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Codexチャットを開く/ })).toHaveAttribute(
      'href',
      'codex://threads/thread-abcdef123456',
    )
  })

  test('デスクトップ看板カードの完了チェックと削除はAPI完了前に即時反映する', async () => {
    const onToggleSourceTaskComplete = vi.fn(() => new Promise<void>(() => undefined))
    const onDeleteSourceTask = vi.fn(() => new Promise<void>(() => undefined))
    renderDesktopKanban({
      onToggleSourceTaskComplete,
      onDeleteSourceTask,
    })
    await screen.findByText('Mac offline')

    fireEvent.click(screen.getByRole('button', { expanded: false }))

    fireEvent.click(screen.getByRole('checkbox', { name: /看板操作テスト.+完了にする/ }))
    expect(onToggleSourceTaskComplete).toHaveBeenCalledWith('node-1', true)
    expect(screen.getByRole('checkbox', { name: /看板操作テスト.+未完了に戻す/ })).toBeChecked()

    fireEvent.click(screen.getByRole('button', { name: /看板操作テスト.+削除/ }))
    expect(onDeleteSourceTask).toHaveBeenCalledWith('node-1')
    expect(screen.queryByText('看板操作テスト')).not.toBeInTheDocument()
  })

  test('未送信のCodex taskと進捗がないマップノードは看板に出さない', async () => {
    const callbacks = renderDesktopKanban({
      tasks: [
        progressTask({
          id: 'pending-task',
          title: '未送信タスク',
          status: 'pending',
          source_id: 'node-pending',
        }),
      ],
      sourceTasksById: new Map([
        ['node-pending', sourceTask('node-pending', { title: '未送信タスク' })],
        ['node-without-progress', sourceTask('node-without-progress', { title: '進捗なしノード' })],
      ]),
    })
    await screen.findByText('Mac offline')

    fireEvent.click(screen.getByRole('button', { expanded: false }))

    expect(screen.queryByText('未送信タスク')).not.toBeInTheDocument()
    expect(screen.queryByText('進捗なしノード')).not.toBeInTheDocument()
    expect(screen.queryByText('未送信')).not.toBeInTheDocument()
    expect(screen.getByText('確認待ち 0')).toBeInTheDocument()
    expect(callbacks.onRunSourceTask).not.toHaveBeenCalled()
    expect(callbacks.onOpenTask).not.toHaveBeenCalled()
  })

  test('デスクトップ看板の展開中にスペースとプロジェクト切替を表示する', async () => {
    renderDesktopKanban({
      spaces: [
        {
          id: 'space-1',
          title: '仕事',
          user_id: 'user-1',
          description: null,
          status: 'active',
          default_calendar_id: null,
          icon: null,
          color: null,
          created_at: '2026-06-10T00:00:00.000Z',
        },
      ],
      projects: [
        {
          id: 'project-1',
          user_id: 'user-1',
          space_id: 'space-1',
          title: '採用改善',
          description: '',
          purpose: null,
          category_tag: null,
          priority: 0,
          status: 'active',
          color_theme: '#22c55e',
          repo_path: null,
          created_at: '2026-06-10T00:00:00.000Z',
        },
      ],
      selectedSpaceId: 'space-1',
      selectedProjectId: 'project-1',
      onSelectSpace: vi.fn(),
      onSelectProject: vi.fn(),
    })
    await screen.findByText('Mac offline')

    fireEvent.click(screen.getByRole('button', { expanded: false }))

    expect(screen.getByTitle('スペースを切替')).toHaveTextContent('仕事')
    expect(screen.getByTitle('プロジェクトを切替')).toHaveTextContent('採用改善')
  })

  test('デスクトップ看板は外部クローズシグナルで折りたたまれる', async () => {
    const view = renderDesktopKanban()
    await screen.findByText('Mac offline')

    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByTestId('codex-kanban-desktop-body')).toBeInTheDocument()

    view.rerenderKanban(1)

    expect(screen.queryByTestId('codex-kanban-desktop-body')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { expanded: false })).toBeInTheDocument()
  })

  test('デスクトップ看板は上端ドラッグで表示高さを広げられる', async () => {
    renderDesktopKanban()
    await screen.findByText('Mac offline')

    const separator = screen.getByRole('separator', { name: /Codex看板の高さを変更/ })
    act(() => {
      fireEvent.pointerDown(separator, { clientY: 500 })
      fireEvent.pointerMove(window, { clientY: 360 })
    })

    expect(screen.getByTestId('codex-kanban-desktop-body')).toHaveStyle({ height: '400px' })
    act(() => {
      fireEvent.pointerUp(window)
    })
  })
})
