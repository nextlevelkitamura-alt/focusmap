export interface MindmapOrganizationNodeInput {
  id: string
  title: string
  parent_task_id: string | null
  is_group: boolean
  status: string | null
  stage: string | null
  order_index: number | null
  source?: string | null
}

export interface OrderedMindmapOrganizationNode extends MindmapOrganizationNodeInput {
  depth: number
  path: string
  parent_title: string | null
  children_count: number
}

export interface MindmapOrganizationCandidate {
  title: string
  parent_task_id: string | null
  parent_title: string | null
  node_ids: string[]
  node_titles: string[]
  reason: string
  confidence: 'medium' | 'low'
  operation_hint: string[]
  diagram: string
}

export interface MindmapOrganizationHarness {
  rules: string[]
  response_format: string[]
  apply_after_approval: string[]
  diagram_template: string
}

const DOMAIN_TERMS = [
  'Focusmap',
  'focusmap',
  'チャット',
  'プロジェクト',
  'マインドマップ',
  'ノート',
  'メモ',
  '予定',
  'カレンダー',
  'Codex',
  'AI',
  'エージェント',
  'タスク',
  'スマホ',
  'モバイル',
  'デスクトップ',
  'UI',
  '同期',
  '検索',
  '整理',
  '設定',
  '認証',
  '実行',
] as const

function compactTitle(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) return '無題'
  return normalized.length > 90 ? `${normalized.slice(0, 90)}...` : normalized
}

function stripTitlePrefix(value: string): string {
  return value
    .replace(/^(方針|決定|論点|タスク)\s*[:：]\s*/, '')
    .replace(/^[\s\-・*]+/, '')
    .trim()
}

function explicitPrefix(value: string): string | null {
  const title = stripTitlePrefix(value)
  const match = title.match(/^([^:：/／｜|、,]{2,18})\s*[:：/／｜|、,]/)
  if (!match) return null
  const prefix = compactTitle(match[1])
  if (/^(対応|改善|確認|作業|その他|メモ|タスク)$/.test(prefix)) return null
  return prefix
}

function domainTerm(value: string): string | null {
  const title = stripTitlePrefix(value)
  return DOMAIN_TERMS.find(term => title.includes(term)) ?? null
}

function groupingKey(value: string): { key: string; confidence: 'medium' | 'low' } | null {
  const prefix = explicitPrefix(value)
  if (prefix) return { key: prefix, confidence: 'medium' }
  const term = domainTerm(value)
  if (term) return { key: term, confidence: 'low' }
  return null
}

export function orderMindmapOrganizationNodes(
  nodes: MindmapOrganizationNodeInput[],
): OrderedMindmapOrganizationNode[] {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const childrenByParent = new Map<string | null, MindmapOrganizationNodeInput[]>()
  for (const node of nodes) {
    const key = node.parent_task_id ?? null
    const children = childrenByParent.get(key) ?? []
    children.push(node)
    childrenByParent.set(key, children)
  }
  for (const children of childrenByParent.values()) {
    children.sort((a, b) =>
      (a.order_index ?? 0) - (b.order_index ?? 0) ||
      compactTitle(a.title).localeCompare(compactTitle(b.title), 'ja'),
    )
  }

  const ordered: OrderedMindmapOrganizationNode[] = []
  const visited = new Set<string>()

  const visit = (node: MindmapOrganizationNodeInput, depth: number, parentPath: string[]) => {
    if (visited.has(node.id)) return
    visited.add(node.id)
    const title = compactTitle(node.title)
    const children = childrenByParent.get(node.id) ?? []
    const pathParts = [...parentPath, title]
    ordered.push({
      ...node,
      title,
      depth,
      path: pathParts.join(' / '),
      parent_title: node.parent_task_id ? compactTitle(byId.get(node.parent_task_id)?.title ?? '') : null,
      children_count: children.length,
    })
    children.forEach(child => visit(child, depth + 1, pathParts))
  }

  ;(childrenByParent.get(null) ?? []).forEach(root => visit(root, 0, []))
  nodes
    .filter(node => !visited.has(node.id))
    .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
    .forEach(node => visit(node, 0, []))

  return ordered
}

export function formatMindmapOrganizationTree(
  ordered: OrderedMindmapOrganizationNode[],
  limit = 120,
): string {
  if (ordered.length === 0) return '（マインドマップノードはまだありません）'
  const shown = ordered.slice(0, Math.max(1, limit))
  const lines = shown.map(node => {
    const indent = '  '.repeat(Math.min(node.depth, 8))
    const icon = node.is_group ? '▣' : '•'
    const state = node.status === 'done' || node.stage === 'done' ? ' [完了]' : ''
    const childCount = node.children_count > 0 ? ` (${node.children_count}件)` : ''
    const idLabel = node.is_group ? `group:${node.id}` : `node:${node.id}`
    return `${indent}${icon} ${node.title}${childCount}${state} [${idLabel}]`
  })
  if (ordered.length > shown.length) {
    lines.push(`...ほか${ordered.length - shown.length}件`)
  }
  return lines.join('\n')
}

