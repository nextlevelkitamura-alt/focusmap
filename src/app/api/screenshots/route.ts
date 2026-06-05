import { NextRequest, NextResponse } from 'next/server'
import { isR2Configured, putR2Object, R2ConfigurationError, deleteR2Object } from '@/lib/r2/client'
import {
  SCREENSHOT_MIN_UPLOAD_INTERVAL_MS,
  screenshotObjectKey,
  shouldBypassScreenshotInterval,
  validateScreenshotImage,
} from '@/lib/r2/screenshots'
import { isTursoConfigured, TursoConfigurationError } from '@/lib/turso/client'
import {
  getLatestScreenshotForTask,
  getTursoTaskForAuth,
  insertScreenshotMetadata,
  listScreenshotsForTask,
} from '@/lib/turso/codex-monitoring'
import { authenticateMonitoringRequest } from '@/lib/turso/request-auth'

function unavailable(code: 'turso_not_configured' | 'r2_not_configured') {
  return NextResponse.json(
    { error: code === 'turso_not_configured' ? 'Turso is not configured' : 'R2 is not configured', code },
    { status: 503 },
  )
}

function compactString(value: unknown, max: number) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null
}

type MultipartForm = {
  get: (key: string) => unknown
}

function parsePositiveInteger(value: unknown) {
  if (typeof value !== 'string') return null
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function formFile(form: MultipartForm, key: string) {
  const value = form.get(key)
  return value instanceof File ? value : null
}

async function fileToBytes(file: File) {
  return new Uint8Array(await file.arrayBuffer())
}

export async function GET(request: NextRequest) {
  const auth = await authenticateMonitoringRequest(request)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isTursoConfigured()) return unavailable('turso_not_configured')

  const { searchParams } = new URL(request.url)
  const taskId = searchParams.get('task_id')?.trim()
  if (!taskId) return NextResponse.json({ error: 'task_id is required' }, { status: 400 })
  const limit = Math.min(Math.max(Number.parseInt(searchParams.get('limit') || '20', 10) || 20, 1), 100)

  try {
    const task = await getTursoTaskForAuth(taskId, {
      userId: auth.userId,
      spaceId: auth.spaceId,
      supabase: auth.supabase,
    })
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

    const screenshots = await listScreenshotsForTask(task.id, task.user_id, limit)
    return NextResponse.json({ source: 'turso', screenshots })
  } catch (error) {
    if (error instanceof TursoConfigurationError) return unavailable('turso_not_configured')
    console.error('[screenshots GET]', error)
    return NextResponse.json({ error: 'Screenshot metadata fetch failed' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await authenticateMonitoringRequest(request)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isTursoConfigured()) return unavailable('turso_not_configured')
  if (!isR2Configured()) return unavailable('r2_not_configured')

  const form = await request.formData().catch(() => null) as MultipartForm | null
  if (!form) return NextResponse.json({ error: 'multipart/form-data is required' }, { status: 400 })
  if (form.get('original')) {
    return NextResponse.json({ error: 'original screenshots must stay on the Mac and are not accepted' }, { status: 400 })
  }

  const taskId = compactString(form.get('task_id'), 120)
  if (!taskId) return NextResponse.json({ error: 'task_id is required' }, { status: 400 })

  const preview = formFile(form, 'preview')
  const thumbnail = formFile(form, 'thumbnail')
  if (!preview && !thumbnail) {
    return NextResponse.json({ error: 'preview or thumbnail file is required' }, { status: 400 })
  }

  const previewError = preview
    ? validateScreenshotImage({ variant: 'preview', contentType: preview.type, size: preview.size })
    : null
  if (previewError) return NextResponse.json({ error: previewError }, { status: 400 })
  const thumbnailError = thumbnail
    ? validateScreenshotImage({ variant: 'thumbnail', contentType: thumbnail.type, size: thumbnail.size })
    : null
  if (thumbnailError) return NextResponse.json({ error: thumbnailError }, { status: 400 })

  try {
    const task = await getTursoTaskForAuth(taskId, {
      userId: auth.userId,
      spaceId: auth.spaceId,
      supabase: auth.supabase,
    })
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

    const uploadReason = compactString(form.get('upload_reason'), 80)
    const latest = await getLatestScreenshotForTask(task.id, task.user_id)
    if (latest && !shouldBypassScreenshotInterval(uploadReason)) {
      const elapsedMs = Date.now() - new Date(latest.created_at).getTime()
      if (Number.isFinite(elapsedMs) && elapsedMs < SCREENSHOT_MIN_UPLOAD_INTERVAL_MS) {
        return NextResponse.json(
          {
            error: 'screenshot upload interval is too short',
            code: 'screenshot_upload_rate_limited',
            retry_after_ms: SCREENSHOT_MIN_UPLOAD_INTERVAL_MS - elapsedMs,
          },
          { status: 429 },
        )
      }
    }

    const screenshotId = crypto.randomUUID()
    const uploadedKeys: string[] = []
    let previewKey: string | null = null
    let thumbnailKey: string | null = null

    try {
      if (thumbnail) {
        thumbnailKey = screenshotObjectKey({
          userId: task.user_id,
          taskId: task.id,
          screenshotId,
          variant: 'thumbnail',
          contentType: thumbnail.type,
        })
        await putR2Object({ key: thumbnailKey, body: await fileToBytes(thumbnail), contentType: thumbnail.type })
        uploadedKeys.push(thumbnailKey)
      }

      if (preview) {
        previewKey = screenshotObjectKey({
          userId: task.user_id,
          taskId: task.id,
          screenshotId,
          variant: 'preview',
          contentType: preview.type,
        })
        await putR2Object({ key: previewKey, body: await fileToBytes(preview), contentType: preview.type })
        uploadedKeys.push(previewKey)
      }

      const capturedAtRaw = compactString(form.get('captured_at'), 80)
      const capturedAt = capturedAtRaw && !Number.isNaN(Date.parse(capturedAtRaw))
        ? new Date(capturedAtRaw).toISOString()
        : new Date().toISOString()

      await insertScreenshotMetadata({
        id: screenshotId,
        task_id: task.id,
        user_id: task.user_id,
        thumbnail_key: thumbnailKey,
        preview_key: previewKey,
        width: parsePositiveInteger(form.get('width')),
        height: parsePositiveInteger(form.get('height')),
        thumbnail_size_bytes: thumbnail?.size ?? null,
        preview_size_bytes: preview?.size ?? null,
        captured_at: capturedAt,
        local_original_path_hash: compactString(form.get('local_original_path_hash'), 160),
      })

      return NextResponse.json({
        id: screenshotId,
        task_id: task.id,
        source: 'r2',
        thumbnail_key: thumbnailKey,
        preview_key: previewKey,
      }, { status: 201 })
    } catch (error) {
      await Promise.all(uploadedKeys.map(key => deleteR2Object(key).catch(() => undefined)))
      throw error
    }
  } catch (error) {
    if (error instanceof TursoConfigurationError) return unavailable('turso_not_configured')
    if (error instanceof R2ConfigurationError) return unavailable('r2_not_configured')
    console.error('[screenshots POST]', error)
    return NextResponse.json({ error: 'Screenshot upload failed' }, { status: 500 })
  }
}
