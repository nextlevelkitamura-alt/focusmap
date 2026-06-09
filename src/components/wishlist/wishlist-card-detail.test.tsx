import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { IdealGoalWithItems, Project } from '@/types/database'
import { WishlistCardDetail } from './wishlist-card-detail'
import { useState } from 'react'

const memoAiTaskMock = vi.hoisted(() => ({
  task: null as Record<string, unknown> | null,
}))

const imageCompressionMock = vi.hoisted(() => ({
  compressImageFileForUpload: vi.fn(async (file: File) => (
    new File(['compressed'], file.name.replace(/\.[^.]+$/, '.jpg'), {
      type: 'image/jpeg',
      lastModified: file.lastModified,
    })
  )),
}))

vi.mock('@/hooks/useMemoAiTasks', () => ({
  useMemoAiTasks: () => ({
    getBySourceId: () => memoAiTaskMock.task,
  }),
}))

vi.mock('@/lib/image-compression', () => ({
  MAX_UPLOAD_IMAGE_BYTES: 300 * 1024,
  compressImageFileForUpload: imageCompressionMock.compressImageFileForUpload,
}))

vi.mock('@/components/memo/note-claude-runner', () => ({
  NoteClaudeRunnerPanel: () => null,
}))

vi.mock('@/components/memo/memo-refine-chat', () => ({
  MemoRefineChat: () => null,
}))

vi.mock('@/components/memo/memo-chat-history', () => ({
  MemoChatHistory: () => null,
}))

function createMemoItem(overrides: Partial<IdealGoalWithItems> = {}): IdealGoalWithItems {
  return {
    id: 'memo-1',
    user_id: 'user-1',
    title: 'Original title',
    description: 'Original body',
    status: 'memo',
    memo_status: 'unsorted',
    is_completed: false,
    scheduled_at: null,
    duration_minutes: null,
    google_event_id: null,
    calendar_id: null,
    project_id: null,
    category: null,
    tags: [],
    ai_summary: null,
    time_candidates: null,
    subtask_suggestions: null,
    created_at: '2026-05-21T00:00:00.000Z',
    updated_at: '2026-05-21T00:00:00.000Z',
    ideal_items: [],
    ...overrides,
  } as IdealGoalWithItems
}

function DetailHarness() {
  const [item, setItem] = useState<IdealGoalWithItems>(createMemoItem())

  return (
    <WishlistCardDetail
      item={item}
      open
      onOpenChange={vi.fn()}
      onUpdate={async (_id, updates) => {
        setItem(prev => ({
          ...prev,
          ...updates,
          updated_at: '2026-05-21T00:01:00.000Z',
        }) as IdealGoalWithItems)
      }}
      onCalendarAdd={vi.fn()}
      tagOptions={['仕事', 'アイデア']}
    />
  )
}

