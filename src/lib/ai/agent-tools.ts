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
  bulkAddMemos,
  checkCalendarAvailability,
  createScheduleTask,
  deleteCalendarEvent,
  deleteMindmapNode,
  findCalendarOpenSlots,
  getMindmapNodeDetail,
  getMindmapOverview,
  getNoteOrganizationDetail,
  getProjectContext,
  listCalendarEvents,
  listNotesForOrganization,
  listProjectTasks,
  listProjects,
  moveMindmapNode,
  proposeMindmapOrganization,
  saveProjectContext,
  saveMindmapDraft,
  updateMindmapMemoLink,
  updateMindmapNode,
  updateCalendarEvent,
  updateProject,
} from './tools'
import { createRemoteTools, resolveOnlineRunner, type OnlineRunner } from './remote-tools'

export interface BuiltAgentTools {
  tools: ToolSet
  runner: OnlineRunner | null
}

export interface BuildAgentToolsOptions {
  chatSessionId?: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function withInjectedToolInput(toolDef: ToolSet[string], extraInput: Record<string, unknown> | null): ToolSet[string] {
  const execute = toolDef.execute
  if (!extraInput || !execute) return toolDef

  return {
    ...toolDef,
    execute: ((input: unknown, options: unknown) => {
      const nextInput = isRecord(input) ? { ...input, ...extraInput } : input
      return execute(nextInput as never, options as never)
    }) as ToolSet[string]['execute'],
  }
}

/**
 * 認証済みユーザーの ToolSet を組み立てる。
 * 同時にオンライン runner を解決して返す (UIのステータス表示やシステムプロンプト分岐に使う)。
 */
export async function buildAgentTools(
  userId: string,
  spaceId: string | null,
  options: BuildAgentToolsOptions = {},
): Promise<BuiltAgentTools> {
  const supabase = await createClient()
  const runner = await resolveOnlineRunner(supabase, userId)
  const remote = createRemoteTools({ userId, spaceId, runner })
  const saveMindmapDraftTool = withInjectedToolInput(
    saveMindmapDraft,
    options.chatSessionId ? { chatSessionId: options.chatSessionId } : null,
  )

  const tools: ToolSet = {
    listProjects,
    getProjectContext,
    saveProjectContext,
    updateProject,
    listProjectTasks,
    listNotesForOrganization,
    getNoteOrganizationDetail,
    proposeMindmapOrganization,
    saveMindmapDraft: saveMindmapDraftTool,
    getMindmapOverview,
    getMindmapNodeDetail,
    updateMindmapNode,
    moveMindmapNode,
    updateMindmapMemoLink,
    addTask,
    bulkAddMemos,
    listCalendarEvents,
    findCalendarOpenSlots,
    checkCalendarAvailability,
    addCalendarEvent,
    updateCalendarEvent,
    deleteCalendarEvent,
    addMindmapGroup,
    addMindmapTask,
    deleteMindmapNode,
    scheduleTask: createScheduleTask(spaceId),
    ...remote,
  }

  return { tools, runner }
}
