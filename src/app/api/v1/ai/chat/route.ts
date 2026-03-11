import { NextRequest } from 'next/server'
import { authenticateApiKey, isAuthError } from '../../_lib/auth'
import { apiSuccess, apiError, handleCors } from '../../_lib/response'
import { generateText } from 'ai'
import { getModelForSkill, getConfigForSkill } from '@/lib/ai/providers'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

// OPTIONS /api/v1/ai/chat
export async function OPTIONS() {
  return handleCors()
}

// POST /api/v1/ai/chat
export async function POST(request: NextRequest) {
  const auth = await authenticateApiKey(request, 'ai:chat')
  if (isAuthError(auth)) return auth

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return apiError('SERVICE_UNAVAILABLE', 'AI service not configured', 503)
  }

  let body: { message?: unknown; history?: unknown; skill?: unknown }
  try {
    body = await request.json()
  } catch {
    return apiError('BAD_REQUEST', 'Invalid JSON body', 400)
  }

  const { message, history = [], skill } = body as {
    message: string
    history: ChatMessage[]
    skill?: string
  }

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return apiError('BAD_REQUEST', 'message is required', 400)
  }

  // 会話履歴をプロンプトに変換
  const historyContext = (history as ChatMessage[])
    .map((m) => `${m.role === 'user' ? 'ユーザー' : 'AI'}: ${m.content}`)
    .join('\n')

  const systemPrompt = `あなたはShikumikaのAIアシスタントです。
ユーザーの仕事・タスク管理・プロジェクト管理に関する質問に答えます。
簡潔かつ丁寧に日本語で返答してください。`

  const prompt = `${historyContext ? `## 会話履歴\n${historyContext}\n\n` : ''}ユーザー: ${message.trim()}`

  try {
    const skillId = typeof skill === 'string' ? skill : undefined
    const skillConfig = getConfigForSkill(skillId)
    const aiResult = await generateText({
      model: getModelForSkill(skillId),
      system: systemPrompt,
      prompt,
      maxOutputTokens: skillConfig.maxTokens,
      temperature: skillConfig.temperature,
    })

    return apiSuccess({ reply: aiResult.text })
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error'
    console.error('[v1/ai/chat] error:', errMsg)

    if (errMsg.includes('API key not valid') || errMsg.includes('API_KEY_INVALID')) {
      return apiError('SERVICE_UNAVAILABLE', 'AI設定を確認してください（APIキーエラー）', 503)
    }
    if (errMsg.includes('quota') || errMsg.includes('429') || errMsg.includes('RATE_LIMIT')) {
      return apiError('RATE_LIMITED', 'リクエスト上限に達しました。しばらくお待ちください', 429)
    }

    return apiError('SERVER_ERROR', 'AIチャット中にエラーが発生しました', 500)
  }
}
