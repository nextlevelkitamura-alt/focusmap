import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'

// POST /api/ai/analyze-memo - メモをAIで分析・分類
export async function POST(request: Request) {
  try {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      console.error('GEMINI_API_KEY is not configured')
      return NextResponse.json({ error: 'AI service not configured' }, { status: 503 })
    }

    const body = await request.json()
    const { content, noteId } = body

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return NextResponse.json({ error: 'Content is required' }, { status: 400 })
    }

    // ユーザーのプロジェクトとルートタスクを取得（コンテキスト用）
    const { data: projects } = await supabase
      .from('projects')
      .select('id, name')
      .eq('user_id', user.id)
      .order('name')

    const { data: rootTasks } = await supabase
      .from('tasks')
      .select('id, title, project_id, parent_task_id')
      .eq('user_id', user.id)
      .is('parent_task_id', null)
      .order('title')

    // プロジェクトとタスクの構造をテキスト化
    const projectContext = (projects || []).map(p => {
      const tasks = (rootTasks || [])
        .filter(t => t.project_id === p.id)
        .map(t => `  - ${t.title} (id: ${t.id})`)
        .join('\n')
      return `- ${p.name} (id: ${p.id})\n${tasks}`
    }).join('\n')

    // Gemini API 呼び出し
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })

    const prompt = `あなたはタスク管理アシスタントです。
以下のメモを分析して、分類と追加先を提案してください。

メモ: "${content.trim()}"

ユーザーのプロジェクトとタスク一覧:
${projectContext || '(プロジェクトなし)'}

以下のJSON形式で回答してください（JSONのみ、説明文不要）:
{
  "classification": "calendar" または "map",
  "confidence": 0.0〜1.0の数値,
  "suggested_project_id": "プロジェクトID or null",
  "suggested_project_name": "プロジェクト名 or null",
  "suggested_node_id": "親タスクID or null",
  "suggested_node_title": "親タスク名 or null",
  "reasoning": "判断理由を1-2文で",
  "extracted_entities": {
    "dates": ["抽出された日付（YYYY-MM-DD形式）"],
    "times": ["抽出された時刻（HH:MM形式）"],
    "keywords": ["重要キーワード"]
  }
}

分類基準:
- "calendar": 日時が明確、予定・イベント・会議・締め切りなど
- "map": アイディア・計画・タスク・やること・メモなど`

    const result = await model.generateContent(prompt)
    const responseText = result.response.text()

    // JSONを抽出（マークダウンのコードブロックを考慮）
    const jsonMatch = responseText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.error('Failed to parse AI response:', responseText)
      return NextResponse.json({ error: 'AI analysis failed to produce valid result' }, { status: 500 })
    }

    const aiAnalysis = JSON.parse(jsonMatch[0])

    // noteId が指定されていれば、notes テーブルの ai_analysis を更新
    if (noteId) {
      await supabase
        .from('notes')
        .update({
          ai_analysis: aiAnalysis,
          status: 'processed',
        })
        .eq('id', noteId)
        .eq('user_id', user.id)
    }

    return NextResponse.json({ analysis: aiAnalysis })
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    console.error('AI analysis error:', errMsg, error)
    return NextResponse.json({ error: `AI analysis failed: ${errMsg}` }, { status: 500 })
  }
}
