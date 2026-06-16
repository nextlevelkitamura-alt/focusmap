export interface ApiScope {
  id: string
  label: string
  description: string
  category: string
  risk?: 'low' | 'medium' | 'high'
}

export interface ApiScopePreset {
  id: string
  label: string
  description: string
  scopes: string[]
}

const READ_ONLY_SCOPES = ['spaces:read', 'projects:read', 'project:context:read', 'memos:read', 'mindmap:read', 'tasks:read', 'calendar:read']
const AI_ORGANIZE_SCOPES = ['spaces:read', 'projects:read', 'project:context:read', 'memos:read', 'memos:write', 'mindmap:read', 'mindmap:drafts', 'tasks:read', 'calendar:read']
const AI_EXECUTE_SCOPES = ['spaces:read', 'projects:read', 'projects:write', 'project:context:read', 'project:context:write', 'memos:read', 'memos:write', 'mindmap:read', 'mindmap:drafts', 'mindmap:write', 'tasks:read', 'tasks:write', 'calendar:read', 'calendar:write']

export const API_SCOPES: ApiScope[] = [
  { id: 'spaces:read', label: 'スペース読み取り', description: 'スペース一覧を取得', category: 'スペース', risk: 'low' },
  { id: 'spaces:write', label: 'スペース書き込み', description: 'スペース共有・設定を更新', category: 'スペース', risk: 'medium' },
  { id: 'projects:read', label: 'プロジェクト読み取り', description: 'プロジェクト一覧・詳細を取得', category: 'プロジェクト', risk: 'low' },
  { id: 'projects:write', label: 'プロジェクト書き込み', description: 'プロジェクト本体を作成・更新', category: 'プロジェクト', risk: 'medium' },
  { id: 'project:context:read', label: 'プロジェクト文脈読み取り', description: '概要・背景・進捗メモを取得', category: 'プロジェクト', risk: 'low' },
  { id: 'project:context:write', label: 'プロジェクト文脈書き込み', description: '概要・背景・進捗メモを更新', category: 'プロジェクト', risk: 'medium' },
  { id: 'memos:read', label: 'メモ読み取り', description: '現行メモ画面のメモ・構造化メモを取得', category: 'メモ', risk: 'low' },
  { id: 'memos:write', label: 'メモ書き込み', description: '現行メモ画面へメモを追加・更新', category: 'メモ', risk: 'medium' },
  { id: 'notes:read', label: '旧ノート読み取り', description: '旧 notes API 互換の読み取り', category: '互換', risk: 'low' },
  { id: 'notes:write', label: '旧ノート書き込み', description: '旧 notes API 互換の書き込み', category: '互換', risk: 'medium' },
  { id: 'mindmap:read', label: 'マップ読み取り', description: 'マインドマップ概要・AI案を取得', category: 'マインドマップ', risk: 'low' },
  { id: 'mindmap:drafts', label: 'AI案作成', description: '本番反映前のマインドマップAI案を保存・調整', category: 'マインドマップ', risk: 'medium' },
  { id: 'mindmap:write', label: 'マップ書き込み', description: 'AI案の確定、Undo/Redo、単発ノード更新', category: 'マインドマップ', risk: 'high' },
  { id: 'tasks:read', label: 'タスク読み取り', description: 'タスクの一覧・詳細を取得', category: 'タスク', risk: 'low' },
  { id: 'tasks:write', label: 'タスク書き込み', description: 'タスクの作成・更新・削除', category: 'タスク', risk: 'high' },
  { id: 'calendar:read', label: 'カレンダー読み取り', description: 'カレンダーイベントを取得', category: 'カレンダー', risk: 'low' },
  { id: 'calendar:write', label: 'カレンダー書き込み', description: '予定の作成・移動・削除', category: 'カレンダー', risk: 'high' },
  { id: 'habits:read', label: '習慣読み取り', description: '習慣タスクの一覧を取得', category: '習慣', risk: 'low' },
  { id: 'habits:write', label: '習慣書き込み', description: '習慣の作成・更新・完了記録', category: '習慣', risk: 'medium' },
  { id: 'ai:tasks:read', label: 'AIタスク読み取り', description: 'AI実行タスクの一覧・詳細を取得', category: 'AI', risk: 'low' },
  { id: 'ai:tasks:write', label: 'AIタスク書き込み', description: 'AI実行タスクの作成・更新・削除', category: 'AI', risk: 'medium' },
  { id: 'ai:packages:read', label: 'AIパッケージ読み取り', description: '共有AI実行パッケージを取得', category: 'AI', risk: 'low' },
  { id: 'ai:packages:write', label: 'AIパッケージ書き込み', description: '共有AI実行パッケージを作成・更新', category: 'AI', risk: 'medium' },
  { id: 'ai:runners', label: 'AI実行PC', description: 'AI実行PCのheartbeat・claimを行う', category: 'AI', risk: 'high' },
  { id: 'ai:scheduling', label: 'AIスケジューリング', description: 'AI予定調整機能を使用', category: 'AI', risk: 'medium' },
  { id: 'ai:chat', label: 'AIチャット', description: 'AIチャット機能を使用', category: 'AI', risk: 'medium' },
  { id: 'ai:actions', label: 'AI一括操作', description: 'v1 API操作を最大10件まとめて実行', category: 'AI', risk: 'high' },
]

export const API_SCOPE_PRESETS: ApiScopePreset[] = [
  {
    id: 'read_only',
    label: '読み取りのみ',
    description: 'プロジェクト、メモ、マップ、カレンダーを読むだけ',
    scopes: READ_ONLY_SCOPES,
  },
  {
    id: 'ai_organize',
    label: 'AI整理用',
    description: '外部AIが情報を読み、マップ上にAI案を保存する',
    scopes: AI_ORGANIZE_SCOPES,
  },
  {
    id: 'ai_execute',
    label: 'AI実行用',
    description: 'AI案の確定、文脈更新、メモ/予定/タスク更新まで許可',
    scopes: AI_EXECUTE_SCOPES,
  },
  {
    id: 'full_operation',
    label: 'フル操作',
    description: '予定書き込みや一括操作も含める',
    scopes: API_SCOPES.map(scope => scope.id),
  },
]

export const DEFAULT_SCOPES = AI_ORGANIZE_SCOPES
export const API_SCOPE_IDS = new Set(API_SCOPES.map(scope => scope.id))

export function normalizeApiScopes(scopes: unknown): string[] {
  if (!Array.isArray(scopes)) return DEFAULT_SCOPES
  const normalized = scopes
    .filter((scope): scope is string => typeof scope === 'string' && API_SCOPE_IDS.has(scope))
  return Array.from(new Set(normalized.length > 0 ? normalized : DEFAULT_SCOPES))
}
