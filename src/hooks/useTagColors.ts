"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { DEFAULT_TAG_COLOR, getTagColor, getTagColorFromName, normalizeColor } from "@/lib/color-utils"

export interface ManagedTag {
  id: string | null
  name: string
  color: string
  persisted: boolean
}

export function useTagColors() {
  const [tags, setTags] = useState<ManagedTag[]>([])
  const [isLoadingTags, setIsLoadingTags] = useState(true)

  const refreshTags = useCallback(async () => {
    setIsLoadingTags(true)
    try {
      const res = await fetch("/api/memo-tags", { cache: "no-store" })
      const data = await res.json()
      setTags(Array.isArray(data.tags) ? data.tags : [])
    } catch {
      setTags([])
    } finally {
      setIsLoadingTags(false)
    }
  }, [])

  useEffect(() => {
    refreshTags()
  }, [refreshTags])

  const tagColors = useMemo(() => {
    return Object.fromEntries(tags.map(tag => [tag.name, normalizeColor(tag.color, DEFAULT_TAG_COLOR)]))
  }, [tags])

  const saveTagColor = useCallback(async (name: string, color: string) => {
    const trimmed = name.trim()
    if (!trimmed) return null
    const normalized = normalizeColor(color, getTagColorFromName(trimmed))
    setTags(prev => {
      const exists = prev.some(tag => tag.name === trimmed)
      if (exists) {
        return prev.map(tag => tag.name === trimmed ? { ...tag, color: normalized, persisted: true } : tag)
      }
      return [...prev, { id: null, name: trimmed, color: normalized, persisted: true }]
    })
    const res = await fetch("/api/memo-tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed, color: normalized }),
    })
    const data = await res.json()
    if (!res.ok || data.error) {
      await refreshTags()
      throw new Error(data.error || "タグ色の保存に失敗しました")
    }
    if (data.tag) {
      setTags(prev => {
        const next = prev.filter(tag => tag.name !== data.tag.name)
        return [...next, data.tag].sort((a, b) => a.name.localeCompare(b.name, "ja"))
      })
    }
    return data.tag as ManagedTag
  }, [refreshTags])

  const createTag = useCallback(async (name: string, color?: string) => {
    const trimmed = name.trim()
    if (!trimmed) return null
    return saveTagColor(trimmed, color ?? getTagColor(trimmed, tagColors))
  }, [saveTagColor, tagColors])

  const deleteTag = useCallback(async (name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    setTags(prev => prev.filter(tag => tag.name !== trimmed))
    const res = await fetch(`/api/memo-tags?name=${encodeURIComponent(trimmed)}`, { method: "DELETE" })
    if (!res.ok) await refreshTags()
  }, [refreshTags])

  const colorForTag = useCallback((name: string) => getTagColor(name, tagColors), [tagColors])

  return {
    tags,
    tagColors,
    isLoadingTags,
    refreshTags,
    saveTagColor,
    createTag,
    deleteTag,
    colorForTag,
  }
}
