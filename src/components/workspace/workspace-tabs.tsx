'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Tab {
  href: string;
  label: string;
  icon: LucideIcon;
}

interface WorkspaceTabsProps {
  tabs: Tab[];
}

const BASE = '/dashboard/workspace';

export function WorkspaceTabs({ tabs }: WorkspaceTabsProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const spaceParam = searchParams.get('space');

  const query = spaceParam ? `?space=${encodeURIComponent(spaceParam)}` : '';

  return (
    <nav className="-mb-px flex gap-1 overflow-x-auto">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const fullHref = `${BASE}${tab.href}`;
        const isActive =
          tab.href === ''
            ? pathname === BASE || pathname === `${BASE}/`
            : pathname.startsWith(fullHref);
        return (
          <Link
            key={tab.href || 'overview'}
            href={`${fullHref}${query}`}
            className={cn(
              'flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="h-4 w-4" />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
