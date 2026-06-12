import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { UnifiedChat } from '@/components/chat/unified-chat';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ space?: string }>;
}

export default async function ChatPage({ searchParams }: PageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { space } = await searchParams;
  let spaceId: string | null = space ?? null;
  const [ownedSpaceResult, projectsResult] = await Promise.all([
    !spaceId
      ? supabase
      .from('spaces')
      .select('id')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from('projects')
      .select('*')
      .order('created_at', { ascending: false }),
  ]);

  if (!spaceId) spaceId = ownedSpaceResult.data?.id ?? null;
  const projects = projectsResult.data ?? [];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <UnifiedChat spaceId={spaceId} projects={projects} />
    </div>
  );
}
