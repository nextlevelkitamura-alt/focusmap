import { ArrowLeft, Bot, CheckCircle2, Clock, ExternalLink } from "lucide-react"
import type { ReactNode } from "react"

const messages = [
  {
    id: "m1",
    role: "user",
    body: "実行中の送信データを調査して、履歴に出す本文を整理してください",
    time: "6/14 17:39",
  },
  {
    id: "m2",
    role: "codex",
    body: "履歴の本文は、Tursoがあれば `ai_task_progress` / `ai_task_events` から最大50件、なければSupabaseの `ai_task_activity_messages` または `ai_tasks.result` から最大50件です。表示側では最後の20件だけを会話として描画します。",
    time: "6/14 17:40",
  },
  {
    id: "m3",
    role: "codex",
    body: "Mac側から送る進捗snapshotは、重複ハッシュと最小2秒間隔で抑制されています。状態・thread ID・短いcurrent_step/summaryを中心に送り、長いログ本文は保存しません。",
    time: "6/14 17:41",
  },
]

const histories = [
  { title: "実行中の送信データを調査", status: "確認待ち", time: "最終 6/14 18:00", tone: "amber" },
  { title: "Codex監視UIの戻る導線", status: "実行中", time: "最終 6/14 17:52", tone: "green" },
  { title: "リポ監視の取り込み一覧", status: "完了", time: "最終 6/14 17:41", tone: "green" },
]

function StatusPill({ tone, children }: { tone: string; children: ReactNode }) {
  const isAmber = tone === "amber"
  return (
    <span className={`inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold ${
      isAmber
        ? "border-amber-400/55 bg-amber-400/10 text-amber-200"
        : "border-emerald-400/40 bg-emerald-400/10 text-emerald-200"
    }`}>
      {isAmber ? <Clock className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
      {children}
    </span>
  )
}

export default function CodexChatHistoryMockupPage() {
  return (
    <main className="min-h-dvh bg-[#0f1012] px-4 py-6 text-zinc-100">
      <div className="mx-auto grid w-full max-w-6xl gap-5 md:grid-cols-[360px_minmax(0,420px)] md:items-start md:justify-center">
        <section className="overflow-hidden rounded-[28px] border border-white/10 bg-[#1f1f1f] shadow-2xl shadow-black/35">
          <div className="border-b border-white/10 px-4 pb-3 pt-4">
            <div className="flex min-h-11 items-center justify-between gap-3">
              <button type="button" className="inline-flex min-h-10 items-center gap-1.5 rounded-full px-2.5 text-sm font-semibold text-zinc-200">
                <ArrowLeft className="h-4 w-4" />
                戻る
              </button>
              <span className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-emerald-400/40 bg-emerald-400/10 px-3 text-xs font-semibold text-emerald-200">
                <Bot className="h-3.5 w-3.5" />
                Codex
              </span>
            </div>
            <div className="mt-2">
              <h1 className="text-base font-semibold">AIチャット履歴</h1>
              <p className="mt-1 line-clamp-2 text-xs font-medium text-zinc-400">実行中の送信データを調査</p>
            </div>
          </div>

          <div className="space-y-2 px-3 py-3">
            {histories.map(item => (
              <article key={item.title} className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="line-clamp-2 text-sm font-semibold leading-snug">{item.title}</div>
                    <div className="mt-2 text-[11px] text-zinc-500">{item.time}</div>
                  </div>
                  <StatusPill tone={item.tone}>{item.status}</StatusPill>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="overflow-hidden rounded-[28px] border border-white/10 bg-[#1f1f1f] shadow-2xl shadow-black/35">
          <div className="border-b border-white/10 px-4 pb-3 pt-4">
            <div className="flex min-h-11 items-center justify-between gap-3">
              <button type="button" className="inline-flex min-h-10 items-center gap-1.5 rounded-full px-2.5 text-sm font-semibold text-zinc-200">
                <ArrowLeft className="h-4 w-4" />
                戻る
              </button>
              <a
                href="codex://threads/thread-mock-history"
                className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-emerald-400/40 bg-emerald-400/10 px-3 text-xs font-semibold text-emerald-200"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Codexで開く
              </a>
            </div>
            <div className="mt-2">
              <h2 className="text-base font-semibold">AIチャット履歴</h2>
              <p className="mt-1 line-clamp-2 text-xs font-medium text-zinc-400">実行中の送信データを調査</p>
            </div>
          </div>

          <div className="max-h-[620px] space-y-5 overflow-y-auto px-4 py-5">
            <StatusPill tone="amber">確認待ち</StatusPill>
            {messages.map(message => {
              if (message.role === "user") {
                return (
                  <article key={message.id} className="flex justify-end">
                    <div className="max-w-[82%] rounded-2xl bg-white px-4 py-2.5 text-[15px] font-medium leading-7 text-zinc-950 shadow-sm">
                      {message.body}
                    </div>
                  </article>
                )
              }
              return (
                <article key={message.id} className="space-y-1.5">
                  <div className="flex items-center gap-2 text-[11px] text-zinc-500">
                    <span className="font-medium text-zinc-400">Codexの返答</span>
                    <span>{message.time}</span>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-[15px] leading-7 text-zinc-100">{message.body}</p>
                </article>
              )
            })}
          </div>
        </section>
      </div>
    </main>
  )
}
