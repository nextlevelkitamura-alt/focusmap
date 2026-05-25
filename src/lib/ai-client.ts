import { generateText, jsonSchema, type JSONValue, type ModelMessage, type ToolSet } from 'ai'
import { google } from '@ai-sdk/google'
import { resolveGeminiModel } from '@/lib/ai/providers'

const AI_BASE_URL = (process.env.EXTERNAL_AI_API_BASE_URL ?? 'https://api.moonshot.ai/v1').replace(/\/$/, '')
const AI_API_KEY  = process.env.EXTERNAL_AI_API_KEY ?? process.env.OPENCODE_GO_API_KEY ?? process.env.MOONSHOT_API_KEY ?? ''
const AI_MODEL    = process.env.EXTERNAL_AI_MODEL ?? 'kimi-k2.6'
const DISABLE_KIMI_THINKING = process.env.EXTERNAL_AI_DISABLE_THINKING !== 'false'
const ALLOW_EXTERNAL_AI_IN_PRODUCTION = process.env.ALLOW_EXTERNAL_AI_IN_PRODUCTION === 'true'

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

function normalizeGeminiModel(model?: string) {
  return resolveGeminiModel(model)
}

function shouldUseGemini(model?: string) {
  const requestedModel = model?.trim().toLowerCase()
  return (
    requestedModel?.startsWith('gemini-') ||
    !AI_API_KEY ||
    (process.env.NODE_ENV === 'production' && !ALLOW_EXTERNAL_AI_IN_PRODUCTION)
  )
}

function assertGeminiConfigured() {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    throw new Error('GOOGLE_GENERATIVE_AI_API_KEY が設定されていません')
  }
}

async function geminiChatCompletion(
  messages: Message[],
  opts?: { temperature?: number; max_tokens?: number; model?: string },
) {
  assertGeminiConfigured()
  const model = normalizeGeminiModel(opts?.model)
  const system = messages.find(message => message.role === 'system')?.content
  const prompt = messages
    .filter(message => message.role !== 'system')
    .map(message => `${message.role}: ${message.content}`)
    .join('\n\n')

  const result = await generateText({
    model: google(model),
    system,
    prompt,
    maxOutputTokens: opts?.max_tokens ?? 1200,
    temperature: opts?.temperature ?? 0.5,
  })

  if (!result.text?.trim()) {
    throw new Error(`AI_EMPTY_RESPONSE:${model}:${result.finishReason ?? 'unknown'}`)
  }
  return result.text
}

function toGeminiMessages(messages: AgentMessage[]): ModelMessage[] {
  const toolNameByCallId = new Map<string, string>()

  return messages.map((message): ModelMessage => {
    if (message.role === 'system' || message.role === 'user') {
      return { role: message.role, content: message.content }
    }

    if (message.role === 'assistant') {
      const content: NonNullable<Extract<ModelMessage, { role: 'assistant' }>['content']> = []
      if (message.content?.trim()) {
        content.push({ type: 'text', text: message.content })
      }
      for (const call of message.tool_calls ?? []) {
        toolNameByCallId.set(call.id, call.function.name)
        let input: unknown = {}
        try {
          input = JSON.parse(call.function.arguments || '{}')
        } catch {
          input = { raw_arguments: call.function.arguments }
        }
        content.push({
          type: 'tool-call',
          toolCallId: call.id,
          toolName: call.function.name,
          input,
        })
      }
      return { role: 'assistant', content: content.length ? content : '' }
    }

    if (message.role === 'tool') {
      const toolName = toolNameByCallId.get(message.tool_call_id) ?? 'unknown_tool'
      let value: JSONValue = message.content
      try {
        value = JSON.parse(message.content) as JSONValue
      } catch {
        value = message.content
      }
      return {
        role: 'tool',
        content: [{
          type: 'tool-result',
          toolCallId: message.tool_call_id,
          toolName,
          output: { type: 'json', value },
        }],
      }
    }

    return { role: 'assistant', content: '' }
  })
}

function toGeminiTools(tools: ToolDef[]): ToolSet {
  return Object.fromEntries(
    tools.map(def => [
      def.function.name,
      {
        description: def.function.description,
        inputSchema: jsonSchema(def.function.parameters),
      },
    ]),
  ) as ToolSet
}

function toToolChoice(toolChoice?: 'auto' | 'none' | 'required') {
  if (!toolChoice) return undefined
  return toolChoice
}

async function geminiChatCompletionWithTools(
  messages: AgentMessage[],
  tools: ToolDef[],
  opts?: { temperature?: number; max_tokens?: number; model?: string; tool_choice?: 'auto' | 'none' | 'required' },
): Promise<ChatResult> {
  assertGeminiConfigured()
  const model = normalizeGeminiModel(opts?.model)
  const result = await generateText({
    model: google(model),
    messages: toGeminiMessages(messages),
    tools: toGeminiTools(tools),
    toolChoice: toToolChoice(opts?.tool_choice),
    maxOutputTokens: opts?.max_tokens ?? 1500,
    temperature: opts?.temperature ?? 0.5,
  })

  const toolCalls = result.toolCalls?.map(call => ({
    id: call.toolCallId,
    type: 'function' as const,
    function: {
      name: call.toolName,
      arguments: JSON.stringify(call.input ?? {}),
    },
  }))

  return {
    content: result.text || null,
    tool_calls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
    finish_reason: result.finishReason ?? 'unknown',
  }
}

export async function chatCompletion(
  messages: Message[],
  opts?: { temperature?: number; max_tokens?: number; model?: string }
): Promise<string> {
  if (shouldUseGemini(opts?.model)) {
    return geminiChatCompletion(messages, opts)
  }
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
  if (shouldUseGemini(opts?.model)) {
    return geminiChatCompletionWithTools(messages, tools, opts)
  }
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
