-- ユーザーコンテキストを3カテゴリに拡張
-- life_personality: 生活スタイル・性格
-- life_purpose: 人生の目的・目標・価値観
-- current_situation: 最近の状況・悩み・仕事

ALTER TABLE ai_user_context
  ADD COLUMN IF NOT EXISTS life_personality TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS life_purpose TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS current_situation TEXT NOT NULL DEFAULT '';

-- 既存の persona の内容を life_personality に移行
UPDATE ai_user_context
  SET life_personality = persona
  WHERE persona != '' AND life_personality = '';
