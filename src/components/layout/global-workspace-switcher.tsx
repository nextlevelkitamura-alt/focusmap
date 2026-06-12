'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Building2, ChevronDown, Sparkles } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { createClient } from '@/utils/supabase/client';
import { PLAN_DEFINITIONS } from '@/lib/plans';
import Link from 'next/link';
import { cn } from '@/lib/utils';

const STORAGE_KEY = 'focusmap:active-workspace-id';

interface SpaceRow {
  id: string;
  title: string;
  color: string | null;
  plan: string;
}

/**
 * 全画面で常時表示する WorkspaceSwitcher
 * ヘッダー右上に配置、現在の workspace を表示・切替可能
 */
export function GlobalWorkspaceSwitcher() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [spaces, setSpaces] = useState<SpaceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }

      const { data: owned } = await supabase
        .from('spaces')
        .select('id, title, color, plan')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true });

      const { data: member } = await supabase
        .from('space_members')
        .select('spaces!inner(id, title, color, plan, user_id)')
        .eq('user_id', user.id);

      const ownedList = (owned ?? []) as SpaceRow[];
      const memberList = ((member ?? []) as Array<{ spaces: SpaceRow | SpaceRow[] }>)
        .map((m) => (Array.isArray(m.spaces) ? m.spaces[0] : m.spaces))
        .filter((s): s is SpaceRow => Boolean(s));

      const all = [
        ...ownedList,
        ...memberList.filter((s) => !ownedList.some((o) => o.id === s.id)),
      ];
      setSpaces(all);

      const fromUrl = searchParams.get('space');
      const stored = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
      const initial =
        fromUrl ?? stored ?? all[0]?.id ?? null;
      setActiveId(initial);
      if (initial && typeof window !== 'undefined') {
        window.localStorage.setItem(STORAGE_KEY, initial);
      }
      setLoading(false);
    })();
  }, [searchParams]);

  if (loading || spaces.length === 0) return null;

  const active = spaces.find((s) => s.id === activeId) ?? spaces[0];
  const planLabel =
    PLAN_DEFINITIONS[active.plan as keyof typeof PLAN_DEFINITIONS]?.jaName ?? active.plan;

  const onSelect = (id: string) => {
    setActiveId(id);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, id);
    }
    // workspace pages and standalone chat page read the active space from ?space=.
    if (pathname.startsWith('/dashboard/workspace') || pathname === '/dashboard/chat') {
      const params = new URLSearchParams(searchParams.toString());
      params.set('space', id);
      router.push(`${pathname}?${params.toString()}`);
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-md border border-border/60 bg-background px-2.5 py-1 text-xs font-medium hover:bg-muted/60 transition-colors"
        >
          {active.color ? (
            <span
              className="h-2 w-2 rounded-full shrink-0"
              style={{ backgroundColor: active.color }}
            />
          ) : (
            <Building2 className="h-3 w-3 text-muted-foreground" />
          )}
          <span className="hidden sm:inline-block max-w-[150px] truncate">{active.title}</span>
          <Badge variant="outline" className="hidden md:inline-flex text-[9px] py-0">
            {planLabel}
          </Badge>
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-1" align="end">
        <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          Workspace
        </div>
        {spaces.map((s) => {
          const isActive = s.id === active.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelect(s.id)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                isActive ? 'bg-muted/60 font-medium' : 'hover:bg-muted/40',
              )}
            >
              {s.color && (
                <span
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: s.color }}
                />
              )}
              <span className="flex-1 truncate text-left">{s.title}</span>
              <Badge variant="outline" className="text-[9px]">
                {PLAN_DEFINITIONS[s.plan as keyof typeof PLAN_DEFINITIONS]?.jaName ?? s.plan}
              </Badge>
            </button>
          );
        })}
        <div className="my-1 border-t border-border/40" />
        <Link
          href={`/dashboard/workspace?space=${active.id}`}
          className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted/40 hover:text-foreground"
        >
          <Sparkles className="h-3 w-3" />
          Workspace 管理
        </Link>
      </PopoverContent>
    </Popover>
  );
}
