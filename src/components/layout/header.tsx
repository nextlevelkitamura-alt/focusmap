"use client"

import { useState, useEffect, type CSSProperties } from "react"
import { createClient } from "@/utils/supabase/client"
import type { User } from "@supabase/supabase-js"
import { useRouter } from "next/navigation"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { LogOut, MessageCircle, Network, Settings, User as UserIcon, CalendarDays, Sparkles, StickyNote } from "lucide-react"
import { Project, Space } from "@/types/database"
import { useView, DashboardView } from "@/contexts/ViewContext"
import { cn } from "@/lib/utils"
import { FocusmapLogo } from "@/components/ui/focusmap-logo"
import { MemoToMindmapDialog } from "@/components/memo/memo-to-mindmap-dialog"
import { SpaceProjectSwitcher } from "@/components/dashboard/space-project-switcher"
import { useForceDesktopDashboard } from "@/hooks/useForceDesktopDashboard"
import { isFocusmapDesktopShell } from "@/lib/external-auth-launch"

interface HeaderProps {
    spaces?: Space[]
    projects?: Project[]
    selectedSpaceId?: string | null
    selectedProjectId?: string | null
    onSelectSpace?: (id: string | null) => void
    onSelectProject?: (id: string | null) => void
    onProjectCreated?: (project: Project) => void
    onProjectSaved?: (project: Project) => void
    onProjectDeleted?: (projectId: string) => void | Promise<void>
    onSpaceSaved?: (space: Space) => void
    showTaskListToggle?: boolean
    isTaskListVisible?: boolean
    onToggleTaskList?: () => void
    showCalendarSplitToggle?: boolean
    isCalendarSplitVisible?: boolean
    onToggleCalendarSplit?: () => void
    showMapSplitToggle?: boolean
    isMapSplitVisible?: boolean
    onToggleMapSplit?: () => void
    showMemoSplitToggle?: boolean
    isMemoSplitVisible?: boolean
    onToggleMemoSplit?: () => void
    onMindmapUpdated?: () => void
    onLogoClick?: () => void
}

