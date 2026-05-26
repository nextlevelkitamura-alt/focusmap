import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ErrorBannerProps {
  title?: string;
  message: string;
  className?: string;
}

export function ErrorBanner({ title, message, className }: ErrorBannerProps) {
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-md border border-red-300 bg-red-50/80 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300',
        className,
      )}
    >
      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
      <div className="space-y-0.5">
        {title && <p className="font-medium">{title}</p>}
        <p className={title ? 'text-xs opacity-90' : ''}>{message}</p>
      </div>
    </div>
  );
}
