-- Add note read/write scopes for SNS素材連携.

ALTER TABLE api_keys
  ALTER COLUMN scopes SET DEFAULT ARRAY[
    'tasks:read',
    'tasks:write',
    'projects:read',
    'projects:write',
    'notes:read',
    'notes:write',
    'spaces:read',
    'habits:read',
    'ai:scheduling',
    'ai:chat',
    'ai:tasks:read',
    'ai:tasks:write',
    'calendar:read'
  ];

UPDATE api_keys
SET scopes = array_append(scopes, 'notes:read')
WHERE NOT ('notes:read' = ANY(scopes));

UPDATE api_keys
SET scopes = array_append(scopes, 'notes:write')
WHERE NOT ('notes:write' = ANY(scopes));
