import type { DashboardView } from "@/contexts/ViewContext"

const prefetched = new Set<string>()

function canPrefetchOnCurrentConnection() {
  if (typeof navigator === "undefined") return false
  const connection = (navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string }
  }).connection

  if (connection?.saveData) return false
  if (connection?.effectiveType && /^(slow-2g|2g)$/.test(connection.effectiveType)) return false
  return true
}

function preloadOnce(key: string, loader: () => Promise<unknown>) {
  if (prefetched.has(key) || !canPrefetchOnCurrentConnection()) return
  prefetched.add(key)
  void loader().catch(() => {
    prefetched.delete(key)
  })
}

export function preloadDashboardView(view: DashboardView) {
  if (view === "today") {
    preloadOnce("today", () => import("@/components/today/today-view"))
    return
  }

  if (view === "long-term") {
    preloadOnce("wishlist", () => import("@/components/wishlist/wishlist-view"))
    preloadOnce("space-project-switcher", () => import("@/components/dashboard/space-project-switcher"))
    return
  }

  if (view === "ai") {
    preloadOnce("mobile-ai-execution", () => import("@/components/ai/mobile-ai-execution-view"))
    preloadOnce("desktop-ai", () => import("@/components/ai/ai-view"))
    return
  }

  if (view === "automation") {
    preloadOnce("auto-chat", () => import("@/components/chat/auto-chat-view"))
    return
  }

  if (view === "map") {
    preloadOnce("mobile-ai-map", () => import("@/components/ai/mobile-ai-map-view"))
    preloadOnce("center-pane", () => import("@/components/dashboard/center-pane"))
  }
}

export function preloadDashboardPanels() {
  preloadOnce("ai-chat-panel", () => import("@/components/ai/ai-chat-panel"))
  preloadOnce("scheduling-panel", () => import("@/components/ai/scheduling-panel"))
}
