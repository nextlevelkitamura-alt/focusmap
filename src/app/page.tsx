import Link from 'next/link'

export const metadata = {
  title: 'Focusmap',
  description: 'AIが予定とタスクを整理し、人間が俯瞰して承認するダッシュボードです。',
}

export default function Home() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="mx-auto flex min-h-screen w-full max-w-5xl flex-col justify-center px-6 py-12">
        <div className="max-w-3xl space-y-8">
          <div className="space-y-4">
            <p className="text-sm font-medium text-muted-foreground">AI task and calendar dashboard</p>
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Focusmap</h1>
            <p className="text-lg leading-8 text-muted-foreground">
              Focusmap は、タスク、メモ、Google カレンダーの予定をひとつの画面で整理し、
              AIの提案を確認しながら日々の予定作成と調整を進めるためのWebアプリです。
            </p>
          </div>

          <div className="grid gap-4 text-sm leading-7 text-muted-foreground sm:grid-cols-3">
            <div className="border-l border-border pl-4">
              タスクと予定を同期し、作成・変更・削除した予定をGoogleカレンダーへ反映します。
            </div>
            <div className="border-l border-border pl-4">
              空き時間や作業量を確認しながら、AIがスケジュール候補を提示します。
            </div>
            <div className="border-l border-border pl-4">
              ユーザーが承認した操作だけを実行し、カレンダー連携はいつでも解除できます。
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

          <p className="text-sm text-muted-foreground">
            お問い合わせ: nextlevel.kitamura@gmail.com
          </p>
        </div>
      </section>
    </main>
  )
}
