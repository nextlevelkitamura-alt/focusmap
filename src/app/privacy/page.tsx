export const metadata = {
  title: "プライバシーポリシー | Focusmap",
};

export default function PrivacyPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <h1 className="text-3xl font-bold mb-8">プライバシーポリシー</h1>
      <p className="text-sm text-muted-foreground mb-8">最終更新日: 2026年3月11日</p>

      <div className="space-y-8 text-sm leading-relaxed">
        <section>
          <h2 className="text-xl font-semibold mb-3">1. はじめに</h2>
          <p>
            Focusmap（以下「本アプリ」）は、ユーザーのプライバシーを尊重し、個人情報の保護に努めます。
            本プライバシーポリシーは、本アプリがどのような情報を収集し、どのように利用するかを説明します。
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">2. 収集する情報</h2>
          <h3 className="text-lg font-medium mb-2">2.1 アカウント情報</h3>
          <p className="mb-3">
            Googleアカウントを使用したログイン時に、以下の情報を取得します：
          </p>
          <ul className="list-disc pl-6 space-y-1">
            <li>メールアドレス</li>
            <li>表示名</li>
            <li>プロフィール画像URL</li>
          </ul>

          <h3 className="text-lg font-medium mb-2 mt-4">2.2 Googleカレンダーデータ</h3>
          <p className="mb-3">
            ユーザーが明示的に許可した場合に限り、Googleカレンダーの予定データ（タイトル、日時、説明）にアクセスし、予定の作成・更新・削除を行います。
            このデータは以下の目的でのみ使用されます：
          </p>
          <ul className="list-disc pl-6 space-y-1">
            <li>タスクとカレンダー予定の同期・表示・作成・更新・削除</li>
            <li>AIによるスケジューリング提案</li>
          </ul>

          <h3 className="text-lg font-medium mb-2 mt-4">2.3 ユーザー作成データ</h3>
          <p>タスク、プロジェクト、習慣、メモなど、ユーザーがアプリ内で作成したデータ。</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">3. データの利用目的</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>本アプリの機能提供（タスク管理、カレンダー連携、習慣トラッキング）</li>
            <li>AIによるスケジューリングおよびタスク管理の支援</li>
            <li>サービスの改善・不具合の修正</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">4. データの共有</h2>
          <p>
            本アプリは、ユーザーの個人情報を第三者に販売、貸与、共有することはありません。
            ただし、以下の場合を除きます：
          </p>
          <ul className="list-disc pl-6 space-y-1">
            <li>ユーザーの明示的な同意がある場合</li>
            <li>法令に基づく開示要求がある場合</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">5. データの保管</h2>
          <p>
            ユーザーデータはSupabase（クラウドデータベース）に安全に保管されます。
            Googleカレンダーのデータはキャッシュ目的で一時的に保持されますが、永続的に保存されることはありません。
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">6. データの削除</h2>
          <p>
            ユーザーはいつでもアカウントの削除を要求できます。
            アカウント削除時には、関連するすべてのデータが完全に削除されます。
            削除のご要望は、アプリ内の設定画面またはメールにてお問い合わせください。
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">7. Googleユーザーデータの取り扱い（Limited Use準拠）</h2>
          <p className="mb-3">
            本アプリによるGoogleカレンダーAPIから取得した情報の使用と転送は、
            <a
              href="https://developers.google.com/terms/api-services-user-data-policy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline"
            >
              Google API Services User Data Policy
            </a>
            （Limited Use requirementsを含む）に準拠します。具体的には以下を遵守します。
          </p>
          <ul className="list-disc pl-6 space-y-1">
            <li>取得したGoogleカレンダーデータは、ユーザーが本アプリ内でタスクと予定を管理するための機能提供にのみ使用します。</li>
            <li>広告（リターゲティング広告・パーソナライズ広告を含む）目的でGoogleユーザーデータを使用または転送しません。</li>
            <li>人間が読む形でGoogleユーザーデータを閲覧することは、ユーザーの明示的な同意がある場合、セキュリティ上必要な場合、適用法令に従う場合、または匿名化・集約された運用目的に限定されます。</li>
            <li>Googleユーザーデータを第三者に販売しません。</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">8. English Summary (for Google OAuth Verification)</h2>
          <p className="mb-3">
            Focusmap&apos;s use and transfer of information received from Google APIs to any other app will adhere to the
            {' '}
            <a
              href="https://developers.google.com/terms/api-services-user-data-policy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline"
            >
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements.
          </p>
          <p className="mb-3">
            Focusmap requests the following Google OAuth scopes:
          </p>
          <ul className="list-disc pl-6 space-y-1 mb-3">
            <li>
              <code>https://www.googleapis.com/auth/calendar.events</code> — to read upcoming events and to create,
              update, or delete events on behalf of the user when the user explicitly schedules a task inside Focusmap.
            </li>
            <li>
              <code>https://www.googleapis.com/auth/calendar.calendarlist.readonly</code> — to list the user&apos;s
              calendars so they can choose which calendars to display and which calendar to write new events into.
            </li>
          </ul>
          <p>
            Focusmap does not use Google user data for advertising. Focusmap does not sell Google user data. Focusmap does
            not allow humans to read Google user data unless we obtain explicit consent from the user, it is necessary for
            security purposes, it is required by applicable law, or the data is aggregated and anonymized for internal
            operations. Users can disconnect Google Calendar at any time from the calendar settings inside the app, which
            deletes the stored OAuth tokens.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">9. お問い合わせ</h2>
          <p>
            プライバシーに関するご質問やお問い合わせは、以下までご連絡ください：
          </p>
          <p className="mt-2">
            メール: nextlevel.kitamura@gmail.com
          </p>
        </section>
      </div>
    </div>
  );
}
