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

    // Gemini API 呼び出し（3.0優先、未対応時は2.5へフォールバック）
    const genAI = new GoogleGenerativeAI(apiKey)
    const preferredModel = (process.env.GEMINI_MODEL || 'gemini-3.0-flash').trim()
    const modelCandidates = Array.from(new Set([preferredModel, 'gemini-2.5-flash'].filter(Boolean)))

    const today = new Date().toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-')
    const dayOfWeek = ['日', '月', '火', '水', '木', '金', '土'][new Date().getDay()]

    const prompt = `あなたはタスク管理アシスタントです。
以下のメモを分析して、分類と追加先を提案してください。

今日の日付: ${today}（${dayOfWeek}曜日）

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
  "event_title": "カレンダー予定の場合、日時部分を除いた予定名（例: 「明日の朝9時に会議」→「会議」、「来週土曜に江の島旅行」→「江の島旅行」）。map分類の場合はnull",
  "extracted_entities": {
    "dates": ["抽出された日付（YYYY-MM-DD形式）。「明日」「来週月曜」等は${today}を基準に具体的な日付に変換すること"],
    "times": ["抽出された時刻（HH:MM形式）。「朝」→09:00、「昼」→12:00、「夕方」→17:00、「夜」→19:00 のように変換"],
    "keywords": ["重要キーワード"]
  }
}

分類基準:
- "calendar": 日時が明確、予定・イベント・会議・締め切り・旅行・外出など
- "map": アイディア・計画・タスク・やること・メモなど

注意:
- 「明日」「来週」「今週末」等の相対的な表現は、今日(${today})を基準にYYYY-MM-DD形式の具体的な日付に変換すること
- event_titleは日時情報を含めず、予定の本質的な名前だけを抽出すること`

    let result: Awaited<ReturnType<ReturnType<typeof genAI.getGenerativeModel>['generateContent']>> | null = null
    let lastModelError: unknown = null

    for (const modelName of modelCandidates) {
      try {
        const model = genAI.getGenerativeModel({ model: modelName })
        result = await model.generateContent(prompt)
        break
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error)
        lastModelError = error
        const isModelUnavailable =
          errMsg.includes('404') ||
          errMsg.toLowerCase().includes('not found') ||
          errMsg.toLowerCase().includes('model')
        if (!isModelUnavailable) {
          throw error
        }
      }
    }

    if (!result) {
      throw lastModelError || new Error('No available Gemini model')
    }
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

    // Google API固有のエラーをユーザーフレンドリーなメッセージに変換
    if (errMsg.includes('API key not valid') || errMsg.includes('API_KEY_INVALID')) {
      return NextResponse.json({ error: 'AI機能が一時的に利用できません' }, { status: 503 })
    }
    if (errMsg.includes('quota') || errMsg.includes('429') || errMsg.includes('RATE_LIMIT')) {
      return NextResponse.json({ error: 'リクエスト上限に達しました。しばらくお待ちください' }, { status: 429 })
    }

    return NextResponse.json({ error: 'AI分析中にエラーが発生しました' }, { status: 500 })
  }
}
