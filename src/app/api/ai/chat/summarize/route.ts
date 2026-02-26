import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

// POST /api/ai/chat/summarize - 会話を要約して保存
export async function POST(request: Request) {
  try {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'AI service not configured' }, { status: 503 })
    }

    const { messages } = await request.json() as { messages: ChatMessage[] }

    if (!messages || messages.length < 2) {
      return NextResponse.json({ error: 'At least 2 messages required' }, { status: 400 })
    }

    // 会話テキストを構築
    const conversationText = messages
      .map(m => `${m.role === 'user' ? 'ユーザー' : 'AI'}: ${m.content}`)
      .join('\n')

    // Geminiで要約を生成
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })

    const result = await model.generateContent({
      contents: [{
        role: 'user',
        parts: [{
          text: `以下の会話を200文字以内で要約してください。
また、主要なトピックをキーワード3つ以内で抽出してください。

会話:
${conversationText}

出力形式（JSON）:
{"summary": "要約テキスト", "topics": ["キーワード1", "キーワード2"]}

JSONのみ出力してください。`,
        }],
      }],
    })

    const responseText = result.response.text().trim()
    let summary = ''
    let topics: string[] = []

    try {
      // JSONを抽出
      const jsonMatch = responseText.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        summary = parsed.summary || ''
        topics = Array.isArray(parsed.topics) ? parsed.topics : []
      }
    } catch {
      // JSONパース失敗時はレスポンスをそのまま要約として使用
      summary = responseText.slice(0, 200)
    }

    if (!summary) {
      summary = `${messages.length}件のメッセージの会話`
    }

    // DBに保存
    await supabase
      .from('ai_chat_summaries')
      .insert({
        user_id: user.id,
        summary,
        topics,
        message_count: messages.length,
      })

    // 古い要約を削除（最新5件のみ保持）
    const { data: allSummaries } = await supabase
      .from('ai_chat_summaries')
      .select('id')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (allSummaries && allSummaries.length > 5) {
      const idsToDelete = allSummaries.slice(5).map(s => s.id)
      await supabase
        .from('ai_chat_summaries')
        .delete()
        .in('id', idsToDelete)
    }

    // ユーザーコンテキスト（パーソナライズ）を更新 — 3カテゴリ対応
    try {
      const { data: existingContext } = await supabase
        .from('ai_user_context')
        .select('persona, preferences, life_personality, life_purpose, current_situation')
        .eq('user_id', user.id)
        .maybeSingle()

      const currentPersona = existingContext?.persona || ''
      const currentPrefs = existingContext?.preferences || {}
      const currentLifePersonality = existingContext?.life_personality || ''
      const currentLifePurpose = existingContext?.life_purpose || ''
      const currentSituation = existingContext?.current_situation || ''

      const contextResult = await model.generateContent({
        contents: [{
          role: 'user',
          parts: [{
            text: `以下の会話から、ユーザーの嗜好やパターンを抽出してください。

既存のユーザー情報:
- 生活・性格: ${currentLifePersonality || currentPersona || '(まだなし)'}
- 目標・価値観: ${currentLifePurpose || '(まだなし)'}
- 最近の状況: ${currentSituation || '(まだなし)'}

既存の好み:
${JSON.stringify(currentPrefs)}

今回の会話要約:
${summary}

以下のJSON形式で出力してください:
{
  "persona": "ユーザーの特徴を100文字以内（後方互換用）",
  "life_personality": "生活スタイル・性格の特徴（333字以内、既存と統合）",
  "life_purpose": "目標・価値観・なりたい姿（333字以内、既存と統合）",
  "current_situation": "最近の状況・仕事・悩み（333字以内、最新に更新）",
  "preferences": {"preferred_time_of_day": "morning/afternoon/evening/null", "common_event_types": ["電話","会議"]}
}

JSONのみ出力。変更がないカテゴリは既存の値をそのまま返してください。`,
          }],
        }],
      })

      const contextText = contextResult.response.text().trim()
      const contextJson = contextText.match(/\{[\s\S]*\}/)
      if (contextJson) {
        const parsed = JSON.parse(contextJson[0])
        const newPersona = parsed.persona || currentPersona
        const newPrefs = { ...currentPrefs, ...parsed.preferences }
        const newLifePersonality = (parsed.life_personality || currentLifePersonality).slice(0, 500)
        const newLifePurpose = (parsed.life_purpose || currentLifePurpose).slice(0, 500)
        const newSituation = (parsed.current_situation || currentSituation).slice(0, 500)

        await supabase
          .from('ai_user_context')
          .upsert({
            user_id: user.id,
            persona: newPersona.slice(0, 500),
            preferences: newPrefs,
            life_personality: newLifePersonality,
            life_purpose: newLifePurpose,
            current_situation: newSituation,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'user_id' })
      }
    } catch (contextError) {
      // コンテキスト更新失敗はサイレントに無視
      console.error('[summarize] Context update failed:', contextError)
    }

    return NextResponse.json({ summary, topics })
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    console.error('[summarize] Error:', errMsg, error)

    if (errMsg.includes('API key not valid') || errMsg.includes('API_KEY_INVALID')) {
      return NextResponse.json({ error: 'AI設定を確認してください（APIキーエラー）', errorCode: 'API_KEY_INVALID' }, { status: 503 })
    }
    if (errMsg.includes('quota') || errMsg.includes('429') || errMsg.includes('RATE_LIMIT')) {
      return NextResponse.json({ error: 'リクエスト上限に達しました。しばらくお待ちください', errorCode: 'RATE_LIMIT' }, { status: 429 })
    }

    return NextResponse.json(
      { error: '会話要約中にエラーが発生しました', errorCode: 'UNKNOWN' },
      { status: 500 }
    )
  }
}
