import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { chatCompletion } from '@/lib/ai-client'
import { generateText } from 'ai'
import { google } from '@ai-sdk/google'

const MEMO_TAGS = ['仕事', '生活', '学習', '健康', '人間関係'] as const

const SYSTEM_PROMPT = `Focusmapのメモ整理。JSONのみ返す。
schema={"title":string,"category":string,"tags":string[],"description":string,"scheduled_at":string|null,"duration_minutes":number}
制約: titleは30字以内。descriptionはURLを消さず原文ベースで最大120字。categoryは必ず 仕事/生活/学習/健康/人間関係 のどれか1つ。tagsは必ず空配列[]。ミクロな固有タグ（料理名、買い物品、作業名など）は作らない。duration_minutesは5/15/30/60/90/120の近い値。日時が明確な時だけscheduled_atをISO文字列にする。
現在日時: ${new Date().toISOString()}`

function normalizeMemoModel(model: string) {
  if (model === 'gemini-3.0-flash') return 'gemini-2.5-flash'
  return model
}

function normalizeMemoCategory(value: unknown, fallbackText = '') {
  if (typeof value === 'string' && MEMO_TAGS.includes(value as (typeof MEMO_TAGS)[number])) {
    return value
  }
  const text = `${typeof value === 'string' ? value : ''} ${fallbackText}`
  if (/仕事|業務|会議|資料|連絡|事務|営業|顧客|AI|自動化|開発|実装|コード|調査/.test(text)) return '仕事'
  if (/学習|勉強|読書|講座|本|スキル|技術検証/.test(text)) return '学習'
  if (/健康|運動|睡眠|病院|通院|休息|メンタル|食事改善/.test(text)) return '健康'
  if (/家族|友人|会食|相談|連絡|人間関係|プレゼント|イベント/.test(text)) return '人間関係'
  return '生活'
}

type MemoSuggestionDraft = {
  title?: string
  category?: string
  tags?: string[]
  memo_status?: string
  description?: string
  scheduled_at?: string | null
  duration_minutes?: number | null
  time_candidates?: Array<{ scheduled_at: string }>
}

function stripJsonFence(raw: string) {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  return (fenced?.[1] ?? raw).trim()
}

