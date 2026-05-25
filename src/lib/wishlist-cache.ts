import type { IdealGoalWithItems } from "@/types/database"

export type WishlistItem = IdealGoalWithItems

type FetchWishlistItemsOptions = {
  spaceId?: string | null
  projectId?: string | null
  force?: boolean
}

type CacheEntry = {
  items: WishlistItem[]
  expiresAt: number
}

const CACHE_TTL_MS = 3 * 60 * 1000
const SESSION_PREFIX = "focusmap:wishlist-items:"
const memoryCache = new Map<string, CacheEntry>()
const inflightRequests = new Map<string, Promise<WishlistItem[]>>()

function getCacheKey({ spaceId = null, projectId = null }: FetchWishlistItemsOptions) {
  return `space:${spaceId ?? "all"}|project:${projectId ?? "all"}`
}

function getSessionKey(cacheKey: string) {
  return `${SESSION_PREFIX}${cacheKey}`
}

function readSessionCache(cacheKey: string): CacheEntry | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.sessionStorage.getItem(getSessionKey(cacheKey))
    if (!raw) return null
    const parsed = JSON.parse(raw) as CacheEntry
    if (!Array.isArray(parsed.items) || typeof parsed.expiresAt !== "number") return null
    if (parsed.expiresAt <= Date.now()) {
      window.sessionStorage.removeItem(getSessionKey(cacheKey))
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function writeCache(cacheKey: string, items: WishlistItem[]) {
  const entry = {
    items,
    expiresAt: Date.now() + CACHE_TTL_MS,
  }
  memoryCache.set(cacheKey, entry)
  if (typeof window === "undefined") return
  try {
    window.sessionStorage.setItem(getSessionKey(cacheKey), JSON.stringify(entry))
  } catch {
    // Keep the memory cache even if sessionStorage is unavailable or full.
  }
}

function getCachedItems(cacheKey: string) {
  const memoryEntry = memoryCache.get(cacheKey)
  if (memoryEntry) {
    if (memoryEntry.expiresAt > Date.now()) return memoryEntry.items
    memoryCache.delete(cacheKey)
  }

  const sessionEntry = readSessionCache(cacheKey)
  if (!sessionEntry) return null
  memoryCache.set(cacheKey, sessionEntry)
  return sessionEntry.items
}

export function invalidateWishlistItemsCache() {
  memoryCache.clear()
  inflightRequests.clear()
  if (typeof window === "undefined") return
  try {
    for (let i = window.sessionStorage.length - 1; i >= 0; i -= 1) {
      const key = window.sessionStorage.key(i)
      if (key?.startsWith(SESSION_PREFIX)) window.sessionStorage.removeItem(key)
    }
  } catch {
    // Ignore storage access errors.
  }
}

export async function fetchWishlistItems(options: FetchWishlistItemsOptions = {}) {
  const cacheKey = getCacheKey(options)
  if (!options.force) {
    const cached = getCachedItems(cacheKey)
    if (cached) return cached

    const inflight = inflightRequests.get(cacheKey)
    if (inflight) return inflight
  }

  const request = (async () => {
    const params = new URLSearchParams()
    if (options.spaceId) params.set("space_id", options.spaceId)
    if (options.projectId) params.set("project_id", options.projectId)

    const res = await fetch(`/api/wishlist${params.size ? `?${params.toString()}` : ""}`)
    if (!res.ok) throw new Error(`メモの取得に失敗しました (${res.status})`)
    const data = await res.json()
    const items = (data.items ?? []) as WishlistItem[]
    writeCache(cacheKey, items)
    return items
  })()

  inflightRequests.set(cacheKey, request)
  try {
    return await request
  } finally {
    if (inflightRequests.get(cacheKey) === request) {
      inflightRequests.delete(cacheKey)
    }
  }
}
