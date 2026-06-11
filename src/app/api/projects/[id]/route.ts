import { createClient } from "@/utils/supabase/server"
import { resolveProjectRepoPath } from "@/lib/project-repo-path"
import { NextResponse } from "next/server"

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value)
}

function hasOwn(record: Record<string, unknown>, key: string) {
    return Object.prototype.hasOwnProperty.call(record, key)
}

async function currentProjectRepoPath(
    supabase: Awaited<ReturnType<typeof createClient>>,
    userId: string,
    projectId: string,
) {
    const { data, error } = await supabase
        .from("projects")
        .select("repo_path")
        .eq("id", projectId)
        .eq("user_id", userId)
        .maybeSingle()
    if (error) throw error
    const repoPath = typeof data?.repo_path === "string" ? data.repo_path.trim() : ""
    return repoPath || null
}

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
        }

        const { id } = await params
        const body = await request.json()
        const updates = isRecord(body) ? { ...body } : {}
        let repoPathFromBody: string | null | undefined

        if (hasOwn(updates, "repo_path")) {
            const resolvedRepo = await resolveProjectRepoPath(supabase, user.id, updates.repo_path)
            if (resolvedRepo.error) {
                return NextResponse.json({ error: resolvedRepo.error }, { status: 400 })
            }
            updates.repo_path = resolvedRepo.repoPath
            repoPathFromBody = resolvedRepo.repoPath
        }

        if (hasOwn(updates, "codex_thread_import_enabled")) {
            const enabled = updates.codex_thread_import_enabled === true
            updates.codex_thread_import_enabled = enabled

            if (enabled) {
                const repoPath = repoPathFromBody !== undefined
                    ? repoPathFromBody
                    : await currentProjectRepoPath(supabase, user.id, id)
                if (!repoPath) {
                    return NextResponse.json(
                        { error: "repo_path is required before enabling Codex thread import" },
                        { status: 400 },
                    )
                }
                updates.codex_thread_import_enabled_since = new Date().toISOString()
            } else {
                updates.codex_thread_import_enabled_since = null
            }
        } else if (repoPathFromBody !== undefined) {
            const currentRepoPath = await currentProjectRepoPath(supabase, user.id, id)
            if (currentRepoPath !== repoPathFromBody) {
                updates.codex_thread_import_enabled = false
                updates.codex_thread_import_enabled_since = null
            }
        }

        const { data, error } = await supabase
            .from("projects")
            .update(updates)
            .eq("id", id)
            .eq("user_id", user.id)
            .select()
            .single()

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        return NextResponse.json(data)
    } catch (error) {
        console.error("[API] PATCH /api/projects/[id] error:", error)
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        )
    }
}

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
        }

        const { id } = await params

        const { error } = await supabase
            .from("projects")
            .delete()
            .eq("id", id)
            .eq("user_id", user.id)

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error("[API] DELETE /api/projects/[id] error:", error)
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        )
    }
}
