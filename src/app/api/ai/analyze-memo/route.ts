import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'
import { generateText } from 'ai'
import { getModelForSkill } from '@/lib/ai/providers'

// POST /api/ai/analyze-memo - メモをAIで分析・分類
export async function POST(request: Request) {
  try {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Vercel AI SDK (@ai-sdk/google) は GOOGLE_GENERATIVE_AI_API_KEY を自動で読む
    if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
      console.error('GOOGLE_GENERATIVE_AI_API_KEY is not configured')
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
    "dates": ["抽出/推測した日付（YYYY-MM-DD形式、最大3件）"],
    "times": ["抽出/推測した時刻（HH:MM形式、最大3件）"],
    "keywords": ["重要キーワード"]
  }
}

分類基準:
- "calendar": 日時が明確、予定・イベント・会議・締め切り・旅行・外出など
- "map": アイディア・計画・タスク・やること・メモなど

## dates の抽出ルール（厳守）
- 「明日」「来週月曜」「11/15」「2026/11/15」など**明示的な日付表現**がある場合のみ、今日(${today})を基準にYYYY-MM-DD形式へ変換して格納
- 「今度」「そのうち」「いつか」「近いうち」等の曖昧表現は**必ず空配列 []**
- 推測で日付を作らない。明示がなければ空配列
- 配列は最大3件まで

## times の抽出ルール（最重要・厳守）
**固定マッピング（朝→09:00、夜→19:00 等）は禁止**。以下の優先順位で判断する:

1. **明示的な時刻表現**（「9時」「14:30」「朝9時」「午後3時」等）があれば、その値を高信頼度で格納
2. 明示時刻がない場合のみ、**メモ全体の文脈**（活動内容・対象・場面）から「現実的にいつやる活動か」を判断し、妥当な候補を最大3件提示する
   - 例: 「朝ジョギング」「ランニング」→ ["06:00", "07:00"]
   - 例: 「晩酌」「飲み会」→ ["19:00", "20:00", "21:00"]
   - 例: 「ランチ会議」→ ["12:00", "12:30", "13:00"]
   - 例: 「歯医者の予約」→ 時刻情報がないので []（推測しない）
3. 「夜」「朝」のような単語が出てきても、**活動内容と矛盾するなら採用しない**（例: 「朝のジムに行く話。夜になって思い出した」のような文では、活動は朝なので times は朝の候補のみ）
4. 推測の自信が低い、または活動の典型時刻が広範すぎる場合は**必ず空配列 []**
5. 配列は最大3件まで

## event_title のルール
- 日時情報を含めず、予定の本質的な名前だけを抽出すること
- map 分類の場合は null`

    // Vercel AI SDK で生成
    const aiResult = await generateText({
      model: getModelForSkill(),
      prompt,
      maxOutputTokens: 800,
      temperature: 0.3,
    })
    const responseText = aiResult.text

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
      return NextResponse.json({ error: 'AI設定を確認してください（APIキーエラー）', errorCode: 'API_KEY_INVALID' }, { status: 503 })
    }
    if (errMsg.includes('quota') || errMsg.includes('429') || errMsg.includes('RATE_LIMIT')) {
      return NextResponse.json({ error: 'リクエスト上限に達しました。しばらくお待ちください', errorCode: 'RATE_LIMIT' }, { status: 429 })
    }

    return NextResponse.json({ error: 'AI分析中にエラーが発生しました', errorCode: 'UNKNOWN' }, { status: 500 })
  }
}
