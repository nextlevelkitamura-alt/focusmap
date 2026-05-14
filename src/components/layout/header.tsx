"use client"

import { useState, useEffect, useRef } from "react"
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
import { ChevronDown, LogOut, Settings, User as UserIcon, Layers, Plus, Pencil, Trash2, Check, Network, Target, ListTodo, Star, CalendarDays, Sparkles } from "lucide-react"
import { Space } from "@/types/database"
import { useView, DashboardView } from "@/contexts/ViewContext"
import { cn } from "@/lib/utils"
import { FocusmapLogo } from "@/components/ui/focusmap-logo"
import { DEFAULT_SPACE_COLOR, normalizeColor } from "@/lib/color-utils"

const ALL_SPACE_PREFS_KEY = "focusmap:allSpacePrefs"
const ALL_SPACE_RENAME_ID = "__all__"

interface HeaderProps {
    spaces?: Space[]
    selectedSpaceId?: string | null
    onSelectSpace?: (id: string | null) => void
    onCreateSpace?: (title: string, color?: string) => Promise<Space | null>
    onUpdateSpace?: (spaceId: string, updates: Partial<Space>) => Promise<void>
    onDeleteSpace?: (spaceId: string) => Promise<void>
    showTaskListToggle?: boolean
    isTaskListVisible?: boolean
    onToggleTaskList?: () => void
    showCalendarSplitToggle?: boolean
    isCalendarSplitVisible?: boolean
    onToggleCalendarSplit?: () => void
}

