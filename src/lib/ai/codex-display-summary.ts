import { deepseek } from "@ai-sdk/deepseek"
import { google } from "@ai-sdk/google"
import { generateObject } from "ai"
import { z } from "zod"
import {
  buildFallbackCodexDisplaySummary,
  normalizeCodexDisplaySummaryInput,
  type CodexDisplaySummary,
  type CodexDisplaySummaryInput,
} from "@/lib/codex-display-summary"

const SUMMARY_SCHEMA = z.object({
  done: z.string().min(1).max(80),
  current: z.string().min(1).max(80),
  next: z.string().min(1).max(80),
})

const DEEPSEEK_SUMMARY_PROVIDER_OPTIONS = {
  deepseek: {
    thinking: { type: "disabled" as const },
    reasoningEffort: "low" as const,
  },
} as const

function inputSize(input: CodexDisplaySummaryInput) {
  return [
    input.title,
    input.snippet ?? "",
    input.detailText ?? "",
    ...input.messages.map(message => message.body),
  ].join("\n").length
}

function getModel(size: number) {
  if (process.env.DEEPSEEK_API_KEY) {
    const modelId = size >= 5_000
      ? process.env.DEEPSEEK_CODEX_SUMMARY_MODEL ?? process.env.DEEPSEEK_AGENT_MODEL ?? process.env.DEEPSEEK_MODEL ?? "deepseek-v4-pro"
      : process.env.DEEPSEEK_CODEX_SUMMARY_SPEED_MODEL ?? process.env.DEEPSEEK_AGENT_SPEED_MODEL ?? process.env.DEEPSEEK_INTENT_MODEL ?? "deepseek-v4-flash"
    return {
      model: deepseek(modelId),
      modelLabel: modelId,
      providerOptions: DEEPSEEK_SUMMARY_PROVIDER_OPTIONS,
    }
  }

  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    const modelId = process.env.GEMINI_CODEX_SUMMARY_MODEL ?? process.env.GEMINI_MODEL ?? "gemini-3.1-flash-lite"
    return {
      model: google(modelId),
      modelLabel: modelId,
      providerOptions: undefined,
    }
  }

  return null
}

function buildPrompt(input: CodexDisplaySummaryInput) {
  const messages = input.messages.slice(-12).map((message, index) => {
    const role = message.role === "user" ? "user" : "codex"
    return `${index + 1}. ${role}: ${message.body}`
  }).join("\n\n")

  return [
    `タイトル: ${input.title}`,
    input.statusLabel ? `状態: ${input.statusLabel}` : "",
    input.snippet ? `初回依頼の要点: ${input.snippet}` : "",
    input.detailText ? `補足: ${input.detailText}` : "",
    messages ? `表示対象の会話:\n${messages}` : "",
  ].filter(Boolean).join("\n\n")
}

export async function generateCodexDisplaySummary(input: CodexDisplaySummaryInput): Promise<{
  summary: CodexDisplaySummary
  source: "ai" | "fallback"
  model: string | null
  error?: string
}> {
  const normalized = normalizeCodexDisplaySummaryInput(input)
  const fallback = buildFallbackCodexDisplaySummary(normalized)
  const size = inputSize(normalized)
  const modelConfig = getModel(size)

  if (!modelConfig || size < 240) {
    return { summary: fallback, source: "fallback", model: null }
  }

  try {
    const result = await generateObject({
      model: modelConfig.model,
      schema: SUMMARY_SCHEMA,
      system: [
        "あなたはFocusmapのCodex作業履歴を右サイドバー用に要約するアシスタントです。",
        "raw prompt、画面情報、skill定義、system/developer指示、内部ログは要約対象に含めないでください。",
        "ユーザーが今判断するために必要な情報だけを日本語で短く返してください。",
        "done=実行したこと、current=現状、next=確認すること。",
      ].join("\n"),
      prompt: buildPrompt(normalized),
      temperature: 0.1,
      ...(modelConfig.providerOptions ? { providerOptions: modelConfig.providerOptions } : {}),
    })

    return {
      summary: {
        done: result.object.done,
        current: result.object.current,
        next: result.object.next,
      },
      source: "ai",
      model: modelConfig.modelLabel,
    }
  } catch (error) {
    return {
      summary: fallback,
      source: "fallback",
      model: modelConfig.modelLabel,
      error: error instanceof Error ? error.message : "AI summary failed",
    }
  }
}
