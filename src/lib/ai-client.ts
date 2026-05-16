const AI_BASE_URL = (process.env.EXTERNAL_AI_API_BASE_URL ?? 'https://api.moonshot.ai/v1').replace(/\/$/, '')
const AI_API_KEY  = process.env.EXTERNAL_AI_API_KEY ?? process.env.OPENCODE_GO_API_KEY ?? process.env.MOONSHOT_API_KEY ?? ''
const AI_MODEL    = process.env.EXTERNAL_AI_MODEL ?? 'kimi-k2.6'
const DISABLE_KIMI_THINKING = process.env.EXTERNAL_AI_DISABLE_THINKING !== 'false'

type Message = { role: 'system' | 'user' | 'assistant'; content: string }

// ─── ツール呼び出し対応 ────────────────────────────────────────────────────
export interface ToolDef {
  /** OpenAI 互換の tools フォーマット */
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>  // JSON schema
  }
}

export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string  // JSON string
  }
}

/** ツール込みの拡張 Message 型 */
export type AgentMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

export interface ChatResult {
  content: string | null
  tool_calls?: ToolCall[]
  finish_reason: string
}

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

/**
 * ツール呼び出し対応のチャット完了。
 * OpenAI 互換の tools パラメータを送信し、tool_calls or テキストを返す。
 *
 * 注: モデル側でツール対応していない場合 (古い moonshot/openai) は tools パラメータは無視され、
 * テキスト応答が返る。
 */
export async function chatCompletionWithTools(
  messages: AgentMessage[],
  tools: ToolDef[],
  opts?: { temperature?: number; max_tokens?: number; model?: string; tool_choice?: 'auto' | 'none' | 'required' }
): Promise<ChatResult> {
  if (!AI_API_KEY) throw new Error('EXTERNAL_AI_API_KEY が設定されていません')

  const model = opts?.model || AI_MODEL
  const normalizedModel = model.toLowerCase()
  const isKimiK26 = normalizedModel === 'kimi-k2.6' || normalizedModel.startsWith('kimi-k2.6-')
  const isOpenCodeGo = AI_BASE_URL.includes('opencode.ai/zen/go')

  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: opts?.max_tokens ?? 1500,
    tools,
    tool_choice: opts?.tool_choice ?? 'auto',
  }

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
    choices?: Array<{
      finish_reason?: string
      message?: {
        content?: string | null | Array<{ text?: string; type?: string }>
        tool_calls?: ToolCall[]
      }
    }>
  }
  const choice = data.choices?.[0]
  const msg = choice?.message
  const rawContent = msg?.content
  const content = typeof rawContent === 'string'
    ? rawContent
    : Array.isArray(rawContent)
      ? rawContent.map(part => part.text ?? '').join('')
      : null

  return {
    content: content ?? null,
    tool_calls: msg?.tool_calls,
    finish_reason: choice?.finish_reason ?? 'unknown',
  }
}
