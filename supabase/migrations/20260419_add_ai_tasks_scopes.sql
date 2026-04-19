-- Add ai:tasks:read and ai:tasks:write scopes to api_keys
-- 既存の API キーにも自動的に新しい scope を追加する
-- これにより、人生管理の /schedule スキルが service_role_key ではなく
-- API キー経由で ai_tasks を操作できるようになる

-- 1. デフォルト scope の更新（今後作られる新規キー用）
ALTER TABLE api_keys
  ALTER COLUMN scopes SET DEFAULT ARRAY[
    'tasks:read',
    'tasks:write',
    'projects:read',
    'projects:write',
    'spaces:read',
    'habits:read',
    'ai:scheduling',
    'ai:chat',
    'ai:tasks:read',
    'ai:tasks:write',
    'calendar:read'
  ];

-- 2. 既存キーへの backfill（array_append で重複なく追加）
UPDATE api_keys
SET scopes = array_append(scopes, 'ai:tasks:read')
WHERE NOT ('ai:tasks:read' = ANY(scopes));

UPDATE api_keys
SET scopes = array_append(scopes, 'ai:tasks:write')
WHERE NOT ('ai:tasks:write' = ANY(scopes));
