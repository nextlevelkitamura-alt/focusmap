import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agent-auth'
import { isTursoConfigured } from '@/lib/turso/client'
import { upsertRunnerHeartbeat } from '@/lib/turso/codex-monitoring'

const VALID_EXECUTORS = new Set(['playwright', 'simple', 'browser', 'terminal', 'codex_app'])

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map(v => String(v).trim()).filter(Boolean)
    : []
}

export async function POST(request: NextRequest) {
  try {
    const { supabase, token } = await authenticateAgent(request)
    const body = await request.json().catch(() => ({}))
    const hostname = typeof body.hostname === 'string' && body.hostname.trim()
      ? body.hostname.trim()
      : 'focusmap-lite-mac'
    const executors = stringArray(body.executors).filter(executor => VALID_EXECUTORS.has(executor))
    const metadata = body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
      ? body.metadata as Record<string, unknown>
      : {}

    const { data: runner, error } = await supabase
      .from('ai_runners')
      .upsert({
        user_id: token.user_id,
        hostname,
        display_name: typeof body.display_name === 'string' && body.display_name.trim()
          ? body.display_name.trim()
          : `${hostname} (Focusmap Lite)`,
        executors: executors.length ? executors : ['playwright', 'simple', 'browser', 'terminal'],
        available_repo_keys: stringArray(body.available_repo_keys),
        available_secret_names: stringArray(body.available_secret_names),
        repo_paths: body.repo_paths && typeof body.repo_paths === 'object' && !Array.isArray(body.repo_paths)
          ? body.repo_paths
          : {},
        metadata: {
          ...metadata,
          app: 'focusmap-lite',
          token_id: token.id,
          install_method: metadata.install_method ?? 'curl',
          last_agent_api_heartbeat_at: new Date().toISOString(),
        },
        last_heartbeat_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,hostname' })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    if (isTursoConfigured()) {
      try {
        await upsertRunnerHeartbeat({
          runner_id: runner.id,
          user_id: token.user_id,
          device_id: hostname,
          status: 'online',
          version: typeof metadata.version === 'string' ? metadata.version : null,
          metadata_json: {
            ...metadata,
            executors: executors.length ? executors : ['playwright', 'simple', 'browser', 'terminal'],
          },
        })
      } catch (tursoError) {
        console.error('[agents/heartbeat turso]', tursoError)
      }
    }

    if (token.space_id) {
      await supabase
        .from('ai_runner_spaces')
        .upsert({ runner_id: runner.id, space_id: token.space_id, enabled: true }, { onConflict: 'runner_id,space_id' })
    }

    return NextResponse.json({ runner })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'agent authentication failed' },
      { status: 401 },
    )
  }
}
