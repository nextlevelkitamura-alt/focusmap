import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/service'

const BUCKET = 'task-attachments'
const MAX_FILE_SIZE = 300 * 1024
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 365

function createAdminClientOrNull() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null
  try {
    return createServiceClient()
  } catch (error) {
    console.error('[tasks/attachments] Service client unavailable:', error)
    return null
  }
}

function createStorageToken() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

/**
 * GET /api/tasks/[id]/attachments
 * タスクの添付ファイル一覧を取得
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: taskId } = await params
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: task } = await supabase
    .from('tasks')
    .select('id')
    .eq('id', taskId)
    .eq('user_id', user.id)
    .single()

  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

  const attachmentClient = createAdminClientOrNull() ?? supabase
  const { data, error } = await attachmentClient
    .from('task_attachments')
    .select('*')
    .eq('task_id', taskId)
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const attachments = await Promise.all((data ?? []).map(async attachment => {
    const { data: signedData } = await attachmentClient.storage
      .from(BUCKET)
      .createSignedUrl(attachment.storage_path, SIGNED_URL_TTL_SECONDS)
    return signedData?.signedUrl
      ? { ...attachment, file_url: signedData.signedUrl }
      : attachment
  }))

  return NextResponse.json({ attachments })
}

/**
 * POST /api/tasks/[id]/attachments
 * ファイルをアップロードして添付ファイルを作成
 * Content-Type: multipart/form-data
 * Body: file (File)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: taskId } = await params
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // タスクの所有権確認
  const { data: task } = await supabase
    .from('tasks')
    .select('id')
    .eq('id', taskId)
    .eq('user_id', user.id)
    .single()

  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

  const formData = await request.formData() as unknown as { get(name: string): File | string | null }
  const file = formData.get('file') as File | null

  if (!file) {
    return NextResponse.json({ error: 'File is required' }, { status: 400 })
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: '画像は300KB以下に圧縮してからアップロードしてください' }, { status: 400 })
  }

  // Supabase Storage にアップロード
  const storageToken = createStorageToken()
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const storagePath = `${user.id}/${taskId}/task_${storageToken}_${safeName}`
  const attachmentClient = createAdminClientOrNull() ?? supabase

  const { error: uploadError } = await attachmentClient.storage
    .from(BUCKET)
    .upload(storagePath, file, {
      contentType: file.type,
      upsert: false,
    })

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 })
  }

  // 署名付きURL（1年間有効）を取得
  const { data: signedData, error: signedError } = await attachmentClient.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS)

  if (signedError || !signedData) {
    // アップロードしたファイルを削除してロールバック
    await attachmentClient.storage.from(BUCKET).remove([storagePath])
    return NextResponse.json({ error: 'Failed to generate file URL' }, { status: 500 })
  }

  // DBに記録
  const { data: attachment, error: dbError } = await attachmentClient
    .from('task_attachments')
    .insert({
      user_id: user.id,
      task_id: taskId,
      file_name: file.name,
      file_url: signedData.signedUrl,
      storage_path: storagePath,
      file_type: file.type,
      file_size: file.size,
    })
    .select()
    .single()

  if (dbError) {
    await attachmentClient.storage.from(BUCKET).remove([storagePath])
    return NextResponse.json({ error: dbError.message }, { status: 500 })
  }

  return NextResponse.json({ attachment }, { status: 201 })
}
