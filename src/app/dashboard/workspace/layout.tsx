import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';

export const dynamic = 'force-dynamic';

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

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
          {children}
        </div>
      </div>
    </div>
  );
}
