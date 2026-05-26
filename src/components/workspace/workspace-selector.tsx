'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useEffect } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { PLAN_DEFINITIONS } from '@/lib/plans';

interface WorkspaceSelectorProps {
  spaces: Array<{ id: string; title: string; color?: string | null; plan: string }>;
}

const STORAGE_KEY = 'focusmap:active-workspace-id';

export function WorkspaceSelector({ spaces }: WorkspaceSelectorProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const spaceParam = searchParams.get('space');
  const activeId = spaceParam ?? spaces[0]?.id ?? '';

  // 選択を localStorage に永続化
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (spaceParam) {
      window.localStorage.setItem(STORAGE_KEY, spaceParam);
      return;
    }
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && spaces.some((s) => s.id === stored)) {
      const params = new URLSearchParams(searchParams.toString());
      params.set('space', stored);
      router.replace(`${pathname}?${params.toString()}`);
    }
  }, [spaceParam, spaces, router, pathname, searchParams]);

  const active = spaces.find((s) => s.id === activeId) ?? spaces[0];
  if (!active) return null;

  const onChange = (id: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('space', id);
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <Select value={active.id} onValueChange={onChange}>
      <SelectTrigger className="h-8 w-auto min-w-[180px] gap-2 text-sm">
        <SelectValue>
          <span className="flex items-center gap-2">
            {active.color && (
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: active.color }} />
            )}
            <span className="truncate">{active.title}</span>
            <Badge variant="secondary" className="text-[10px]">
              {PLAN_DEFINITIONS[active.plan as keyof typeof PLAN_DEFINITIONS]?.jaName ?? active.plan}
            </Badge>
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {spaces.map((space) => (
          <SelectItem key={space.id} value={space.id}>
            <span className="flex items-center gap-2">
              {space.color && (
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: space.color }} />
              )}
              {space.title}
              <Badge variant="outline" className="ml-auto text-[10px]">
                {PLAN_DEFINITIONS[space.plan as keyof typeof PLAN_DEFINITIONS]?.jaName ?? space.plan}
              </Badge>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