export function suggestMindmapOrganizationCandidates(
  ordered: OrderedMindmapOrganizationNode[],
  maxCandidates = 6,
): MindmapOrganizationCandidate[] {
  const byParent = new Map<string | null, OrderedMindmapOrganizationNode[]>()
  for (const node of ordered) {
    const siblings = byParent.get(node.parent_task_id ?? null) ?? []
    siblings.push(node)
    byParent.set(node.parent_task_id ?? null, siblings)
  }

  const candidates: MindmapOrganizationCandidate[] = []
  for (const [parentId, siblings] of byParent.entries()) {
    const parentTitle = parentId
      ? ordered.find(node => node.id === parentId)?.title ?? null
      : null
    const groups = new Map<string, {
      confidence: 'medium' | 'low'
      nodes: OrderedMindmapOrganizationNode[]
    }>()

    for (const node of siblings) {
      if (node.is_group && node.children_count > 0) continue
      const key = groupingKey(node.title)
      if (!key) continue
      const current = groups.get(key.key) ?? { confidence: key.confidence, nodes: [] }
      current.confidence = current.confidence === 'medium' || key.confidence === 'medium' ? 'medium' : 'low'
      current.nodes.push(node)
      groups.set(key.key, current)
    }

    for (const [key, group] of groups.entries()) {
      if (group.nodes.length < 2) continue
      const title = `${key}を整理する`
      const nodeTitles = group.nodes.map(node => node.title)
      candidates.push({
        title,
        parent_task_id: parentId,
        parent_title: parentTitle,
        node_ids: group.nodes.map(node => node.id),
        node_titles: nodeTitles,
        reason: group.confidence === 'medium'
          ? `同じ接頭辞「${key}」を持つ兄弟ノードが複数あります。`
          : `見出しに共通語「${key}」を含む兄弟ノードが複数あります。`,
        confidence: group.confidence,
        operation_hint: [
          `saveMindmapDraft: 新規まとめ "${title}" を parentTaskId=${parentId ?? 'null'} に追加`,
          ...group.nodes.map(node => `saveMindmapDraft: 既存ノード "${node.title}" (${node.id}) を新規まとめ配下へ移動案として保存`),
        ],
        diagram: [
          `${parentTitle ?? 'ルート'}`,
          `└─ ${title}（新規まとめ）`,
          ...nodeTitles.map(nodeTitle => `   ├─ ${nodeTitle}`),
        ].join('\n'),
      })
    }
  }

  return candidates
    .sort((a, b) => {
      if (a.confidence !== b.confidence) return a.confidence === 'medium' ? -1 : 1
      return b.node_ids.length - a.node_ids.length
    })
    .slice(0, Math.max(1, maxCandidates))
}

export function buildMindmapOrganizationHarness(): MindmapOrganizationHarness {
  return {
    rules: [
      '整理範囲は既定で現在マインドマップ上にあるノードだけにする。Codex未配置/未取り込みチャット、未整理メモ、ノート見出しはユーザーが明示した時だけ含める。',
      '最初は見出しだけで全体を眺め、本文やメモ詳細を無差別に読まない。',
      'まとめ候補は提案に留め、ユーザー承認前に saveMindmapDraft を実行しない。',
      'チャット経由の整理結果は addMindmapGroup / moveMindmapNode / updateMindmapNode で本番DBへ直接反映せず、saveMindmapDraft で AI案 下書きへ保存する。',
      '判断に迷う候補だけ getMindmapNodeDetail や getNoteOrganizationDetail で詳細を読む。',
      '削除は提案しない。まず新規まとめノード作成、既存ノード配下への移動、必要なら名称変更案だけに絞る。',
      '提案では、新しいノードを作って紐づける案と、既存ノード配下へ入れる案の両方を検討して示す。片方が不要な場合は理由を短く添える。',
    ],
    response_format: [
      '1. 採用範囲: 既定では現在マップ上のノードのみ。ユーザーが明示した場合だけ、含めたCodex/メモ/ノート範囲を短く明記する。',
      '2. 読んだ前提: プロジェクト概要、現在の見出し数、見出しの大枠を短く共有する。',
      '3. 整理提案: 新規ノード作成案、既存ノードへ入れる案、移動するノード、理由、実行操作をカード風に出す。',
      '4. 図: ```text``` のツリーで「現在 → 提案後」を見せる。',
      '5. 確認: 「この案をAI案として保存してよいですか？」と聞き、承認後だけ saveMindmapDraft を呼ぶ。',
    ],
    apply_after_approval: [
      'saveMindmapDraft に新規ノード、既存ノード移動、ユーザー明示のタイトル調整、元メモ/チャット紐づきだけを渡す。',
      'AIによる既存タイトル一括変更、メモ/状態/進捗/予定変更、削除候補は下書き保存対象に入れない。',
      '保存後は、画面の AI案 で確認・手動調整し、確定で本番反映できることを短く伝える。',
    ],
    diagram_template: [
      '```text',
      '現在',
      'ルート',
      '├─ 既存ノードA',
      '├─ 既存ノードB',
      '',
      '提案後',
      'ルート',
      '└─ 新規まとめノード',
      '   ├─ 既存ノードA',
      '   └─ 既存ノードB',
      '```',
    ].join('\n'),
  }
}
