/**
 * AI ツール定義 — Vercel AI SDK の tool() で定義
 *
 * Phase 1: ツール定義のみ作成（まだ generateText に渡していない）
 * Phase 2: generateText の tools に渡してエージェントループを有効化
 */
import { tool } from 'ai'
import { z } from 'zod/v3'
import { createClient } from '@/utils/supabase/server'
import { normalizeVisibility, resolveAiTaskSpaceId } from '@/lib/space-access'

// ━━━ タスク関連 ━━━

export const addTask = tool({
  description: 'マインドマップにタスクを追加する。ユーザーが「〜をやりたい」「〜を追加して」と言った時に使う。',
  inputSchema: z.object({
    title: z.string().describe('タスクのタイトル'),
    projectId: z.string().optional().describe('プロジェクトID（指定なしの場合はnull）'),
    parentTaskId: z.string().optional().describe('親タスクのID（サブタスクの場合）'),
  }),
  execute: async ({ title, projectId, parentTaskId }) => {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: '認証エラー' }

    const taskId = crypto.randomUUID()
    const { error } = await supabase.from('tasks').insert({
      id: taskId,
      title,
      user_id: user.id,
      project_id: projectId || null,
      parent_task_id: parentTaskId || null,
      status: 'pending',
    })
    if (error) return { success: false, error: error.message }
    return { success: true, taskId, title, message: `タスク「${title}」を追加しました` }
  },
})

// ━━━ カレンダー関連 ━━━

export const addCalendarEvent = tool({
  description: 'Googleカレンダーに予定を追加する。日時が含まれる発言の時に使う。',
  inputSchema: z.object({
    title: z.string().describe('予定のタイトル'),
    scheduledAt: z.string().describe('開始日時（ISO 8601形式、例: 2026-03-01T10:00:00+09:00）'),
    estimatedTime: z.number().optional().describe('所要時間（分）。デフォルト60分'),
    calendarId: z.string().optional().describe('GoogleカレンダーID。未指定ならデフォルトカレンダー'),
    projectId: z.string().optional().describe('紐付けるプロジェクトID'),
  }),
  execute: async ({ title, scheduledAt, estimatedTime, calendarId, projectId }) => {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: '認証エラー' }

    // カレンダー所有権チェック
    if (calendarId) {
      const { data: ownedCalendar } = await supabase
        .from('user_calendars')
        .select('google_calendar_id')
        .eq('user_id', user.id)
        .eq('google_calendar_id', calendarId)
        .maybeSingle()
      if (!ownedCalendar) return { success: false, error: '選択したカレンダーは利用できません' }
    }

    const taskId = crypto.randomUUID()
    const estMin = estimatedTime || 60

    // タスク作成
    const { error: taskError } = await supabase.from('tasks').insert({
      id: taskId,
      title,
      user_id: user.id,
      project_id: projectId || null,
      scheduled_at: scheduledAt,
      estimated_time: estMin,
      calendar_id: calendarId || null,
      stage: 'scheduled',
      status: 'todo',
      priority: 3,
    })
    if (taskError) return { success: false, error: taskError.message }

    // Google Calendar 同期
    let calendarSynced = false
    let resolvedCalendarId = calendarId || null
    if (scheduledAt && estMin > 0) {
      if (!resolvedCalendarId) {
        const { data: settings } = await supabase
          .from('user_calendar_settings')
          .select('is_sync_enabled, default_calendar_id')
          .eq('user_id', user.id)
          .maybeSingle()
        if (settings?.is_sync_enabled) {
          resolvedCalendarId = settings.default_calendar_id || 'primary'
          await supabase.from('tasks').update({ calendar_id: resolvedCalendarId }).eq('id', taskId)
        }
      }
      if (resolvedCalendarId) {
        try {
          const { syncTaskToCalendar } = await import('@/lib/google-calendar')
          await syncTaskToCalendar(user.id, taskId, {
            title,
            scheduled_at: scheduledAt,
            estimated_time: estMin,
            calendar_id: resolvedCalendarId,
          })
          calendarSynced = true
        } catch (e) {
          console.error('[tool:addCalendarEvent] Calendar sync failed:', e)
        }
      }
    }

    return {
      success: true,
      taskId,
      title,
      scheduledAt,
      calendarSynced,
      message: calendarSynced
        ? `予定「${title}」をカレンダーに登録しました`
        : `予定「${title}」をタスクとして追加しました`,
    }
  },
})

// ━━━ マインドマップ関連 ━━━

