import { NextRequest, NextResponse } from 'next/server';
import { createHmac } from 'node:crypto';
import { createClient } from '@/utils/supabase/server';

/**
 * POST /api/agents/token
 *
 * Body: { space_id: string }
 * Returns: { token: string, install_command: string }
 *
 * agent_token は HMAC(user_id + space_id, ENCRYPTION_KEY) で生成。
 * focusmap-agent は config.json にこのトークンを保存して起動するが、
 * 現状の MVP では agent_token は表示のみで認証には user_id / service_role_key を使う。
 * Phase 5 で API key テーブルに正式化予定。
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

  const secret = process.env.FOCUSMAP_ENCRYPTION_KEY ?? 'dev-fallback-secret-rotate-in-prod';
  const payload = `${user.id}:${spaceId}:${Date.now()}`;
  const token = createHmac('sha256', secret).update(payload).digest('hex').slice(0, 32);

  const origin = req.headers.get('origin') ?? 'https://focusmap-official.com';
  const installCommand = `curl -sSL ${origin}/install.sh | sh -s -- ${token}`;

  return NextResponse.json({
    token,
    install_command: installCommand,
    user_id: user.id,
    space_id: spaceId,
    expires_at: null,
    note: 'このトークンは config.json に保存されます。 紛失時は再発行してください。',
  });
}
