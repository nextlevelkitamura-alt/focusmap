"use client"

import { useMemo, useState, type ReactNode } from "react"
import { ChevronDown, ChevronRight, FileText, FolderKanban, Layers, Loader2, Pipette, Tags } from "lucide-react"
import { Project, Space } from "@/types/database"
import { useTagColors } from "@/hooks/useTagColors"
import { COLOR_PRESETS, DEFAULT_PROJECT_COLOR, DEFAULT_SPACE_COLOR, getTagColor, normalizeColor } from "@/lib/color-utils"
import { RepoPicker } from "./repo-picker"
import { ScanSettingsSection } from "./scan-settings-section"
import { ProjectContextChatDialog } from "@/components/projects/project-context-chat-dialog"
import {
  SettingsEmptyState,
  SettingsSection,
  SettingsStatusChip,
} from "@/components/settings/settings-primitives"

interface ProjectSettingsProps {
  initialProjects: Project[]
  initialSpaces: Space[]
}

export function ProjectSettings({ initialProjects, initialSpaces }: ProjectSettingsProps) {
  const [projects, setProjects] = useState(initialProjects)
  const [spaces, setSpaces] = useState(initialSpaces)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [descProject, setDescProject] = useState<Project | null>(null)
  const { tags, tagColors, isLoadingTags, saveTagColor } = useTagColors()

  const sortedProjects = useMemo(() => [...projects].sort((a, b) => a.title.localeCompare(b.title, "ja")), [projects])
  const sortedSpaces = useMemo(() => [...spaces].sort((a, b) => a.title.localeCompare(b.title, "ja")), [spaces])
  const linkedRepoCount = useMemo(() => sortedProjects.filter(project => project.repo_path?.trim()).length, [sortedProjects])
  const describedProjectCount = useMemo(() => sortedProjects.filter(project => project.description?.trim()).length, [sortedProjects])
  const visualIdentityCount = sortedProjects.length + sortedSpaces.length + tags.length

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
    <div className="space-y-8">
      <div id="project-colors">
        <SettingsSection
          title="Visual identity"
          description="プロジェクト、ワークスペース、タグを必要な識別だけに絞って表示します。"
          trailing={<SettingsStatusChip tone="muted">{visualIdentityCount} items</SettingsStatusChip>}
        >
          <div className="grid divide-y divide-white/[0.07] xl:grid-cols-3 xl:divide-x xl:divide-y-0">
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
        </SettingsSection>
      </div>

      <div id="project-repos">
        <SettingsSection
          title="Repo execution target"
          description="AI実行やCodex取り込みで使うローカルrepo pathをプロジェクトごとに紐づけます。"
          trailing={
            <SettingsStatusChip tone={linkedRepoCount === sortedProjects.length && sortedProjects.length > 0 ? "ok" : "attention"}>
              {linkedRepoCount}/{sortedProjects.length} linked
            </SettingsStatusChip>
          }
        >
          {sortedProjects.length === 0 ? (
            <SettingsEmptyState>プロジェクトがありません</SettingsEmptyState>
          ) : (
            <div>
              {sortedProjects.map(project => {
                const isSavingRepo = savingKey === `project-repo:${project.id}`
                const hasRepo = Boolean(project.repo_path?.trim())
                return (
                  <div key={project.id} className="border-b border-white/[0.07] last:border-b-0">
                    <RepoPicker
                      value={project.repo_path ?? null}
                      onChange={(path) => updateProjectRepoPath(project, path ?? "")}
                      allowCustom={false}
                      triggerVariant="row"
                      rowLabel={project.title}
                      rowDescription="メモ・マップ・Codex threadの実行先"
                      rowStatus={
                        <SettingsStatusChip tone={isSavingRepo ? "neutral" : hasRepo ? "ok" : "attention"}>
                          {isSavingRepo ? "保存中" : hasRepo ? "接続中" : "未設定"}
                        </SettingsStatusChip>
                      }
                      disabled={isSavingRepo}
                    />
                  </div>
                )
              })}
            </div>
          )}
        </SettingsSection>
      </div>

      <div id="project-descriptions">
        <SettingsSection
          title="Project context"
          description="AIがプロジェクトの目的、制約、現在地を読めるように説明/contextを整えます。"
          trailing={
            <SettingsStatusChip tone={describedProjectCount === sortedProjects.length && sortedProjects.length > 0 ? "ok" : "attention"}>
              {describedProjectCount}/{sortedProjects.length} ready
            </SettingsStatusChip>
          }
        >
          {sortedProjects.length === 0 ? (
            <SettingsEmptyState>プロジェクトがありません</SettingsEmptyState>
          ) : (
            <div>
              {sortedProjects.map(project => {
                const description = project.description?.trim()
                return (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => setDescProject(project)}
                    className="flex min-h-[64px] w-full items-center gap-3 border-b border-white/[0.07] px-4 py-3 text-left transition hover:bg-white/[0.04] active:bg-white/[0.08] last:border-b-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/[0.08] bg-black/20 text-zinc-400">
                      <FileText className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-[15px] font-medium leading-5 text-zinc-50">{project.title}</span>
                        <SettingsStatusChip tone={description ? "ok" : "attention"}>
                          {description ? "OK" : "未設定"}
                        </SettingsStatusChip>
                      </span>
                      <span className="mt-1 block truncate text-[12px] leading-5 text-zinc-500">
                        {description || "説明がありません。チャットで追加できます。"}
                      </span>
                    </span>
                    <span className="hidden shrink-0 text-[12px] text-zinc-500 sm:inline">チャットで更新</span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-zinc-500" />
                  </button>
                )
              })}
            </div>
          )}
        </SettingsSection>
      </div>

      <ScanSettingsSection />

      {descProject && (
        <ProjectContextChatDialog
          open={!!descProject}
          projectId={descProject.id}
          projectTitle={descProject.title}
          initialDescription={descProject.description ?? ""}
          onClose={() => setDescProject(null)}
          onUpdated={(description) => {
            setProjects(prev => prev.map(p => p.id === descProject.id ? { ...p, description } : p))
            setDescProject(prev => prev ? { ...prev, description } : prev)
          }}
        />
      )}
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
    <section className="min-w-0 p-4">
      <div className="mb-3 flex items-center gap-2 text-[13px] font-medium text-zinc-300">
        {icon}
        {title}
      </div>
      {items.length === 0 ? (
        <div className="flex min-h-20 items-center justify-center rounded-md border border-white/[0.07] bg-black/15 px-3 text-center text-[12px] text-zinc-500">{empty}</div>
      ) : (
        <div className="space-y-2">
          {items.map(item => (
            <div key={item.id} className="flex min-h-12 flex-wrap items-center gap-2 rounded-md border border-transparent px-1.5 py-1.5 transition hover:border-white/[0.08] hover:bg-white/[0.035]">
              <span className="h-4 w-4 shrink-0 rounded-full border border-white/20" style={{ backgroundColor: item.color }} />
              <span className="min-w-0 flex-1 truncate text-sm text-zinc-100">{item.label}</span>
              {item.saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-500" />}
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
          className="h-8 w-[112px] appearance-none rounded-md border border-white/[0.10] bg-black/20 pl-7 pr-7 text-xs text-zinc-100 outline-none focus:ring-1 focus:ring-white/35"
          aria-label={`${label}のプリセット色`}
        >
          {COLOR_PRESETS.map(preset => (
            <option key={preset.value} value={preset.value}>{preset.label}</option>
          ))}
          <option value="custom">カスタム</option>
        </select>
        <span className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border border-white/20" style={{ backgroundColor: normalized }} />
        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
      </div>
      <label className="flex h-8 w-9 cursor-pointer items-center justify-center rounded-md border border-white/[0.10] bg-black/20 text-zinc-500 transition hover:text-zinc-100">
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
