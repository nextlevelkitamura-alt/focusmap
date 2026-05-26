import Link from 'next/link'
import { PLAN_DEFINITIONS, PLAN_ORDER } from '@/lib/plans'
import { formatCurrency } from '@/lib/format'
import { Check, Lock, Server, Zap } from 'lucide-react'

export const metadata = {
  title: 'Focusmap — あなたのMacで動く、AI業務自動化',
  description:
    'ローカル実行でデータが手元から出ない。Webアプリで管理、社員はボタンを押すだけ。Zapier や Lindy より透明な価格、Mac mini連携の自動化プラットフォーム。',
}

export default function Home() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="mx-auto w-full max-w-5xl px-6 py-16 sm:py-20">
        <div className="max-w-3xl space-y-10">
          <div className="space-y-4">
            <p className="text-sm font-medium text-muted-foreground">AI 業務自動化プラットフォーム</p>
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
              あなたのMacで動く、<br className="sm:hidden" />AI業務自動化
            </h1>
            <p className="text-lg leading-8 text-muted-foreground">
              Focusmap は、Mac mini に常駐するエージェントと Web アプリの管理画面を組み合わせた、
              小規模法人・個人事業主向けの AI 自動化プラットフォームです。
              認証情報は手元から出ず、社員はボタンを押すだけで自動化が動きます。
            </p>
          </div>

          <div className="grid gap-4 text-sm leading-7 text-muted-foreground sm:grid-cols-3">
            <div className="border-l border-border pl-4">
              <Lock className="mb-1 h-4 w-4 text-primary" />
              <span className="block font-medium text-foreground">ローカル実行</span>
              認証Cookieは手元のMacに保管。クラウドへの流出ゼロ。
            </div>
            <div className="border-l border-border pl-4">
              <Server className="mb-1 h-4 w-4 text-primary" />
              <span className="block font-medium text-foreground">Webで管理</span>
              スキル選択・実行ログ・チーム共有は SaaS で完結。
            </div>
            <div className="border-l border-border pl-4">
              <Zap className="mb-1 h-4 w-4 text-primary" />
              <span className="block font-medium text-foreground">使った分だけ可視化</span>
              Claude Code 型の使用量バーで残量が常時見える。
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link
              href="/login"
              className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground"
            >
              ログイン
            </Link>
            <Link
              href="/privacy"
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-border px-5 text-sm font-medium"
            >
              プライバシーポリシー
            </Link>
            <Link
              href="/terms"
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-border px-5 text-sm font-medium"
            >
              利用規約
            </Link>
          </div>

          <div className="rounded-lg border border-border p-5 text-sm leading-7 text-muted-foreground space-y-2">
            <p className="font-medium text-foreground">Google Calendar integration</p>
            <p>
              After logging in, users can connect their Google account from the calendar settings screen. Focusmap then
              uses the Google Calendar API to read upcoming events, create new events when the user schedules a task,
              and update or delete events the user manages inside Focusmap.
            </p>
            <p>
              Requested OAuth scopes:
              {' '}
              <code className="text-foreground">calendar.events</code>
              {' · '}
              <code className="text-foreground">calendar.calendarlist.readonly</code>
              . Connection can be revoked at any time from the calendar settings.
            </p>
          </div>

          <section className="space-y-4 pt-8" id="pricing">
            <div className="space-y-1">
              <h2 className="text-2xl font-bold tracking-tight">料金プラン</h2>
              <p className="text-sm text-muted-foreground">
                Zapier / Lindy と比べて透明、月額に AI 実行コストまで含まれます。
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {PLAN_ORDER.map((planId) => {
                const plan = PLAN_DEFINITIONS[planId]
                const isFree = planId === 'free'
                const isHighlighted = planId === 'team'
                return (
                  <div
                    key={planId}
                    className={
                      'rounded-lg border p-5 flex flex-col gap-3 ' +
                      (isHighlighted
                        ? 'border-primary/60 bg-primary/[0.04] shadow-sm'
                        : 'border-border bg-background')
                    }
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-foreground">{plan.jaName}</p>
                        {isHighlighted && (
                          <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
                            推奨
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{plan.description}</p>
                    </div>
                    <div>
                      {planId === 'enterprise' ? (
                        <p className="text-2xl font-bold">お問い合わせ</p>
                      ) : (
                        <p className="text-2xl font-bold">
                          {formatCurrency(plan.priceUsdPerSeat, 'USD')}
                          <span className="ml-1 text-xs font-normal text-muted-foreground">
                            /月{plan.minSeats > 1 ? ` × seat` : ''}
                          </span>
                        </p>
                      )}
                      {!isFree && plan.minSeats > 1 && (
                        <p className="text-[11px] text-muted-foreground">最低 {plan.minSeats} seat〜</p>
                      )}
                    </div>
                    <ul className="space-y-1 text-xs leading-relaxed text-muted-foreground">
                      <li className="flex items-start gap-1.5">
                        <Check className="mt-0.5 h-3 w-3 text-emerald-500 shrink-0" />
                        月 {isFinite(plan.monthlyExecutionsPerSeat) ? plan.monthlyExecutionsPerSeat : '∞'} 回
                        {plan.minSeats > 1 ? '/seat' : ''} 実行
                      </li>
                      {plan.features.macMiniSupport && (
                        <li className="flex items-start gap-1.5">
                          <Check className="mt-0.5 h-3 w-3 text-emerald-500 shrink-0" />
                          Mac mini 連携
                        </li>
                      )}
                      {plan.features.teamSharing && (
                        <li className="flex items-start gap-1.5">
                          <Check className="mt-0.5 h-3 w-3 text-emerald-500 shrink-0" />
                          チーム共有
                        </li>
                      )}
                      {plan.features.adminDashboard && (
                        <li className="flex items-start gap-1.5">
                          <Check className="mt-0.5 h-3 w-3 text-emerald-500 shrink-0" />
                          管理画面 + Analytics
                        </li>
                      )}
                      {plan.features.auditLog && (
                        <li className="flex items-start gap-1.5">
                          <Check className="mt-0.5 h-3 w-3 text-emerald-500 shrink-0" />
                          監査ログ
                        </li>
                      )}
                      {plan.features.sso && (
                        <li className="flex items-start gap-1.5">
                          <Check className="mt-0.5 h-3 w-3 text-emerald-500 shrink-0" />
                          SSO / SAML
                        </li>
                      )}
                      {plan.features.byok && (
                        <li className="flex items-start gap-1.5">
                          <Check className="mt-0.5 h-3 w-3 text-emerald-500 shrink-0" />
                          BYOK (API key 持ち込み)
                        </li>
                      )}
                    </ul>
                    <Link
                      href={planId === 'enterprise' ? 'mailto:hello@focusmap-official.com' : '/login'}
                      className={
                        'mt-auto inline-flex min-h-9 items-center justify-center rounded-md px-3 text-xs font-medium transition-colors ' +
                        (isHighlighted
                          ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                          : 'border border-border hover:bg-muted/60')
                      }
                    >
                      {isFree ? '無料で始める' : planId === 'enterprise' ? 'お問い合わせ' : 'プランを選ぶ'}
                    </Link>
                  </div>
                )
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              月額にはAI実行コストが含まれます (Gemini Flash-Lite / DeepSeek V4 Pro 等の激安モデル採用)。
              超過分は Personal $0.20 / Team $0.10 のpay-as-you-go。
            </p>
          </section>

          <p className="text-sm text-muted-foreground">
            お問い合わせ: nextlevel.kitamura@gmail.com
          </p>
        </div>
      </section>
    </main>
  )
}
