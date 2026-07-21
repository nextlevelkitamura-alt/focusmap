import { HelpCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { QuestionAnswer } from '@/app/dashboard/board/_components/question-answer';
import type { AskItem } from './types';

// 「きみの番」レーン（モックv2 asklane）。人間の仕事の全量＝質問・確認待ちをここへ集約。
// 0件なら表示ごと消える（null）。淡い強調背景のレーン。
export function AskLane({ asks, selectedDate }: { asks: AskItem[]; selectedDate: string }) {
  if (asks.length === 0) return null;

  return (
    <section
      aria-labelledby="asklane-heading"
      className="space-y-2 rounded-2xl border border-blue-200 bg-blue-50/70 p-3 dark:border-blue-500/30 dark:bg-blue-500/10"
    >
      <h2 id="asklane-heading" className="text-[11px] font-bold tracking-wider text-blue-700 dark:text-blue-300">
        きみの番（{asks.length}件）
      </h2>

      <div className="space-y-2">
        {asks.map((ask, index) =>
          ask.kind === 'question' ? (
            <div
              key={`q-${ask.todo.id}`}
              className="rounded-xl border border-blue-200 bg-background p-3 dark:border-blue-500/30"
            >
              <p className="text-[10.5px] text-muted-foreground">{ask.themeName || '未分類'}</p>
              <p className="mt-0.5 flex items-start gap-1.5 text-sm leading-relaxed">
                <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <span className="min-w-0">{ask.todo.question}</span>
              </p>
              <div className="mt-2">
                {ask.todo.questionGate ? (
                  <p className="text-xs text-muted-foreground">
                    これは承認が要る操作です。ボードからは回答できません。セッションで明示承認してください。
                  </p>
                ) : (
                  <QuestionAnswer
                    todoId={ask.todo.id}
                    choices={ask.todo.questionChoices}
                    allowFree={ask.todo.questionAllowFree}
                    date={selectedDate}
                  />
                )}
              </div>
            </div>
          ) : (
            <div
              key={`w-${ask.session.sessionKey}-${index}`}
              className="flex items-start gap-2 rounded-xl border border-blue-200 bg-background p-3 dark:border-blue-500/30"
            >
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber-500" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{ask.session.now || ask.session.goal || 'エージェント'}</p>
                <p className="mt-0.5 text-[11px] font-semibold text-amber-700 tabular-nums dark:text-amber-400">
                  確認待ち {ask.waitMin}分
                </p>
                {ask.themeName ? (
                  <p className={cn('mt-0.5 text-[10.5px] leading-tight text-muted-foreground')}>{ask.themeName}</p>
                ) : null}
              </div>
            </div>
          ),
        )}
      </div>
    </section>
  );
}
