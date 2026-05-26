import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { hashAgentToken } from '@/lib/agent-auth';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';

/**
 * POST /api/agents/token
 *
 * Body: { space_id: string }
 * Returns: { token: string, install_command: string }
 *
 * agent_token は一度だけ表示し、DBには SHA-256 hash のみ保存する。
 * Focusmap Lite / focusmap-agent はこの token だけで agent API を呼び、
 * service role key はユーザーのMacへ置かない。
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const spaceId: string | undefined = body.space_id;
  if (!spaceId) {
    return NextResponse.json({ error: 'space_id is required' }, { status: 400 });
  }

  // Space オーナー or Admin チェック
  const { data: canEdit } = await supabase.rpc('can_edit_space', {
    p_space_id: spaceId,
    p_user_id: user.id,
  });
  if (!canEdit) {
    return NextResponse.json(
      { error: 'Only workspace owner/admin can issue agent tokens' },
      { status: 403 },
    );
  }

  const rawToken = `fma_${randomBytes(32).toString('base64url')}`;
  const service = createServiceClient();
  const { error: insertError } = await service.from('agent_tokens').insert({
    user_id: user.id,
    space_id: spaceId,
    token_hash: hashAgentToken(rawToken),
    name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'Focusmap Lite',
  });

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  const origin = req.headers.get('origin') ?? 'https://focusmap-official.com';
  const installCommand = `curl -sSL ${origin}/install.sh | sh -s -- ${rawToken}`;

  return NextResponse.json({
    token: rawToken,
    install_command: installCommand,
    user_id: user.id,
    space_id: spaceId,
    expires_at: null,
    note: 'このトークンは一度だけ表示され、Macの config.json に保存されます。紛失時は再発行してください。',
  });
}
