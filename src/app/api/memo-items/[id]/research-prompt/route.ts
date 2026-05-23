import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

type RouteContext = {
  params: Promise<{ id: string }>
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function compact(value: string | null | undefined, max = 700) {
  const normalized = (value ?? '').replace(/\s+/g, ' ').trim()
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, Math.max(0, max - 3)).trim()}...`
}

function buildResearchPrompt(args: {
  memoTitle: string
  memoBody: string
  itemTitle: string
  itemBody: string
  projectTitle: string
  projectContext: string
}) {
  return `あなたはFocusmapのリサーチ担当です。

目的:
次の実行項目に着手できるよう、必要な情報だけを調べて結論を返してください。ログ全文や長い調査過程は不要です。

元メモ:
${args.memoTitle}
${args.memoBody ? `\n${args.memoBody}` : ''}

実行/検討項目:
${args.itemTitle}
${args.itemBody ? `\n補足: ${args.itemBody}` : ''}

プロジェクト文脈（参考）:
${args.projectTitle || '未設定'}
${args.projectContext || '文脈なし'}

出力形式:
1. 結論: 3行以内
2. 根拠: 重要な根拠だけ3点以内
3. 次の実行: Focusmapに戻すべき実行項目を1-3件
4. 判断が必要な点: あれば1-2件

制約:
- 情報が古い可能性があるものは最新情報を確認してください。
- 推測と確認済み事実を分けてください。
- Focusmapに戻す内容は結論中心にしてください。`
}

async function loadSourceMemo(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  sourceType: string,
  sourceId: string,
) {
  if (sourceType === 'wishlist') {
    const { data } = await supabase
      .from('ideal_goals')
      .select('title, description')
      .eq('id', sourceId)
      .eq('user_id', userId)
      .maybeSingle()
    return {
      title: text(data?.title),
      body: text(data?.description),
    }
  }

  const { data } = await supabase
    .from('notes')
    .select('content')
    .eq('id', sourceId)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .maybeSingle()

  const content = text(data?.content)
  return {
    title: compact(content, 80),
    body: content,
  }
}

export async function POST(_request: NextRequest, context: RouteContext) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await context.params

  const { data: item, error: itemError } = await supabase
    .from('memo_items')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (itemError || !item) return NextResponse.json({ error: '構造化項目が見つかりません' }, { status: 404 })

  const [sourceMemo, projectResult] = await Promise.all([
    loadSourceMemo(supabase, user.id, item.source_type, item.source_id),
    item.project_id
      ? supabase
          .from('projects')
          .select('title, description, purpose')
          .eq('id', item.project_id)
          .eq('user_id', user.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const project = projectResult.data
  const projectContext = compact([text(project?.description), text(project?.purpose)].filter(Boolean).join('\n'), 500)
  const prompt = buildResearchPrompt({
    memoTitle: compact(sourceMemo.title, 160),
    memoBody: compact(sourceMemo.body, 700),
    itemTitle: compact(item.title, 160),
    itemBody: compact(item.body, 400),
    projectTitle: text(project?.title),
    projectContext,
  })

  const metadata = item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata)
    ? item.metadata as Record<string, unknown>
    : {}

  await supabase
    .from('memo_items')
    .update({
      metadata: {
        ...metadata,
        research_prompt: prompt,
        research_prompt_generated_at: new Date().toISOString(),
      },
    })
    .eq('id', item.id)
    .eq('user_id', user.id)

  return NextResponse.json({ prompt })
}
