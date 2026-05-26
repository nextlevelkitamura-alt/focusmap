import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Users } from 'lucide-react';
import { MembersClient } from '@/components/workspace/members-client';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ space?: string }>;
}

const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner',
  editor: 'Admin',
  commenter: 'Member',
  viewer: 'Member',
};

const ROLE_VARIANT: Record<string, 'default' | 'secondary' | 'outline'> = {
  owner: 'default',
  editor: 'secondary',
  commenter: 'outline',
  viewer: 'outline',
};

export default async function MembersPage({ searchParams }: PageProps) {
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

  const { data: spaceRow } = await supabase
    .from('spaces')
    .select('id, title, user_id')
    .eq('id', space)
    .maybeSingle();
  if (!spaceRow) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Workspace が見つかりません
        </CardContent>
      </Card>
    );
  }

  const { data: members } = await supabase
    .from('space_members')
    .select('user_id, role, created_at')
    .eq('space_id', space)
    .order('created_at', { ascending: true });

  const { data: invites } = await supabase
    .from('space_invites')
    .select('id, email, role, accepted_at, expires_at, created_at')
    .eq('space_id', space)
    .order('created_at', { ascending: false });

  const isOwner = spaceRow.user_id === user.id;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">現在のメンバー</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(members ?? []).length === 0 && (
            <EmptyState
              icon={Users}
              title="メンバーがまだいません"
              description="招待してチームで自動化を使いましょう"
              variant="compact"
            />
          )}
          {(members ?? []).map((m) => (
            <div
              key={m.user_id}
              className="flex items-center justify-between rounded-md border border-border/40 px-3 py-2"
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">
                  {m.user_id === user.id ? 'あなた' : m.user_id.slice(0, 8)}
                </span>
                <span className="text-xs text-muted-foreground">
                  参加: {new Date(m.created_at).toLocaleDateString('ja-JP')}
                </span>
              </div>
              <Badge variant={ROLE_VARIANT[m.role] ?? 'outline'}>
                {ROLE_LABEL[m.role] ?? m.role}
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      <MembersClient
        spaceId={space}
        isOwner={isOwner}
        pendingInvites={(invites ?? []).filter((i) => !i.accepted_at)}
      />
    </div>
  );
}
