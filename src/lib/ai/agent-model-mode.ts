export const AGENT_MODEL_MODES = ['speed', 'think'] as const

export type AgentModelMode = typeof AGENT_MODEL_MODES[number]

export const DEFAULT_AGENT_MODEL_MODE: AgentModelMode = 'think'

export const AGENT_MODEL_MODE_LABELS: Record<AgentModelMode, string> = {
  speed: 'スピード',
  think: '考える',
}

export const AGENT_MODEL_MODE_DESCRIPTIONS: Record<AgentModelMode, string> = {
  speed: '軽い整理や短い確認を速く返す',
  think: 'マップ整理や論理検討を深く進める',
}

export function normalizeAgentModelMode(value: unknown): AgentModelMode {
  return value === 'speed' ? 'speed' : DEFAULT_AGENT_MODEL_MODE
}
