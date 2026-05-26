'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, ExternalLink, Sparkles } from 'lucide-react';
import type { PlanId } from '@/lib/plans';

interface BillingActionsProps {
  spaceId: string;
  variant: 'checkout' | 'portal';
  plan?: PlanId;
  label?: string;
}

export function BillingActions({ spaceId, variant, plan, label }: BillingActionsProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    setLoading(true);
    setError(null);
    try {
      if (variant === 'checkout') {
        const res = await fetch('/api/stripe/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ space_id: spaceId, plan }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? 'Checkoutに失敗しました');
        if (data?.url) window.location.href = data.url;
      } else {
        const res = await fetch('/api/stripe/portal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ space_id: spaceId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? 'ポータル起動に失敗しました');
        if (data?.url) window.location.href = data.url;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました');
      setLoading(false);
    }
  };

  return (
    <div className="space-y-1">
      <Button
        size="sm"
        variant={variant === 'portal' ? 'outline' : 'default'}
        className="w-full gap-1"
        onClick={handleClick}
        disabled={loading}
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : variant === 'portal' ? (
          <ExternalLink className="h-3.5 w-3.5" />
        ) : (
          <Sparkles className="h-3.5 w-3.5" />
        )}
        {label ?? (variant === 'portal' ? '請求ポータルを開く' : 'アップグレード')}
      </Button>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
