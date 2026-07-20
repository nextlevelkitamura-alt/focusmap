'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Target } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface SessionGoalSelectProps {
  goals: string[];
  selectedGoal?: string;
}

export function SessionGoalSelect({ goals, selectedGoal }: SessionGoalSelectProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const handleChange = (goal: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('goal', goal);
    router.replace(`${pathname}?${params.toString()}`);
  };

  return (
    <Select value={selectedGoal} onValueChange={handleChange} disabled={goals.length === 0}>
      <SelectTrigger
        aria-label="今日の目標を選択"
        className="h-11 w-full justify-between border-border/70 bg-card text-left sm:max-w-xl"
      >
        <span className="flex min-w-0 items-center gap-2">
          <Target className="h-4 w-4 shrink-0 text-primary" />
          <SelectValue placeholder="今日の目標を選択" />
        </span>
      </SelectTrigger>
      <SelectContent>
        {goals.map((goal) => (
          <SelectItem key={goal} value={goal}>
            {goal}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
