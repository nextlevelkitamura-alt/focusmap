import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'

// POST /api/transcribe - 音声ファイルをテキストに変換（Groq Whisper API）
export async function POST(request: Request) {
  try {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const apiKey = process.env.GROQ_API_KEY
    if (!apiKey) {
      console.error('GROQ_API_KEY is not configured')
      return NextResponse.json({ error: 'Transcription service not configured' }, { status: 503 })
    }

    const formData = await request.formData()
    const audioFile = formData.get('audio') as File | null

    if (!audioFile) {
      return NextResponse.json({ error: 'Audio file is required' }, { status: 400 })
    }

    // ファイルサイズチェック（Groq Free tier: 25MB上限）
    if (audioFile.size > 25 * 1024 * 1024) {
      return NextResponse.json({ error: 'Audio file too large (max 25MB)' }, { status: 400 })
    }

    // Groq API に送信（OpenAI互換エンドポイント）
    const groqFormData = new FormData()
    groqFormData.append('file', audioFile)
    groqFormData.append('model', 'whisper-large-v3-turbo')
    groqFormData.append('language', 'ja')
    groqFormData.append('response_format', 'json')

    const groqResponse = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
      body: groqFormData,
    })

    if (!groqResponse.ok) {
      const errorBody = await groqResponse.text()
      console.error('Groq API error:', groqResponse.status, errorBody)

      if (groqResponse.status === 429) {
        return NextResponse.json(
          { error: '音声認識の利用制限に達しました。しばらく待ってから再試行してください。' },
          { status: 429 }
        )
      }

      return NextResponse.json({ error: 'Transcription failed' }, { status: 500 })
    }

    const result = await groqResponse.json()

    // 音声データは保存しない（トランスクリプト後に破棄）
    return NextResponse.json({ text: result.text })
  } catch (error) {
    console.error('Transcription error:', error)
    return NextResponse.json({ error: 'Transcription failed' }, { status: 500 })
  }
}
