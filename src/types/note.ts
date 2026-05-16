// AIメモ機能の型定義

export type NoteInputType = 'text' | 'voice'
export type NoteStatus = 'pending' | 'processed' | 'archived'

export interface NoteAiAnalysis {
  classification: 'calendar' | 'map'
  confidence: number
  suggested_project_id: string | null
  suggested_project_name: string | null
  suggested_node_id: string | null
  suggested_node_title: string | null
  reasoning: string
  event_title?: string | null  // カレンダー分類時の予定名（日時部分を除いた本質的なタイトル）
  extracted_entities: {
    dates: string[]
    times: string[]
    keywords: string[]
  }
}

export interface Note {
  id: string
  user_id: string
  project_id: string | null
  task_id: string | null
  content: string
  raw_input: string | null
  input_type: NoteInputType
  status: NoteStatus
  ai_analysis: NoteAiAnalysis | null
  image_urls: string[] | null
  created_at: string
  updated_at: string
}

export interface NoteInsert {
  id?: string
  user_id: string
  project_id?: string | null
  task_id?: string | null
  content: string
  raw_input?: string | null
  input_type?: NoteInputType
  status?: NoteStatus
  ai_analysis?: NoteAiAnalysis | null
  image_urls?: string[] | null
  created_at?: string
  updated_at?: string
}

export interface NoteUpdate {
  id?: string
  user_id?: string
  project_id?: string | null
  task_id?: string | null
  content?: string
  raw_input?: string | null
  input_type?: NoteInputType
  status?: NoteStatus
  ai_analysis?: NoteAiAnalysis | null
  image_urls?: string[] | null
  created_at?: string
  updated_at?: string
}
