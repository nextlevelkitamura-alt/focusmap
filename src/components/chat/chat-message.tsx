'use client';

import { cn } from '@/lib/utils';
import { Bot, User } from 'lucide-react';
import type { ReactNode } from 'react';

export type ChatRole = 'user' | 'assistant' | 'system';

interface ChatMessageProps {
  role: ChatRole;
  children: ReactNode;
  timestamp?: string;
}

export function ChatMessage({ role, children, timestamp }: ChatMessageProps) {
  const isUser = role === 'user';
  const isSystem = role === 'system';

  return (
    <div className={cn('flex gap-3', isUser && 'flex-row-reverse')}>
      <div
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs',
          isUser
            ? 'bg-primary text-primary-foreground'
            : isSystem
            ? 'bg-muted text-muted-foreground'
            : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
        )}
      >
        {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
      </div>
      <div className={cn('max-w-[85%] space-y-1', isUser && 'items-end')}>
        <div
          className={cn(
            'rounded-lg px-3 py-2 text-sm',
            isUser
              ? 'bg-primary text-primary-foreground'
              : isSystem
              ? 'bg-muted/50 text-muted-foreground text-xs'
              : 'bg-muted text-foreground',
          )}
        >
          {children}
        </div>
        {timestamp && (
          <p
            className={cn(
              'text-[10px] text-muted-foreground',
              isUser ? 'text-right' : 'text-left',
            )}
          >
            {timestamp}
          </p>
        )}
      </div>
    </div>
  );
}
