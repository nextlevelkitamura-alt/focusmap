import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { chatCompletion } from '@/lib/ai-client'
import {
  MemoSourceTypeSchema,
  MemoStructureModeSchema,
  memoItemContentHash,
  parseMemoStructureResult,
  stableHash,
  type MemoStructureItem,
  type MemoStructureResult,
} from '@/lib/memo-structure'
import type { Json } from '@/types/database'

type SourceMemo = {
  id: string
  sourceType: 'wishlist' | 'note'
  title: string
  body: string
  projectId: string | null
  aiSourcePayload?: unknown
}

type ProjectContext = {
  id: string
  title: string
  description: string
  purpose: string | null
}

type ExistingMemoItem = {
  id: string
  title: string
  body: string | null
  item_kind: string
  status: string
  parent_item_id: string | null
  project_id: string | null
  content_hash: string
}

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function buildSourceText(source: SourceMemo) {
  return [
    `タイトル: ${source.title}`,
    source.body ? `本文:\n${source.body}` : '',
  ].filter(Boolean).join('\n\n')
}

function compactText(value: string, maxLength = 120) {
  const text = value.replace(/\s+/g, ' ').trim()
  if (text.length <= maxLength) return text
  return `${text.slice(0, Math.max(0, maxLength - 3)).trim()}...`
}

function stripListPrefix(value: string) {
  return value
    .replace(/^\s*[-*・\d.)、]+\s*/, '')
    .replace(/^\[[ xX]\]\s*/, '')
    .trim()
}