function firstBalancedJson(source: string) {
  const start = source.search(/[\[{]/)
  if (start < 0) return null
  const stack: string[] = []
  let inString = false
  let escaped = false
  for (let index = start; index < source.length; index++) {
    const char = source[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') stack.push('}')
    if (char === '[') stack.push(']')
    if (char === '}' || char === ']') {
      if (stack.pop() !== char) return null
      if (stack.length === 0) return source.slice(start, index + 1)
    }
  }
  return null
}

function extractJson(raw: string): unknown {
  const source = stripJsonFence(raw)
  try {
    return JSON.parse(source)
  } catch {
    const balanced = firstBalancedJson(source)
    if (!balanced) {
      throw new Error('AIの返答からJSONを抽出できませんでした')
    }
    return JSON.parse(balanced)
  }
}

function normalizeSuggestion(parsed: unknown, fallbackText: string): Required<Omit<MemoSuggestionDraft, 'time_candidates'>> & { time_candidates?: Array<{ scheduled_at: string }> } {
  if (Array.isArray(parsed)) {
    const items = parsed.filter(item => item && typeof item === 'object') as MemoSuggestionDraft[]
    const titles = items.map(item => item.title).filter(Boolean) as string[]
    const descriptions = items.map(item => item.description || item.title).filter(Boolean) as string[]
    return {
      title: titles.slice(0, 2).join(' / ').slice(0, 30) || fallbackText.slice(0, 30) || '新しいメモ',
      category: normalizeMemoCategory(items.find(item => item.category)?.category, fallbackText),
      tags: [],
      memo_status: 'organized',
      description: descriptions.join('。').slice(0, 120) || fallbackText,
      scheduled_at: items.find(item => item.scheduled_at)?.scheduled_at ?? null,
      duration_minutes: items.reduce((sum, item) => sum + (Number(item.duration_minutes) || 0), 0) || 60,
      time_candidates: [],
    }
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('AIの返答JSONがオブジェクトではありません')
  }
  const item = parsed as MemoSuggestionDraft
  return {
    title: (item.title || fallbackText.slice(0, 30) || '新しいメモ').slice(0, 30),
    category: normalizeMemoCategory(item.category, fallbackText),
    tags: [],
    memo_status: item.memo_status || 'organized',
    description: item.description || fallbackText,
    scheduled_at: item.scheduled_at ?? null,
    duration_minutes: Number(item.duration_minutes) || 60,
    time_candidates: Array.isArray(item.time_candidates) ? item.time_candidates : [],
  }
}

async function completeMemoJson(
  messages: Parameters<typeof chatCompletion>[0],
  model: string,
) {
  if (model.startsWith('gemini-')) {
    if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
      throw new Error('GOOGLE_GENERATIVE_AI_API_KEY が設定されていません')
    }
    const result = await generateText({
      model: google(model),
      system: messages.find(message => message.role === 'system')?.content,
      prompt: messages.find(message => message.role === 'user')?.content ?? '',
      maxOutputTokens: 450,
      temperature: 0,
      providerOptions: {
        google: {
          thinkingConfig: {
            thinkingBudget: 0,
          },
        },
      },
    })
    return result.text
  }

  try {
    return await chatCompletion(messages, {
      max_tokens: 900,
      temperature: 0.1,
      model,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (!message.startsWith('AI_EMPTY_RESPONSE:')) throw error
    return chatCompletion(messages, {
      max_tokens: 1800,
      temperature: 0.1,
      model,
    })
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as { text?: string; model?: string }
  if (!body.text?.trim()) return NextResponse.json({ error: 'text は必須です' }, { status: 400 })

  try {
    if (
      !process.env.GOOGLE_GENERATIVE_AI_API_KEY &&
      !process.env.EXTERNAL_AI_API_KEY &&
      !process.env.OPENCODE_GO_API_KEY &&
      !process.env.MOONSHOT_API_KEY
    ) {
      return NextResponse.json({ error: 'AI APIキーが設定されていません' }, { status: 503 })
    }

    const { data: context } = await supabase
      .from('ai_user_context')
      .select('preferences')
      .eq('user_id', user.id)
      .maybeSingle()
    const preferences = context?.preferences as Record<string, unknown> | null
    const configuredModel = typeof preferences?.ai_ingest_model === 'string'
      ? preferences.ai_ingest_model.trim()
      : ''
    const requestModel = typeof body.model === 'string' ? body.model.trim() : ''
    const modelUsed = normalizeMemoModel(requestModel || configuredModel || 'glm-5.1')

    const raw = await completeMemoJson([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: body.text.slice(0, 1200) },
    ], modelUsed)

    const suggestion = normalizeSuggestion(extractJson(raw), body.text)

    return NextResponse.json({
      model: modelUsed,
      suggestion: {
        title: suggestion.title,
        category: normalizeMemoCategory(suggestion.category, body.text),
        tags: [],
        memo_status: suggestion.time_candidates?.length ? 'time_candidates' : (suggestion.memo_status || 'organized'),
        description: suggestion.description || body.text,
        scheduled_at: suggestion.scheduled_at ?? null,
        duration_minutes: suggestion.duration_minutes ?? 60,
        time_candidates: suggestion.scheduled_at ? [{
          label: '指定日時',
          scheduled_at: suggestion.scheduled_at,
          duration_minutes: suggestion.duration_minutes ?? 60,
          reason: '入力から日時を抽出',
        }] : [],
        subtask_suggestions: [],
      },
    })
  } catch (e) {
    const errMessage = e instanceof Error ? e.message : ''
    const message = errMessage.startsWith('AI_EMPTY_RESPONSE:')
      ? 'AIの返答本文が空でした。別のモデルを選ぶか、もう一度実行してください。'
      : errMessage || 'AI解析に失敗しました'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
