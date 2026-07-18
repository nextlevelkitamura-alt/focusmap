'use client';

import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';
import { answerQuestionAction } from '../actions';

// 段階4: AIの質問に、選択肢タップ or 自由入力で回答する（Claude質問UIと同型）。
// 人間ゲート承認質問（gate）はこのUIを描画せず、呼び出し側でセッション誘導文だけを出す。
export function QuestionAnswer({
  todoId,
  choices,
  allowFree,
  date,
}: {
  todoId: string;
  choices: string[];
  allowFree: boolean;
  date: string;
}) {
  const [freeOpen, setFreeOpen] = useState(false);
  const [freeText, setFreeText] = useState('');

  return (
    <div className="flex flex-wrap gap-2">
      {choices.map((choice, index) => (
        <form key={index} action={answerQuestionAction}>
          <input type="hidden" name="id" value={todoId} />
          <input type="hidden" name="date" value={date} />
          <input type="hidden" name="answer" value={choice} />
          <button
            type="submit"
            className="min-h-11 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium active:scale-95"
          >
            {choice}
          </button>
        </form>
      ))}

      {allowFree ? (
        freeOpen ? (
          <form action={answerQuestionAction} className="flex w-full flex-wrap items-center gap-2">
            <input type="hidden" name="id" value={todoId} />
            <input type="hidden" name="date" value={date} />
            <input
              name="answer"
              value={freeText}
              onChange={(event) => setFreeText(event.target.value)}
              autoFocus
              placeholder="自由入力で答える…"
              className="min-h-11 flex-1 rounded-lg border border-dashed border-border bg-background px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={!freeText.trim()}
              className="min-h-11 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              回答
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setFreeOpen(true)}
            className={cn(
              'flex min-h-11 items-center gap-1.5 rounded-lg border border-dashed border-border',
              'px-3 py-2 text-sm text-muted-foreground active:scale-95',
            )}
          >
            <Pencil className="h-3.5 w-3.5" />
            自由入力で答える…
          </button>
        )
      ) : null}
    </div>
  );
}
