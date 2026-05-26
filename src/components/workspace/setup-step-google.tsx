'use client';

import { Button } from '@/components/ui/button';
import { Check, ExternalLink, Calendar, Plug } from 'lucide-react';

interface SetupStepGoogleProps {
  connected: boolean;
  spaceId: string | null;
  onNext: () => void;
}

export function SetupStepGoogle({ connected, spaceId, onNext }: SetupStepGoogleProps) {
  const next = spaceId
    ? `/dashboard/workspace/setup?space=${spaceId}&step=2`
    : '/dashboard/workspace/setup?step=2';
  const connectHref = `/api/calendar/connect?next=${encodeURIComponent(next)}`;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Google Calendar を連携</h2>
        <p className="text-sm text-muted-foreground">
          Focusmap は Google Calendar の予定を読み書きして自動化を実行します。認証情報は手元のMacにのみ保存されます。
        </p>
      </div>

      <div className="grid gap-2 text-sm">
        <div className="flex items-center gap-2 rounded-md border border-border/60 px-3 py-2">
          <Calendar className="h-4 w-4 text-primary" />
          <span className="flex-1">Google Calendar (予定の読み書き)</span>
          <span className="text-xs text-muted-foreground">calendar.events</span>
        </div>
        <div className="flex items-start gap-2 rounded-md border border-border/40 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <Plug className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            Gmail / スプレッドシート / Notion / Slack 等の他サービスは、外部MCP (Composio / Zapier MCP 等) 経由で接続する方針です (Google OAuth審査を避けるため)。
          </span>
        </div>
      </div>

      {connected ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
            <Check className="h-4 w-4" />
            <span>Google Calendar が連携されています</span>
          </div>
          <div className="flex justify-end">
            <Button onClick={onNext}>次へ: エージェント導入 →</Button>
          </div>
        </div>
      ) : (
        <div className="flex justify-end">
          <Button asChild>
            <a href={connectHref}>
              <ExternalLink className="mr-1 h-3.5 w-3.5" />
              Google Calendar を連携
            </a>
          </Button>
        </div>
      )}
    </div>
  );
}
