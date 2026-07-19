import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { createClient } from '@/utils/supabase/server';
import { getRepos } from '@/lib/turso/todos';
import { getActiveThemes } from '@/lib/turso/themes';
import { addTodo } from '../actions';
import { ThemeSelect } from '../_components/theme-select';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ addError?: string }>;
}

const DO_KIND_OPTIONS = [
  { value: 'today', label: '今日' },
  { value: 'tomorrow', label: '明日' },
  { value: 'this_week', label: '今週' },
  { value: 'next_week', label: '来週' },
  { value: 'custom', label: '日付...' },
];

function PillRadio({
  name,
  value,
  label,
  defaultChecked,
}: {
  name: string;
  value: string;
  label: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="block">
      <input type="radio" name={name} value={value} defaultChecked={defaultChecked} required className="peer sr-only" />
      <span className="flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-border px-2 text-center text-sm font-medium text-muted-foreground transition-colors peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring">
        {label}
      </span>
    </label>
  );
}

export default async function AddTodoPage({ searchParams }: PageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const params = await searchParams;
  const [repos, themes] = await Promise.all([getRepos().catch(() => []), getActiveThemes().catch(() => [])]);

  return (
    <div className="mx-auto min-h-0 w-full max-w-lg flex-1 space-y-5 overflow-y-auto pb-10">
      <header className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-11 w-11" asChild>
          <Link href="/dashboard/board" aria-label="戻る">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <h1 className="text-lg font-semibold">やることを追加</h1>
      </header>

      {params.addError === '1' ? (
        <p role="alert" className="text-sm text-destructive">
          追加できませんでした。タイトル・実行repo・任せるの選択を確認してください。
        </p>
      ) : null}

      <form action={addTodo} className="space-y-5">
        <div>
          <label htmlFor="title" className="mb-1.5 block text-sm font-medium">
            何をやる？
          </label>
          <Input id="title" name="title" required placeholder="例: 求人票の下書きを作る" className="h-12 text-base" autoComplete="off" />
        </div>

        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">いつ</legend>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {DO_KIND_OPTIONS.map((option, index) => (
              <PillRadio key={option.value} name="doKind" value={option.value} label={option.label} defaultChecked={index === 0} />
            ))}
          </div>
          <div className="mt-2">
            <label htmlFor="customDate" className="mb-1 block text-xs text-muted-foreground">
              「日付...」を選んだ場合はここで指定
            </label>
            <input
              id="customDate"
              name="customDate"
              type="date"
              className="h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm"
            />
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">実行repo</legend>
          {repos.length > 0 ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {repos.map((repo, index) => (
                <PillRadio key={repo.slug} name="repo" value={repo.slug} label={repo.name} defaultChecked={index === 0} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-destructive">
              repo一覧を読み込めませんでした（PERSONAL_OS_INBOX_* の接続設定を確認してください）。
            </p>
          )}
        </fieldset>

        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">任せる（必須）</legend>
          <div className="grid grid-cols-2 gap-2">
            <PillRadio name="assignee" value="self" label="自分でやる" />
            <PillRadio name="assignee" value="ai" label="AIに任せる" defaultChecked />
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">大課題テーマ</legend>
          <ThemeSelect themes={themes.map((theme) => ({ id: theme.id, name: theme.name }))} />
          <p className="mt-1 text-xs text-muted-foreground">
            未選択は「未分類」。新規テーマの目的・完了条件は、作成後にボードの鉛筆から書けます。
          </p>
        </fieldset>

        <details className="rounded-lg border border-border">
          <summary className="cursor-pointer select-none px-3 py-2.5 text-sm text-muted-foreground">
            締切・メモ・的への紐付けは詳しく ▾
          </summary>
          <div className="space-y-3 border-t border-border p-3">
            <div>
              <label htmlFor="dueDate" className="mb-1 block text-xs text-muted-foreground">
                締切
              </label>
              <input
                id="dueDate"
                name="dueDate"
                type="date"
                className="h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              />
            </div>
            <div>
              <label htmlFor="note" className="mb-1 block text-xs text-muted-foreground">
                メモ
              </label>
              <textarea
                id="note"
                name="note"
                rows={3}
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="goalRef" className="mb-1 block text-xs text-muted-foreground">
                紐付ける的（slug・任意）
              </label>
              <Input id="goalRef" name="goalRef" placeholder="例: 2026-07-17-当日ボードSQL化" className="h-10" />
            </div>
          </div>
        </details>

        <Button type="submit" className="h-12 w-full text-base font-semibold">
          追加する
        </Button>
      </form>
    </div>
  );
}