export function Header({
    spaces = [],
    selectedSpaceId = null,
    onSelectSpace,
    onCreateSpace,
    onUpdateSpace,
    onDeleteSpace,
    showTaskListToggle = false,
    isTaskListVisible = false,
    onToggleTaskList,
    showCalendarSplitToggle = false,
    isCalendarSplitVisible = false,
    onToggleCalendarSplit,
}: HeaderProps) {
    const router = useRouter()
    const [user, setUser] = useState<User | null>(null)
    const [supabase] = useState(() => createClient())

    // Space create/rename state
    const [isCreatingSpace, setIsCreatingSpace] = useState(false)
    const [newSpaceTitle, setNewSpaceTitle] = useState("")
    const [newSpaceColor, setNewSpaceColor] = useState(DEFAULT_SPACE_COLOR)
    const [renamingSpaceId, setRenamingSpaceId] = useState<string | null>(null)
    const [renameTitle, setRenameTitle] = useState("")
    const [renameColor, setRenameColor] = useState(DEFAULT_SPACE_COLOR)
    const [allSpacePrefs, setAllSpacePrefs] = useState(() => {
        if (typeof window === "undefined") return { title: "全体", color: DEFAULT_SPACE_COLOR }
        try {
            const raw = window.localStorage.getItem(ALL_SPACE_PREFS_KEY)
            const parsed = raw ? JSON.parse(raw) as { title?: string; color?: string } : null
            return {
                title: parsed?.title?.trim() || "全体",
                color: normalizeColor(parsed?.color, DEFAULT_SPACE_COLOR),
            }
        } catch {
            return { title: "全体", color: DEFAULT_SPACE_COLOR }
        }
    })
    const createInputRef = useRef<HTMLInputElement>(null)
    const renameInputRef = useRef<HTMLInputElement>(null)
    const [dropdownOpen, setDropdownOpen] = useState(false)

    useEffect(() => {
        const getUser = async () => {
            const { data: { user } } = await supabase.auth.getUser()
            setUser(user)
        }
        getUser()
    }, [supabase])

    useEffect(() => {
        if (isCreatingSpace && createInputRef.current) {
            createInputRef.current.focus()
        }
    }, [isCreatingSpace])

    useEffect(() => {
        if (renamingSpaceId && renameInputRef.current) {
            renameInputRef.current.focus()
            renameInputRef.current.select()
        }
    }, [renamingSpaceId])

    const handleLogout = async () => {
        await supabase.auth.signOut()
        router.refresh()
        router.push("/login")
    }

    const handleCreateSubmit = async () => {
        if (!newSpaceTitle.trim() || !onCreateSpace) return
        await onCreateSpace(newSpaceTitle.trim(), normalizeColor(newSpaceColor, DEFAULT_SPACE_COLOR))
        setNewSpaceTitle("")
        setNewSpaceColor(DEFAULT_SPACE_COLOR)
        setIsCreatingSpace(false)
    }

    const handleRenameSubmit = async () => {
        if (!renameTitle.trim() || !renamingSpaceId) return
        const color = normalizeColor(renameColor, DEFAULT_SPACE_COLOR)
        if (renamingSpaceId === ALL_SPACE_RENAME_ID) {
            const next = { title: renameTitle.trim(), color }
            setAllSpacePrefs(next)
            window.localStorage.setItem(ALL_SPACE_PREFS_KEY, JSON.stringify(next))
        } else if (onUpdateSpace) {
            await onUpdateSpace(renamingSpaceId, { title: renameTitle.trim(), color })
        }
        setRenamingSpaceId(null)
        setRenameTitle("")
        setRenameColor(DEFAULT_SPACE_COLOR)
    }

    const { activeView, setActiveView } = useView()

    const selectedSpace = spaces.find(s => s.id === selectedSpaceId)
    const displayName = selectedSpaceId === null ? allSpacePrefs.title : (selectedSpace?.title || "Space")
    const displayColor = selectedSpaceId === null
        ? allSpacePrefs.color
        : normalizeColor(selectedSpace?.color, DEFAULT_SPACE_COLOR)

    const viewTabs: { id: DashboardView; label: string; icon: React.ReactNode }[] = [
        { id: 'today',     label: 'Today', icon: <CalendarDays className="h-3.5 w-3.5" /> },
        { id: 'long-term', label: 'メモ',  icon: <Sparkles className="h-3.5 w-3.5" /> },
        { id: 'map',       label: 'マップ', icon: <Network className="h-3.5 w-3.5" /> },
        { id: 'habits',    label: '習慣',   icon: <Target className="h-3.5 w-3.5" /> },
        { id: 'ideal',     label: '理想',   icon: <Star className="h-3.5 w-3.5" /> },
    ]

    return (
        <header className="h-14 border-b hidden md:flex items-center justify-between px-4 bg-background z-50 flex-shrink-0">
            {/* Left: Logo & Space Switcher */}
            <div className="flex items-center gap-4">
                <FocusmapLogo className="h-9 w-auto text-foreground" />

                <div className="h-6 w-px bg-border mx-2" />

                <DropdownMenu open={dropdownOpen} onOpenChange={(open) => {
                    setDropdownOpen(open)
                    if (!open) {
                        setIsCreatingSpace(false)
                        setNewSpaceTitle("")
                        setNewSpaceColor(DEFAULT_SPACE_COLOR)
                        setRenamingSpaceId(null)
                        setRenameTitle("")
                        setRenameColor(DEFAULT_SPACE_COLOR)
                    }
                }}>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="gap-2 font-normal">
                            {selectedSpaceId === null && <Layers className="h-3.5 w-3.5 text-muted-foreground" />}
                            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: displayColor }} />
                            {displayName}
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-[220px]">
                        <DropdownMenuLabel>Spaces</DropdownMenuLabel>
                        <DropdownMenuSeparator />

                        {/* 全体 option */}
                        {renamingSpaceId === ALL_SPACE_RENAME_ID ? (
                            <div className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                                <div className="flex items-center gap-2">
                                    <input
                                        ref={renameInputRef}
                                        value={renameTitle}
                                        onChange={(e) => setRenameTitle(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') handleRenameSubmit()
                                            if (e.key === 'Escape') { setRenamingSpaceId(null); setRenameTitle(""); setRenameColor(DEFAULT_SPACE_COLOR) }
                                        }}
                                        className="min-w-0 flex-1 text-sm bg-muted/50 border rounded px-2 py-1 outline-none focus:ring-1 focus:ring-primary"
                                    />
                                    <input
                                        type="color"
                                        value={renameColor}
                                        onChange={(e) => setRenameColor(e.target.value)}
                                        className="h-8 w-9 cursor-pointer rounded border bg-transparent p-0.5"
                                        aria-label="全体の色"
                                    />
                                    <button
                                        className="h-8 w-8 flex items-center justify-center rounded hover:bg-muted text-muted-foreground"
                                        onClick={handleRenameSubmit}
                                    >
                                        <Check className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="group flex items-center">
                                <DropdownMenuItem
                                    onClick={() => onSelectSpace?.(null)}
                                    className="flex-1 gap-2"
                                >
                                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: allSpacePrefs.color }} />
                                    <Layers className="h-3.5 w-3.5" />
                                    {allSpacePrefs.title}
                                    {selectedSpaceId === null && <Check className="h-3.5 w-3.5 ml-auto" />}
                                </DropdownMenuItem>
                                <button
                                    className="mr-2 h-5 w-5 flex items-center justify-center rounded hover:bg-muted text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        setRenamingSpaceId(ALL_SPACE_RENAME_ID)
                                        setRenameTitle(allSpacePrefs.title)
                                        setRenameColor(allSpacePrefs.color)
                                    }}
                                >
                                    <Pencil className="h-3 w-3" />
                                </button>
                            </div>
                        )}

                        <DropdownMenuSeparator />

                        {/* Space list */}
                        {spaces.map(space => (
                            renamingSpaceId === space.id ? (
                                <div key={space.id} className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                                    <div className="flex items-center gap-2">
                                        <input
                                            ref={renameInputRef}
                                            value={renameTitle}
                                            onChange={(e) => setRenameTitle(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') handleRenameSubmit()
                                                if (e.key === 'Escape') { setRenamingSpaceId(null); setRenameTitle(""); setRenameColor(DEFAULT_SPACE_COLOR) }
                                            }}
                                            className="min-w-0 flex-1 text-sm bg-muted/50 border rounded px-2 py-1 outline-none focus:ring-1 focus:ring-primary"
                                        />
                                        <input
                                            type="color"
                                            value={renameColor}
                                            onChange={(e) => setRenameColor(e.target.value)}
                                            className="h-8 w-9 cursor-pointer rounded border bg-transparent p-0.5"
                                            aria-label={`${space.title}の色`}
                                        />
                                        <button
                                            className="h-8 w-8 flex items-center justify-center rounded hover:bg-muted text-muted-foreground"
                                            onClick={handleRenameSubmit}
                                        >
                                            <Check className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div key={space.id} className="group flex items-center">
                                    <DropdownMenuItem
                                        onClick={() => onSelectSpace?.(space.id)}
                                        className="flex-1 gap-2"
                                    >
                                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: normalizeColor(space.color, DEFAULT_SPACE_COLOR) }} />
                                        {space.title}
                                        {selectedSpaceId === space.id && <Check className="h-3.5 w-3.5 ml-auto" />}
                                    </DropdownMenuItem>
                                    <div className="flex items-center gap-0.5 pr-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button
                                            className="h-5 w-5 flex items-center justify-center rounded hover:bg-muted text-muted-foreground"
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                setRenamingSpaceId(space.id)
                                                setRenameTitle(space.title)
                                                setRenameColor(normalizeColor(space.color, DEFAULT_SPACE_COLOR))
                                            }}
                                        >
                                            <Pencil className="h-3 w-3" />
                                        </button>
                                        <button
                                            className="h-5 w-5 flex items-center justify-center rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                if (window.confirm(`スペース「${space.title}」を削除しますか？\n配下のプロジェクト・タスクも全て削除されます。`)) {
                                                    onDeleteSpace?.(space.id)
                                                }
                                            }}
                                        >
                                            <Trash2 className="h-3 w-3" />
                                        </button>
                                    </div>
                                </div>
                            )
                        ))}

                        <DropdownMenuSeparator />

                        {/* Create Space */}
                        {isCreatingSpace ? (
                            <div className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                                <div className="flex items-center gap-2">
                                    <input
                                        ref={createInputRef}
                                        value={newSpaceTitle}
                                        onChange={(e) => setNewSpaceTitle(e.target.value)}
                                        placeholder="スペース名..."
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') handleCreateSubmit()
                                            if (e.key === 'Escape') { setIsCreatingSpace(false); setNewSpaceTitle(""); setNewSpaceColor(DEFAULT_SPACE_COLOR) }
                                        }}
                                        className="min-w-0 flex-1 text-sm bg-muted/50 border rounded px-2 py-1 outline-none focus:ring-1 focus:ring-primary"
                                    />
                                    <input
                                        type="color"
                                        value={newSpaceColor}
                                        onChange={(e) => setNewSpaceColor(e.target.value)}
                                        className="h-8 w-9 cursor-pointer rounded border bg-transparent p-0.5"
                                        aria-label="新しいスペースの色"
                                    />
                                    <button
                                        className="h-8 w-8 flex items-center justify-center rounded hover:bg-muted text-muted-foreground"
                                        onClick={handleCreateSubmit}
                                    >
                                        <Check className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <DropdownMenuItem onClick={(e) => {
                                e.preventDefault()
                                setIsCreatingSpace(true)
                            }}>
                                <Plus className="h-3.5 w-3.5 mr-2" />
                                スペースを追加
                            </DropdownMenuItem>
                        )}
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>

            {/* Center: View Tabs */}
            <div className="hidden md:flex items-center gap-2 absolute left-1/2 -translate-x-1/2">
                <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-0.5">
                    {viewTabs.map(tab => (
                        <Button
                            key={tab.id}
                            variant={activeView === tab.id ? "secondary" : "ghost"}
                            size="sm"
                            className={cn(
                                "gap-1.5 h-7 px-3 text-xs font-medium transition-all",
                                activeView === tab.id
                                    ? "bg-background shadow-sm"
                                    : "text-muted-foreground hover:text-foreground"
                            )}
                            onClick={() => setActiveView(tab.id)}
                        >
                            {tab.icon}
                            {tab.label}
                        </Button>
                    ))}
                </div>
                {showTaskListToggle && activeView === 'map' && (
                    <Button
                        variant={isTaskListVisible ? "secondary" : "ghost"}
                        size="sm"
                        className={cn(
                            "gap-1.5 h-7 px-3 text-xs font-medium",
                            isTaskListVisible
                                ? "bg-background shadow-sm border"
                                : "text-muted-foreground hover:text-foreground"
                        )}
                        onClick={onToggleTaskList}
                    >
                        <ListTodo className="h-3.5 w-3.5" />
                        タスク一覧
                    </Button>
                )}
            </div>

            {/* Right: User Profile & Settings */}
            <div className="flex items-center gap-2">
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
                <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground"
                    title="Settings"
                    onClick={() => router.push('/dashboard/settings')}
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
                        <DropdownMenuItem onClick={() => router.push('/dashboard/settings')}>
                            <UserIcon className="mr-2 h-4 w-4" />
                            <span>Profile</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => router.push('/dashboard/settings')}>
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
        </header>
    )
}
