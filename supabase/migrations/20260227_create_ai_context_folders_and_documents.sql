-- AI Context Folder Management: フォルダ/ファイル型コンテキスト管理
-- 既存の ai_user_context / ai_project_context は残しつつ、新しい汎用構造を追加

-- ============================================
-- 1. ai_context_folders テーブル
-- ============================================
CREATE TABLE IF NOT EXISTS ai_context_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES ai_context_folders(id) ON DELETE CASCADE,

  folder_type TEXT NOT NULL DEFAULT 'custom'
    CHECK (folder_type IN ('root_personal', 'root_projects', 'project', 'custom')),

  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,

  title TEXT NOT NULL,
  icon TEXT,
  order_index INTEGER NOT NULL DEFAULT 0,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_context_folders_user_id
  ON ai_context_folders(user_id);
CREATE INDEX IF NOT EXISTS idx_context_folders_parent_id
  ON ai_context_folders(parent_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_context_folders_user_project
  ON ai_context_folders(user_id, project_id)
  WHERE project_id IS NOT NULL;

-- ============================================
-- 2. ai_context_documents テーブル
-- ============================================
CREATE TABLE IF NOT EXISTS ai_context_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  folder_id UUID NOT NULL REFERENCES ai_context_folders(id) ON DELETE CASCADE,

  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',

  document_type TEXT NOT NULL DEFAULT 'note'
    CHECK (document_type IN (
      'personality', 'purpose', 'situation',
      'project_purpose', 'project_status', 'project_insights',
      'note'
    )),

  max_length INTEGER NOT NULL DEFAULT 500,

  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'ai_interview', 'ai_auto')),

  order_index INTEGER NOT NULL DEFAULT 0,
  is_pinned BOOLEAN NOT NULL DEFAULT FALSE,

  content_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  freshness_reviewed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_context_documents_user_id
  ON ai_context_documents(user_id);
CREATE INDEX IF NOT EXISTS idx_context_documents_folder_id
  ON ai_context_documents(folder_id);
CREATE INDEX IF NOT EXISTS idx_context_documents_freshness
  ON ai_context_documents(content_updated_at);

-- ============================================
-- 3. RLS ポリシー
-- ============================================
ALTER TABLE ai_context_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_context_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own context folders"
  ON ai_context_folders FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can manage own context documents"
  ON ai_context_documents FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
