export interface ApiKey {
  id: string
  key_prefix: string
  name: string
  scopes: string[]
  is_active: boolean
  last_used_at: string | null
  expires_at: string | null
  created_at: string
}

export interface CreateApiKeyRequest {
  name: string
  scopes: string[]
}

export interface CreateApiKeyResponse extends ApiKey {
  raw_key: string
}
