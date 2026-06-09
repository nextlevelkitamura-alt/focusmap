import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const getUser = vi.fn()
  const taskSingle = vi.fn()
  const userFrom = vi.fn((table: string) => {
    if (table === 'tasks') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: taskSingle,
            })),
          })),
        })),
      }
    }
    return {}
  })

  const upload = vi.fn()
  const createSignedUrl = vi.fn()
  const remove = vi.fn()
  const storageFrom = vi.fn(() => ({
    upload,
    createSignedUrl,
    remove,
  }))
  const attachmentSingle = vi.fn()
  const attachmentSelect = vi.fn(() => ({ single: attachmentSingle }))
  const attachmentInsert = vi.fn(() => ({ select: attachmentSelect }))
  const adminFrom = vi.fn((table: string) => {
    if (table === 'task_attachments') {
      return {
        insert: attachmentInsert,
      }
    }
    return {}
  })

  return {
    userClient: {
      auth: { getUser },
      from: userFrom,
    },
    adminClient: {
      from: adminFrom,
      storage: { from: storageFrom },
    },
    getUser,
    taskSingle,
    userFrom,
    upload,
    createSignedUrl,
    remove,
    storageFrom,
    attachmentSingle,
    attachmentInsert,
    adminFrom,
  }
})

vi.mock('@/utils/supabase/server', () => ({
  createClient: vi.fn(async () => mocks.userClient),
}))

vi.mock('@/utils/supabase/service', () => ({
  createServiceClient: vi.fn(() => mocks.adminClient),
}))

import { POST } from './route'

function createUploadRequest(file = new File(['image'], 'node.png', { type: 'image/png' })) {
  const formData = new FormData()
  formData.set('file', file)
  return {
    formData: async () => formData,
  } as Request
}

describe('POST /api/tasks/[id]/attachments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'
    mocks.getUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'user@example.com' } },
      error: null,
    })
    mocks.taskSingle.mockResolvedValue({ data: { id: 'task-1' }, error: null })
    mocks.upload.mockResolvedValue({ error: null })
    mocks.createSignedUrl.mockResolvedValue({
      data: { signedUrl: 'https://example.com/signed-node.png' },
      error: null,
    })
    mocks.remove.mockResolvedValue({ error: null })
    mocks.attachmentSingle.mockResolvedValue({
      data: {
        id: 'attachment-1',
        user_id: 'user-1',
        task_id: 'task-1',
        file_name: 'node.png',
        file_url: 'https://example.com/signed-node.png',
        storage_path: 'user-1/task-1/task_test_node.png',
        file_type: 'image/png',
        file_size: 5,
      },
      error: null,
    })
  })

  test('本人確認後はservice role clientでStorageと添付レコードを保存する', async () => {
    const res = await POST(createUploadRequest(), {
      params: Promise.resolve({ id: 'task-1' }),
    })
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.attachment.id).toBe('attachment-1')
    expect(mocks.userFrom).toHaveBeenCalledWith('tasks')
    expect(mocks.storageFrom).toHaveBeenCalledWith('task-attachments')
    expect(mocks.upload).toHaveBeenCalledWith(
      expect.stringMatching(/^user-1\/task-1\/task_/),
      expect.any(File),
      expect.objectContaining({ contentType: 'image/png', upsert: false }),
    )
    expect(mocks.adminFrom).toHaveBeenCalledWith('task_attachments')
    expect(mocks.attachmentInsert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'user-1',
      task_id: 'task-1',
      file_name: 'node.png',
      file_url: 'https://example.com/signed-node.png',
      file_type: 'image/png',
      file_size: 5,
    }))
  })

  test('300KBを超える画像はStorageへ送らず拒否する', async () => {
    const res = await POST(createUploadRequest(new File([new Uint8Array(300 * 1024 + 1)], 'large.png', { type: 'image/png' })), {
      params: Promise.resolve({ id: 'task-1' }),
    })
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toContain('300KB')
    expect(mocks.upload).not.toHaveBeenCalled()
    expect(mocks.attachmentInsert).not.toHaveBeenCalled()
  })
})
