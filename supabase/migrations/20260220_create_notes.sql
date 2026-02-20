-- AIメモ機能: notes テーブル作成

-- notes テーブル
CREATE TABLE IF NOT EXISTS notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID,  -- projects テーブルは未作成のため FK なし（将来追加）
  task_id UUID,  -- tasks テーブルへの FK は後から追加
  content TEXT NOT NULL,
  raw_input TEXT,
  input_type TEXT NOT NULL DEFAULT 'text' CHECK (input_type IN ('text', 'voice')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processed', 'archived')),
  ai_analysis JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_notes_user_id ON notes(user_id);
CREATE INDEX IF NOT EXISTS idx_notes_project_id ON notes(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notes_task_id ON notes(task_id) WHERE task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notes_status ON notes(status);
CREATE INDEX IF NOT EXISTS idx_notes_created_at ON notes(created_at DESC);

-- RLS (Row Level Security)
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;

-- ポリシー: ユーザーは自分のメモのみアクセス可能
CREATE POLICY "Users can view own notes" ON notes
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own notes" ON notes
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own notes" ON notes
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own notes" ON notes
  FOR DELETE USING (auth.uid() = user_id);

-- updated_at 自動更新トリガー
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_notes_updated_at
  BEFORE UPDATE ON notes
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
