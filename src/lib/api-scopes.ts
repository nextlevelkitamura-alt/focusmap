export interface ApiScope {
  id: string
  label: string
  description: string
  category: string
}

export const API_SCOPES: ApiScope[] = [
  { id: 'tasks:read', label: 'タスク読み取り', description: 'タスクの一覧・詳細を取得', category: 'タスク' },
  { id: 'tasks:write', label: 'タスク書き込み', description: 'タスクの作成・更新・削除', category: 'タスク' },
  { id: 'projects:read', label: 'プロジェクト読み取り', description: 'プロジェクトの一覧・詳細を取得', category: 'プロジェクト' },
  { id: 'projects:write', label: 'プロジェクト書き込み', description: 'プロジェクトの作成・更新', category: 'プロジェクト' },
  { id: 'spaces:read', label: 'スペース読み取り', description: 'スペースの一覧を取得', category: 'スペース' },
  { id: 'habits:read', label: '習慣読み取り', description: '習慣タスクの一覧を取得', category: '習慣' },
  { id: 'habits:write', label: '習慣書き込み', description: '習慣の作成・更新・完了記録', category: '習慣' },
  { id: 'ai:scheduling', label: 'AIスケジューリング', description: 'AI予定調整機能を使用', category: 'AI' },
  { id: 'ai:chat', label: 'AIチャット', description: 'AIチャット機能を使用', category: 'AI' },
  { id: 'calendar:read', label: 'カレンダー読み取り', description: 'カレンダーイベントを取得', category: 'カレンダー' },
]

export const DEFAULT_SCOPES = API_SCOPES.map(s => s.id)
