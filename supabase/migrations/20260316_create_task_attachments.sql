-- task_attachments: マインドマップのノードにファイルを紐づける機能
-- Supabase Storage バケット: task-attachments

-- テーブル作成
CREATE TABLE IF NOT EXISTS task_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  task_id uuid REFERENCES tasks(id) ON DELETE CASCADE NOT NULL,
  file_name text NOT NULL,
  file_url text NOT NULL,        -- Supabase Storage の署名付き or 公開URL
  storage_path text NOT NULL,    -- バケット内のパス（削除用）
  file_type text NOT NULL,       -- MIME type: 'image/png', 'application/pdf' etc.
  file_size integer NOT NULL,    -- バイト数
  created_at timestamptz DEFAULT now() NOT NULL
);

-- インデックス
CREATE INDEX IF NOT EXISTS task_attachments_task_id_idx ON task_attachments(task_id);
CREATE INDEX IF NOT EXISTS task_attachments_user_id_idx ON task_attachments(user_id);

-- RLS 有効化
ALTER TABLE task_attachments ENABLE ROW LEVEL SECURITY;

-- RLS ポリシー: ユーザー自身のデータのみアクセス可能
CREATE POLICY "Users can view own task attachments"
  ON task_attachments FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own task attachments"
  ON task_attachments FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own task attachments"
  ON task_attachments FOR DELETE
  USING (auth.uid() = user_id);

-- Supabase Storage バケット作成（SQLからは設定できないため、コメントで手順を記載）
-- ダッシュボードまたは以下のコマンドで実行:
-- supabase storage create task-attachments --public=false
-- または Storage > New bucket > "task-attachments", Public: false

-- ストレージのRLSポリシー（Supabase Dashboard > Storage > Policies で設定）:
-- バケット: task-attachments
-- SELECT: bucket_id = 'task-attachments' AND auth.uid()::text = (storage.foldername(name))[1]
-- INSERT: bucket_id = 'task-attachments' AND auth.uid()::text = (storage.foldername(name))[1]
-- DELETE: bucket_id = 'task-attachments' AND auth.uid()::text = (storage.foldername(name))[1]
