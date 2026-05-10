import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { chatCompletion } from '@/lib/ai-client'

const SYSTEM_PROMPT = `あなたはFocusmapの思考メモ整理アシスタントです。ユーザーが話した内容を、保存前のメモ提案として構造化してください。
JSON のみで返答してください（マークダウン・説明文は不要）。

返すJSONのスキーマ:
{
  "title": string,           // 簡潔なタイトル（最大30文字）
  "category": string,        // 学習/調査/目標/アイデア/旅行/健康/趣味/その他 のいずれか
  "tags": string[],          // 絞り込み用タグ。2〜4個
  "memo_status": "unsorted" | "organized" | "time_candidates",
  "description": string,     // メモ本文。URLが含まれる場合はそのまま残す
  "scheduled_at": string | null,    // 日時が含まれる場合のみ ISO 8601形式。なければ null
  "duration_minutes": number | null, // 所要時間（分）。明示されていなければ推定値
  "time_candidates": [{"label": string, "scheduled_at": string, "duration_minutes": number, "reason": string}],
  "subtask_suggestions": [{"title": string, "estimated_minutes": number, "reason": string}]
}

ルール:
- メモの見出しに使える title を必ず作る。
- メモ本文にURLがあれば消さない。Google Docs等もそのまま残す。
- time_candidates は1〜3件。具体日付がなければ近い朝/夜/週末の候補を出す。
- subtask_suggestions は必要な場合のみ。空配列でもよい。

現在の日時: ${new Date().toISOString()}`

function fallbackSuggestion(text: string) {
  const title = text.split(/[。.\n]/)[0]?.trim().slice(0, 30) || '新しい思考メモ'
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(21, 0, 0, 0)
  const weekend = new Date()
  weekend.setDate(weekend.getDate() + ((6 - weekend.getDay() + 7) % 7 || 7))
  weekend.setHours(10, 0, 0, 0)
  const tags = ['調査']
  if (/AI|生成AI|ChatGPT|Claude|Codex/i.test(text)) tags.push('AI')
  if (/勉強|学習|学び/.test(text)) tags.push('学習')
  return {
    title,
    category: /勉強|学習|学び/.test(text) ? '学習' : '調査',
    tags,
    memo_status: 'time_candidates',
    description: text,
    scheduled_at: null,
    duration_minutes: 60,
    time_candidates: [
      { label: '明日 夜', scheduled_at: tomorrow.toISOString(), duration_minutes: 60, reason: '短く着手しやすい時間帯' },
      { label: '週末 午前', scheduled_at: weekend.toISOString(), duration_minutes: 90, reason: 'まとまった調査時間を取りやすい' },
    ],
    subtask_suggestions: [
      { title: '関連資料を確認する', estimated_minutes: 30, reason: '判断材料を集めるため' },
      { title: '要点をメモに整理する', estimated_minutes: 30, reason: '次の行動に移しやすくするため' },
    ],
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as { text?: string }
  if (!body.text?.trim()) return NextResponse.json({ error: 'text は必須です' }, { status: 400 })

  try {
    if (!process.env.EXTERNAL_AI_API_KEY) {
      return NextResponse.json({ suggestion: fallbackSuggestion(body.text) })
    }

    const raw = await chatCompletion([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user',   content: body.text },
    ])

    const suggestion = JSON.parse(raw) as {
      title: string
      category: string
      tags?: string[]
      memo_status?: string
      description: string
      scheduled_at: string | null
      duration_minutes: number | null
      time_candidates?: Array<{ label: string; scheduled_at: string; duration_minutes: number; reason: string }>
      subtask_suggestions?: Array<{ title: string; estimated_minutes: number; reason: string }>
    }

    return NextResponse.json({
      suggestion: {
        title: suggestion.title,
        category: suggestion.category || 'その他',
        tags: Array.isArray(suggestion.tags) ? suggestion.tags.slice(0, 6) : [],
        memo_status: suggestion.time_candidates?.length ? 'time_candidates' : (suggestion.memo_status || 'organized'),
        description: suggestion.description || body.text,
        scheduled_at: suggestion.scheduled_at ?? null,
        duration_minutes: suggestion.duration_minutes ?? 60,
        time_candidates: Array.isArray(suggestion.time_candidates) ? suggestion.time_candidates.slice(0, 3) : [],
        subtask_suggestions: Array.isArray(suggestion.subtask_suggestions) ? suggestion.subtask_suggestions.slice(0, 6) : [],
      },
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'AI解析に失敗しました'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
