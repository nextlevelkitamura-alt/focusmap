import Link from 'next/link'
import type { ReactNode } from 'react'
import {
  ArrowRight,
  Calendar,
  Check,
  Cpu,
  GitBranch,
  Lock,
  MessagesSquare,
  ShieldCheck,
  Sparkles,
  Terminal,
  Wallet,
} from 'lucide-react'

export const metadata = {
  title: 'FocusMap — あなたのAIを、マインドマップから動かす',
  description:
    '考えをマインドマップで可視化し、あなたが契約しているAI（Codex / Claude / Gemini）にプロンプトを注入。ローカルで実行し、往復しながらタスクを片付ける。API再販ゼロ、従量課金なしの定額。Mac で動く、AIの司令地図。',
}

/* ---- 小物 ---- */

function StatePill({ label, tone }: { label: string; tone: 'idle' | 'run' | 'wait' | 'done' }) {
  const map: Record<string, string> = {
    idle: 'bg-zinc-800 text-zinc-400',
    run: 'bg-violet-500/15 text-violet-300 ring-1 ring-violet-500/30',
    wait: 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30',
    done: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30',
  }
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${map[tone]}`}>
      {tone === 'run' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-400" />}
      {label}
    </span>
  )
}

function Section({
  id,
  eyebrow,
  title,
  children,
}: {
  id?: string
  eyebrow?: string
  title: string
  children: ReactNode
}) {
  return (
    <section id={id} className="mx-auto w-full max-w-6xl px-6 py-14 sm:py-20">
      {eyebrow && <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-violet-400">{eyebrow}</p>}
      <h2 className="max-w-3xl text-2xl font-bold tracking-tight text-zinc-50 sm:text-3xl">{title}</h2>
      <div className="mt-8">{children}</div>
    </section>
  )
}

/* ---- ヒーローの実UI風モック ---- */

function ProductMock() {
  return (
    <div className="relative w-full overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/70 shadow-2xl shadow-black/40 backdrop-blur">
      {/* ウィンドウバー */}
      <div className="flex items-center gap-1.5 border-b border-zinc-800 px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
        <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
        <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
        <span className="ml-2 text-[10px] text-zinc-500">FocusMap — 司令地図</span>
        <span className="ml-auto inline-flex items-center gap-1 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
          <Cpu className="h-3 w-3" /> Codex
        </span>
      </div>

      <div className="grid grid-cols-1 gap-px bg-zinc-800 sm:grid-cols-[1.1fr_1fr]">
        {/* 左: マインドマップ */}
        <div className="bg-zinc-900/80 p-4">
          <div className="mb-3 inline-flex rounded-md bg-zinc-800/80 px-2 py-1 text-xs font-medium text-zinc-200">
            転職を検討
          </div>
          <div className="space-y-2 pl-3">
            <div className="flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5">
              <span className="text-xs text-zinc-300">市場の年収レンジを調べる</span>
              <StatePill label="実行中" tone="run" />
            </div>
            <div className="flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5">
              <span className="text-xs text-zinc-300">職務経歴書ドラフト</span>
              <StatePill label="要返信" tone="wait" />
            </div>
            <div className="flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5">
              <span className="text-xs text-zinc-300">情報収集の時間を確保</span>
              <StatePill label="完了" tone="done" />
            </div>
            <div className="flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5">
              <span className="text-xs text-zinc-500">昇給交渉の準備</span>
              <StatePill label="待機" tone="idle" />
            </div>
          </div>
        </div>

        {/* 右: 実行ログ + カレンダー */}
        <div className="flex flex-col bg-zinc-950/80">
          <div className="flex items-center gap-1 border-b border-zinc-800 px-3 py-1.5 text-[10px] text-zinc-500">
            <Terminal className="h-3 w-3" /> 実行ログ
          </div>
          <div className="flex-1 space-y-1 p-3 font-mono text-[10px] leading-relaxed text-zinc-400">
            <p><span className="text-violet-400">▸</span> 市場データを収集中…</p>
            <p className="text-zinc-500">  3社の求人レンジを取得</p>
            <p><span className="text-emerald-400">✓</span> 中央値: 620〜780万</p>
            <p className="text-zinc-300">
              次に進めますか？{' '}
              <span className="inline-block h-3 w-1.5 translate-y-0.5 animate-pulse bg-zinc-300" />
            </p>
          </div>
          <div className="border-t border-zinc-800 p-3">
            <div className="flex items-center gap-2 rounded-md bg-emerald-500/10 px-2.5 py-1.5 ring-1 ring-emerald-500/20">
              <Calendar className="h-3.5 w-3.5 text-emerald-300" />
              <span className="text-[11px] text-emerald-200">情報収集 — 明日 14:00 を追加</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ---- ページ本体 ---- */

export default function Home() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 antialiased">
      {/* 背景の淡いグラデ */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute left-1/2 top-[-10%] h-[480px] w-[820px] -translate-x-1/2 rounded-full bg-violet-600/15 blur-[120px]" />
      </div>

      {/* ナビ */}
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
        <span className="inline-flex items-center gap-2 text-base font-semibold tracking-tight">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/focusmap-icon.svg" alt="FocusMap" className="h-8 w-8" /> FocusMap
        </span>
        <nav className="flex items-center gap-2">
          <Link href="#pricing" className="hidden rounded-md px-3 py-2 text-sm text-zinc-400 hover:text-zinc-100 sm:inline-flex">
            料金
          </Link>
          <Link href="/login" className="inline-flex min-h-11 items-center rounded-md bg-zinc-100 px-4 text-sm font-medium text-zinc-900 hover:bg-white">
            ログイン
          </Link>
        </nav>
      </header>

      {/* ヒーロー */}
      <section className="mx-auto grid w-full max-w-6xl items-center gap-12 px-6 pb-12 pt-8 sm:pt-16 lg:grid-cols-2">
        <div className="space-y-7">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1 text-xs text-zinc-400">
            <Sparkles className="h-3.5 w-3.5 text-violet-400" /> あなたのAIサブスクで動く司令地図
          </span>
          <h1 className="text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl">
            あなたの
            <span className="bg-gradient-to-r from-violet-300 to-sky-300 bg-clip-text text-transparent">
              構想
            </span>
            から、
            <br />
            AIが動く。
          </h1>
          <p className="max-w-xl text-lg leading-8 text-zinc-400">
            マインドマップから、あなたが契約している Codex / Claude にプロンプトを注入。
            ローカルで実行し、往復しながらタスクを片付ける。
            <span className="text-zinc-200">API は再販しない。だから従量課金の青天井が無い。</span>
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/login"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-gradient-to-r from-violet-500 to-sky-500 px-5 text-sm font-semibold text-white shadow-lg shadow-violet-900/30 hover:opacity-95"
            >
              無料で始める <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="#how"
              className="inline-flex min-h-11 items-center rounded-md border border-zinc-800 px-5 text-sm font-medium text-zinc-300 hover:bg-zinc-900"
            >
              30秒で分かる
            </Link>
          </div>
          <p className="text-xs text-zinc-500">Mac で動作 · デモ動画 近日公開</p>
        </div>

        <div className="relative">
          <ProductMock />
          <p className="mt-3 text-center text-[11px] text-zinc-600">※ 実画面イメージ。デモ動画は近日公開</p>
        </div>
      </section>

      {/* 信頼帯（誇張しない） */}
      <div className="mx-auto w-full max-w-6xl px-6">
        <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 rounded-xl border border-zinc-900 bg-zinc-900/30 px-6 py-4 text-xs text-zinc-500">
          <span className="inline-flex items-center gap-1.5"><Lock className="h-3.5 w-3.5" /> ローカル実行・認証は手元のMacに</span>
          <span className="inline-flex items-center gap-1.5"><Wallet className="h-3.5 w-3.5" /> API再販ゼロ・従量課金なし</span>
          <span className="inline-flex items-center gap-1.5"><Cpu className="h-3.5 w-3.5" /> Codex / Claude / Gemini 対応予定</span>
        </div>
      </div>

      {/* マジック説明 */}
      <Section eyebrow="The Magic" title="マインドマップが、AIの司令塔になる。">
        <div className="grid gap-5 sm:grid-cols-3">
          {[
            {
              icon: <GitBranch className="h-5 w-5 text-violet-400" />,
              h: 'ノード＝仕事の単位',
              p: '考えを枝に分解。各ノードが「待機 / 実行中 / 要返信 / 完了」の状態を持つ、生きたタスク。',
            },
            {
              icon: <MessagesSquare className="h-5 w-5 text-violet-400" />,
              h: '往復で進む',
              p: 'AIが返してきた確認や結果をその場で受け取り、あなたが返信。撃ちっぱなしではなく、会話で詰める。',
            },
            {
              icon: <Calendar className="h-5 w-5 text-violet-400" />,
              h: '行動まで繋がる',
              p: '決まったことはカレンダーや進捗ボードへ。考えるだけで終わらせない。',
            },
          ].map((f) => (
            <div key={f.h} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
              <div className="mb-3">{f.icon}</div>
              <h3 className="text-sm font-semibold text-zinc-100">{f.h}</h3>
              <p className="mt-1.5 text-sm leading-6 text-zinc-400">{f.p}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* ユニットエコノミクスの楔 */}
      <Section eyebrow="Why FocusMap" title="API は再販しない。あなたが払っているAIで実行する。">
        <div className="grid gap-8 lg:grid-cols-2">
          <p className="text-base leading-8 text-zinc-400">
            多くのAIツールは、高価なAPIを月額に上乗せして再販します。だから使うほど不安になる。
            FocusMap は違う。実行を担うのは
            <span className="text-zinc-100"> あなたがすでに契約している Codex / Claude のサブスク</span>。
            FocusMap が課金するのは「考えを可視化し、AIを差配する」レイヤーだけ。
            <span className="text-zinc-100"> だから定額。従量の青天井が無い。</span>
          </p>
          <div className="space-y-3">
            {[
              ['従量課金の青天井が無い', '実行コストはあなたのサブスク側。FocusMapは定額のみ。'],
              ['ローカル実行で安全', '認証情報・Cookieは手元のMacから出ない。'],
              ['ベンダーに縛られない', 'Codexが使えなくなっても、Claude / Gemini に切り替えるだけ。'],
            ].map(([h, p]) => (
              <div key={h} className="flex items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                <div>
                  <p className="text-sm font-medium text-zinc-100">{h}</p>
                  <p className="text-sm text-zinc-400">{p}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* 使い方 3ステップ */}
      <Section id="how" eyebrow="How it works" title="繋いで、描いて、実行する。">
        <div className="grid gap-5 sm:grid-cols-3">
          {[
            ['01', 'AIを繋ぐ', 'お使いの Codex / Claude をローカルに接続。あなたのログインのまま動く。'],
            ['02', '考えを描く', 'AIと壁打ちしながら、頭の中をマインドマップに構造化する。'],
            ['03', 'ノードから実行', 'ノードを選んで実行。AIがローカルで動き、往復しながら片付ける。'],
          ].map(([n, h, p]) => (
            <div key={n} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
              <span className="font-mono text-xs text-violet-400">{n}</span>
              <h3 className="mt-2 text-sm font-semibold text-zinc-100">{h}</h3>
              <p className="mt-1.5 text-sm leading-6 text-zinc-400">{p}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* 差別化 */}
      <Section eyebrow="Comparison" title="ラッパーでも、ただのマインドマップでもない。">
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6">
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">vs 自動化SaaS（Zapier / Lindy）</p>
            <p className="mt-2 text-sm leading-7 text-zinc-300">
              クレジット・従量課金で使うほど不安。FocusMap は定額で、実行はあなたのAIサブスク。
              しかもローカルで自分のログインのまま動く。
            </p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6">
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">vs チャットAI（ChatGPT 単体）</p>
            <p className="mt-2 text-sm leading-7 text-zinc-300">
              答えが返るだけで行動に繋がらない。FocusMap は対話を構造化し、ノードから実行し、
              カレンダーと進捗まで動かす。
            </p>
          </div>
        </div>
      </Section>

      {/* 安全 + OAuth開示（審査用に保持） */}
      <Section eyebrow="Security" title="認証情報は、手元のMacから出ない。">
        <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
          <div className="flex items-start gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-6">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
            <p className="text-sm leading-7 text-zinc-300">
              実行はあなたのMac上で完結。Cookie や認証トークンはクラウドに送らない。
              連携はいつでも設定画面から解除できます。
            </p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6 text-sm leading-7 text-zinc-400">
            <p className="font-medium text-zinc-200">Google Calendar integration</p>
            <p className="mt-1">
              After logging in, users can connect their Google account from the calendar settings screen. FocusMap then
              uses the Google Calendar API to read upcoming events, create new events when the user schedules a task,
              and update or delete events the user manages inside FocusMap.
            </p>
            <p className="mt-1">
              Requested OAuth scopes: <code className="text-zinc-200">calendar.events</code>
              {' · '}
              <code className="text-zinc-200">calendar.calendarlist.readonly</code>. Connection can be revoked at any
              time from the calendar settings.
            </p>
          </div>
        </div>
      </Section>

      {/* 料金（アーリーアクセス・定額・API再販なし） */}
      <Section id="pricing" eyebrow="Pricing" title="シンプルな定額。従量課金なし。">
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6">
            <p className="text-sm font-semibold text-zinc-100">Free</p>
            <p className="mt-1 text-3xl font-bold text-zinc-50">$0</p>
            <p className="mt-1 text-xs text-zinc-500">まず触ってみる</p>
            <ul className="mt-4 space-y-2 text-sm text-zinc-400">
              {['マインドマップ + メモ', 'AI実行 週10回まで（お試し・1ターン=1回）', 'ノード数 / プロジェクト数に上限', 'AI接続 1つ'].map((t) => (
                <li key={t} className="flex items-start gap-2">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" /> {t}
                </li>
              ))}
            </ul>
            <Link
              href="/login"
              className="mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-md border border-zinc-700 text-sm font-medium text-zinc-200 hover:bg-zinc-800"
            >
              無料で始める
            </Link>
          </div>

          <div className="relative rounded-xl border border-violet-500/40 bg-violet-500/[0.04] p-6 shadow-lg shadow-violet-900/20">
            <span className="absolute right-5 top-5 rounded-full bg-violet-500 px-2 py-0.5 text-[10px] font-semibold text-white">
              近日
            </span>
            <p className="text-sm font-semibold text-zinc-100">Pro</p>
            <p className="mt-1 text-3xl font-bold text-zinc-50">
              $20<span className="ml-1 text-sm font-normal text-zinc-500">/ 月</span>
            </p>
            <p className="mt-1 text-xs text-zinc-500">実行はあなたのAIサブスク。FocusMapは定額のみ。</p>
            <ul className="mt-4 space-y-2 text-sm text-zinc-300">
              {['ノード / プロジェクト 無制限', 'AI実行 無制限（往復こみ・回数制限なし）', '会話ログ監視・再注入', '複数AI接続（Codex / Claude / Gemini）', 'カレンダー / 進捗連携'].map(
                (t) => (
                  <li key={t} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" /> {t}
                  </li>
                ),
              )}
            </ul>
            <Link
              href="/login"
              className="mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-md bg-gradient-to-r from-violet-500 to-sky-500 text-sm font-semibold text-white hover:opacity-95"
            >
              アーリーアクセスに参加
            </Link>
          </div>
        </div>
        <p className="mt-4 text-xs text-zinc-600">
          実行コストはあなたが契約するAIサブスク側で発生します。FocusMap はAPIを再販しません。
        </p>
      </Section>

      {/* FAQ */}
      <Section eyebrow="FAQ" title="よくある質問">
        <div className="grid gap-4 sm:grid-cols-2">
          {[
            ['Macは必須ですか？', '現在はMacでのローカルAI実行を前提にしています（macOS）。常時起動できる環境を推奨します。'],
            ['どのAIサブスクが要りますか？', 'まずは Codex（ChatGPT / OpenAI）に対応。Claude / Gemini など他のAIへの対応を広げていきます。'],
            ['データはどこに保存されますか？', '認証情報・Cookieは手元のMacに保管され、クラウドへ送信しません。'],
            ['Codexが使えなくなったら？', '複数AI対応なので、Claude や Gemini など別のAIに切り替えて使い続けられます。'],
          ].map(([q, a]) => (
            <div key={q} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
              <p className="text-sm font-medium text-zinc-100">{q}</p>
              <p className="mt-1.5 text-sm leading-6 text-zinc-400">{a}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* 最終CTA */}
      <section className="mx-auto w-full max-w-6xl px-6 pb-24">
        <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-gradient-to-br from-zinc-900 to-zinc-950 p-10 text-center sm:p-14">
          <h2 className="mx-auto max-w-2xl text-2xl font-bold tracking-tight text-zinc-50 sm:text-3xl">
            API再販ゼロ。あなたのサブスクで、考えを実行に変える。
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm text-zinc-400">
            マインドマップから、あなたのAIを司令する。FocusMap で始めましょう。
          </p>
          <Link
            href="/login"
            className="mt-7 inline-flex min-h-11 items-center gap-1.5 rounded-md bg-gradient-to-r from-violet-500 to-sky-500 px-6 text-sm font-semibold text-white hover:opacity-95"
          >
            無料で始める <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* フッター */}
      <footer className="border-t border-zinc-900">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 py-8 text-sm text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
          <span className="inline-flex items-center gap-2 font-semibold text-zinc-300">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/focusmap-icon.svg" alt="FocusMap" className="h-5 w-5" /> FocusMap
          </span>
          <div className="flex flex-wrap items-center gap-4">
            <Link href="/login" className="inline-flex min-h-11 items-center hover:text-zinc-200">ログイン</Link>
            <Link href="/privacy" className="inline-flex min-h-11 items-center hover:text-zinc-200">プライバシーポリシー</Link>
            <Link href="/terms" className="inline-flex min-h-11 items-center hover:text-zinc-200">利用規約</Link>
            <a href="mailto:nextlevel.kitamura@gmail.com" className="inline-flex min-h-11 items-center hover:text-zinc-200">お問い合わせ</a>
          </div>
        </div>
      </footer>
    </main>
  )
}
