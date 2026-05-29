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
  if (!spaceId) {
    const { data: ownedSpace } = await supabase
      .from('spaces')
      .select('id')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    spaceId = ownedSpace?.id ?? null;
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <UnifiedChat spaceId={spaceId} />
    </div>
  );
}
