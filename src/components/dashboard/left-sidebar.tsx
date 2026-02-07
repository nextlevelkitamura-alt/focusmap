"use client"

import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Database, Project } from "@/types/database"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { MoreHorizontal, Plus, GripVertical } from "lucide-react"
import { cn } from "@/lib/utils"

type Goal = Database['public']['Tables']['goals']['Row']

interface LeftSidebarProps {
    goals: Goal[]
    selectedGoalId: string | null
    onSelectGoal: (id: string) => void
    projects: Project[]
    selectedProjectId: string | null
    onSelectProject: (id: string) => void
}

export function LeftSidebar({
    goals,
    selectedGoalId,
    onSelectGoal,
    projects,
    selectedProjectId,
    onSelectProject
}: LeftSidebarProps) {

    // Helper to filter projects by status
    // Note: Database might store 'active', 'completed', 'on_hold'. 
    // We map them to user's desired sections: Active(active), Concept(concept/on_hold), Archive(archived/completed)
    const activeProjects = projects.filter(p => p.status === 'active')
    const conceptProjects = projects.filter(p => p.status === 'concept' || p.status === 'on_hold')
    const archiveProjects = projects.filter(p => p.status === 'completed' || p.status === 'archived')

    const ProjectCard = ({ project }: { project: Project }) => {
        const isSelected = selectedProjectId === project.id

        let statusColor = "bg-green-500" // default active
        if (project.status === 'concept' || project.status === 'on_hold') statusColor = "bg-blue-500"
        if (project.status === 'completed' || project.status === 'archived') statusColor = "bg-gray-500"

        // Override based on priority for "Active" if desired, or stick to status color?
        // Mockup shows red/blue dots. Let's use priority if active.
        if (project.status === 'active') {
            if (project.priority >= 4) statusColor = "bg-red-500"
            else if (project.priority === 3) statusColor = "bg-green-500"
        }

        return (
            <div
                onClick={() => onSelectProject(project.id)}
                className={cn(
                    "group relative p-3 rounded-lg border transition-all cursor-pointer hover:bg-muted/50",
                    isSelected ? "bg-muted/60 border-primary/50 shadow-sm" : "bg-card border-border/50 hover:border-border",
                    "flex flex-col gap-2"
                )}
            >
                {/* Drag Handle (Visual only for now) */}
                <div className="absolute left-1 top-1/2 -translate-y-1/2 text-muted-foreground/30 opacity-0 group-hover:opacity-100 cursor-grab">
                    <GripVertical className="w-4 h-4" />
                </div>

                <div className="flex items-center justify-between pl-4">
                    <div className="flex items-center gap-2">
                        <div className={cn("w-2 h-2 rounded-full flex-shrink-0", statusColor)} />
                        <span className="text-sm font-medium leading-none truncate max-w-[140px]">
                            {project.title}
                        </span>
                    </div>
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                        <MoreHorizontal className="w-4 h-4" />
                    </Button>
                </div>

                <div className="flex items-center gap-2 pl-6 text-xs text-muted-foreground">
                    <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30" />
                    <span>ステータス</span>
                </div>
            </div>
        )
    }

    const Section = ({ title, items, onAdd }: { title: string, items: Project[], onAdd?: () => void }) => (
        <div className="space-y-2">
            <div className="flex items-center justify-between px-1">
                <h3 className="text-xs font-semibold text-muted-foreground">{title}</h3>
                <Button variant="ghost" size="icon" className="h-5 w-5 text-muted-foreground hover:text-foreground">
                    <Plus className="w-3 h-3" />
                </Button>
            </div>
            <div className="space-y-2">
                {items.map(p => <ProjectCard key={p.id} project={p} />)}
                {items.length === 0 && (
                    <div className="text-[10px] text-muted-foreground/50 px-2 italic">No projects</div>
                )}
            </div>
        </div>
    )

    return (
        <div className="flex flex-col h-full bg-muted/10 border-r">
            <div className="p-4 border-b">
                <h2 className="font-semibold text-sm">プロジェクト管理</h2>
            </div>

            <ScrollArea className="flex-1">
                <div className="p-4 space-y-6">
                    <Section title="実行 (Active)" items={activeProjects} />
                    <Section title="構想 (Concept)" items={conceptProjects} />
                    <Section title="アーカイブ (Archive)" items={archiveProjects} />
                </div>
            </ScrollArea>
        </div>
    )
}
