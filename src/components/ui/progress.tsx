'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value: number;
  max?: number;
  indicatorClassName?: string;
}

export const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value, max = 100, indicatorClassName, ...props }, ref) => {
    const safeValue = Math.max(0, Math.min(value, max));
    const ratio = (safeValue / max) * 100;
    return (
      <div
        ref={ref}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={safeValue}
        className={cn(
          'relative h-2 w-full overflow-hidden rounded-full bg-secondary',
          className,
        )}
        {...props}
      >
        <div
          className={cn(
            'h-full transition-[width,background-color] duration-500 ease-out',
            indicatorClassName ?? 'bg-emerald-500',
          )}
          style={{ width: `${ratio}%` }}
        />
      </div>
    );
  },
);
Progress.displayName = 'Progress';