function extractLocalCandidates(source: SourceMemo) {
  const text = source.body || source.title
  const lines = text
    .split(/\n+/)
    .flatMap(line => {
      const cleaned = stripListPrefix(line)
      if (cleaned.length > 90) {
        return cleaned.split(/[。.!？?]\s*/).map(part => part.trim()).filter(Boolean)
      }
      return [cleaned]
    })
    .map(line => stripListPrefix(line.replace(/^既存サブ項目[:：]?$/, '')))
    .filter(line => line.length >= 4)
    .filter(line => !/^タイトル[:：]/.test(line))
    .filter(line => !/^本文[:：]/.test(line))

  const seen = new Set<string>()
  return lines.filter(line => {
    const key = line.normalize('NFKC').replace(/\s+/g, '').toLowerCase()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 6)
}

function needsResearch(text: string) {
  return /調べ|リサーチ|比較|競合|事例|料金|価格|仕様|SDK|API|法律|制度|最新|React Flow|ライブラリ|市場|導入事例/i.test(text)
}

function needsDecision(text: string) {
  return /判断|決め|選ぶ|採用|やめる|残す|優先|方針|どちら|比較して決める/.test(text)
}

function actionTypeForText(text: string): MemoStructureItem['action_type'] {
  if (needsResearch(text)) return 'research'
  if (needsDecision(text)) return 'decision'
  return 'execution'
}

function itemKindForAction(actionType: MemoStructureItem['action_type']): MemoStructureItem['kind'] {
  if (actionType === 'research') return 'reference'
  if (actionType === 'decision') return 'decision'
  return 'task_candidate'
}

function makeExecutableTitle(text: string, fallbackTitle: string) {
  let value = stripListPrefix(text)
    .replace(/^現状[、,]\s*/, '')
    .replace(/^また[、,]\s*/, '')
    .replace(/^追加で/, '追加で')
    .replace(/という点について/g, 'か')
    .replace(/実際にお話しされているのか/g, '実際に合意されているか')
    .replace(/確認が必要です?。?$/g, '確認する')
    .replace(/確認する必要があります?。?$/g, '確認する')
    .replace(/申し出ること。?$/g, '伝える')
    .replace(/すること。?$/g, 'する')
    .replace(/必要があります?。?$/g, '洗い出す')
    .replace(/です。?$/g, '')
    .replace(/ます。?$/g, 'る')
    .trim()

  if (!/[るうくぐすつぬぶむ]|確認する|伝える|決める|調べる|作る|直す|入れる$/.test(value)) {
    if (/確認|合意|聞/.test(value)) value = `${value}を確認する`
    else if (/追加|必要|機能|要望/.test(value)) value = `${value}を整理する`
    else if (/調査|比較|仕様|事例|料金/.test(value)) value = `${value}を調べる`
    else value = `${value || fallbackTitle}を次の行動に落とす`
  }

  return compactText(value, 80)
}

function deriveActionItems(source: SourceMemo) {
  const candidates = extractLocalCandidates(source)
  const baseText = `${source.title}\n${source.body}`
  const items: Array<{ title: string; body: string | null; actionType: MemoStructureItem['action_type']; sourceQuote: string }> = []

  if (candidates.length <= 1) {
    const text = candidates[0] || source.body || source.title
    if (/確認|お話し|合意|聞/.test(text)) {
      items.push({
        title: makeExecutableTitle(text, source.title),
        body: '実行前に、相手との合意範囲や前提を短く確認する。',
        actionType: 'execution',
        sourceQuote: compactText(text, 240),
      })
    }
    if (/追加|必要|機能|要望|申し出/.test(text)) {
      items.push({
        title: '追加で必要な機能や要望を整理して伝える',
        body: '必要なものが出た場合に、後から拾える形で要望としてまとめる。',
        actionType: 'execution',
        sourceQuote: compactText(text, 240),
      })
    }
    if (items.length === 0) {
      const actionType = actionTypeForText(text)
      items.push({
        title: makeExecutableTitle(text, source.title),
        body: actionType === 'research' ? '実行前に必要な情報を集める。' : null,
        actionType,
        sourceQuote: compactText(text, 240),
      })
    }
  } else {
    for (const candidate of candidates) {
      const actionType = actionTypeForText(candidate)
      items.push({
        title: makeExecutableTitle(candidate, source.title),
        body: actionType === 'research' ? '実行前に必要な情報を集める。' : null,
        actionType,
        sourceQuote: compactText(candidate, 240),
      })
    }
  }

  if (items.length < 2 && /追加|必要|機能|要望/.test(baseText) && !items.some(item => /追加|機能|要望/.test(item.title))) {
    items.push({
      title: '追加で必要な機能や要望を整理する',
      body: null,
      actionType: 'execution',
      sourceQuote: compactText(baseText, 240),
    })
  }

  const researchIndex = items.findIndex(item => item.actionType === 'research')
  return items
    .filter((item, index) => item.actionType !== 'research' || index === researchIndex)
    .slice(0, 3)
}

function chooseLocalProjectId(source: SourceMemo, projects: ProjectContext[]) {
  if (source.projectId) return source.projectId
  const haystack = `${source.title}\n${source.body}`.normalize('NFKC').toLowerCase()
  let best: { id: string; score: number } | null = null

  for (const project of projects) {
    let score = 0
    const title = project.title.normalize('NFKC').toLowerCase().trim()
    const context = `${project.description ?? ''} ${project.purpose ?? ''}`.normalize('NFKC').toLowerCase()
    if (title && haystack.includes(title)) score += 4
    for (const token of context.split(/[\s、。,.]+/).filter(token => token.length >= 3).slice(0, 8)) {
      if (haystack.includes(token)) score += 1
    }
    if (score > 0 && (!best || score > best.score)) best = { id: project.id, score }
  }

  return best?.id ?? null
}

function buildLocalStructureResult(args: {
  source: SourceMemo
  projects: ProjectContext[]
  feedback: string
  reason: string
}): MemoStructureResult {
  const projectId = chooseLocalProjectId(args.source, args.projects)
  const actionItems = deriveActionItems(args.source)

  const items: MemoStructureItem[] = actionItems
    .map((action, index) => {
      const kind = itemKindForAction(action.actionType)
      return {
        client_id: `local-action-${index + 1}`,
        parent_client_id: null,
        parent_existing_item_id: null,
        title: action.title,
        body: action.body,
        kind,
        action_type: action.actionType,
        status: action.actionType === 'execution' ? 'task_candidate' : 'organized',
        suggested_project_id: projectId,
        confidence: action.actionType === 'execution' ? 0.68 : 0.58,
        source_quote: action.sourceQuote,
        reason: args.reason,
      }
    })

  return {
    summary: 'メモを実行可能な単位へ分解しました。必要なら各項目からリサーチプロンプトを作れます。',
    memory: {
      accepted_rules: ['分解結果は最大3件に抑え、実行/リサーチ/判断として扱う'],
      rejected_interpretations: args.feedback ? [args.feedback] : [],
      next_questions: [],
    },
    items,
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label}_TIMEOUT`)), timeoutMs)
    }),
  ])
}

function buildPrompt(args: {
  source: SourceMemo
  projects: ProjectContext[]
  existingItems: ExistingMemoItem[]
  linkedItemIds: Set<string>
  feedback: string
}) {
  const projectContext = args.projects
    .map(project => {
      const summary = (project.description || project.purpose || '').trim()
      return `- ${project.title} (id: ${project.id})\n  context: ${summary.slice(0, 300) || '(説明なし)'}`
    })
    .join('\n')

  const existing = args.existingItems.length > 0
    ? args.existingItems.map(item => {
        const linked = args.linkedItemIds.has(item.id) ? ' / already_in_mindmap' : ''
        return `- ${item.title} (id: ${item.id}, kind: ${item.item_kind}, status: ${item.status}${linked})\n  ${item.body ?? ''}`.trim()
      }).join('\n')
    : '(まだ構造化項目なし)'

  const feedbackSection = args.feedback
    ? `\n# 今回の壁打ちフィードバック\n${args.feedback}`
    : ''

  return `あなたは、人間の思いつきメモを「実行へ進めるための最小単位」にする編集者です。

# 目的
- メモは原材料として残す。
- メモが目的/要望/問題なら、達成に必要な実行単位へ分ける。
- メモ自体がミクロな行動なら、無理に分けず1件だけ出す。
- 分解結果は最大3件。
- 基本は execution。実行前に調査が必要な場合だけ research を最大1件まで含める。
- 判断が必要な場合だけ decision を出す。乱発しない。
- 既存項目と同じ内容は二度と出力しない。
- already_in_mindmap の項目は、マインドマップに再投入しない前提で扱う。
- 新たに入ってきた情報、またはフィードバックで修正すべき新解釈だけを出す。

# メモ
source_type: ${args.source.sourceType}
source_id: ${args.source.id}
${buildSourceText(args.source)}

# プロジェクト文脈
${projectContext || '(プロジェクトなし)'}

# 既存の構造化済み項目
${existing}${feedbackSection}

# 出力形式
JSONのみ。Markdownや説明文は不要。
{
  "summary": "今回の構造化方針を1-2文で",
  "memory": {
    "accepted_rules": ["今回採用した整理方針"],
    "rejected_interpretations": ["ユーザーが違うと言った解釈、または避けた解釈"],
    "next_questions": ["判断に迷う場合だけ、次に聞くべき質問"]
  },
  "items": [
    {
      "client_id": "i1",
      "parent_client_id": null,
      "parent_existing_item_id": null,
      "title": "120字以内",
      "body": "背景や判断材料。不要ならnull",
      "kind": "summary|theme|task_candidate|idea|question|reference|decision",
      "action_type": "execution|research|decision",
      "status": "organized|task_candidate",
      "suggested_project_id": "該当プロジェクトID。自信がなければnull",
      "confidence": 0.0,
      "source_quote": "根拠になる原文抜粋",
      "reason": "なぜその分類か"
    }
  ]
}

# 厳守
- items は最大3件。
- research は最大1件。
- 原文をそのままコピーしない。次に実行できる動詞の形へ変換する。
- 同じ意味の項目は既存項目を優先し、新規出力しない。
- 判断に迷うなら confidence を下げ、next_questions に聞くべきことを入れる。`
}

async function loadSourceMemo(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  sourceType: 'wishlist' | 'note',
  sourceId: string,
): Promise<SourceMemo | null> {
  if (sourceType === 'wishlist') {
    const { data, error } = await supabase
      .from('ideal_goals')
      .select('id, title, description, project_id, tags, memo_status, ai_source_payload, ideal_items(*)')
      .eq('id', sourceId)
      .eq('user_id', userId)
      .single()
    if (error || !data) return null
    const childLines = Array.isArray(data.ideal_items)
      ? data.ideal_items
          .map((item: { title?: string; description?: string | null; is_done?: boolean }) =>
            `- [${item.is_done ? 'x' : ' '}] ${asText(item.title)}${item.description ? `: ${item.description}` : ''}`,
          )
          .filter(line => line.trim() !== '- [ ]')
          .join('\n')
      : ''
    return {
      id: data.id,
      sourceType,
      title: data.title,
      body: [data.description, childLines ? `既存サブ項目:\n${childLines}` : ''].filter(Boolean).join('\n\n'),
      projectId: data.project_id,
      aiSourcePayload: data.ai_source_payload,
    }
  }

  const { data, error } = await supabase
    .from('notes')
    .select('id, content, project_id, image_urls, status')
    .eq('id', sourceId)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .single()
  if (error || !data) return null
  return {
    id: data.id,
    sourceType,
    title: data.content.slice(0, 60),
    body: data.content,
    projectId: data.project_id,
  }
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await request.json()
    const sourceType = MemoSourceTypeSchema.safeParse(body.source_type ?? 'wishlist')
    const mode = MemoStructureModeSchema.safeParse(body.mode ?? 'quick')
    const sourceId = asText(body.source_id)
    const feedback = asText(body.feedback)

    if (!sourceType.success) return NextResponse.json({ error: 'source_type が不正です' }, { status: 400 })
    if (!mode.success) return NextResponse.json({ error: 'mode が不正です' }, { status: 400 })
    if (!sourceId) return NextResponse.json({ error: 'source_id は必須です' }, { status: 400 })

    const source = await loadSourceMemo(supabase, user.id, sourceType.data, sourceId)
    if (!source) return NextResponse.json({ error: 'メモが見つかりません' }, { status: 404 })

    const { data: projects } = await supabase
      .from('projects')
      .select('id, title, description, purpose')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    const projectContexts = ((projects ?? []) as ProjectContext[]).map(project => ({
      id: project.id,
      title: project.title,
      description: project.description ?? '',
      purpose: project.purpose ?? null,
    }))

    const { data: existingItemsRaw } = await supabase
      .from('memo_items')
      .select('id, title, body, item_kind, status, parent_item_id, project_id, content_hash')
      .eq('user_id', user.id)
      .eq('source_type', source.sourceType)
      .eq('source_id', source.id)
      .neq('status', 'archived')
      .order('order_index', { ascending: true })
      .order('created_at', { ascending: true })

    const existingItems = (existingItemsRaw ?? []) as ExistingMemoItem[]

    const { data: existingLinks } = existingItems.length > 0
      ? await supabase
          .from('memo_node_links')
          .select('memo_item_id')
          .eq('user_id', user.id)
          .eq('source_type', source.sourceType)
          .eq('source_id', source.id)
          .eq('link_type', 'mindmap_node')
          .eq('status', 'active')
      : { data: [] as Array<{ memo_item_id: string }> }

    const linkedItemIds = new Set((existingLinks ?? []).map(link => link.memo_item_id))
    const sourceInputHash = stableHash({
      structure_version: 2,
      source_type: source.sourceType,
      source_id: source.id,
      mode: mode.data,
      title: source.title,
      body: source.body,
      project_contexts: projectContexts.map(p => ({ id: p.id, description: p.description, purpose: p.purpose })),
      feedback,
    })

    let existingRunQuery = supabase
      .from('memo_structure_runs')
      .select('*')
      .eq('user_id', user.id)
      .eq('source_type', source.sourceType)
      .eq('source_id', source.id)
      .eq('mode', mode.data)
      .eq('input_hash', sourceInputHash)
      .eq('status', 'completed')

    existingRunQuery = feedback
      ? existingRunQuery.eq('feedback', feedback)
      : existingRunQuery.is('feedback', null)

    const { data: existingRun } = await existingRunQuery
      .maybeSingle()

    if (existingRun) {
      const { data: items } = await supabase
        .from('memo_items')
        .select('*, memo_node_links(*)')
        .eq('user_id', user.id)
        .eq('source_type', source.sourceType)
        .eq('source_id', source.id)
        .neq('status', 'archived')
        .order('order_index', { ascending: true })
      return NextResponse.json({ run: existingRun, items: items ?? [], reused: true })
    }

    let structureSource: 'local_quick' | 'ai_deep' | 'local_fallback' = 'local_quick'
    let result: MemoStructureResult

    if (mode.data === 'quick') {
      result = buildLocalStructureResult({
        source,
        projects: projectContexts,
        feedback,
        reason: '速度優先のローカル分解',
      })
    } else {
      try {
        const responseText = await withTimeout(
          chatCompletion(
            [
              {
                role: 'system',
                content: '深い壁打ち用。JSONのみを返す。ユーザーの違和感を尊重し、既存解釈を重複出力せず、新規・修正点だけを構造化する。',
              },
              {
                role: 'user',
                content: buildPrompt({ source, projects: projectContexts, existingItems, linkedItemIds, feedback }),
              },
            ],
            { max_tokens: 1400, temperature: 0.35 },
          ),
          18000,
          'AI_MEMO_STRUCTURE',
        )
        result = parseMemoStructureResult(responseText)
        structureSource = result.items.length > 0 ? 'ai_deep' : 'local_fallback'
        if (result.items.length === 0) {
          result = buildLocalStructureResult({
            source,
            projects: projectContexts,
            feedback,
            reason: 'AIの出力項目が空だったためローカル分解',
          })
        }
      } catch (aiError) {
        console.warn('[memo-structure] AI deep structure fallback:', aiError)
        result = buildLocalStructureResult({
          source,
          projects: projectContexts,
          feedback,
          reason: 'AI構造化に失敗したためローカル分解',
        })
        result.memory.rejected_interpretations = [
          ...result.memory.rejected_interpretations,
          'AIのJSON出力が不安定だったため、今回はローカル分解を採用',
        ]
        structureSource = 'local_fallback'
      }
    }

    const replaceableItemIds = mode.data === 'quick'
      ? existingItems
          .filter(item => !linkedItemIds.has(item.id))
          .filter(item => ['inbox', 'organized', 'task_candidate'].includes(item.status))
          .map(item => item.id)
      : []

    if (replaceableItemIds.length > 0) {
      await supabase
        .from('memo_items')
        .update({ status: 'archived' })
        .eq('user_id', user.id)
        .in('id', replaceableItemIds)
    }

    const { data: run, error: runError } = await supabase
      .from('memo_structure_runs')
      .insert({
        user_id: user.id,
        source_type: source.sourceType,
        source_id: source.id,
        project_id: source.projectId,
        mode: mode.data,
        input_hash: sourceInputHash,
        feedback: feedback || null,
        project_context_snapshot: projectContexts as unknown as Json,
        existing_item_snapshot: existingItems as unknown as Json,
        result: result as unknown as Json,
        status: 'completed',
      })
      .select('*')
      .single()

    if (runError) return NextResponse.json({ error: runError.message }, { status: 500 })

    const replacingIds = new Set(replaceableItemIds)
    const existingByHash = new Map(existingItems.filter(item => !replacingIds.has(item.id)).map(item => [item.content_hash, item.id]))
    const validExistingIds = new Set(existingItems.filter(item => !replacingIds.has(item.id)).map(item => item.id))
    const createdIdByClientId = new Map<string, string>()
    const createdItems: unknown[] = []
    const sortedItems = [...result.items].sort((a, b) => {
      if (!a.parent_client_id && b.parent_client_id) return -1
      if (a.parent_client_id && !b.parent_client_id) return 1
      return 0
    })

    for (const [index, item] of sortedItems.entries()) {
      const contentHash = memoItemContentHash({ title: item.title, body: item.body, kind: item.kind })
      const existingId = existingByHash.get(contentHash)
      if (existingId) {
        createdIdByClientId.set(item.client_id, existingId)
        continue
      }

      const parentFromClient = item.parent_client_id ? createdIdByClientId.get(item.parent_client_id) : null
      const parentFromExisting = item.parent_existing_item_id && validExistingIds.has(item.parent_existing_item_id)
        ? item.parent_existing_item_id
        : null
      const projectId = item.suggested_project_id && projectContexts.some(project => project.id === item.suggested_project_id)
        ? item.suggested_project_id
        : source.projectId

      const insertPayload = {
        user_id: user.id,
        source_type: source.sourceType,
        source_id: source.id,
        structure_run_id: run.id,
        parent_item_id: parentFromClient ?? parentFromExisting ?? null,
        project_id: projectId,
        title: item.title,
        body: item.body ?? null,
        item_kind: item.kind,
        status: item.status,
        content_hash: contentHash,
        source_input_hash: sourceInputHash,
        confidence: item.confidence ?? null,
        order_index: existingItems.length + index,
        metadata: {
          source_quote: item.source_quote ?? null,
          reason: item.reason ?? null,
          client_id: item.client_id,
          feedback: feedback || null,
          structure_source: structureSource,
          action_type: item.action_type ?? 'execution',
        },
      }

      const { data: inserted, error: itemError } = await supabase
        .from('memo_items')
        .insert(insertPayload)
        .select('*')
        .single()

      if (itemError) {
        if (itemError.code === '23505') continue
        return NextResponse.json({ error: itemError.message }, { status: 500 })
      }
      createdIdByClientId.set(item.client_id, inserted.id)
      createdItems.push(inserted)
    }

    if (source.sourceType === 'wishlist') {
      const previousPayload = source.aiSourcePayload && typeof source.aiSourcePayload === 'object' && !Array.isArray(source.aiSourcePayload)
        ? source.aiSourcePayload as Record<string, unknown>
        : {}
      await supabase
        .from('ideal_goals')
        .update({
          memo_status: 'organized',
          ai_source_payload: {
            ...previousPayload,
            memo_structure: {
              latest_run_id: run.id,
              input_hash: sourceInputHash,
              summary: result.summary ?? null,
              memory: result.memory,
            },
          },
        })
        .eq('id', source.id)
        .eq('user_id', user.id)
    } else {
      await supabase
        .from('notes')
        .update({ status: 'processed' })
        .eq('id', source.id)
        .eq('user_id', user.id)
    }

    const { data: items } = await supabase
      .from('memo_items')
      .select('*, memo_node_links(*)')
      .eq('user_id', user.id)
      .eq('source_type', source.sourceType)
      .eq('source_id', source.id)
      .neq('status', 'archived')
      .order('order_index', { ascending: true })
      .order('created_at', { ascending: true })

    return NextResponse.json({
      run,
      result,
      created_items: createdItems,
      items: items ?? [],
      reused: false,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[memo-structure] error:', message, error)
    const isAiConfig = message.includes('EXTERNAL_AI_API_KEY') || message.includes('External non-Google AI providers')
    return NextResponse.json(
      { error: isAiConfig ? 'AI構造化を実行するためのAI設定がありません' : message },
      { status: isAiConfig ? 503 : 500 },
    )
  }
}
