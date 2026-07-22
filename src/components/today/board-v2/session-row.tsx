import { cn } from '@/lib/utils';
import { SubagentNest } from '@/app/dashboard/board/_components/subagent-nest';
import { FileAgentCheck } from '@/app/dashboard/board/_components/file-agent-check';
import type { SessionItem } from './types';

// board-v2 セッション行（モックv2 .sess／.s-row 準拠）: やること行の直下・テーマ直下にぶら下がるライブ行。
// 左の縦線レール＋状態ドット（run/sub=緑明滅・wait=琥珀）＋名前＋runtimeピル＋稼働ステート＋サブ入れ子。
// 右端に FileAgentCheck（子09方針6の人間チェック・宣言済み todo_id を読むだけで「終わったこと」へ格納）を復旧（修正01・指摘3）。
// 既存 AgentRow / SubagentNest を流用改造。追加クエリは持たず SessionItem（契約）だけで描画する。
// todoTitle: 親タスク見出し（TaskRow から渡す。fileAgentToFinished は todo_id 宣言時のみ parent に使う）。
export function SessionRow({
  item,
  selectedDate,
  todoTitle,
}: {
  item: SessionItem;
  selectedDate: string;
  todoTitle?: string;
}) {
  const { session, stuck, subagents } = item;
  const live = session.state === 'run' || session.state === 'sub';
  const wait = session.state === 'wait';
  const name = session.goal || session.now || 'エージェント';
  // runtimeピル: sessions.type（runtime）· model を素直に連結（DBにある値だけ）。
  const pill = [session.type, session.model].filter(Boolean).join(' · ');
  const nowLine = session.now && session.now !== name ? session.now : '';

  return (
    <div className="ml-1.5 border-l-2 border-border/70 pl-3">
      <div className="flex items-start gap-2 py-1 text-[12.5px]">
        <span
          className={cn(
            'mt-[5px] h-2 w-2 shrink-0 rounded-full',
            live
              ? 'bg-emerald-500 animate-pulse motion-reduce:animate-none'
              : wait
                ? 'bg-amber-500'
                : 'bg-muted-foreground',
          )}
          title={live ? '稼働中' : wait ? '確認待ち' : '状態不明'}
        />
        <div className="min-w-0 flex-1">
          <p className="leading-snug">
            <span className="break-words font-semibold">{name}</span>
            {pill ? (
              <span className="ml-1.5 inline-block rounded bg-muted px-1.5 py-px align-middle text-[10.5px] font-medium text-muted-foreground">
                {pill}
              </span>
            ) : null}
            {/* このセッションが動いている repo（sessions.repo＝git トップの basename）。どの計画/作業か理解の手がかり。空なら出さない。 */}
            {session.repo ? (
              <span className="ml-1.5 inline-block rounded border border-border/70 px-1.5 py-px align-middle text-[10.5px] font-medium text-muted-foreground/90">
                {session.repo}
              </span>
            ) : null}
          </p>
          <p className="mt-0.5 text-[11.5px] tabular-nums text-muted-foreground">
            {wait ? (
              <span className="font-semibold text-amber-700 dark:text-amber-400">
                確認待ち {stuck ? `${stuck.waitMin}分` : ''}
              </span>
            ) : (
              <span className="font-semibold text-emerald-700 dark:text-emerald-400">実行中</span>
            )}
            {nowLine ? <span className="text-muted-foreground"> ・ 今: {nowLine}</span> : null}
          </p>
          {subagents.length > 0 ? <SubagentNest subagents={subagents} /> : null}
        </div>
        <FileAgentCheck
          sessionKey={session.sessionKey}
          todoTitle={todoTitle ?? name}
          date={selectedDate}
          label={name}
        />
      </div>
    </div>
  );
}
