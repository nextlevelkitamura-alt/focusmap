export interface DocumentData {
  id: string
  title: string
  content: string
  document_type: string
  is_pinned: boolean
  content_updated_at: string
  freshness_reviewed_at: string | null
  freshness_score: number
  freshness_status: string
  days_since_update: number
  max_length: number
  order_index: number
}

export interface FolderNode {
  id: string
  title: string
  icon: string | null
  folder_type: string
  is_system: boolean
  order_index: number
  documents: DocumentData[]
  children: FolderNode[]
}
