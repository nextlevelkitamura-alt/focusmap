import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { getFreeTimeContext } from '@/lib/free-time-context'
import { format } from 'date-fns'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

const MAX_RALLIES = 15

// UTCのDateをJSTのDateに変換（+9時間）
function toJstDate(date: Date): Date {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000)
}

// POST /api/ai/scheduling - スケジューリング特化AIチャット
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
    const { message, history = [] } = body as {
      message: string
      history: ChatMessage[]
    }

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 })
    }

    // ラリー制限チェック
    const rallyCount = history.filter(m => m.role === 'user').length
    if (rallyCount >= MAX_RALLIES) {
      return NextResponse.json({
        reply: '会話が長くなりました。リセットして新しい会話を始めましょう。',
        shouldReset: true,
      })
    }

    // カレンダー設定を取得
    const { data: calendarSettings } = await supabase
      .from('user_calendar_settings')
      .select('is_sync_enabled, default_calendar_id')
      .eq('user_id', user.id)
      .maybeSingle()

    const calendarConnected = calendarSettings?.is_sync_enabled === true

    // カレンダーが未連携の場合はエラーメッセージ
    if (!calendarConnected) {
      return NextResponse.json({
        reply: 'カレンダーと連携するとスケジュール調整ができます。設定画面からGoogleカレンダーを接続してください。',
        shouldReset: false,
      })
    }

    // 利用可能なカレンダー一覧
    const { data: userCalendars } = await supabase
      .from('user_calendars')
      .select('google_calendar_id, name, is_primary')
      .eq('user_id', user.id)
      .order('is_primary', { ascending: false })

    const calendarIds = (userCalendars || []).map(c => c.google_calendar_id).filter(Boolean)
    const defaultCalendarId = calendarSettings?.default_calendar_id || calendarIds[0] || 'primary'

    const calendarsContext = (userCalendars || []).map(c =>
      `- ${c.name} (ID: ${c.google_calendar_id})${c.is_primary ? ' [デフォルト]' : ''}`
    ).join('\n')

    // 空き時間コンテキスト（会話開始時のみ取得）
    let freeTimeContext = ''
    const isFirstMessage = history.length === 0

    if (isFirstMessage && calendarIds.length > 0) {
      try {
        const result = await getFreeTimeContext(user.id, calendarIds, supabase)
        freeTimeContext = result.contextText
      } catch (err) {
        console.error('[scheduling] Failed to fetch calendar events:', err)
        freeTimeContext = '\n## 空き時間情報\n（取得に失敗しました。日時を直接お伝えください）'
      }
    } else if (!isFirstMessage) {
      freeTimeContext = '\n（空き時間情報は会話開始時に取得済みです。上の情報を参照してください）'
    }

    // プロジェクト一覧
    const { data: projects } = await supabase
      .from('projects')
      .select('id, title')
      .eq('user_id', user.id)
      .limit(20)

    const projectsContext = (projects || []).map(p => `- ${p.title} (ID: ${p.id})`).join('\n')

    // 会話履歴
    const historyContext = history.map(m =>
      `${m.role === 'user' ? 'ユーザー' : 'AI'}: ${m.content}`
    ).join('\n')

    const nowJstForPrompt = toJstDate(new Date())
    const todayStr = format(nowJstForPrompt, 'yyyy-MM-dd')
    const nowTimeStr = format(nowJstForPrompt, 'HH:mm')
    const days = ['日', '月', '火', '水', '木', '金', '土']
    const todayLabel = `${nowJstForPrompt.getFullYear()}年${nowJstForPrompt.getMonth() + 1}月${nowJstForPrompt.getDate()}日(${days[nowJstForPrompt.getDay()]})`

    const systemPrompt = `あなたはスケジューリング専門のAIアシスタントです。
ユーザーの予定を、実際のカレンダーの空き時間を確認しながら登録します。

## 会話の進め方（重要）
1. **予定タイトルの把握**：予定名が分からなければ「どんな予定ですか？」と聞く
2. **所要時間の確認**：所要時間が不明なら optionsブロック で選択肢を提示
   - デフォルト: 会議・打ち合わせ=60分, ランチ=60分, 作業=90分
   - 時間が明示されていればデフォルトを適用してスキップ可
3. **時間候補の提示**：空き時間データから2〜4候補を slotsブロック で提示
4. **最終確認・登録**：スロット選択後に actionブロック を出力

## slotsブロック（時間候補の提示）
ユーザーに時間を選ばせる場合は以下の形式で返す：
\`\`\`slots
[{"date":"YYYY-MM-DD","startTime":"HH:MM","endTime":"HH:MM","label":"M月D日(曜) HH:MM〜HH:MM","scheduled_at":"YYYY-MM-DDTHH:MM:00+09:00"}]
\`\`\`
- 2〜4候補、今日・明日を優先して近い順に提示
- 提供された「空き時間データ」にある時間のみ提案すること（存在しない時間は絶対に提案しない）
- slotsブロックと optionsブロック と actionブロック は同時に使わない（どれか1つだけ）

## optionsブロック（質問時の選択肢）
\`\`\`options
[{"label": "30分", "value": "30分でお願いします"}, {"label": "1時間", "value": "1時間でお願いします"}, ...]
\`\`\`
- 最大4つまで

## actionブロック（登録確認）
すべての情報が揃い、ユーザーが時間を選んだ後に出力：
\`\`\`action
{"type": "add_calendar_event", "params": {"title": "予定名", "scheduled_at": "ISO8601+09:00", "estimated_time": 分数, "calendar_id": "カレンダーID"}, "description": "📅 M月D日(曜) HH:MM〜HH:MM 予定名 をカレンダーに登録します"}
\`\`\`
- scheduled_atは必ず+09:00付きのISO8601形式
- calendar_idはデフォルト: ${defaultCalendarId}

## 返答のルール
- 1回に1つだけ質問する
- 3文以内で簡潔に
- 日本語で返答
- 空き時間データにない時間は提案しない
${calendarIds.length > 1 ? '- カレンダーが複数ある場合、optionsでどのカレンダーか聞く' : ''}

## コンテキスト
今日: ${todayLabel}（${todayStr}）
現在時刻: ${nowTimeStr}
タイムゾーン: Asia/Tokyo
デフォルトカレンダーID: ${defaultCalendarId}
${calendarsContext ? `利用可能なカレンダー:\n${calendarsContext}` : ''}

ユーザーのプロジェクト一覧:
${projectsContext || '(プロジェクトなし)'}
${freeTimeContext}`

    const prompt = `${historyContext ? `## 会話履歴\n${historyContext}\n\n` : ''}ユーザー: ${message.trim()}`

    // Gemini API 呼び出し（3.0優先、未対応時は2.5へフォールバック）
    const genAI = new GoogleGenerativeAI(apiKey)
    const preferredModel = (process.env.GEMINI_MODEL || 'gemini-3.0-flash').trim()
    const modelCandidates = Array.from(new Set([preferredModel, 'gemini-2.5-flash'].filter(Boolean)))

    let result: Awaited<ReturnType<ReturnType<typeof genAI.getGenerativeModel>['generateContent']>> | null = null
    let lastModelError: unknown = null

    for (const modelName of modelCandidates) {
      try {
        const model = genAI.getGenerativeModel({ model: modelName })
        result = await model.generateContent({
          contents: [
            { role: 'user', parts: [{ text: systemPrompt + '\n\n' + prompt }] }
          ],
          generationConfig: {
            maxOutputTokens: 1000,
            temperature: 0.5,
          },
        })
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
    let replyText = responseText

    // actionブロックを抽出
    const actionMatch = replyText.match(/```action\s*\n([\s\S]*?)\n```/)
    let action: { type: string; params: Record<string, unknown>; description: string } | undefined
    if (actionMatch) {
      try {
        action = JSON.parse(actionMatch[1])
        replyText = replyText.replace(/```action\s*\n[\s\S]*?\n```/, '').trim()
      } catch { /* パース失敗時は無視 */ }
    }

    // slotsブロックを抽出
    const slotsMatch = replyText.match(/```slots\s*\n([\s\S]*?)\n```/)
    let slots: Array<{ date: string; startTime: string; endTime: string; label: string; scheduled_at: string }> | undefined
    if (slotsMatch) {
      try {
        const parsed = JSON.parse(slotsMatch[1])
        if (Array.isArray(parsed) && parsed.length > 0) {
          slots = parsed.slice(0, 4)
        }
        replyText = replyText.replace(/```slots\s*\n[\s\S]*?\n```/, '').trim()
      } catch { /* パース失敗時は無視 */ }
    }

    // optionsブロックを抽出
    const optionsMatch = replyText.match(/```options\s*\n([\s\S]*?)\n```/)
    let options: Array<{ label: string; value: string }> | undefined
    if (optionsMatch) {
      try {
        const parsed = JSON.parse(optionsMatch[1])
        if (Array.isArray(parsed) && parsed.length > 0) {
          options = parsed.slice(0, 4)
        }
        replyText = replyText.replace(/```options\s*\n[\s\S]*?\n```/, '').trim()
      } catch { /* パース失敗時は無視 */ }
    }

    return NextResponse.json({
      reply: replyText,
      action,
      slots,
      options,
    })
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error'
    console.error('[scheduling] Chat error:', errMsg)

    if (errMsg.includes('API key not valid') || errMsg.includes('API_KEY_INVALID')) {
      return NextResponse.json({ error: 'AI機能が一時的に利用できません' }, { status: 503 })
    }
    if (errMsg.includes('quota') || errMsg.includes('429') || errMsg.includes('RATE_LIMIT')) {
      return NextResponse.json({ error: 'リクエスト上限に達しました。しばらくお待ちください' }, { status: 429 })
    }

    return NextResponse.json({ error: 'スケジュール調整中にエラーが発生しました' }, { status: 500 })
  }
}