export const addMindmapGroup = tool({
  description: 'マインドマップにグループ（カテゴリ）ノードを追加する',
  inputSchema: z.object({
    title: z.string().describe('グループのタイトル'),
    projectId: z.string().describe('プロジェクトID'),
  }),
  execute: async ({ title, projectId }) => {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: '認証エラー' }

    const { data: maxOrder } = await supabase
      .from('tasks')
      .select('order_index')
      .eq('user_id', user.id)
      .eq('project_id', projectId)
      .is('parent_task_id', null)
      .is('deleted_at', null)
      .order('order_index', { ascending: false })
      .limit(1)
      .maybeSingle()

    const { error } = await supabase.from('tasks').insert({
      title,
      user_id: user.id,
      project_id: projectId,
      is_group: true,
      parent_task_id: null,
      status: 'todo',
      stage: 'plan',
      order_index: (maxOrder?.order_index ?? -1) + 1,
    })
    if (error) return { success: false, error: error.message }
    return { success: true, title, message: `グループ「${title}」を追加しました` }
  },
})

export const addMindmapTask = tool({
  description: 'マインドマップの特定のグループ配下にタスクを追加する',
  inputSchema: z.object({
    title: z.string().describe('タスクのタイトル'),
    parentId: z.string().describe('親ノード（グループ）のID'),
    projectId: z.string().describe('プロジェクトID'),
  }),
  execute: async ({ title, parentId, projectId }) => {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: '認証エラー' }

    // 親ノード存在確認
    const { data: parentNode } = await supabase
      .from('tasks')
      .select('id, title')
      .eq('id', parentId)
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .maybeSingle()
    if (!parentNode) return { success: false, error: '親ノードが見つかりません' }

    const { data: maxOrder } = await supabase
      .from('tasks')
      .select('order_index')
      .eq('user_id', user.id)
      .eq('parent_task_id', parentId)
      .is('deleted_at', null)
      .order('order_index', { ascending: false })
      .limit(1)
      .maybeSingle()

    const { error } = await supabase.from('tasks').insert({
      title,
      user_id: user.id,
      project_id: projectId,
      parent_task_id: parentId,
      is_group: false,
      status: 'todo',
      stage: 'plan',
      order_index: (maxOrder?.order_index ?? -1) + 1,
    })
    if (error) return { success: false, error: error.message }
    return { success: true, title, parentTitle: parentNode.title, message: `「${parentNode.title}」に「${title}」を追加しました` }
  },
})

export const deleteMindmapNode = tool({
  description: 'マインドマップからノードを削除する（ソフトデリート）',
  inputSchema: z.object({
    nodeId: z.string().describe('削除するノードのID'),
  }),
  execute: async ({ nodeId }) => {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: '認証エラー' }

    const { data: targetNode } = await supabase
      .from('tasks')
      .select('id, title, is_group')
      .eq('id', nodeId)
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .maybeSingle()
    if (!targetNode) return { success: false, error: 'ノードが見つかりません' }

    const now = new Date().toISOString()
    const { error } = await supabase
      .from('tasks')
      .update({ deleted_at: now })
      .eq('id', nodeId)
      .eq('user_id', user.id)
    if (error) return { success: false, error: error.message }

    // グループなら子も削除
    if (targetNode.is_group) {
      await supabase
        .from('tasks')
        .update({ deleted_at: now })
        .eq('parent_task_id', nodeId)
        .eq('user_id', user.id)
        .is('deleted_at', null)
    }

    return { success: true, title: targetNode.title, message: `「${targetNode.title}」を削除しました` }
  },
})

// ━━━ 予約実行（サーバー側 ai_tasks キュー） ━━━

// cronのバリデーション（5フィールド形式）— /api/ai-tasks/schedule と同じ仕様
function isValidCron(expr: string): boolean {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return false
  const rangeCheck = (part: string, min: number, max: number) => {
    if (part === '*') return true
    const n = parseInt(part, 10)
    return !isNaN(n) && n >= min && n <= max
  }
  return (
    rangeCheck(parts[0], 0, 59) &&
    rangeCheck(parts[1], 0, 23) &&
    rangeCheck(parts[2], 1, 31) &&
    rangeCheck(parts[3], 1, 12) &&
    rangeCheck(parts[4], 0, 6)
  )
}

/**
 * 予約実行ツール。Mac がオフラインのときや「毎朝/明日やって」等の時間指定タスクを
 * サーバー側 ai_tasks キューに積む。実体は /api/ai-tasks/schedule と同じロジック。
 * spaceId をクロージャで束ねるためファクトリ形式。
 */
