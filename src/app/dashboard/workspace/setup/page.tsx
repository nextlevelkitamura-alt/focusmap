import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { SetupWizard } from '@/components/workspace/setup-wizard';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ space?: string; step?: string }>;
}

export default async function WorkspaceSetupPage({ searchParams }: PageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { space, step } = await searchParams;

  // 現在の space を決定 (param指定 or 自分の所有space)
  let activeSpaceId: string | null = space ?? null;
  if (!activeSpaceId) {
    const { data: ownedSpace } = await supabase
      .from('spaces')
      .select('id')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    activeSpaceId = ownedSpace?.id ?? null;
  }

  // Google Calendar 連携状況
  const { data: calSettings } = await supabase
    .from('user_calendar_settings')
    .select('google_access_token, google_refresh_token')
    .eq('user_id', user.id)
    .maybeSingle();
  const googleConnected = Boolean(
    calSettings?.google_access_token && calSettings?.google_refresh_token,
  );

  // エージェント接続状況
  let agentConnected = false;
  if (activeSpaceId) {
    const { data: runners } = await supabase
      .from('ai_runners')
      .select('id, last_heartbeat_at, ai_runner_spaces!inner(space_id)')
      .eq('ai_runner_spaces.space_id', activeSpaceId);
    const now = Date.now();
    agentConnected = (runners ?? []).some((r) => {
      if (!r.last_heartbeat_at) return false;
      return now - new Date(r.last_heartbeat_at).getTime() < 2 * 60 * 1000;
    });
  }

  const initialStep = step ? Number(step) : googleConnected ? (agentConnected ? 3 : 2) : 1;

  return (
    <SetupWizard
      spaceId={activeSpaceId}
      userId={user.id}
      initialStep={Math.min(Math.max(initialStep, 1), 3)}
      googleConnected={googleConnected}
      agentConnected={agentConnected}
    />
  );
}
