export const metadata = {
  title: "利用規約 | Shikumika",
};

export default function TermsPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <h1 className="text-3xl font-bold mb-8">利用規約</h1>
      <p className="text-sm text-muted-foreground mb-8">最終更新日: 2026年3月11日</p>

      <div className="space-y-8 text-sm leading-relaxed">
        <section>
          <h2 className="text-xl font-semibold mb-3">1. サービスの概要</h2>
          <p>
            Shikumika（以下「本サービス」）は、タスク管理・習慣トラッキング・カレンダー連携・AIスケジューリングを提供する
            Webアプリケーションです。
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">2. 利用条件</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>本サービスの利用にはGoogleアカウントが必要です</li>
            <li>ユーザーは正確な情報を提供する責任を負います</li>
            <li>不正な目的での利用は禁止されます</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">3. 免責事項</h2>
          <p>
            本サービスは「現状のまま」提供されます。サービスの中断、データの損失等について、
            運営者は一切の責任を負いません。重要なデータについてはバックアップをお勧めします。
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">4. サービスの変更・終了</h2>
          <p>
            運営者は、事前の通知なくサービスの内容を変更、または終了する場合があります。
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">5. お問い合わせ</h2>
          <p>
            メール: nextlevel.kitamura@gmail.com
          </p>
        </section>
      </div>
    </div>
  );
}
