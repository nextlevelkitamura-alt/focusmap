const AI_BASE_URL = process.env.EXTERNAL_AI_API_BASE_URL ?? 'https://api.openai.com/v1'
const AI_API_KEY  = process.env.EXTERNAL_AI_API_KEY ?? ''
const AI_MODEL    = process.env.EXTERNAL_AI_MODEL ?? 'gpt-4o-mini'

type Message = { role: 'system' | 'user' | 'assistant'; content: string }

export async function chatCompletion(
  messages: Message[],
  opts?: { temperature?: number; max_tokens?: number }
): Promise<string> {
  if (!AI_API_KEY) throw new Error('EXTERNAL_AI_API_KEY が設定されていません')

  const res = await fetch(`${AI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${AI_API_KEY}`,
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages,
      temperature: opts?.temperature ?? 0.5,
      max_tokens: opts?.max_tokens ?? 500,
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: { message?: string } }).error?.message ?? `AI API error: ${res.status}`)
  }

  const data = await res.json() as { choices: { message: { content: string } }[] }
  return data.choices[0].message.content
}