describe('WishlistCardDetail', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    imageCompressionMock.compressImageFileForUpload.mockClear()
    imageCompressionMock.compressImageFileForUpload.mockImplementation(async (file: File) => (
      new File(['compressed'], file.name.replace(/\.[^.]+$/, '.jpg'), {
        type: 'image/jpeg',
        lastModified: file.lastModified,
      })
    ))
    memoAiTaskMock.task = null
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    })
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:memo-image-preview'),
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ attachments: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })))
  })

  test('タグ変更で入力中の見出しと本文を消さない', async () => {
    render(<DetailHarness />)

    const titleInput = await screen.findByDisplayValue('Original title')
    const bodyInput = screen.getByPlaceholderText('本文にGoogle DocsなどのURLを貼ると、そのままリンクとして開けます。')

    fireEvent.change(titleInput, { target: { value: 'Draft title' } })
    fireEvent.change(bodyInput, { target: { value: 'Draft body' } })
    fireEvent.click(screen.getByRole('button', { name: /タグを追加/ }))
    fireEvent.click(screen.getByRole('button', { name: '仕事' }))

    await waitFor(() => {
      expect(screen.getByDisplayValue('Draft title')).toBeInTheDocument()
      expect(screen.getByDisplayValue('Draft body')).toBeInTheDocument()
    })
  })

  test('画像エリアでフォルダー選択・ドラッグ&ドロップ・クリップボード貼り付け導線を表示する', async () => {
    render(<DetailHarness />)

    const imageLabel = await screen.findByText('画像')
    expect(within(imageLabel.closest('div') as HTMLElement).queryByRole('button', { name: /^追加$/ })).not.toBeInTheDocument()
    expect(await screen.findByText('画像を追加')).toBeInTheDocument()
    expect(screen.getByText('フォルダー選択 / ドラッグ&ドロップ')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /クリップボード画像を貼り付け/ })).toBeInTheDocument()
  })

  test('メモ作成状態と手動保存ボタンを表示しない', async () => {
    render(<DetailHarness />)

    expect(screen.queryByText('作成中')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /メモを保存/ })).not.toBeInTheDocument()
  })

  test('手動Codexハンドオフ確認待ちは通常ボタンでMac自動再送へ昇格しない', async () => {
    memoAiTaskMock.task = {
      id: 'ai-task-1',
      executor: 'codex_app',
      status: 'awaiting_approval',
      result: {
        codex_manual_handoff: true,
        codex_run_state: 'awaiting_approval',
        codex_review_reason: 'external_app_handoff',
      },
    }
    const onLaunchCodex = vi.fn(async () => undefined)

    render(
      <WishlistCardDetail
        item={createMemoItem({ project_id: 'project-1' })}
        open
        onOpenChange={vi.fn()}
        onUpdate={vi.fn()}
        onCalendarAdd={vi.fn()}
        tagOptions={[]}
        projects={[{
          id: 'project-1',
          user_id: 'user-1',
          space_id: 'space-1',
          title: 'Project',
          description: '',
          purpose: null,
          category_tag: null,
          priority: 0,
          status: 'active',
          color_theme: 'blue',
          repo_path: '/repo/focusmap',
          created_at: '2026-05-21T00:00:00.000Z',
        } satisfies Project]}
        onLaunchCodex={onLaunchCodex}
      />,
    )

    const openButton = await screen.findByRole('button', { name: /Codexに送る/ })
    expect(openButton).toBeDisabled()
    expect(screen.queryByRole('button', { name: /Macへ再送/ })).not.toBeInTheDocument()
    expect(screen.getAllByText('確認待ち').length).toBeGreaterThan(0)

    fireEvent.click(openButton)

    expect(onLaunchCodex).not.toHaveBeenCalled()
  })

  test('日付を選択するとカレンダーPopoverを閉じる', async () => {
    render(<DetailHarness />)

    const dateField = await screen.findByText('日付')
    const dateTrigger = within(dateField.parentElement as HTMLElement).getByRole('button', { name: /未設定/ })
    fireEvent.click(dateTrigger)

    expect(await screen.findByTestId('memo-date-popover')).toHaveAttribute('data-side', 'top')
    expect(await screen.findByRole('button', { name: '前' })).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: /^1$/ })[0])

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '前' })).not.toBeInTheDocument()
    })
  })

  test('時刻PopoverはiPhone風の中央ハイライトホイールにする', async () => {
    render(<DetailHarness />)

    const timeField = await screen.findByText('時刻')
    const timeTrigger = within(timeField.parentElement as HTMLElement).getByRole('button', { name: /未設定/ })
    fireEvent.click(timeTrigger)

    const picker = await screen.findByTestId('ios-time-wheel-picker')
    expect(picker).toHaveClass('rounded-[18px]')

    const hourColumn = screen.getByRole('listbox', { name: '時' })
    expect(hourColumn).toHaveClass('touch-none')
    expect(hourColumn).not.toHaveClass('overflow-y-auto')
  })

  test('時刻ホイールはマウスドラッグ中に表示を即時更新する', async () => {
    render(<DetailHarness />)

    const timeField = await screen.findByText('時刻')
    const timeTrigger = within(timeField.parentElement as HTMLElement).getByRole('button', { name: /未設定/ })
    fireEvent.click(timeTrigger)

    const hourColumn = screen.getByRole('listbox', { name: '時' })
    fireEvent.pointerDown(hourColumn, { pointerId: 1, pointerType: 'mouse', button: 0, clientY: 100 })
    fireEvent.pointerMove(hourColumn, { pointerId: 1, pointerType: 'mouse', clientY: 12 })

    await waitFor(() => {
      expect(within(timeField.parentElement as HTMLElement).getByRole('button', { name: /11:00/ })).toBeInTheDocument()
    })
  })

  test('時刻ホイールはタッチドラッグで表示を即時更新する', async () => {
    render(<DetailHarness />)

    const timeField = await screen.findByText('時刻')
    const timeTrigger = within(timeField.parentElement as HTMLElement).getByRole('button', { name: /未設定/ })
    fireEvent.click(timeTrigger)

    const hourColumn = screen.getByRole('listbox', { name: '時' })
    fireEvent.touchStart(hourColumn, { touches: [{ clientY: 100 }] })
    fireEvent.touchMove(hourColumn, { touches: [{ clientY: 12 }] })

    await waitFor(() => {
      expect(within(timeField.parentElement as HTMLElement).getByRole('button', { name: /11:00/ })).toBeInTheDocument()
    })
  })

  test('時刻ホイールはタップ選択でも値を保存する', async () => {
    render(<DetailHarness />)

    const timeField = await screen.findByText('時刻')
    const timeTrigger = within(timeField.parentElement as HTMLElement).getByRole('button', { name: /未設定/ })
    fireEvent.click(timeTrigger)

    fireEvent.click(screen.getByRole('option', { name: '11' }))

    await waitFor(() => {
      expect(within(timeField.parentElement as HTMLElement).getByRole('button', { name: /11:00/ })).toBeInTheDocument()
    })
  })

  test('時刻ホイールは二本指スクロールで値を保存する', async () => {
    render(<DetailHarness />)

    const timeField = await screen.findByText('時刻')
    const timeTrigger = within(timeField.parentElement as HTMLElement).getByRole('button', { name: /未設定/ })
    fireEvent.click(timeTrigger)

    const hourColumn = screen.getByRole('listbox', { name: '時' })
    fireEvent.wheel(hourColumn, { deltaY: 80 })

    await waitFor(() => {
      expect(within(timeField.parentElement as HTMLElement).getByRole('button', { name: /10:00/ })).toBeInTheDocument()
    })
  })

  test('所要時間カスタムはホイールPopoverで選べる', async () => {
    const promptSpy = vi.spyOn(window, 'prompt')
    render(<DetailHarness />)

    fireEvent.click(await screen.findByRole('button', { name: 'カスタム' }))

    expect(await screen.findByTestId('duration-wheel-popover')).toBeInTheDocument()
    const minuteColumn = screen.getByRole('listbox', { name: '分' })
    for (let i = 0; i < 20; i += 1) {
      fireEvent.wheel(minuteColumn, { deltaY: 80 })
    }
    fireEvent.click(screen.getByRole('button', { name: /反映/ }))

    await waitFor(() => {
      expect(screen.getByText('1時間20分')).toBeInTheDocument()
    })
    expect(promptSpy).not.toHaveBeenCalled()
  })

  test('Codex送信は追加依頼文を編集せず見出しと本文だけ渡す', async () => {
    const onLaunchCodex = vi.fn(async () => undefined)

    render(
      <WishlistCardDetail
        item={createMemoItem({ project_id: 'project-1' })}
        open
        onOpenChange={vi.fn()}
        onUpdate={vi.fn()}
        onCalendarAdd={vi.fn()}
        tagOptions={[]}
        projects={[{
          id: 'project-1',
          user_id: 'user-1',
          space_id: 'space-1',
          title: 'Project',
          description: '',
          purpose: null,
          category_tag: null,
          priority: 0,
          status: 'active',
          color_theme: 'blue',
          repo_path: '/repo/focusmap',
          created_at: '2026-05-21T00:00:00.000Z',
        } satisfies Project]}
        onLaunchCodex={onLaunchCodex}
      />,
    )

    expect(screen.queryByRole('textbox', { name: /Codex/ })).not.toBeInTheDocument()

    fireEvent.click(await screen.findByRole('button', { name: /Codexに送る/ }))

    await waitFor(() => {
      expect(onLaunchCodex).toHaveBeenCalled()
    })
    expect(onLaunchCodex.mock.calls[0]?.[0]).toMatchObject({
      title: 'Original title',
      description: 'Original body',
    })
  })

  test('Codexチャット内容をactivityから表示する', async () => {
    memoAiTaskMock.task = {
      id: 'ai-task-chat',
      executor: 'codex_app',
      status: 'awaiting_approval',
      result: {
        codex_run_state: 'awaiting_approval',
      },
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/codex/sync-node') {
        return new Response(JSON.stringify({ synced: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url === '/api/ai-tasks/ai-task-chat/activity') {
        return new Response(JSON.stringify({
          messages: [
            {
              id: 'activity-user',
              task_id: 'ai-task-chat',
              user_id: 'user-1',
              role: 'user',
              kind: 'sent',
              body: '少々お待ちください！',
              importance: 'normal',
              metadata: {},
              created_at: '2026-06-08T08:56:00.000Z',
            },
            {
              id: 'activity-codex',
              task_id: 'ai-task-chat',
              user_id: 'user-1',
              role: 'codex',
              kind: 'progress',
              body: '承知しました。待機します。',
              importance: 'normal',
              metadata: {},
              created_at: '2026-06-08T08:57:00.000Z',
            },
          ],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ attachments: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <WishlistCardDetail
        item={createMemoItem({ project_id: 'project-1' })}
        open
        onOpenChange={vi.fn()}
        onUpdate={vi.fn()}
        onCalendarAdd={vi.fn()}
        tagOptions={[]}
        projects={[{
          id: 'project-1',
          user_id: 'user-1',
          space_id: 'space-1',
          title: 'Project',
          description: '',
          purpose: null,
          category_tag: null,
          priority: 0,
          status: 'active',
          color_theme: 'blue',
          repo_path: '/repo/focusmap',
          created_at: '2026-05-21T00:00:00.000Z',
        } satisfies Project]}
        onLaunchCodex={vi.fn(async () => undefined)}
      />,
    )

    expect(await screen.findByText('チャット')).toBeInTheDocument()
    expect(await screen.findByText('少々お待ちください！')).toBeInTheDocument()
    expect(await screen.findByText('承知しました。待機します。')).toBeInTheDocument()
  })

  test('画像をドロップすると添付APIへアップロードする', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({
          attachment: {
            id: 'image-1',
            file_name: 'memo.png',
            file_url: 'https://example.com/memo.png',
            file_type: 'image/png',
            file_size: 4,
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ attachments: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<DetailHarness />)

    const dropZone = (await screen.findByText('画像を追加')).closest('button')
    expect(dropZone).toBeTruthy()
    fireEvent.drop(dropZone!, {
      dataTransfer: {
        files: [new File(['data'], 'memo.png', { type: 'image/png' })],
      },
    })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/wishlist/memo-1/attachments',
        expect.objectContaining({ method: 'POST' }),
      )
    })
    expect(imageCompressionMock.compressImageFileForUpload).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'memo.png', type: 'image/png' }),
    )
    const uploadBody = (fetchMock.mock.calls.find(call => call[1]?.method === 'POST')?.[1]?.body) as FormData
    const uploadedFile = uploadBody.get('file') as File
    expect(uploadedFile.name).toBe('memo.jpg')
    expect(uploadedFile.type).toBe('image/jpeg')
    expect(uploadedFile.size).toBeLessThanOrEqual(300 * 1024)
    expect(await screen.findByAltText('memo.png')).toBeInTheDocument()
    const uploadedImage = await screen.findByAltText('memo.png')
    const uploadButton = screen.getByRole('button', { name: /画像を追加/ })
    expect(uploadedImage.compareDocumentPosition(uploadButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  test('アップロード完了前に薄いローカルプレビューを表示する', async () => {
    let resolveUpload: (() => void) | null = null
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Promise<Response>(resolve => {
          resolveUpload = () => resolve(new Response(JSON.stringify({
            attachment: {
              id: 'image-slow',
              file_name: 'slow.png',
              file_url: 'https://example.com/slow.png',
              file_type: 'image/png',
              file_size: 4,
            },
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }))
        })
      }
      return new Response(JSON.stringify({ attachments: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<DetailHarness />)

    const dropZone = (await screen.findByText('画像を追加')).closest('button')
    expect(dropZone).toBeTruthy()
    fireEvent.drop(dropZone!, {
      dataTransfer: {
        files: [new File(['data'], 'slow.png', { type: 'image/png' })],
      },
    })

    expect(await screen.findByAltText('slow.png')).toBeInTheDocument()
    expect(screen.getByTestId('pending-memo-image')).toHaveClass('opacity-45')
    expect(screen.getByText('保存中')).toBeInTheDocument()

    resolveUpload?.()
    await waitFor(() => {
      expect(screen.queryByText('保存中')).not.toBeInTheDocument()
      expect(screen.queryByTestId('pending-memo-image')).not.toBeInTheDocument()
    })
    expect(await screen.findByAltText('slow.png')).toBeInTheDocument()
  })

  test('画像保存中はCodex送信を待つ', async () => {
    let resolveUpload: (() => void) | null = null
    const onLaunchCodex = vi.fn(async () => undefined)
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Promise<Response>(resolve => {
          resolveUpload = () => resolve(new Response(JSON.stringify({
            attachment: {
              id: 'image-slow',
              file_name: 'slow.png',
              file_url: 'https://example.com/slow.png',
              file_type: 'image/png',
              file_size: 4,
            },
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }))
        })
      }
      return new Response(JSON.stringify({ attachments: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <WishlistCardDetail
        item={createMemoItem({ project_id: 'project-1' })}
        open
        onOpenChange={vi.fn()}
        onUpdate={vi.fn()}
        onCalendarAdd={vi.fn()}
        tagOptions={[]}
        projects={[{
          id: 'project-1',
          user_id: 'user-1',
          space_id: 'space-1',
          title: 'Project',
          description: '',
          purpose: null,
          category_tag: null,
          priority: 0,
          status: 'active',
          color_theme: 'blue',
          repo_path: '/repo/focusmap',
          created_at: '2026-05-21T00:00:00.000Z',
        } satisfies Project]}
        onLaunchCodex={onLaunchCodex}
      />,
    )

    const codexButton = await screen.findByRole('button', { name: /Codexに送る/ })
    expect(codexButton).not.toBeDisabled()

    const dropZone = (await screen.findByText('画像を追加')).closest('button')
    expect(dropZone).toBeTruthy()
    fireEvent.drop(dropZone!, {
      dataTransfer: {
        files: [new File(['data'], 'slow.png', { type: 'image/png' })],
      },
    })

    expect(await screen.findByText('保存中')).toBeInTheDocument()
    expect(codexButton).toBeDisabled()
    expect(screen.getByText('画像を保存中です。保存が終わるとCodexへ送れます。')).toBeInTheDocument()
    fireEvent.click(codexButton)
    expect(onLaunchCodex).not.toHaveBeenCalled()

    await act(async () => {
      resolveUpload?.()
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(screen.queryByText('保存中')).not.toBeInTheDocument()
      expect(codexButton).not.toBeDisabled()
    })

    fireEvent.click(codexButton)
    await waitFor(() => {
      expect(onLaunchCodex).toHaveBeenCalled()
    })
  }, 10_000)

  test('画像削除はDELETE完了前にサムネイルを消す', async () => {
    let resolveDelete: (() => void) | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/wishlist/memo-1/attachments/image-existing' && init?.method === 'DELETE') {
        return new Promise<Response>(resolve => {
          resolveDelete = () => resolve(new Response(null, { status: 204 }))
        })
      }
      if (url === '/api/wishlist/memo-1/attachments') {
        return new Response(JSON.stringify({
          attachments: [{
            id: 'image-existing',
            file_name: 'existing.png',
            file_url: 'https://example.com/existing.png',
            file_type: 'image/png',
            file_size: 4,
          }],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<DetailHarness />)
    expect(await screen.findByAltText('existing.png')).toBeInTheDocument()

    fireEvent.click(screen.getByTitle('削除'))

    await waitFor(() => {
      expect(screen.queryByAltText('existing.png')).not.toBeInTheDocument()
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/wishlist/memo-1/attachments/image-existing', { method: 'DELETE' })
    await act(async () => {
      resolveDelete?.()
      await Promise.resolve()
    })
  })

  test('画像削除に失敗したらサムネイルを戻す', async () => {
    let resolveDelete: (() => void) | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/wishlist/memo-1/attachments/image-existing' && init?.method === 'DELETE') {
        return new Promise<Response>(resolve => {
          resolveDelete = () => resolve(new Response(JSON.stringify({ error: 'delete failed' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }))
        })
      }
      if (url === '/api/wishlist/memo-1/attachments') {
        return new Response(JSON.stringify({
          attachments: [{
            id: 'image-existing',
            file_name: 'existing.png',
            file_url: 'https://example.com/existing.png',
            file_type: 'image/png',
            file_size: 4,
          }],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<DetailHarness />)
    expect(await screen.findByAltText('existing.png')).toBeInTheDocument()

    fireEvent.click(screen.getByTitle('削除'))
    await waitFor(() => {
      expect(screen.queryByAltText('existing.png')).not.toBeInTheDocument()
    })

    await act(async () => {
      resolveDelete?.()
      await Promise.resolve()
    })
    expect(await screen.findByAltText('existing.png')).toBeInTheDocument()
    expect(screen.getByText('画像の削除に失敗しました')).toBeInTheDocument()
  })

  test('クリップボード画像を貼り付けると添付APIへアップロードする', async () => {
    const clipboardRead = vi.fn(async () => [{
      types: ['image/png'],
      getType: vi.fn(async () => new Blob(['data'], { type: 'image/png' })),
    }])
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { read: clipboardRead },
    })
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({
          attachment: {
            id: 'image-clipboard',
            file_name: 'clipboard.png',
            file_url: 'https://example.com/clipboard.png',
            file_type: 'image/png',
            file_size: 4,
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ attachments: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<DetailHarness />)
    fireEvent.click(screen.getByRole('button', { name: /クリップボード画像を貼り付け/ }))

    await waitFor(() => {
      expect(clipboardRead).toHaveBeenCalled()
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/wishlist/memo-1/attachments',
        expect.objectContaining({ method: 'POST' }),
      )
    })
    expect(await screen.findByAltText('clipboard.png')).toBeInTheDocument()
  })

  test('画像タブ内でCmd+Vするとクリップボード画像をアップロードする', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({
          attachment: {
            id: 'image-paste-event',
            file_name: 'pasted-event.png',
            file_url: 'https://example.com/pasted-event.png',
            file_type: 'image/png',
            file_size: 4,
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ attachments: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<DetailHarness />)
    fireEvent.paste(screen.getByTestId('memo-image-paste-target'), {
      clipboardData: {
        files: [new File(['data'], 'pasted-event.png', { type: 'image/png' })],
        items: [],
      },
    })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/wishlist/memo-1/attachments',
        expect.objectContaining({ method: 'POST' }),
      )
    })
    expect(await screen.findByAltText('pasted-event.png')).toBeInTheDocument()
  })
})
