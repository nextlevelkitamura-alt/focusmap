"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/utils/supabase/client"
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
import { ChevronDown, LogOut, Settings, User } from "lucide-react"

export function Header() {
    const router = useRouter()
    const [user, setUser] = useState<any>(null)
    const [supabase] = useState(() => createClient())

    useEffect(() => {
        const getUser = async () => {
            const { data: { user } } = await supabase.auth.getUser()
            setUser(user)
        }
        getUser()
    }, [supabase])

    const handleLogout = async () => {
        await supabase.auth.signOut()
        router.refresh()
        router.push("/login")
    }

    const [activeTab, setActiveTab] = useState("dashboard")

    return (
        <header className="h-14 border-b flex items-center justify-between px-4 bg-background z-50">
            {/* Left: Logo & Space Switcher */}
            <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary font-bold">
                        S
                    </div>
                    <span className="font-semibold text-lg hidden md:block">Shikumika .app</span>
                </div>

                <div className="h-6 w-px bg-border mx-2" />

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="gap-2 font-normal">
                            株式会社ネクストレベル
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-[200px]">
                        <DropdownMenuLabel>Spaces</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem>株式会社ネクストレベル</DropdownMenuItem>
                        <DropdownMenuItem>Private</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem>+ Create Space</DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>

            {/* Center: Navigation (Moved from MiniSidebar) */}
            <div className="hidden md:flex items-center gap-1 absolute left-1/2 -translate-x-1/2">
                <Button
                    variant={activeTab === 'dashboard' ? 'secondary' : 'ghost'}
                    size="sm"
                    className="gap-2"
                    onClick={() => setActiveTab('dashboard')}
                >
                    Dashboard
                </Button>
                <Button
                    variant={activeTab === 'goals' ? 'secondary' : 'ghost'}
                    size="sm"
                    className="gap-2 text-muted-foreground hover:text-foreground"
                    onClick={() => setActiveTab('goals')}
                >
                    Goals
                </Button>
                <Button
                    variant={activeTab === 'documents' ? 'secondary' : 'ghost'}
                    size="sm"
                    className="gap-2 text-muted-foreground hover:text-foreground"
                    onClick={() => setActiveTab('documents')}
                >
                    Documents
                </Button>
            </div>

            {/* Right: User Profile & Settings */}
            <div className="flex items-center gap-2">
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
                            <User className="mr-2 h-4 w-4" />
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
