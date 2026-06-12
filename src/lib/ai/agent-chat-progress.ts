import type { UIMessage } from 'ai'

export type AgentChatProgressState = 'thinking' | 'running' | 'done' | 'failed'

export interface AgentChatProgressMetadata {
  focusmapAgentProgress: true
  version: 1
  state: AgentChatProgressState
  label: string
  toolName?: string
  stepNumber?: number
  startedAt: string
  completedAt?: string
  durationMs?: number
}

export interface CreateAgentProgressMessageInput {
  id: string
  state: AgentChatProgressState
  label: string
  startedAt: string
  toolName?: string
  stepNumber?: number
  completedAt?: string
  durationMs?: number
}

const TOOL_LABELS: Record<string, string> = {
  runTerminal: 'ターミナル実行',
  listFiles: 'フォルダ一覧',
  runOpenCode: 'OpenCode実行',
  browserNavigate: 'ブラウザで開く',
  browserClick: 'クリック',
  browserFill: '入力',
  browserScreenshot: 'スクリーンショット',
  readFile: 'ファイル読み取り',
  writeFile: 'ファイル書き込み',
  webResearch: 'Web調査',
  listProjects: 'プロジェクト検索',
  getProjectContext: 'プロジェクト確認',
  saveProjectContext: 'プロジェクト記録',
  updateProject: 'プロジェクト更新',
  listProjectTasks: 'DBタスク確認',
  listNotesForOrganization: 'ノート整理確認',
  getNoteOrganizationDetail: 'ノート詳細確認',
  proposeMindmapOrganization: 'マップ整理提案',
  getMindmapOverview: 'マップ全体確認',
  getMindmapNodeDetail: 'ノード詳細確認',
  updateMindmapNode: 'ノード更新',
  moveMindmapNode: 'ノード移動',
  updateMindmapMemoLink: 'メモ紐づき変更',
  addTask: 'タスク追加',
  listCalendarEvents: '予定確認',
  findCalendarOpenSlots: '空き枠検索',
  checkCalendarAvailability: '空き時間確認',
  addCalendarEvent: '予定登録',
  updateCalendarEvent: '予定更新',
  addMindmapGroup: 'グループ追加',
  addMindmapTask: 'タスク追加',
  deleteMindmapNode: 'ノード削除',
  scheduleTask: '予約実行',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeLabel(label: string) {
  const trimmed = label.trim()
  return trimmed.length > 0 ? trimmed.slice(0, 80) : '処理'
}

export function agentToolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name
}

export function agentProgressText(metadata: AgentChatProgressMetadata): string {
  if (metadata.state === 'thinking') return '考えています'
  if (metadata.state === 'running') return `${metadata.label}中`
  if (metadata.state === 'failed') return `${metadata.label}失敗`
  return `${metadata.label}完了`
}

export function createAgentProgressMessage(input: CreateAgentProgressMessageInput): UIMessage<AgentChatProgressMetadata> {
  const metadata: AgentChatProgressMetadata = {
    focusmapAgentProgress: true,
    version: 1,
    state: input.state,
    label: normalizeLabel(input.label),
    startedAt: input.startedAt,
    ...(input.toolName ? { toolName: input.toolName } : {}),
    ...(typeof input.stepNumber === 'number' ? { stepNumber: input.stepNumber } : {}),
    ...(input.completedAt ? { completedAt: input.completedAt } : {}),
    ...(typeof input.durationMs === 'number' ? { durationMs: Math.max(0, Math.round(input.durationMs)) } : {}),
  }

  return {
    id: input.id,
    role: 'assistant',
    metadata,
    parts: [{ type: 'text', text: agentProgressText(metadata) }],
  }
}

export function getAgentProgressMetadata(message: UIMessage): AgentChatProgressMetadata | null {
  const metadata = message.metadata
  if (!isRecord(metadata) || metadata.focusmapAgentProgress !== true) return null
  const state = metadata.state
  if (state !== 'thinking' && state !== 'running' && state !== 'done' && state !== 'failed') return null
  const label = typeof metadata.label === 'string' ? normalizeLabel(metadata.label) : '処理'
  const startedAt = typeof metadata.startedAt === 'string' ? metadata.startedAt : ''
  return {
    focusmapAgentProgress: true,
    version: 1,
    state,
    label,
    startedAt,
    ...(typeof metadata.toolName === 'string' ? { toolName: metadata.toolName } : {}),
    ...(typeof metadata.stepNumber === 'number' ? { stepNumber: metadata.stepNumber } : {}),
    ...(typeof metadata.completedAt === 'string' ? { completedAt: metadata.completedAt } : {}),
    ...(typeof metadata.durationMs === 'number' ? { durationMs: metadata.durationMs } : {}),
  }
}

export function isAgentProgressMessage(message: UIMessage): boolean {
  return getAgentProgressMetadata(message) !== null
}

export function withoutAgentProgressMessages(messages: UIMessage[]): UIMessage[] {
  return messages.filter(message => !isAgentProgressMessage(message))
}

export function upsertAgentProgressMessage(messages: UIMessage[], progressMessage: UIMessage): UIMessage[] {
  const index = messages.findIndex(message => message.id === progressMessage.id)
  if (index === -1) return [...messages, progressMessage]
  return [
    ...messages.slice(0, index),
    progressMessage,
    ...messages.slice(index + 1),
  ]
}
