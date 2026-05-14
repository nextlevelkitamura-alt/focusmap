import { getTagColorFromName, normalizeColor } from "@/lib/color-utils"

type MemoTagUpsertError = { code?: string; message: string }
type MemoTagClient = {
  from: (table: string) => {
    upsert: (
      rows: Array<{ user_id: string; name: string; color: string }>,
      options: { onConflict: string; ignoreDuplicates: boolean },
    ) => PromiseLike<{ error: MemoTagUpsertError | null }>
  }
}

function collectTagNames(category: unknown, tags: unknown) {
  const names = new Set<string>()
  if (typeof category === "string" && category.trim()) names.add(category.trim())
  if (Array.isArray(tags)) {
    for (const tag of tags) {
      if (typeof tag === "string" && tag.trim()) names.add(tag.trim())
    }
  }
  return [...names]
}

export async function upsertMemoTags(
  supabase: unknown,
  userId: string,
  category: unknown,
  tags: unknown,
) {
  const rows = collectTagNames(category, tags).map(name => ({
    user_id: userId,
    name,
    color: normalizeColor(null, getTagColorFromName(name)),
  }))

  if (rows.length === 0) return

  const client = supabase as MemoTagClient
  const { error } = await client
    .from("memo_tags")
    .upsert(rows, { onConflict: "user_id,name", ignoreDuplicates: true })

  if (error?.code === "42P01" || error?.code === "PGRST205") return
  if (error) console.warn("[memo-tags] Failed to upsert tags:", error.message)
}
