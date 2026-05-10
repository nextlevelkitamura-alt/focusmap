const AI_BASE_URL = (process.env.EXTERNAL_AI_API_BASE_URL ?? 'https://api.moonshot.ai/v1').replace(/\/$/, '')
const AI_API_KEY  = process.env.EXTERNAL_AI_API_KEY ?? process.env.MOONSHOT_API_KEY ?? ''
const AI_MODEL    = process.env.EXTERNAL_AI_MODEL ?? 'kimi-k2.6'
const DISABLE_KIMI_THINKING = process.env.EXTERNAL_AI_DISABLE_THINKING !== 'false'

type Message = { role: 'system' | 'user' | 'assistant'; content: string }

export async function chatCompletion(
  messages: Message[],
  opts?: { temperature?: number; max_tokens?: number }
): Promise<string> {
  if (!AI_API_KEY) throw new Error('EXTERNAL_AI_API_KEY が設定されていません')

  const normalizedModel = AI_MODEL.toLowerCase()
  const isKimiK26 = normalizedModel === 'kimi-k2.6' || normalizedModel.startsWith('kimi-k2.6-')
  const body: Record<string, unknown> = {
    model: AI_MODEL,
    messages,
    max_tokens: opts?.max_tokens ?? 1200,
  }

  // Kimi K2.6 は temperature/top_p などが固定値扱いなので送らない。
  // 構造化JSON用途では思考出力を混ぜないため、デフォルトでthinkingを無効化する。
  if (isKimiK26) {
    if (DISABLE_KIMI_THINKING) body.thinking = { type: 'disabled' }
  } else {
    body.temperature = opts?.temperature ?? 0.5
  }

  const res = await fetch(`${AI_BASE_URL}/chat/completions`, {
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

  const data = await res.json() as { choices?: { message?: { content?: string } }[] }
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error('AI API response is empty')
  return content
}
