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
  { id: 'notes:read', label: 'メモ読み取り', description: 'メモの一覧・検索・プロジェクト別取得', category: 'メモ' },
  { id: 'notes:write', label: 'メモ書き込み', description: 'メモの作成・更新・利用済み化', category: 'メモ' },
  { id: 'spaces:read', label: 'スペース読み取り', description: 'スペースの一覧を取得', category: 'スペース' },
  { id: 'spaces:write', label: 'スペース書き込み', description: 'スペース共有・設定を更新', category: 'スペース' },
  { id: 'habits:read', label: '習慣読み取り', description: '習慣タスクの一覧を取得', category: '習慣' },
  { id: 'habits:write', label: '習慣書き込み', description: '習慣の作成・更新・完了記録', category: '習慣' },
  { id: 'ai:tasks:read', label: 'AIタスク読み取り', description: 'AI実行タスクの一覧・詳細を取得', category: 'AI' },
  { id: 'ai:tasks:write', label: 'AIタスク書き込み', description: 'AI実行タスクの作成・更新・削除', category: 'AI' },
  { id: 'ai:packages:read', label: 'AIパッケージ読み取り', description: '共有AI実行パッケージを取得', category: 'AI' },
  { id: 'ai:packages:write', label: 'AIパッケージ書き込み', description: '共有AI実行パッケージを作成・更新', category: 'AI' },
  { id: 'ai:runners', label: 'AI実行PC', description: 'AI実行PCのheartbeat・claimを行う', category: 'AI' },
  { id: 'ai:scheduling', label: 'AIスケジューリング', description: 'AI予定調整機能を使用', category: 'AI' },
  { id: 'ai:chat', label: 'AIチャット', description: 'AIチャット機能を使用', category: 'AI' },
  { id: 'calendar:read', label: 'カレンダー読み取り', description: 'カレンダーイベントを取得', category: 'カレンダー' },
]

export const DEFAULT_SCOPES = API_SCOPES.map(s => s.id)