export function createScheduleTask(spaceId: string | null) {
  return tool({
    description:
      '指定した日時または繰り返しスケジュールでAIタスクを予約実行する。「明日の朝やって」「毎週月曜に巡回して」などの時間指定や、Macがオフラインで後で実行したいときに使う。実行はサーバー側で行われる。',
    inputSchema: z.object({
      prompt: z.string().describe('予約実行するタスクの指示内容（実行時にこの内容でAIが動く）'),
      scheduledAt: z
        .string()
        .describe('実行開始日時（ISO 8601形式、例: 2026-06-01T08:00:00+09:00）。繰り返しの場合は初回基準時刻。'),
      recurrenceCron: z
        .string()
        .optional()
        .describe('繰り返し実行する場合の5フィールドcron式（例: 毎朝8時なら "0 8 * * *"）。一度きりなら省略。'),
      cwd: z
        .string()
        .optional()
        .describe('実行時の作業ディレクトリ。仕事リポ/求人更新なら /Users/kitamuranaohiro/Private/仕事 などの絶対パスを指定する。'),
      skillId: z
        .string()
        .optional()
        .describe('予約タスクのスキルID。求人更新なら job-update、仕事リポ定期実行なら staff-status-schedule など。'),
      executor: z
        .enum(['claude', 'codex', 'codex_app'])
        .optional()
        .describe('実行器。未指定なら claude。Codexで実行したい場合だけ codex/codex_app を指定する。'),
    }),
    execute: async ({ prompt, scheduledAt, recurrenceCron, cwd, skillId, executor }) => {
      const supabase = await createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return { success: false, error: '認証エラー' }

      if (!prompt || prompt.trim().length === 0) {
        return { success: false, error: 'prompt が空です' }
      }
      if (!scheduledAt || isNaN(Date.parse(scheduledAt))) {
        return { success: false, error: 'scheduledAt は有効なISO8601日時である必要があります' }
      }
      if (!recurrenceCron && new Date(scheduledAt).getTime() < Date.now() - 5 * 60_000) {
        return { success: false, error: 'scheduledAt は未来の日時にしてください' }
      }
      if (recurrenceCron && !isValidCron(recurrenceCron)) {
        return { success: false, error: 'recurrenceCron は有効な5フィールドcron式である必要があります' }
      }

      const resolvedSpace = await resolveAiTaskSpaceId(supabase, user.id, { space_id: spaceId || null })
      if (resolvedSpace.error) return { success: false, error: resolvedSpace.error }

      const { data, error } = await supabase
        .from('ai_tasks')
        .insert({
          user_id: user.id,
          space_id: resolvedSpace.spaceId,
          prompt: prompt.trim(),
          approval_type: 'auto',
          status: 'pending',
          scheduled_at: scheduledAt,
          recurrence_cron: recurrenceCron || null,
          cwd: cwd || null,
          skill_id: skillId || null,
          executor: executor || 'claude',
          run_visibility: normalizeVisibility(undefined, resolvedSpace.spaceId ? 'space' : 'private'),
        })
        .select('id')
        .single()

      if (error) return { success: false, error: error.message }
      return {
        success: true,
        taskId: data.id,
        scheduledAt,
        recurrence: recurrenceCron || null,
        message: recurrenceCron
          ? `繰り返し予約（${recurrenceCron}）を登録しました`
          : `${scheduledAt} に予約を登録しました`,
      }
    },
  })
}

// ━━━ ツール自動実行の有効化判定 ━━━

const TOOL_ENABLED_SKILLS = new Set<string>()

export function isToolEnabledSkill(skillId: string): boolean {
  return TOOL_ENABLED_SKILLS.has(skillId)
}

// ━━━ スキルごとのツールセット ━━━

export function getToolsForSkill(skillId: string) {
  switch (skillId) {
    case 'scheduling':
      return { addCalendarEvent }
    case 'task':
      return { addTask, addMindmapGroup, addMindmapTask }
    case 'project-consultation':
      return { addTask, addCalendarEvent, addMindmapGroup, addMindmapTask, deleteMindmapNode }
    case 'brainstorm':
      return { addTask, addMindmapGroup, addMindmapTask }
    case 'counseling':
      return {}  // カウンセリングはツール不要（対話のみ）
    default:
      return { addTask, addCalendarEvent, addMindmapGroup, addMindmapTask }
  }
}