export function Header({
    spaces = [],
    projects = [],
    selectedSpaceId = null,
    selectedProjectId = null,
    onSelectSpace,
    onSelectProject,
    onProjectCreated,
    onProjectSaved,
    onProjectDeleted,
    onSpaceSaved,
    showCalendarSplitToggle = false,
    isCalendarSplitVisible = false,
    onToggleCalendarSplit,
    showMapSplitToggle = false,
    isMapSplitVisible = false,
    onToggleMapSplit,
    showMemoSplitToggle = false,
    isMemoSplitVisible = false,
    onToggleMemoSplit,
    onMindmapUpdated,
    onLogoClick,
}: HeaderProps) {
    const router = useRouter()
    const [user, setUser] = useState<User | null>(null)
    const [supabase] = useState(() => createClient())
    const [organizeDialogOpen, setOrganizeDialogOpen] = useState(false)
    const [organizeMemoIds, setOrganizeMemoIds] = useState<string[]>([])
    const [organizeMemoProjects, setOrganizeMemoProjects] = useState<Record<string, string | null>>({})
    const [organizeError, setOrganizeError] = useState<string | null>(null)
    const [isLoadingOrganizeMemos, setIsLoadingOrganizeMemos] = useState(false)

    useEffect(() => {
        const getUser = async () => {
            const { data: { user } } = await supabase.auth.getUser()
            setUser(user)
        }
        getUser()
    }, [supabase])

    const handleLogout = async () => {
        await window.focusmapDesktop?.clearAuthSession?.().catch(() => undefined)
        await supabase.auth.signOut()
        router.refresh()
        router.push("/login")
    }

    const { activeView, setActiveView } = useView()
    const forceDesktopDashboard = useForceDesktopDashboard()
    const desktopFlexClass = forceDesktopDashboard ? "flex" : "hidden md:flex"
    const [isDesktopShell, setIsDesktopShell] = useState(false)

    useEffect(() => {
        setIsDesktopShell(isFocusmapDesktopShell())
    }, [])

    const desktopDragStyle = isDesktopShell ? ({ WebkitAppRegion: "drag" } as CSSProperties) : undefined
    const desktopNoDragStyle = isDesktopShell ? ({ WebkitAppRegion: "no-drag" } as CSSProperties) : undefined

    const handleLogoClick = () => {
        if (onLogoClick) {
            onLogoClick()
            return
        }
        try {
            window.localStorage.setItem("focusmap:today-sub-view", "memo")
        } catch {}
        setActiveView('today')
    }

    const handleOpenSettings = () => {
        setActiveView('settings')
    }

    const viewTabs: { id: DashboardView; label: string; icon: React.ReactNode }[] = [
        { id: 'today',     label: 'Todo', icon: <CalendarDays className="h-3.5 w-3.5" /> },
        { id: 'long-term', label: 'メモ',  icon: <Sparkles className="h-3.5 w-3.5" /> },
        { id: 'map',       label: 'マップ', icon: <Network className="h-3.5 w-3.5" /> },
        { id: 'ai',        label: 'チャット', icon: <MessageCircle className="h-3.5 w-3.5" /> },
    ]

    const handleOpenAiOrganize = async () => {
        if (!selectedProjectId) {
            setOrganizeError("プロジェクトを選択してください")
            return
        }
        setIsLoadingOrganizeMemos(true)
        setOrganizeError(null)
        try {
            const res = await fetch(`/api/wishlist?project_id=${encodeURIComponent(selectedProjectId)}`, { cache: "no-store" })
            const data = await res.json()
            if (!res.ok) throw new Error(data?.error || "メモの取得に失敗しました")
            const items = ((data.items || []) as Array<{
                id: string
                memo_status?: string | null
                is_completed?: boolean | null
                google_event_id?: string | null
                project_id?: string | null
            }>)
                .filter(item =>
                    !item.is_completed &&
                    !item.google_event_id &&
                    (item.memo_status ?? "unsorted") === "unsorted",
                )

            const ids = items.map(item => item.id)
            const projectMap: Record<string, string | null> = {}
            for (const item of items) {
                projectMap[item.id] = item.project_id ?? null
            }

            const slicedIds = ids.slice(0, 50)
            setOrganizeMemoIds(slicedIds)
            setOrganizeMemoProjects(
                Object.fromEntries(slicedIds.map(id => [id, projectMap[id] ?? null])),
            )
            setOrganizeDialogOpen(true)
        } catch (error) {
            setOrganizeError(error instanceof Error ? error.message : "メモの取得に失敗しました")
        } finally {
            setIsLoadingOrganizeMemos(false)
        }
    }

    return (
        <header
            className={cn(
            "relative h-14 border-b items-center justify-between px-4 bg-background z-50 flex-shrink-0",
            isDesktopShell && "h-[52px] border-white/10 bg-background/95 pl-[132px] pr-5 shadow-[0_1px_0_rgba(255,255,255,0.04)]",
            desktopFlexClass,
            forceDesktopDashboard && "min-w-[1120px]",
        )}
            style={desktopDragStyle}
        >
            {/* Left: Logo & current workspace */}
            <div
                className={cn(
                    "flex min-w-0 max-w-[440px] items-center gap-3",
                    isDesktopShell && "max-w-[460px] gap-4",
                )}
                style={desktopNoDragStyle}
            >
                {!isDesktopShell && (
                    <button
                        type="button"
                        onClick={handleLogoClick}
                        className="inline-flex min-h-11 items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label="Todayボードへ移動"
                        title="Today"
                    >
                        <FocusmapLogo className="h-9 w-auto text-foreground" />
                    </button>
                )}

                {onSelectSpace && onSelectProject && (
                    <>
                        {!isDesktopShell && <div className="h-6 w-px bg-border" />}
                        <SpaceProjectSwitcher
                            spaces={spaces}
                            projects={projects}
                            selectedSpaceId={selectedSpaceId}
                            selectedProjectId={selectedProjectId}
                            onSelectSpace={onSelectSpace}
                            onSelectProject={onSelectProject}
                            onProjectCreated={onProjectCreated}
                            onProjectSaved={onProjectSaved}
                            onProjectDeleted={onProjectDeleted}
                            onSpaceSaved={onSpaceSaved}
                            showAllProjectsOption={activeView === 'today' || activeView === 'long-term'}
                            className={cn(
                                "max-w-[280px] border-b-0 bg-transparent px-0 py-0",
                                isDesktopShell && "max-w-[360px]",
                            )}
                        />
                    </>
                )}
            </div>

            {/* Center: View Tabs */}
            <div
                className={cn("items-center gap-2 absolute left-1/2 -translate-x-1/2", desktopFlexClass)}
                style={desktopDragStyle}
            >
                <div className={cn(
                    "flex items-center gap-1 bg-muted/50 rounded-lg p-0.5",
                    isDesktopShell && "gap-1.5 rounded-xl bg-muted/45 p-1",
                )}
                    style={desktopDragStyle}
                >
                    {viewTabs.map(tab => (
                        <Button
                            key={tab.id}
                            variant={activeView === tab.id ? "secondary" : "ghost"}
                            size="sm"
                            className={cn(
                                "gap-1.5 h-7 px-2.5 text-xs font-medium transition-all",
                                isDesktopShell && "h-8 gap-2 px-3.5",
                                activeView === tab.id
                                    ? "bg-background shadow-sm"
                                    : "text-muted-foreground hover:text-foreground"
                            )}
                            onClick={() => setActiveView(tab.id)}
                            style={desktopNoDragStyle}
                        >
                            {tab.icon}
                            {tab.label}
                        </Button>
                    ))}
                </div>
                {activeView === 'map' && (
                    <Button
                        variant="ghost"
                        size="sm"
                        className={cn(
                            "gap-1.5 h-7 px-3 text-xs font-medium",
                            "text-muted-foreground hover:text-foreground"
                        )}
                        onClick={handleOpenAiOrganize}
                        disabled={isLoadingOrganizeMemos || !selectedProjectId}
                        style={desktopNoDragStyle}
                    >
                        <Sparkles className={cn("h-3.5 w-3.5", isLoadingOrganizeMemos && "animate-spin")} />
                        AIで整理
                    </Button>
                )}
            </div>

            {/* Right: User Profile & Settings */}
            <div
                className="flex items-center gap-2"
                style={desktopNoDragStyle}
            >
                {showMapSplitToggle && onToggleMapSplit && (
                    <Button
                        variant={isMapSplitVisible ? "secondary" : "ghost"}
                        size="icon"
                        className={cn(
                            "text-muted-foreground",
                            isMapSplitVisible && "bg-background text-primary shadow-sm border border-primary/30"
                        )}
                        onClick={onToggleMapSplit}
                        aria-pressed={isMapSplitVisible}
                        aria-label={isMapSplitVisible ? "マップ分割を閉じる" : "マップを分割表示"}
                        title={isMapSplitVisible ? "マップ分割を閉じる" : "マップを分割表示"}
                    >
                        <Network className="h-4 w-4" />
                    </Button>
                )}
                {showCalendarSplitToggle && onToggleCalendarSplit && (
                    <Button
                        variant={isCalendarSplitVisible ? "secondary" : "ghost"}
                        size="icon"
                        className={cn(
                            "text-muted-foreground",
                            isCalendarSplitVisible && "bg-background text-primary shadow-sm border border-primary/30"
                        )}
                        onClick={onToggleCalendarSplit}
                        aria-pressed={isCalendarSplitVisible}
                        aria-label={isCalendarSplitVisible ? "カレンダーを閉じる" : "カレンダーを表示"}
                        title={isCalendarSplitVisible ? "カレンダーを閉じる" : "カレンダーを表示"}
                    >
                        <CalendarDays className="h-4 w-4" />
                    </Button>
                )}
                {showMemoSplitToggle && onToggleMemoSplit && (
                    <Button
                        variant={isMemoSplitVisible ? "secondary" : "ghost"}
                        size="icon"
                        className={cn(
                            "text-muted-foreground",
                            isMemoSplitVisible && "bg-background text-primary shadow-sm border border-primary/30"
                        )}
                        onClick={onToggleMemoSplit}
                        aria-pressed={isMemoSplitVisible}
                        aria-label={isMemoSplitVisible ? "メモ分割を閉じる" : "メモを分割表示"}
                        title={isMemoSplitVisible ? "メモ分割を閉じる" : "メモを分割表示"}
                    >
                        <StickyNote className="h-4 w-4" />
                    </Button>
                )}
                <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground"
                    title="Settings"
                    onClick={handleOpenSettings}
                >
                    <Settings className="h-4 w-4" />
                </Button>

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="relative h-8 w-8 rounded-full">
                            <Avatar className="h-8 w-8">
                                <AvatarImage src={user?.user_metadata?.avatar_url} alt={user?.email} />
                                <AvatarFallback>
                                    {user?.email?.charAt(0).toUpperCase() || "U"}
                                </AvatarFallback>
                            </Avatar>
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-56" align="end" forceMount>
                        <DropdownMenuLabel className="font-normal">
                            <div className="flex flex-col space-y-1">
                                <p className="text-sm font-medium leading-none">{user?.user_metadata?.full_name || "User"}</p>
                                <p className="text-xs leading-none text-muted-foreground">
                                    {user?.email}
                                </p>
                            </div>
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={handleOpenSettings}>
                            <UserIcon className="mr-2 h-4 w-4" />
                            <span>Profile</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={handleOpenSettings}>
                            <Settings className="mr-2 h-4 w-4" />
                            <span>Settings</span>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={handleLogout}>
                            <LogOut className="mr-2 h-4 w-4" />
                            <span>Log out</span>
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>

            {organizeError && (
                <div className="fixed left-1/2 top-16 z-[80] -translate-x-1/2 rounded-md border bg-background px-3 py-2 text-sm shadow-lg">
                    <span className="text-muted-foreground">{organizeError}</span>
                    <button
                        type="button"
                        className="ml-3 text-xs text-primary hover:underline"
                        onClick={() => setOrganizeError(null)}
                    >
                        閉じる
                    </button>
                </div>
            )}

            <MemoToMindmapDialog
                open={organizeDialogOpen}
                noteIds={organizeMemoIds}
                noteProjects={organizeMemoProjects}
                source="wishlist"
                projects={projects.map(p => ({ id: p.id, title: p.title }))}
                spaces={spaces.map(s => ({ id: s.id, title: s.title }))}
                defaultSpaceId={selectedSpaceId}
                defaultProjectId={selectedProjectId}
                onClose={() => setOrganizeDialogOpen(false)}
                onSuccess={() => {
                    setOrganizeDialogOpen(false)
                    setOrganizeMemoIds([])
                    onMindmapUpdated?.()
                }}
                allowTextImport
            />
        </header>
    )
}
