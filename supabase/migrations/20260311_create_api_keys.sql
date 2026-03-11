-- API Keys table for REST API authentication
CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    key_hash TEXT NOT NULL,
    key_prefix TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT 'Default',
    scopes TEXT[] NOT NULL DEFAULT ARRAY['tasks:read', 'tasks:write', 'projects:read', 'projects:write', 'spaces:read', 'habits:read', 'ai:scheduling', 'ai:chat', 'calendar:read'],
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast hash lookup during authentication
CREATE UNIQUE INDEX idx_api_keys_key_hash ON api_keys (key_hash);

-- Index for user queries
CREATE INDEX idx_api_keys_user_id ON api_keys (user_id);

-- RLS
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

-- Users can only see their own keys
CREATE POLICY "Users can view own api_keys"
    ON api_keys FOR SELECT
    USING (auth.uid() = user_id);

-- Users can insert their own keys
CREATE POLICY "Users can insert own api_keys"
    ON api_keys FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Users can update their own keys (e.g., deactivate)
CREATE POLICY "Users can update own api_keys"
    ON api_keys FOR UPDATE
    USING (auth.uid() = user_id);

-- Users can delete their own keys
CREATE POLICY "Users can delete own api_keys"
    ON api_keys FOR DELETE
    USING (auth.uid() = user_id);
