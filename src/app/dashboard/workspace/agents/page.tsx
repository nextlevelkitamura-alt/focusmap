import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AgentInstallPanel } from '@/components/workspace/agent-install-panel';
import { Server, Wifi, WifiOff } from 'lucide-react';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ space?: string }>;
}

export default async function AgentsPage({ searchParams }: PageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { space } = await searchParams;
  if (!space) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Workspace を選択してください
        </CardContent>
      </Card>
    );
  }

  const { data: runners } = await supabase
    .from('ai_runners')
    .select('id, hostname, display_name, executors, last_heartbeat_at, ai_runner_spaces!inner(space_id, enabled)')
    .eq('ai_runner_spaces.space_id', space)
    .order('last_heartbeat_at', { ascending: false });

  const now = Date.now();
  const enriched = (runners ?? []).map((r) => {
    const lastSeen = r.last_heartbeat_at ? new Date(r.last_heartbeat_at).getTime() : 0;
    const isOnline = lastSeen > 0 && now - lastSeen < 2 * 60 * 1000;
    const ageMin = lastSeen ? Math.floor((now - lastSeen) / 60000) : Infinity;
    return { ...r, isOnline, ageMin };
  });

  return (
    <div className="space-y-6">
      <AgentInstallPanel spaceId={space} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Server className="h-4 w-4" />
            接続中のエージェント
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {enriched.length === 0 && (
            <p className="text-sm text-muted-foreground">
              まだエージェントが接続されていません。上のインストール手順に従って Mac mini にセットアップしてください。
            </p>
          )}
          {enriched.map((r) => (
            <div
              key={r.id}
              className="flex items-center justify-between rounded-md border border-border/40 px-3 py-2"
            >
              <div className="flex items-center gap-3">
                <div
                  className={
                    'flex h-8 w-8 items-center justify-center rounded-full ' +
                    (r.isOnline
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                      : 'bg-muted text-muted-foreground')
                  }
                >
                  {r.isOnline ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{r.display_name ?? r.hostname}</span>
                  <span className="text-xs text-muted-foreground">
                    {r.hostname} ・ executor: {(r.executors ?? []).join(', ')}
                  </span>
                </div>
              </div>
              <div className="flex flex-col items-end gap-0.5">
                <Badge variant={r.isOnline ? 'default' : 'outline'}>
                  {r.isOnline ? 'オンライン' : 'オフライン'}
                </Badge>
                {!r.isOnline && r.last_heartbeat_at && (
                  <span className="text-[10px] text-muted-foreground">
                    {Math.min(r.ageMin, 99999)}分前
                  </span>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
