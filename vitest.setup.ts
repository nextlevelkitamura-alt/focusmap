import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'

// @supabase/ssr の重い依存ツリー（@supabase/supabase-js 含む）を
// ワーカープロセスにロードさせないためにモック化
vi.mock('@supabase/ssr', () => ({
  createBrowserClient: vi.fn(() => ({})),
  createServerClient: vi.fn(() => ({})),
}))
