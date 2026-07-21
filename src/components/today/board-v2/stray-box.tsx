import { Badge } from '@/components/ui/badge';
import type { StrayData } from './types';

function agentDot(state: string) {
  if (state === 'run') return 'bg-emerald-500';
  if (state === 'sub') return 'bg-blue-500';
  if (state === 'wait') return 'bg-amber-500';
  return 'bg-muted-foreground';
}

function agentStateLabel(state: string) {
  if (state === 'run') return '稼働中';
  if (state === 'sub') return 'サブ稼働中';
  if (state === 'wait') return '待機中';
  return state || '状態不明';
}

// 未分類枠（モックv2 stray）。テーマに紐付かなかったものだけの例外枠。
// tasks/sessions/finishedLogs が全て空なら null。琥珀系の破線枠。
// 吸収ボタン（テーマ割当）は流用できる server action が無いため付けない（新規 action は作らない・報告参照）。
export function StrayBox({
  stray,
}: {
  stray: StrayData;
  selectedDate: string;
  aiTargets: { id: string; title: string }[];
}) {
  const finishedCount = stray.finishedLogs.reduce((sum, group) => sum + group.items.length, 0);
  const total = stray.tasks.length + stray.sessions.length + finishedCount;
  if (total === 0) return null;

  return (
    <section
      aria-labelledby="stray-heading"
      className="space-y-2 rounded-xl border border-dashed border-amber-400/70 bg-amber-50/70 p-3 dark:border-amber-500/40 dark:bg-amber-500/10"
    >
      <h2 id="stray-heading" className="text-[11px] font-bold tracking-wider text-amber-700 dark:text-amber-400">
        未分類 {total}件
      </h2>

      {stray.tasks.length > 0 ? (
        <div className="space-y-1.5">
          {stray.tasks.map((item) => (
            <div key={item.todo.id} className="flex items-start gap-2 text-[13px]">
              <span className="min-w-0 flex-1 break-words">{item.todo.title}</span>
              <div className="flex shrink-0 items-center gap-1.5">
                <Badge variant="secondary" className="font-normal">
                  {item.repoName || 'repo未設定'}
                </Badge>
                {item.todo.carriedFrom ? (
                  <span className="text-[10.5px] text-muted-foreground">昨日から</span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {stray.sessions.map((item) => (
        <div key={item.session.sessionKey} className="flex items-center gap-2 text-[12.5px]">
          <span className={`h-2 w-2 shrink-0 rounded-full ${agentDot(item.session.state)}`} aria-hidden />
          <span className="min-w-0 flex-1 truncate font-semibold">
            {item.session.now || item.session.goal || 'エージェント'}
          </span>
          <span className="shrink-0 text-[10.5px] text-muted-foreground">{agentStateLabel(item.session.state)}</span>
        </div>
      ))}

      {stray.finishedLogs.map((group) => (
        <div key={group.parent} className="space-y-1">
          <p className="text-[10.5px] font-semibold text-muted-foreground">{group.parent}</p>
          {group.items.map((entry, index) => (
            <div key={`${group.parent}-${index}`} className="flex items-baseline gap-2 text-[12px] text-slate-600 dark:text-slate-300">
              <span className="shrink-0 font-bold text-emerald-600">✓</span>
              <span className="min-w-0 flex-1 break-words">{entry.entry}</span>
              {entry.count > 1 ? (
                <span className="shrink-0 rounded-full bg-muted px-1.5 text-[10px] tabular-nums">×{entry.count}</span>
              ) : null}
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
