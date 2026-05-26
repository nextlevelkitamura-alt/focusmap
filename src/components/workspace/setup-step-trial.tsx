'use client';

import { Button } from '@/components/ui/button';
import { Sparkles, ChevronLeft, MessageSquare } from 'lucide-react';

interface SetupStepTrialProps {
  spaceId: string | null;
  onBack: () => void;
  onFinish: () => void;
}

const SUGGESTED_PROMPTS = [
  '今日のカレンダー整理をして、空き時間と推奨作業を提案して',
  'Zapier の価格を確認して要約して',
  '未読メールを3行で要約して優先度を判定して',
];

export function SetupStepTrial({ spaceId, onBack, onFinish }: SetupStepTrialProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          最初の自動化を試してみよう
        </h2>
        <p className="text-sm text-muted-foreground">
          チャット画面で自然言語で指示するだけで、AIがスキルを選んで実行します。
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">試してみる指示の例:</p>
        {SUGGESTED_PROMPTS.map((p, i) => (
          <div
            key={i}
            className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-sm"
          >
            「{p}」
          </div>
        ))}
      </div>

      <div className="rounded-md border border-primary/30 bg-primary/[0.04] p-3 text-xs text-muted-foreground">
        <strong className="text-foreground">仕組み:</strong>
        DeepSeek V4 Pro があなたの指示を解析 → 該当スキルを判定 → focusmap-agent (Mac mini) が
        Playwright や Google API を使って実行 → 結果をチャットに返します。
      </div>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>
          <ChevronLeft className="mr-1 h-3.5 w-3.5" />
          戻る
        </Button>
        <Button onClick={onFinish}>
          <MessageSquare className="mr-1 h-3.5 w-3.5" />
          チャット画面を開く
        </Button>
      </div>
    </div>
  );
}
