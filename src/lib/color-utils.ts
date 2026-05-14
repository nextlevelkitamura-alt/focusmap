export const DEFAULT_PROJECT_COLOR = "#3b82f6"
export const DEFAULT_TAG_COLOR = "#8b5cf6"
export const DEFAULT_SPACE_COLOR = "#9ca3af"

export const COLOR_PRESETS = [
  { label: "ブルー", value: "#3b82f6" },
  { label: "シアン", value: "#06b6d4" },
  { label: "ティール", value: "#14b8a6" },
  { label: "グリーン", value: "#22c55e" },
  { label: "ライム", value: "#84cc16" },
  { label: "イエロー", value: "#eab308" },
  { label: "オレンジ", value: "#f97316" },
  { label: "ローズ", value: "#f43f5e" },
  { label: "パープル", value: "#8b5cf6" },
  { label: "スレート", value: "#64748b" },
]

const NAMED_COLORS: Record<string, string> = {
  blue: "#3b82f6",
  green: "#22c55e",
  red: "#ef4444",
  orange: "#f97316",
  yellow: "#eab308",
  purple: "#8b5cf6",
  pink: "#ec4899",
  cyan: "#06b6d4",
  gray: "#9ca3af",
  slate: "#64748b",
}

const TAG_PALETTE = [
  ...COLOR_PRESETS.map(color => color.value),
]

export function normalizeColor(value: string | null | undefined, fallback = DEFAULT_PROJECT_COLOR) {
  if (!value) return fallback
  const trimmed = value.trim()
  if (!trimmed) return fallback
  if (NAMED_COLORS[trimmed]) return NAMED_COLORS[trimmed]
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const [, r, g, b] = trimmed
    return `#${r}${r}${g}${g}${b}${b}`
  }
  return fallback
}

export function colorToRgba(color: string, alpha: number) {
  const hex = normalizeColor(color)
  const r = Number.parseInt(hex.slice(1, 3), 16)
  const g = Number.parseInt(hex.slice(3, 5), 16)
  const b = Number.parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`
}

export function getTextColorForBackground(color: string) {
  const hex = normalizeColor(color)
  const r = Number.parseInt(hex.slice(1, 3), 16)
  const g = Number.parseInt(hex.slice(3, 5), 16)
  const b = Number.parseInt(hex.slice(5, 7), 16)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.62 ? "#111827" : "#ffffff"
}

export function getTagColorFromName(name: string) {
  let hash = 0
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  }
  return TAG_PALETTE[hash % TAG_PALETTE.length]
}

export function getTagColor(name: string, colors: Record<string, string> = {}) {
  return normalizeColor(colors[name], getTagColorFromName(name))
}
