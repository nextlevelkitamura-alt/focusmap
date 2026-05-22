type SupabaseLike = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any
}

export type SpaceRole = 'owner' | 'editor' | 'commenter' | 'viewer'
export type RunVisibility = 'private' | 'space'

export const SPACE_ROLES: SpaceRole[] = ['owner', 'editor', 'commenter', 'viewer']

export function isSpaceRole(value: unknown): value is SpaceRole {
  return typeof value === 'string' && SPACE_ROLES.includes(value as SpaceRole)
}

export function normalizeSpaceRole(value: unknown, fallback: SpaceRole = 'viewer'): SpaceRole {
  return isSpaceRole(value) ? value : fallback
}

export function canEditRole(role: SpaceRole | null) {
  return role === 'owner' || role === 'editor'
}

export function canOwnRole(role: SpaceRole | null) {
  return role === 'owner'
}

export function normalizeVisibility(value: unknown, fallback: RunVisibility = 'private'): RunVisibility {
  return value === 'space' || value === 'private' ? value : fallback
}

export async function getSpaceRole(
  supabase: SupabaseLike,
  userId: string,
  spaceId: string | null | undefined,
): Promise<SpaceRole | null> {
  if (!spaceId) return null

  const { data: space } = await supabase
    .from('spaces')
    .select('user_id')
    .eq('id', spaceId)
    .maybeSingle()

  if (space?.user_id === userId) return 'owner'

  const { data: member } = await supabase
    .from('space_members')
    .select('role')
    .eq('space_id', spaceId)
    .eq('user_id', userId)
    .maybeSingle()

  return isSpaceRole(member?.role) ? member.role : null
}

export async function canViewSpace(supabase: SupabaseLike, userId: string, spaceId: string | null | undefined) {
  return !!(await getSpaceRole(supabase, userId, spaceId))
}

export async function canEditSpace(supabase: SupabaseLike, userId: string, spaceId: string | null | undefined) {
  return canEditRole(await getSpaceRole(supabase, userId, spaceId))
}

export async function canOwnSpace(supabase: SupabaseLike, userId: string, spaceId: string | null | undefined) {
  return canOwnRole(await getSpaceRole(supabase, userId, spaceId))
}

async function getProjectSpaceId(
  supabase: SupabaseLike,
  projectId: string | null | undefined,
): Promise<string | null> {
  if (!projectId) return null
  const { data } = await supabase
    .from('projects')
    .select('space_id')
    .eq('id', projectId)
    .maybeSingle()
  return typeof data?.space_id === 'string' ? data.space_id : null
}

export async function resolveAiTaskSpaceId(
  supabase: SupabaseLike,
  userId: string,
  input: {
    space_id?: string | null
    source_ideal_goal_id?: string | null
    source_note_id?: string | null
    parent_task_id?: string | null
    project_id?: string | null
    fallback_space_id?: string | null
  },
): Promise<{ spaceId: string | null; error?: string }> {
  const explicit = input.space_id ?? null
  if (explicit) {
    if (!(await canEditSpace(supabase, userId, explicit))) {
      return { spaceId: null, error: 'No edit access to the selected space' }
    }
    return { spaceId: explicit }
  }

  if (input.source_ideal_goal_id) {
    const { data } = await supabase
      .from('ideal_goals')
      .select('project_id')
      .eq('id', input.source_ideal_goal_id)
      .maybeSingle()
    const spaceId = await getProjectSpaceId(supabase, data?.project_id)
    if (spaceId && !(await canEditSpace(supabase, userId, spaceId))) {
      return { spaceId: null, error: 'No edit access to the memo space' }
    }
    if (spaceId) return { spaceId }
  }

  if (input.source_note_id) {
    const { data } = await supabase
      .from('notes')
      .select('project_id')
      .eq('id', input.source_note_id)
      .maybeSingle()
    const spaceId = await getProjectSpaceId(supabase, data?.project_id)
    if (spaceId && !(await canEditSpace(supabase, userId, spaceId))) {
      return { spaceId: null, error: 'No edit access to the note space' }
    }
    if (spaceId) return { spaceId }
  }

  if (input.project_id) {
    const spaceId = await getProjectSpaceId(supabase, input.project_id)
    if (spaceId && !(await canEditSpace(supabase, userId, spaceId))) {
      return { spaceId: null, error: 'No edit access to the project space' }
    }
    if (spaceId) return { spaceId }
  }

  if (input.parent_task_id) {
    const { data } = await supabase
      .from('ai_tasks')
      .select('user_id, space_id, run_visibility')
      .eq('id', input.parent_task_id)
      .maybeSingle()
    if (data?.user_id && data.user_id !== userId && data.run_visibility !== 'space') {
      return { spaceId: null, error: 'No access to the parent task' }
    }
    if (data?.space_id) {
      if (!(await canEditSpace(supabase, userId, data.space_id))) {
        return { spaceId: null, error: 'No edit access to the parent task space' }
      }
      return { spaceId: data.space_id }
    }
    if (data?.user_id && data.user_id !== userId) {
      return { spaceId: null, error: 'No access to the parent task' }
    }
  }

  if (input.fallback_space_id) {
    if (!(await canEditSpace(supabase, userId, input.fallback_space_id))) {
      return { spaceId: null, error: 'No edit access to the selected space' }
    }
    return { spaceId: input.fallback_space_id }
  }

  return { spaceId: null }
}

export function renderPackagePrompt(template: string, inputs: Record<string, unknown>) {
  return template.replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (_match, key: string) => {
    const value = inputs[key]
    if (value === undefined || value === null) return ''
    if (typeof value === 'string') return value
    return JSON.stringify(value)
  }).trim()
}
