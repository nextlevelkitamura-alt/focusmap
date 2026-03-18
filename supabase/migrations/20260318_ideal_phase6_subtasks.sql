-- Phase 6C: サブタスク（アイテムの親子関係）
-- ideal_items に parent_item_id を追加して1階層のネストをサポート

ALTER TABLE ideal_items
  ADD COLUMN parent_item_id uuid REFERENCES ideal_items(id) ON DELETE CASCADE;

-- 親の子アイテム一覧を高速に取得するためのインデックス
CREATE INDEX idx_ideal_items_parent ON ideal_items(parent_item_id)
  WHERE parent_item_id IS NOT NULL;
