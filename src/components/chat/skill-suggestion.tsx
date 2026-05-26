'use client';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sparkles, X, Play, Brain } from 'lucide-react';
import type { IntentResult } from '@/lib/ai/intent-classifier';

interface SkillSuggestionProps {
  intent: IntentResult;
  modelLabel: string;
  onExecute: () => void;
  onCancel: () => void;
  loading?: boolean;
}

const SKILL_ICONS: Record<string, string> = {
  'calendar-organize': '📅',
  'web-research': '🌐',
  'email-summary': '📧',
};

const SKILL_LABELS: Record<string, string> = {
  'calendar-organize': '今日のカレンダー整理',
  'web-research': '競合・情報サイト巡回',
  'email-summary': 'メール要約',
};

export function SkillSuggestion({
  intent,
  modelLabel,
  onExecute,
  onCancel,
  loading,
}: SkillSuggestionProps) {
  if (!intent.skill_id) {
    return (
      <div className="rounded-md border border-amber-300 bg-amber-50/50 px-3 py-2.5 text-sm space-y-2 dark:border-amber-900 dark:bg-amber-950/30">
        <div className="flex items-center gap-1.5 text-amber-700 dark:text-amber-300">
          <Brain className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">スキル判定不可</span>
        </div>
        <p className="text-xs text-muted-foreground">{intent.reasoning}</p>
        {intent.followup_question && (
          <p className="text-sm text-foreground">{intent.followup_question}</p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-md border border-primary/30 bg-primary/[0.04] px-3 py-2.5 space-y-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-medium text-foreground">推奨スキル</span>
          <Badge variant="outline" className="text-[10px]">
            信頼度 {(intent.confidence * 100).toFixed(0)}%
          </Badge>
        </div>
        <span className="text-[10px] text-muted-foreground">{modelLabel}</span>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xl">{SKILL_ICONS[intent.skill_id] ?? '⚡'}</span>
        <div className="flex-1">
          <p className="text-sm font-medium text-foreground">
            {SKILL_LABELS[intent.skill_id] ?? intent.skill_id}
          </p>
          <p className="text-xs text-muted-foreground">{intent.reasoning}</p>
        </div>
      </div>

      {intent.args && Object.keys(intent.args).length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">パラメータ</summary>
          <pre className="mt-1 overflow-x-auto rounded bg-muted/60 px-2 py-1.5 text-[11px]">
            {JSON.stringify(intent.args, null, 2)}
          </pre>
        </details>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={loading}>
          <X className="h-3.5 w-3.5" />
          キャンセル
        </Button>
        <Button size="sm" onClick={onExecute} disabled={loading} className="gap-1">
          <Play className="h-3.5 w-3.5" />
          {loading ? '実行中...' : '実行する'}
        </Button>
      </div>
    </div>
  );
}
