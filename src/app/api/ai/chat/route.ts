import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  action?: {
    type: string
    params: Record<string, unknown>
    description: string
  }
}

// POST /api/ai/chat - AIチャット対話
export async function POST(request: Request) {
  try {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'AI service not configured' }, { status: 503 })
    }

    const body = await request.json()
    const { message, history = [], context = {} } = body as {
      message: string
      history: ChatMessage[]
      context: { activeNoteId?: string; activeProjectId?: string }
    }

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 })
    }

    // 7ラリー制限チェック
    const rallyCount = history.filter(m => m.role === 'user').length
    if (rallyCount >= 7) {
      return NextResponse.json({
        reply: '会話が長くなりました。リセットして新しい会話を始めましょう。',
        shouldReset: true,
      })
    }

    // ユーザーのプロジェクトとタスクを取得（コンテキスト用）
    const { data: projects } = await supabase
      .from('projects')
      .select('id, title')
      .eq('user_id', user.id)

    const { data: tasks } = await supabase
      .from('tasks')
      .select('id, title, project_id, priority, scheduled_at')
      .eq('user_id', user.id)
      .is('parent_task_id', null)
      .limit(30)

    // アクティブなメモのコンテキスト
    let activeNoteContent = ''
    if (context.activeNoteId) {
      const { data: note } = await supabase
        .from('notes')
        .select('content, project_id')
        .eq('id', context.activeNoteId)
        .eq('user_id', user.id)
        .single()
      if (note) {
        activeNoteContent = `\n現在選択中のメモ: "${note.content}"`
      }
    }

    // プロジェクト一覧を文字列化
    const projectsContext = (projects || []).map(p => {
      const projectTasks = (tasks || []).filter(t => t.project_id === p.id)
      const taskList = projectTasks.map(t => `  - ${t.title}`).join('\n')
      return `- ${p.title} (ID: ${p.id})${taskList ? '\n' + taskList : ''}`
    }).join('\n')

    // 会話履歴を文字列化
    const historyContext = history.map(m =>
      `${m.role === 'user' ? 'ユーザー' : 'AI'}: ${m.content}`
    ).join('\n')

    const systemPrompt = `あなたは「しかみか」のAIアシスタントです。
ユーザーのメモを整理し、タスクや予定の管理を手伝います。

## できること
1. マインドマップにタスクを追加 → action: add_task
2. カレンダーに予定を追加 → action: add_calendar_event
3. メモの編集 → action: edit_memo
4. メモにプロジェクトを紐付け → action: link_project
5. メモを処理済みにする → action: archive_memo
6. タスクの優先度変更 → action: update_priority
7. タスクの締切設定 → action: set_deadline

## ルール
- 操作を実行する場合、応答テキストに操作内容を説明し、JSONブロックでアクションを指定する
- 削除操作は実行不可。「削除はメモ画面から行ってください」と案内する
- 曖昧な指示は質問して明確にする。その際、選択肢ブロックで候補を提示する
- 簡潔に応答する（3文以内）
- 日本語で応答する

## 選択肢の指定方法
ユーザーに選択を求める場合、応答の最後に以下のJSONブロックを含める:
\`\`\`options
[{"label": "表示テキスト", "value": "選択時に送信される値"}, ...]
\`\`\`
- 最大4つまで
- プロジェクトやタスクを選ぶ場合は、コンテキストの一覧から候補を出す
- 日時を選ぶ場合は、具体的な候補日時を出す

例:
ユーザー: 「マップに追加して」
AI: どのプロジェクトに追加しますか？
\`\`\`options
[{"label": "プロジェクトA", "value": "プロジェクトAに追加して"}, {"label": "プロジェクトB", "value": "プロジェクトBに追加して"}]
\`\`\`

## アクション指定方法
操作が必要な場合、応答の最後に以下のJSONブロックを含める:
\`\`\`action
{"type": "アクション名", "params": {パラメータ}, "description": "確認用の説明"}
\`\`\`
注意: actionブロックとoptionsブロックは同時に使わない。どちらか一方のみ。

アクション名と必要なパラメータ:
- add_task: {"title": "タスク名", "project_id": "プロジェクトID(任意)"}
- add_calendar_event: {"title": "予定名", "scheduled_at": "ISO8601日時", "estimated_time": 分数}
- edit_memo: {"note_id": "メモID", "content": "新しい内容"}
- link_project: {"note_id": "メモID", "project_id": "プロジェクトID"}
- archive_memo: {"note_id": "メモID"}
- update_priority: {"task_id": "タスクID", "priority": 1-4}
- set_deadline: {"task_id": "タスクID", "scheduled_at": "ISO8601日時", "estimated_time": 分数}

## コンテキスト
今日の日付: ${new Date().toISOString().split('T')[0]}

ユーザーのプロジェクト一覧:
${projectsContext || '(プロジェクトなし)'}
${activeNoteContent}`

    const prompt = `${historyContext ? `## 会話履歴\n${historyContext}\n\n` : ''}ユーザー: ${message.trim()}`

    // Gemini API 呼び出し
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })

    const result = await model.generateContent({
      contents: [
        { role: 'user', parts: [{ text: systemPrompt + '\n\n' + prompt }] }
      ],
      generationConfig: {
        maxOutputTokens: 500,
        temperature: 0.7,
      },
    })

    const responseText = result.response.text()

    // アクションブロックを抽出
    const actionMatch = responseText.match(/```action\s*\n([\s\S]*?)\n```/)
    let action: ChatMessage['action'] | undefined
    let replyText = responseText

    if (actionMatch) {
      try {
        action = JSON.parse(actionMatch[1])
        replyText = replyText.replace(/```action\s*\n[\s\S]*?\n```/, '').trim()
      } catch {
        // JSON パース失敗時はアクションなしで続行
      }
    }

    // 選択肢ブロックを抽出
    const optionsMatch = replyText.match(/```options\s*\n([\s\S]*?)\n```/)
    let options: { label: string; value: string }[] | undefined

    if (optionsMatch) {
      try {
        const parsed = JSON.parse(optionsMatch[1])
        if (Array.isArray(parsed) && parsed.length > 0) {
          options = parsed.slice(0, 4)
        }
        replyText = replyText.replace(/```options\s*\n[\s\S]*?\n```/, '').trim()
      } catch {
        // パース失敗時は選択肢なしで続行
      }
    }

    return NextResponse.json({
      reply: replyText,
      action,
      options,
    })
  } catch (error) {
    console.error('Chat error:', error)
    const errMsg = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: `Chat failed: ${errMsg}` }, { status: 500 })
  }
}
