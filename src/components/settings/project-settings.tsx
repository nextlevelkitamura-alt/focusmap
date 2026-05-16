"use client"

import { useMemo, useState, type ReactNode } from "react"
import { ChevronDown, FolderKanban, Layers, Loader2, Pipette, Tags, Terminal, Check } from "lucide-react"
import { Project, Space } from "@/types/database"
import { useTagColors } from "@/hooks/useTagColors"
import { COLOR_PRESETS, DEFAULT_PROJECT_COLOR, DEFAULT_SPACE_COLOR, getTagColor, normalizeColor } from "@/lib/color-utils"

interface ProjectSettingsProps {
  initialProjects: Project[]
  initialSpaces: Space[]
}

export function ProjectSettings({ initialProjects, initialSpaces }: ProjectSettingsProps) {
  const [projects, setProjects] = useState(initialProjects)
  const [spaces, setSpaces] = useState(initialSpaces)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const { tags, tagColors, isLoadingTags, saveTagColor } = useTagColors()

  const sortedProjects = useMemo(() => [...projects].sort((a, b) => a.title.localeCompare(b.title, "ja")), [projects])
  const sortedSpaces = useMemo(() => [...spaces].sort((a, b) => a.title.localeCompare(b.title, "ja")), [spaces])

  const updateProjectColor = async (project: Project, color: string) => {
    const normalized = normalizeColor(color, DEFAULT_PROJECT_COLOR)
    setProjects(prev => prev.map(p => p.id === project.id ? { ...p, color_theme: normalized } : p))
    setSavingKey(`project:${project.id}`)
    try {
      await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ color_theme: normalized }),
      })
    } finally {
      setSavingKey(null)
    }
  }

  const updateSpaceColor = async (space: Space, color: string) => {
    const normalized = normalizeColor(color, DEFAULT_SPACE_COLOR)
    setSpaces(prev => prev.map(s => s.id === space.id ? { ...s, color: normalized } : s))
    setSavingKey(`space:${space.id}`)
    try {
      await fetch(`/api/spaces/${space.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ color: normalized }),
      })
    } finally {
      setSavingKey(null)
    }
  }

  const updateTagColor = async (name: string, color: string) => {
    setSavingKey(`tag:${name}`)
    try {
      await saveTagColor(name, color)
    } finally {
      setSavingKey(null)
    }
  }

  const updateProjectRepoPath = async (project: Project, repoPath: string) => {
    const normalized = repoPath.trim() || null
    setProjects(prev => prev.map(p => p.id === project.id ? { ...p, repo_path: normalized } : p))
    setSavingKey(`project-repo:${project.id}`)
    try {
      await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo_path: normalized }),
      })
    } finally {
      setSavingKey(null)
    }
  }

  return (
    <div className="space-y-4">
    <div id="project-colors" className="rounded-lg border bg-card p-4">
      <div className="mb-4">
        <h3 className="text-base font-semibold">プロジェクトとタグ</h3>
        <p className="mt-1 text-sm text-muted-foreground">プロジェクト、ワークスペース、タグの色を管理します。</p>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <ColorList
          title="プロジェクト"
          icon={<FolderKanban className="h-4 w-4" />}
          items={sortedProjects.map(project => ({
            id: project.id,
            label: project.title,
            color: normalizeColor(project.color_theme, DEFAULT_PROJECT_COLOR),
            saving: savingKey === `project:${project.id}`,
            onChange: color => updateProjectColor(project, color),
          }))}
          empty="プロジェクトがありません"
        />

        <ColorList
          title="ワークスペース"
          icon={<Layers className="h-4 w-4" />}
          items={sortedSpaces.map(space => ({
            id: space.id,
            label: space.title,
            color: normalizeColor(space.color, DEFAULT_SPACE_COLOR),
            saving: savingKey === `space:${space.id}`,
            onChange: color => updateSpaceColor(space, color),
          }))}
          empty="ワークスペースがありません"
        />

        <ColorList
          title="タグ"
          icon={<Tags className="h-4 w-4" />}
          items={tags.map(tag => ({
            id: tag.name,
            label: tag.name,
            color: getTagColor(tag.name, tagColors),
            saving: savingKey === `tag:${tag.name}`,
            onChange: color => updateTagColor(tag.name, color),
          }))}
          empty={isLoadingTags ? "読み込み中..." : "タグがありません"}
        />
      </div>
    </div>

    <div id="project-repos" className="rounded-lg border bg-card p-4">
      <div className="mb-4">
        <h3 className="text-base font-semibold flex items-center gap-2">
          <Terminal className="h-4 w-4" />
          プロジェクトのリポジトリパス
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          メモの「Claudeで実行」ボタンを使うと、プロジェクトに紐付くこのパスを cwd（作業ディレクトリ）として Claude Code が起動します。絶対パスを指定してください。
        </p>
      </div>
      <div className="space-y-2">
        {sortedProjects.length === 0 ? (
          <div className="flex min-h-20 items-center justify-center text-xs text-muted-foreground">プロジェクトがありません</div>
        ) : sortedProjects.map(project => (
          <RepoPathRow
            key={project.id}
            project={project}
            saving={savingKey === `project-repo:${project.id}`}
            onSave={(path) => updateProjectRepoPath(project, path)}
          />
        ))}
      </div>
    </div>
    </div>
  )
}

function RepoPathRow({
  project,
  saving,
  onSave,
}: {
  project: Project
  saving: boolean
  onSave: (path: string) => Promise<void>
}) {
  const [value, setValue] = useState(project.repo_path ?? "")
  const isDirty = value.trim() !== (project.repo_path ?? "")

  return (
    <div className="flex flex-col gap-1.5 rounded-md border bg-background/40 p-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">{project.title}</div>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="/Users/you/dev/repo"
          className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-xs font-mono outline-none focus:ring-1 focus:ring-primary"
          spellCheck={false}
          autoComplete="off"
        />
      </div>
      <button
        type="button"
        disabled={!isDirty || saving}
        onClick={() => onSave(value)}
        className="h-8 shrink-0 rounded-md border bg-background px-3 text-xs hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1"
      >
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
        保存
      </button>
    </div>
  )
}

function ColorList({
  title,
  icon,
  items,
  empty,
}: {
  title: string
  icon: ReactNode
  items: Array<{
    id: string
    label: string
    color: string
    saving: boolean
    onChange: (color: string) => void
  }>
  empty: string
}) {
  return (
    <section className="min-w-0 rounded-md border bg-background/40 p-3">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium">
        {icon}
        {title}
      </div>
      {items.length === 0 ? (
        <div className="flex min-h-20 items-center justify-center text-xs text-muted-foreground">{empty}</div>
      ) : (
        <div className="space-y-2">
          {items.map(item => (
            <div key={item.id} className="flex min-h-12 flex-wrap items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-muted/40">
              <span className="h-4 w-4 shrink-0 rounded-full border" style={{ backgroundColor: item.color }} />
              <span className="min-w-0 flex-1 truncate text-sm">{item.label}</span>
              {item.saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
              <ColorControl
                color={item.color}
                label={item.label}
                onChange={item.onChange}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function ColorControl({
  color,
  label,
  onChange,
}: {
  color: string
  label: string
  onChange: (color: string) => void
}) {
  const normalized = normalizeColor(color)
  const presetValue = COLOR_PRESETS.some(preset => preset.value.toLowerCase() === normalized.toLowerCase())
    ? normalized
    : "custom"

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <div className="relative">
        <select
          value={presetValue}
          onChange={event => {
            if (event.target.value !== "custom") onChange(event.target.value)
          }}
          className="h-8 w-[112px] appearance-none rounded-md border bg-background pl-7 pr-7 text-xs outline-none focus:ring-1 focus:ring-primary"
          aria-label={`${label}のプリセット色`}
        >
          {COLOR_PRESETS.map(preset => (
            <option key={preset.value} value={preset.value}>{preset.label}</option>
          ))}
          <option value="custom">カスタム</option>
        </select>
        <span className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border" style={{ backgroundColor: normalized }} />
        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      </div>
      <label className="flex h-8 w-9 cursor-pointer items-center justify-center rounded-md border bg-background text-muted-foreground hover:text-foreground">
        <Pipette className="h-3.5 w-3.5" />
        <input
          type="color"
          value={normalized}
          onChange={event => onChange(event.target.value)}
          className="sr-only"
          aria-label={`${label}のカスタム色`}
        />
      </label>
    </div>
  )
}
