"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { CheckCircle2, GitBranch, Laptop, Mail, Package, Play, RefreshCw, Save, Send, Users } from "lucide-react"
import type { Space } from "@/types/database"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useCalendars } from "@/hooks/useCalendars"
import type { SpaceRole } from "@/lib/space-access"
import { fetchWithSupabaseAuth } from "@/lib/auth/supabase-auth-fetch"

type SpaceMemberRow = {
  id: string
  user_id: string
  role: SpaceRole
  created_at: string
}

type AiPackageRow = {
  id: string
  title: string
  executor: "claude" | "codex" | "codex_app"
  default_visibility: "private" | "space"
  required_repo_key: string | null
  required_secret_names: string[]
  current_version_id?: string | null
  current_version?: {
    id: string
    version: string
    source_kind: "git" | "local_repo_key" | "inline"
    repo_url: string | null
    git_ref: string | null
    git_commit_sha: string | null
    package_path: string
    manifest: Record<string, unknown>
    published_at: string
  } | null
  runner_caches?: Array<{
    runner_id: string
    package_id: string
    version_id: string
    local_path: string | null
    sync_status: "missing" | "sync_requested" | "syncing" | "ready" | "failed"
    synced_at: string | null
    last_error: string | null
  }>
  created_at: string
}

type AiRunnerRow = {
  id: string
  user_id: string
  hostname: string
  display_name: string | null
  executors: string[]
  available_repo_keys: string[]
  last_heartbeat_at: string
}

const ROLES: SpaceRole[] = ["owner", "editor", "commenter", "viewer"]
const EXECUTORS = ["claude", "codex", "codex_app"] as const

function commaList(value: string) {
  return value.split(",").map(item => item.trim()).filter(Boolean)
}

function isOnline(lastHeartbeatAt: string) {
  return Date.now() - new Date(lastHeartbeatAt).getTime() < 2 * 60 * 1000
}

function packageSyncLabel(pkg: AiPackageRow) {
  if (!pkg.current_version) return "未公開"
  const cache = (pkg.runner_caches ?? [])[0]
  if (!cache) return "未同期"
  if (cache.version_id !== pkg.current_version.id) return "更新あり"
  if (cache.sync_status === "ready") return "同期済み"
  if (cache.sync_status === "syncing") return "同期中"
  if (cache.sync_status === "sync_requested") return "同期待ち"
  if (cache.sync_status === "failed") return "同期失敗"
  return "未同期"
}

function packageSyncTone(pkg: AiPackageRow) {
  const label = packageSyncLabel(pkg)
  if (label === "同期済み") return "text-emerald-400"
  if (label === "同期中" || label === "同期待ち") return "text-sky-400"
  if (label === "同期失敗") return "text-red-400"
  return "text-amber-300"
}

