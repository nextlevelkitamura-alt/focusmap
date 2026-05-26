import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import Link from 'next/link';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  ctaLabel?: string;
  ctaHref?: string;
  onCta?: () => void;
  className?: string;
  variant?: 'default' | 'compact';
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  ctaLabel,
  ctaHref,
  onCta,
  className,
  variant = 'default',
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-md border border-dashed border-border/60 bg-muted/20 text-center',
        variant === 'compact' ? 'gap-2 px-4 py-6' : 'gap-3 px-6 py-10',
        className,
      )}
    >
      {Icon && (
        <Icon
          className={cn(
            'text-muted-foreground',
            variant === 'compact' ? 'h-6 w-6' : 'h-10 w-10',
          )}
          strokeWidth={1.5}
        />
      )}
      <div className="space-y-1">
        <p className={cn('font-medium text-foreground', variant === 'compact' ? 'text-sm' : 'text-base')}>
          {title}
        </p>
        {description && (
          <p className={cn('text-muted-foreground', variant === 'compact' ? 'text-xs' : 'text-sm')}>
            {description}
          </p>
        )}
      </div>
      {ctaLabel && (ctaHref || onCta) && (
        <div className="pt-1">
          {ctaHref ? (
            <Button asChild size={variant === 'compact' ? 'sm' : 'default'}>
              <Link href={ctaHref}>{ctaLabel}</Link>
            </Button>
          ) : (
            <Button size={variant === 'compact' ? 'sm' : 'default'} onClick={onCta}>
              {ctaLabel}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
