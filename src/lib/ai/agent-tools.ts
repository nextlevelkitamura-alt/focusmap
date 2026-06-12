/**
 * 統合エージェント用 ToolSet の組み立て
 *
 * サーバー直実行ツール (タスク追加/カレンダー/マインドマップ) と
 * Mac リモートツール (ターミナル/ブラウザ/ファイル) を1つの ToolSet にまとめる。
 *
 * runner がオフラインでもリモートツールは登録され、呼ばれたら「オフライン」を返す
 * (モデルがユーザーに状況を説明できるようにするため)。
 */
import type { ToolSet } from 'ai'
import { createClient } from '@/utils/supabase/server'
import {
  addTask,
  addCalendarEvent,
  addMindmapGroup,
  addMindmapTask,
  checkCalendarAvailability,
  createScheduleTask,
  deleteMindmapNode,
  getProjectContext,
  listCalendarEvents,
  listProjectTasks,
  listProjects,
  saveProjectContext,
  updateCalendarEvent,
} from './tools'
import { createRemoteTools, resolveOnlineRunner, type OnlineRunner } from './remote-tools'

export interface BuiltAgentTools {
  tools: ToolSet
  runner: OnlineRunner | null
}

/**
 * 認証済みユーザーの ToolSet を組み立てる。
 * 同時にオンライン runner を解決して返す (UIのステータス表示やシステムプロンプト分岐に使う)。
 */
export async function buildAgentTools(userId: string, spaceId: string | null): Promise<BuiltAgentTools> {
  const supabase = await createClient()
  const runner = await resolveOnlineRunner(supabase, userId)
  const remote = createRemoteTools({ userId, spaceId, runner })

  const tools: ToolSet = {
    listProjects,
    getProjectContext,
    saveProjectContext,
    listProjectTasks,
    addTask,
    listCalendarEvents,
    checkCalendarAvailability,
    addCalendarEvent,
    updateCalendarEvent,
    addMindmapGroup,
    addMindmapTask,
    deleteMindmapNode,
    scheduleTask: createScheduleTask(spaceId),
    ...remote,
  }

  return { tools, runner }
}