export function SpaceSharingSettings({ initialSpaces }: { initialSpaces: Space[] }) {
  const [spaces, setSpaces] = useState(initialSpaces)
  const [selectedSpaceId, setSelectedSpaceId] = useState(initialSpaces[0]?.id ?? "")
  const selectedSpace = spaces.find(space => space.id === selectedSpaceId) ?? null
  const { calendars } = useCalendars()

  const [members, setMembers] = useState<SpaceMemberRow[]>([])
  const [packages, setPackages] = useState<AiPackageRow[]>([])
  const [runners, setRunners] = useState<AiRunnerRow[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteRole, setInviteRole] = useState<SpaceRole>("editor")
  const [memberUserId, setMemberUserId] = useState("")
  const [memberRole, setMemberRole] = useState<SpaceRole>("editor")
  const [packageTitle, setPackageTitle] = useState("")
  const [promptTemplate, setPromptTemplate] = useState("")
  const [executor, setExecutor] = useState<typeof EXECUTORS[number]>("claude")
  const [requiredRepoKey, setRequiredRepoKey] = useState("")
  const [requiredSecrets, setRequiredSecrets] = useState("")
  const [scheduleJson, setScheduleJson] = useState("{}")
  const [packageVersion, setPackageVersion] = useState("v1")
  const [repoUrl, setRepoUrl] = useState("")
  const [gitRef, setGitRef] = useState("main")
  const [packagePath, setPackagePath] = useState(".")
  const [packageCommand, setPackageCommand] = useState("")
  const [versionPackageId, setVersionPackageId] = useState("")
  const [newVersionName, setNewVersionName] = useState("")
  const [newVersionGitRef, setNewVersionGitRef] = useState("")
  const [newVersionCommand, setNewVersionCommand] = useState("")

  const writableCalendars = useMemo(
    () => calendars.filter(calendar => calendar.access_level === "owner" || calendar.access_level === "writer"),
    [calendars],
  )

  const refreshSpaceData = useCallback(async () => {
    if (!selectedSpaceId) return
    const [membersRes, packagesRes, runnersRes] = await Promise.all([
      fetch(`/api/spaces/${selectedSpaceId}/members`),
      fetch(`/api/ai-packages?space_id=${encodeURIComponent(selectedSpaceId)}`),
      fetchWithSupabaseAuth(`/api/ai-runners?space_id=${encodeURIComponent(selectedSpaceId)}`),
    ])

    if (membersRes.ok) setMembers(((await membersRes.json()).members ?? []) as SpaceMemberRow[])
    if (packagesRes.ok) setPackages(((await packagesRes.json()).packages ?? []) as AiPackageRow[])
    if (runnersRes.ok) setRunners(((await runnersRes.json()).runners ?? []) as AiRunnerRow[])
  }, [selectedSpaceId])

  useEffect(() => {
    void refreshSpaceData()
  }, [refreshSpaceData])

  useEffect(() => {
    if (!versionPackageId && packages[0]?.id) setVersionPackageId(packages[0].id)
    if (versionPackageId && !packages.some(pkg => pkg.id === versionPackageId)) {
      setVersionPackageId(packages[0]?.id ?? "")
    }
  }, [packages, versionPackageId])

  const saveDefaultCalendar = async (calendarId: string | null) => {
    if (!selectedSpaceId) return
    setIsSaving(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/spaces/${selectedSpaceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ default_calendar_id: calendarId }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? "保存できませんでした")
      const updated = await res.json() as Space
      setSpaces(prev => prev.map(space => space.id === updated.id ? updated : space))
      setMessage("既定カレンダーを保存しました")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存できませんでした")
    } finally {
      setIsSaving(false)
    }
  }

  const sendInvite = async () => {
    if (!selectedSpaceId || !inviteEmail.trim()) return
    setIsSaving(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/spaces/${selectedSpaceId}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? "招待を作成できませんでした")
      setInviteEmail("")
      setMessage("招待リンクを作成しました")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "招待を作成できませんでした")
    } finally {
      setIsSaving(false)
    }
  }

  const addMember = async () => {
    if (!selectedSpaceId || !memberUserId.trim()) return
    setIsSaving(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/spaces/${selectedSpaceId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: memberUserId.trim(), role: memberRole }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? "メンバーを追加できませんでした")
      setMemberUserId("")
      await refreshSpaceData()
      setMessage("メンバーを更新しました")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "メンバーを追加できませんでした")
    } finally {
      setIsSaving(false)
    }
  }

  const createPackage = async () => {
    if (!selectedSpaceId || !packageTitle.trim() || !promptTemplate.trim()) return
    setIsSaving(true)
    setMessage(null)
    try {
      let schedule: unknown = {}
      try {
        schedule = JSON.parse(scheduleJson || "{}")
      } catch {
        throw new Error("schedule JSON が不正です")
      }

      const res = await fetch("/api/ai-packages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          space_id: selectedSpaceId,
          title: packageTitle.trim(),
          prompt_template: promptTemplate.trim(),
          executor,
          schedule,
          required_repo_key: requiredRepoKey.trim() || null,
          required_secret_names: commaList(requiredSecrets),
          default_visibility: "space",
          initial_version: packageCommand.trim() || repoUrl.trim()
            ? {
              version: packageVersion.trim() || "v1",
              source_kind: repoUrl.trim() ? "git" : "local_repo_key",
              repo_url: repoUrl.trim() || null,
              git_ref: gitRef.trim() || null,
              package_path: packagePath.trim() || ".",
              manifest: {
                command: packageCommand.trim() || undefined,
                repo_key: requiredRepoKey.trim() || undefined,
              },
              publish: true,
            }
            : null,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? "パッケージを作成できませんでした")
      setPackageTitle("")
      setPromptTemplate("")
      setRequiredRepoKey("")
      setRequiredSecrets("")
      setScheduleJson("{}")
      setPackageVersion("v1")
      setRepoUrl("")
      setGitRef("main")
      setPackagePath(".")
      setPackageCommand("")
      await refreshSpaceData()
      setMessage("AIパッケージを作成しました")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "パッケージを作成できませんでした")
    } finally {
      setIsSaving(false)
    }
  }

  const syncPackage = async (pkg: AiPackageRow, silent = false) => {
    setIsSaving(true)
    if (!silent) setMessage(null)
    try {
      const res = await fetch("/api/ai-runners/sync-package", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ package_id: pkg.id }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? "同期を要求できませんでした")
      await refreshSpaceData()
      if (!silent) setMessage("同期を要求しました。オンラインPCが次のheartbeatで差分取得します")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "同期を要求できませんでした")
    } finally {
      setIsSaving(false)
    }
  }

  const runPackage = async (pkg: AiPackageRow) => {
    setIsSaving(true)
    setMessage(null)
    try {
      if (pkg.current_version) {
        await fetch("/api/ai-runners/sync-package", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ package_id: pkg.id }),
        })
      }
      const res = await fetch(`/api/ai-packages/${pkg.id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ run_visibility: "space" }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? "実行を予約できませんでした")
      await refreshSpaceData()
      setMessage("実行を予約しました。未同期なら同期後に自動実行されます")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "実行を予約できませんでした")
    } finally {
      setIsSaving(false)
    }
  }

  const publishVersion = async () => {
    const pkg = packages.find(item => item.id === versionPackageId)
    if (!pkg || !newVersionName.trim()) return
    setIsSaving(true)
    setMessage(null)
    try {
      const current = pkg.current_version
      const res = await fetch(`/api/ai-packages/${pkg.id}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: newVersionName.trim(),
          source_kind: current?.repo_url ? "git" : "local_repo_key",
          repo_url: current?.repo_url ?? null,
          git_ref: newVersionGitRef.trim() || current?.git_ref || null,
          package_path: current?.package_path ?? ".",
          manifest: {
            ...(current?.manifest ?? {}),
            command: newVersionCommand.trim() || current?.manifest?.command,
          },
          publish: true,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? "バージョンを公開できませんでした")
      setNewVersionName("")
      setNewVersionGitRef("")
      setNewVersionCommand("")
      await refreshSpaceData()
      setMessage("新しいバージョンを公開しました。各PCに更新ありとして表示されます")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "バージョンを公開できませんでした")
    } finally {
      setIsSaving(false)
    }
  }

  if (spaces.length === 0) {
    return <p className="px-4 text-sm text-muted-foreground">Space がありません。</p>
  }

  return (
    <div className="space-y-4 px-3">
      <section className="rounded-xl border border-border/60 bg-card p-4">
        <Label htmlFor="space-select">Space</Label>
        <select
          id="space-select"
          value={selectedSpaceId}
          onChange={event => setSelectedSpaceId(event.target.value)}
          className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          {spaces.map(space => <option key={space.id} value={space.id}>{space.title}</option>)}
        </select>
        {message && <p className="mt-2 text-xs text-muted-foreground">{message}</p>}
      </section>

      <section className="rounded-xl border border-border/60 bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Save className="h-4 w-4 text-primary" />
          <h2 className="text-base font-semibold">既定カレンダー</h2>
        </div>
        <select
          value={selectedSpace?.default_calendar_id ?? ""}
          onChange={event => saveDefaultCalendar(event.target.value || null)}
          disabled={isSaving}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">未設定</option>
          {writableCalendars.map(calendar => (
            <option key={calendar.google_calendar_id} value={calendar.google_calendar_id}>
              {calendar.name}
            </option>
          ))}
        </select>
      </section>

      <section className="rounded-xl border border-border/60 bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          <h2 className="text-base font-semibold">メンバー</h2>
        </div>
        <div className="space-y-2">
          {members.map(member => (
            <div key={member.id} className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-sm">
              <span className="truncate">{member.user_id}</span>
              <span className="text-xs text-muted-foreground">{member.role}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_120px_auto]">
          <Input value={memberUserId} onChange={event => setMemberUserId(event.target.value)} placeholder="user_id" />
          <select value={memberRole} onChange={event => setMemberRole(event.target.value as SpaceRole)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
            {ROLES.map(role => <option key={role} value={role}>{role}</option>)}
          </select>
          <Button type="button" onClick={addMember} disabled={isSaving}>追加</Button>
        </div>
      </section>

      <section className="rounded-xl border border-border/60 bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Mail className="h-4 w-4 text-primary" />
          <h2 className="text-base font-semibold">招待</h2>
        </div>
        <div className="grid gap-2 sm:grid-cols-[1fr_120px_auto]">
          <Input value={inviteEmail} onChange={event => setInviteEmail(event.target.value)} placeholder="email@example.com" />
          <select value={inviteRole} onChange={event => setInviteRole(event.target.value as SpaceRole)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
            {ROLES.map(role => <option key={role} value={role}>{role}</option>)}
          </select>
          <Button type="button" onClick={sendInvite} disabled={isSaving}>
            <Send className="mr-2 h-4 w-4" />
            招待
          </Button>
        </div>
      </section>

      <section className="rounded-xl border border-border/60 bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Laptop className="h-4 w-4 text-primary" />
          <h2 className="text-base font-semibold">AI実行PC</h2>
        </div>
        <div className="space-y-2">
          {runners.length === 0 && <p className="text-sm text-muted-foreground">登録済みPCはありません。</p>}
          {runners.map(runner => (
            <div key={runner.id} className="rounded-md bg-muted/40 px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate">{runner.display_name || runner.hostname}</span>
                <span className={isOnline(runner.last_heartbeat_at) ? "text-emerald-400" : "text-muted-foreground"}>
                  {isOnline(runner.last_heartbeat_at) ? "online" : "offline"}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{runner.executors.join(", ") || "executor 未登録"}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-border/60 bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Package className="h-4 w-4 text-primary" />
          <h2 className="text-base font-semibold">AIパッケージ</h2>
        </div>
        <div className="space-y-2">
          {packages.length === 0 && <p className="text-sm text-muted-foreground">共有できるAIパッケージはまだありません。</p>}
          {packages.map(pkg => (
            <div key={pkg.id} className="rounded-md bg-muted/40 px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">{pkg.title}</span>
                <span className="text-xs text-muted-foreground">{pkg.executor}</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="inline-flex items-center gap-1 rounded-md bg-background/60 px-2 py-1 text-muted-foreground">
                  <GitBranch className="h-3 w-3" />
                  {pkg.current_version?.version ?? "未公開"}
                </span>
                <span className={`inline-flex items-center gap-1 rounded-md bg-background/60 px-2 py-1 ${packageSyncTone(pkg)}`}>
                  <CheckCircle2 className="h-3 w-3" />
                  {packageSyncLabel(pkg)}
                </span>
                {pkg.current_version?.git_ref && (
                  <span className="rounded-md bg-background/60 px-2 py-1 text-muted-foreground">{pkg.current_version.git_ref}</span>
                )}
              </div>
              {(pkg.required_repo_key || pkg.required_secret_names.length > 0) && (
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {pkg.required_repo_key || "repo指定なし"} · secrets {pkg.required_secret_names.join(", ") || "なし"}
                </p>
              )}
              {pkg.runner_caches?.[0]?.last_error && (
                <p className="mt-1 line-clamp-2 text-xs text-red-300">{pkg.runner_caches[0].last_error}</p>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => syncPackage(pkg)} disabled={isSaving || !pkg.current_version}>
                  <RefreshCw className="mr-2 h-3.5 w-3.5" />
                  同期
                </Button>
                <Button type="button" size="sm" onClick={() => runPackage(pkg)} disabled={isSaving}>
                  <Play className="mr-2 h-3.5 w-3.5" />
                  更新して実行
                </Button>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 grid gap-2">
          <Input value={packageTitle} onChange={event => setPackageTitle(event.target.value)} placeholder="パッケージ名" />
          <textarea
            value={promptTemplate}
            onChange={event => setPromptTemplate(event.target.value)}
            placeholder="prompt template: {{name}} のように入力値を差し込めます"
            className="min-h-28 rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <div className="grid gap-2 sm:grid-cols-3">
            <select value={executor} onChange={event => setExecutor(event.target.value as typeof EXECUTORS[number])} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
              {EXECUTORS.map(value => <option key={value} value={value}>{value}</option>)}
            </select>
            <Input value={requiredRepoKey} onChange={event => setRequiredRepoKey(event.target.value)} placeholder="required_repo_key" />
            <Input value={requiredSecrets} onChange={event => setRequiredSecrets(event.target.value)} placeholder="SECRET_NAME, OTHER_TOKEN" />
          </div>
          <textarea
            value={scheduleJson}
            onChange={event => setScheduleJson(event.target.value)}
            placeholder='{"recurrence_cron":"0 9 * * 1-5"}'
            className="min-h-16 rounded-md border border-input bg-background px-3 py-2 text-xs font-mono"
          />
          <div className="grid gap-2 sm:grid-cols-4">
            <Input value={packageVersion} onChange={event => setPackageVersion(event.target.value)} placeholder="version: v1" />
            <Input value={repoUrl} onChange={event => setRepoUrl(event.target.value)} placeholder="Git URL（任意）" />
            <Input value={gitRef} onChange={event => setGitRef(event.target.value)} placeholder="branch/tag/commit" />
            <Input value={packagePath} onChange={event => setPackagePath(event.target.value)} placeholder="package path" />
          </div>
          <textarea
            value={packageCommand}
            onChange={event => setPackageCommand(event.target.value)}
            placeholder='実行コマンド例: npm run staff-status -- --target "$FOCUSMAP_TASK_PROMPT"'
            className="min-h-16 rounded-md border border-input bg-background px-3 py-2 text-xs font-mono"
          />
          <Button type="button" onClick={createPackage} disabled={isSaving}>
            作成
          </Button>
        </div>
        {packages.length > 0 && (
          <div className="mt-4 border-t border-border/60 pt-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              <GitBranch className="h-4 w-4 text-primary" />
              新バージョン公開
            </div>
            <div className="grid gap-2 sm:grid-cols-[1fr_120px_1fr]">
              <select value={versionPackageId} onChange={event => setVersionPackageId(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
                {packages.map(pkg => <option key={pkg.id} value={pkg.id}>{pkg.title}</option>)}
              </select>
              <Input value={newVersionName} onChange={event => setNewVersionName(event.target.value)} placeholder="v2" />
              <Input value={newVersionGitRef} onChange={event => setNewVersionGitRef(event.target.value)} placeholder="branch/tag/commit" />
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
              <Input value={newVersionCommand} onChange={event => setNewVersionCommand(event.target.value)} placeholder="実行コマンドを変える場合だけ入力" />
              <Button type="button" onClick={publishVersion} disabled={isSaving || !newVersionName.trim()}>
                公開
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
