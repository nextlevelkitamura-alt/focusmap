import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

const BUCKET = 'task-attachments'
const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB

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

  const { data, error } = await supabase
    .from('task_attachments')
    .select('*')
    .eq('task_id', taskId)
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ attachments: data })
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

  const formData = await request.formData()
  const file = formData.get('file') as File | null

  if (!file) {
    return NextResponse.json({ error: 'File is required' }, { status: 400 })
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: 'File size exceeds 50MB limit' }, { status: 400 })
  }

  // Supabase Storage にアップロード
  const timestamp = Date.now()
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const storagePath = `${user.id}/${taskId}/${timestamp}_${safeName}`

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, file, {
      contentType: file.type,
      upsert: false,
    })

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 })
  }

  // 署名付きURL（1年間有効）を取得
  const { data: signedData, error: signedError } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, 60 * 60 * 24 * 365)

  if (signedError || !signedData) {
    // アップロードしたファイルを削除してロールバック
    await supabase.storage.from(BUCKET).remove([storagePath])
    return NextResponse.json({ error: 'Failed to generate file URL' }, { status: 500 })
  }

  // DBに記録
  const { data: attachment, error: dbError } = await supabase
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
    await supabase.storage.from(BUCKET).remove([storagePath])
    return NextResponse.json({ error: dbError.message }, { status: 500 })
  }

  return NextResponse.json({ attachment }, { status: 201 })
}
