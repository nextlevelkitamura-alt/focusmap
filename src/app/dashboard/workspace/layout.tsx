import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/server';
import { Building2, Users, CreditCard, BarChart3, Clock3, Server } from 'lucide-react';
import { WorkspaceTabs } from '@/components/workspace/workspace-tabs';
import { WorkspaceSelector } from '@/components/workspace/workspace-selector';

export const dynamic = 'force-dynamic';

const TABS = [
  { href: '', label: '概要', icon: Building2 },
  { href: '/members', label: 'メンバー', icon: Users },
  { href: '/billing', label: '課金', icon: CreditCard },
  { href: '/analytics', label: '使用量', icon: BarChart3 },
  { href: '/sessions', label: 'セッション', icon: Clock3 },
  { href: '/agents', label: 'エージェント', icon: Server },
] as const;

interface WorkspaceLayoutProps {
  children: React.ReactNode;
  searchParams?: Promise<{ space?: string }>;
}

export default async function WorkspaceLayout({ children }: WorkspaceLayoutProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // ユーザーがアクセス可能な spaces を全取得
  const { data: ownedSpaces } = await supabase
    .from('spaces')
    .select('id, title, color, plan, seat_count')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true });

  const { data: memberSpaces } = await supabase
    .from('space_members')
    .select('space_id, role, spaces!inner(id, title, color, plan, seat_count, user_id)')
    .eq('user_id', user.id);

  type SpaceRow = { id: string; title: string; color: string | null; plan: string; seat_count: number };
  const owned = (ownedSpaces ?? []) as SpaceRow[];
  const member = ((memberSpaces ?? []) as Array<{ spaces: SpaceRow | SpaceRow[]; role: string }>)
    .map((m) => (Array.isArray(m.spaces) ? m.spaces[0] : m.spaces))
    .filter((s): s is SpaceRow => Boolean(s));
  const allSpaces = [...owned, ...member.filter((s) => !owned.some((o) => o.id === s.id))];

  if (allSpaces.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md text-center space-y-4">
          <Building2 className="h-12 w-12 mx-auto text-muted-foreground" />
          <h1 className="text-xl font-semibold">Workspaceがありません</h1>
          <p className="text-sm text-muted-foreground">
            まずダッシュボードからスペースを作成してください。
          </p>
          <Link
            href="/dashboard"
            className="inline-block rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90"
          >
            ダッシュボードに戻る
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-border/40 bg-background/95 backdrop-blur">
        <div className="flex flex-col gap-3 px-4 pb-2 pt-4 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              <h1 className="text-lg font-semibold">Workspace 管理</h1>
            </div>
            <WorkspaceSelector spaces={allSpaces} />
          </div>
          <WorkspaceTabs tabs={[...TABS]} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
          {children}
        </div>
      </div>
    </div>
  );
}
