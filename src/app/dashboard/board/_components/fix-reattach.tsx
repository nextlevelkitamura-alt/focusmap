'use client';

import { useRef } from 'react';
import { reattachFixAction } from '../actions';

// 段階3: 手直し(fix)行の付け替えを1タップで。対象タスクを選ぶと即送信する。
export function FixReattach({
  stepId,
  date,
  targets,
}: {
  stepId: string;
  date: string;
  targets: { id: string; title: string }[];
}) {
  const formRef = useRef<HTMLFormElement>(null);

  if (targets.length === 0) return null;

  return (
    <form ref={formRef} action={reattachFixAction} className="ml-auto">
      <input type="hidden" name="stepId" value={stepId} />
      <input type="hidden" name="date" value={date} />
      <select
        name="targetTodoId"
        defaultValue=""
        onChange={() => formRef.current?.requestSubmit()}
        aria-label="手直しを別タスクへ付け替え"
        className="min-h-9 rounded-md border border-border bg-background px-1.5 py-1 text-xs text-muted-foreground"
      >
        <option value="" disabled>
          付け替え…
        </option>
        {targets.map((target) => (
          <option key={target.id} value={target.id}>
            {target.title}
          </option>
        ))}
      </select>
    </form>
  );
}
