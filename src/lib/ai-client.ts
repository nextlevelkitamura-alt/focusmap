const AI_BASE_URL = (process.env.EXTERNAL_AI_API_BASE_URL ?? 'https://api.moonshot.ai/v1').replace(/\/$/, '')
const AI_API_KEY  = process.env.EXTERNAL_AI_API_KEY ?? process.env.OPENCODE_GO_API_KEY ?? process.env.MOONSHOT_API_KEY ?? ''
const AI_MODEL    = process.env.EXTERNAL_AI_MODEL ?? 'kimi-k2.6'
const DISABLE_KIMI_THINKING = process.env.EXTERNAL_AI_DISABLE_THINKING !== 'false'

type Message = { role: 'system' | 'user' | 'assistant'; content: string }

function chatCompletionsUrl() {
  return AI_BASE_URL.endsWith('/chat/completions')
    ? AI_BASE_URL
    : `${AI_BASE_URL}/chat/completions`
}

export async function chatCompletion(
  messages: Message[],
  opts?: { temperature?: number; max_tokens?: number; model?: string }
): Promise<string> {
  if (!AI_API_KEY) throw new Error('EXTERNAL_AI_API_KEY が設定されていません')

  const model = opts?.model || AI_MODEL
  const normalizedModel = model.toLowerCase()
  const isKimiK26 = normalizedModel === 'kimi-k2.6' || normalizedModel.startsWith('kimi-k2.6-')
  const isOpenCodeGo = AI_BASE_URL.includes('opencode.ai/zen/go')
  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: opts?.max_tokens ?? 1200,
  }

  // Kimi K2.6 は temperature/top_p などが固定値扱いなので送らない。
  // 構造化JSON用途では思考出力を混ぜないため、デフォルトでthinkingを無効化する。
  if (isKimiK26) {
    if (DISABLE_KIMI_THINKING && !isOpenCodeGo) body.thinking = { type: 'disabled' }
  } else {
    body.temperature = opts?.temperature ?? 0.5
  }

  const res = await fetch(chatCompletionsUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${AI_API_KEY}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: { message?: string } }).error?.message ?? `AI API error: ${res.status}`)
  }

  const data = await res.json() as {
    choices?: {
      finish_reason?: string
      message?: { content?: string | Array<{ text?: string; type?: string }> }
      text?: string
    }[]
  }
  const choice = data.choices?.[0]
  const rawContent = choice?.message?.content
  const content = typeof rawContent === 'string'
    ? rawContent
    : Array.isArray(rawContent)
      ? rawContent.map(part => part.text ?? '').join('')
      : choice?.text
  if (!content?.trim()) {
    throw new Error(`AI_EMPTY_RESPONSE:${model}:${choice?.finish_reason ?? 'unknown'}`)
  }
  return content
}
