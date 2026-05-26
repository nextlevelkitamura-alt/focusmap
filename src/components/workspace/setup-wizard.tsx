'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Check, Circle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SetupStepGoogle } from './setup-step-google';
import { SetupStepAgent } from './setup-step-agent';
import { SetupStepTrial } from './setup-step-trial';

interface SetupWizardProps {
  spaceId: string | null;
  userId: string;
  initialStep: number;
  googleConnected: boolean;
  agentConnected: boolean;
}

const STEPS = [
  { num: 1, label: 'Google連携' },
  { num: 2, label: 'エージェント導入' },
  { num: 3, label: '最初のスキル試行' },
];

export function SetupWizard({
  spaceId,
  userId,
  initialStep,
  googleConnected,
  agentConnected,
}: SetupWizardProps) {
  const router = useRouter();
  const [step, setStep] = useState<number>(initialStep);

  // Step 2 から 3への自動遷移 (agent接続を検知したら)
  useEffect(() => {
    if (step === 2 && agentConnected) {
      setStep(3);
    }
  }, [step, agentConnected]);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">セットアップ</h1>
        <p className="text-sm text-muted-foreground">
          3つのステップで、誰でも Mac mini に自動化エージェントを導入できます。
        </p>
      </header>

      {/* Step indicator */}
      <div className="flex items-center gap-1">
        {STEPS.map((s, idx) => {
          const isDone =
            (s.num === 1 && googleConnected) ||
            (s.num === 2 && agentConnected) ||
            s.num < step;
          const isActive = s.num === step;
          return (
            <div key={s.num} className="flex flex-1 items-center">
              <button
                type="button"
                onClick={() => setStep(s.num)}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors',
                  isActive && 'bg-primary/10 text-primary font-medium',
                  !isActive && 'text-muted-foreground hover:text-foreground',
                )}
              >
                <span
                  className={cn(
                    'flex h-6 w-6 items-center justify-center rounded-full border text-[10px]',
                    isDone && 'border-emerald-500 bg-emerald-500 text-white',
                    isActive && !isDone && 'border-primary text-primary',
                    !isActive && !isDone && 'border-border text-muted-foreground',
                  )}
                >
                  {isDone ? <Check className="h-3 w-3" /> : s.num}
                </span>
                <span>{s.label}</span>
              </button>
              {idx < STEPS.length - 1 && (
                <div
                  className={cn('mx-1 h-px flex-1 transition-colors', isDone ? 'bg-emerald-500' : 'bg-border')}
                />
              )}
            </div>
          );
        })}
      </div>

      <Card>
        <CardContent className="pt-6">
          {step === 1 && (
            <SetupStepGoogle
              connected={googleConnected}
              onNext={() => setStep(2)}
              spaceId={spaceId}
            />
          )}
          {step === 2 && (
            <SetupStepAgent
              spaceId={spaceId}
              userId={userId}
              connected={agentConnected}
              onBack={() => setStep(1)}
              onNext={() => setStep(3)}
            />
          )}
          {step === 3 && (
            <SetupStepTrial
              spaceId={spaceId}
              onBack={() => setStep(2)}
              onFinish={() => router.push('/dashboard/chat')}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
