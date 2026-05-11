import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

const BUCKET = 'ideal-attachments'
const MAX_FILE_SIZE = 20 * 1024 * 1024

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('ideal_attachments')
    .select('*')
    .eq('ideal_id', id)
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ attachments: data })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: goal } = await supabase
    .from('ideal_goals')
    .select('id')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (!goal) return NextResponse.json({ error: 'Memo not found' }, { status: 404 })

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'File is required' }, { status: 400 })
  if (!file.type.startsWith('image/')) return NextResponse.json({ error: '画像ファイルを選択してください' }, { status: 400 })
  if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: '画像は20MB以下にしてください' }, { status: 400 })

  const timestamp = Date.now()
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const storagePath = `${user.id}/${id}/memo_${timestamp}_${safeName}`

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, file, {
      contentType: file.type,
      upsert: false,
    })

  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 })

  const { data: signedData, error: signedError } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, 60 * 60 * 24 * 365)

  if (signedError || !signedData) {
    await supabase.storage.from(BUCKET).remove([storagePath])
    return NextResponse.json({ error: 'Failed to generate image URL' }, { status: 500 })
  }

  const { data: attachment, error: dbError } = await supabase
    .from('ideal_attachments')
    .insert({
      user_id: user.id,
      ideal_id: id,
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
