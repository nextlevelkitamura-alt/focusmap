/**
 * AI ツール定義 — Vercel AI SDK の tool() で定義
 *
 * Phase 1: ツール定義のみ作成（まだ generateText に渡していない）
 * Phase 2: generateText の tools に渡してエージェントループを有効化
 */
import { tool } from 'ai'
import { z } from 'zod/v3'
import { createClient } from '@/utils/supabase/server'

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

// ━━━ ツール自動実行の有効化判定 ━━━

const TOOL_ENABLED_SKILLS = new Set(['task', 'brainstorm', 'project-consultation'])

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
