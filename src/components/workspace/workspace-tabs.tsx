'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Building2, Users, CreditCard, BarChart3, Clock3, Server } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Tab {
  href: string;
  label: string;
  icon: LucideIcon;
}

// タブ定義はこのクライアントコンポーネント内に置く。
// lucideアイコン（forwardRefコンポーネント＝関数）をサーバ→クライアントのprop境界で
// 渡すと本番ビルドで "Functions cannot be passed directly to Client Components" になるため、
// アイコン参照はクライアント側に閉じる。
const TABS: Tab[] = [
  { href: '', label: '概要', icon: Building2 },
  { href: '/members', label: 'メンバー', icon: Users },
  { href: '/billing', label: '課金', icon: CreditCard },
  { href: '/analytics', label: '使用量', icon: BarChart3 },
  { href: '/sessions', label: 'セッション', icon: Clock3 },
  { href: '/agents', label: 'エージェント', icon: Server },
];

const BASE = '/dashboard/workspace';

export function WorkspaceTabs() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const spaceParam = searchParams.get('space');

  const query = spaceParam ? `?space=${encodeURIComponent(spaceParam)}` : '';

  return (
    <nav className="-mb-px flex gap-1 overflow-x-auto">
      {TABS.map((tab) => {
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
