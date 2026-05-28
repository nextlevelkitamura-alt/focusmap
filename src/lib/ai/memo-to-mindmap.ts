/**
 * メモ→マインドマップ変換のコアロジック。
 * 複数メモを受け取り、AIがロジックツリー（フラットなノード配列）へ再編する。
 *
 * 再帰スキーマ（z.lazy）は構造化出力で不安定なため、
 * フラット配列 + 親参照（parentTempId）でツリーを表現する。
 */
import { z } from 'zod'
import { generateObject } from 'ai'
import { getModelForMemoMindmap, type MemoMindmapMode } from './providers'

export const MAX_MINDMAP_DRAFT_DEPTH = 4

export const MindmapDraftSchema = z.object({
  projectTitle: z.string().describe('マインドマップ全体のタイトル。簡潔に'),
  nodes: z
    .array(
      z.object({
        tempId: z.string().describe('一時ID。"n1","n2"... の形式'),
        title: z.string().describe('ノードの見出し。簡潔に'),
        parentTempId: z
          .string()
          .nullable()
          .describe('親ノードの tempId。ルートノードは null'),
        sourceNoteIds: z
          .array(z.string())
          .describe('このノードが直接表す元メモID。分類・要約・橋渡し用の追加ノードは空配列'),
        attachToExistingTaskId: z
          .string()
          .nullable()
          .default(null)
          .describe('既存マップの接続先task_id。parentTempIdがnullの追加ルートだけ指定可'),
      }),
    )
    .describe('ツリーを構成する全ノード。階層は parentTempId で表現'),
  existingNodeRenameSuggestions: z
    .array(
      z.object({
        taskId: z.string().describe('変更候補の既存ノードID'),
        currentTitle: z.string().describe('現在の既存ノード名'),
        suggestedTitle: z.string().describe('変更案。内容の見出しだけを書く'),
        reason: z.string().describe('なぜ名前を広げる/変えるべきか'),
      }),
    )
    .default([])
    .describe('既存ノード名の変更案。自動適用禁止。必要な場合だけ出す'),
})

export type MindmapDraft = z.infer<typeof MindmapDraftSchema>
export type MindmapDraftNode = MindmapDraft['nodes'][number]
export type ExistingNodeRenameSuggestion = MindmapDraft['existingNodeRenameSuggestions'][number]

export interface MemoInput {
  id: string
  content: string
}

const SYSTEM_PROMPT = `あなたは、散らばったメモを整理して論理的なマインドマップ（ロジックツリー）へ再編する編集者です。

# 役割
ユーザーが書き溜めた複数のメモを受け取り、それらを意味のある階層構造（ツリー）にまとめます。

# 厳守するルール
1. メモの原文を尊重し、書かれていない事実を勝手に足さない。
2. 追加するノード群は最大${MAX_MINDMAP_DRAFT_DEPTH}層まで。5層以上は禁止。原則は浅く、必要な場合だけ3〜4層にする。
3. 主旨が近いメモは同じ枝にまとめる。
4. 抽象 → 具体 の順で親子関係を作る（上位ほど大きな概念）。
5. 与えられた全てのメモIDを、いずれかの「元メモそのものを直接表す具体ノード」の sourceNoteIds に必ず割り当てる。取りこぼし禁止。
6. tempId は "n1","n2",... と一意に振る。ルートノードの parentTempId は null。
7. ノードの title は簡潔に（長文にしない）。メモ本文そのままのコピーは避け、見出しとして要約する。
8. 1つのメモが複数のノードに関係する場合は、最も主たる具体ノードの sourceNoteIds に入れる。
9. 複数メモを束ねるために新しく作る分類・要約・橋渡し・論点整理ノードは sourceNoteIds を必ず [] にする。これはメモではなく、ただの構造ノード。
10. title に「メモ」「ノード」「まとめ用ノード」など管理上の呼称を入れず、内容の見出しだけを書く。
11. 既存マップが与えられた場合、意味が明確に近い既存ノードがあれば、追加ルートの attachToExistingTaskId に既存ノードIDを入れて接続する。
12. attachToExistingTaskId を指定できるのは parentTempId が null の追加ルートだけ。子ノードごとに別々の既存ノードへ散らさない。
13. 異なるトピックなら無理に既存ノードへ接続せず、attachToExistingTaskId は null にする。
14. 既存ノードに接続したいが既存ノード名が狭すぎる/ズレている場合だけ existingNodeRenameSuggestions に変更案を出す。既存ノード名は絶対に勝手に変更しない。`

interface BuildPromptArgs {
  notes: MemoInput[]
  existingTree?: string
}

function buildUserPrompt({ notes, existingTree }: BuildPromptArgs): string {
  const noteList = notes
    .map((n, i) => `${i + 1}. [id: ${n.id}]\n${n.content.trim()}`)
    .join('\n\n')

  const existingSection = existingTree
    ? `\n\n# 既存のマインドマップ構造\n以下は追記先の既存ツリーです。各行の [task:...] / [group:...] が既存ノードIDです。\n新しいノード群は、適切なら追加ルートの attachToExistingTaskId に既存ノードIDを入れて接続してください。合わなければ null のまま新規ルートにしてください。\n既存ノード名を広げた方がよい場合だけ existingNodeRenameSuggestions に変更案と理由を出してください。自動変更は禁止です。\n${existingTree}`
    : ''

  return `次のメモ群をロジックツリーに整理してください。

# メモ一覧（全${notes.length}件）
${noteList}${existingSection}

全てのメモIDを具体ノードの sourceNoteIds に割り当て、分類・要約・橋渡し用の追加ノードは sourceNoteIds: [] にした、最大${MAX_MINDMAP_DRAFT_DEPTH}層までのツリー構造 JSON を出力してください。`
}

export function buildDraftChildMap(nodes: MindmapDraftNode[]): Map<string, string[]> {
  const ids = new Set(nodes.map(node => node.tempId))
  const childMap = new Map<string, string[]>()

  for (const node of nodes) {
    if (!node.parentTempId || !ids.has(node.parentTempId)) continue
    const children = childMap.get(node.parentTempId) ?? []
    children.push(node.tempId)
    childMap.set(node.parentTempId, children)
  }

  return childMap
}

export function isSourceBackedDraftNode(
  node: MindmapDraftNode,
  childMap: Map<string, string[]>,
): boolean {
  if (node.sourceNoteIds.length === 0) return false
  return (childMap.get(node.tempId)?.length ?? 0) === 0
}

export function getDraftNodeDepths(nodes: MindmapDraftNode[]): Map<string, number> {
  const nodeByTempId = new Map(nodes.map(node => [node.tempId, node]))
  const depthCache = new Map<string, number>()

  const depthOf = (tempId: string, seen: Set<string> = new Set()): number => {
    if (depthCache.has(tempId)) return depthCache.get(tempId)!
    if (seen.has(tempId)) return 1
    seen.add(tempId)
    const node = nodeByTempId.get(tempId)
    if (!node?.parentTempId || !nodeByTempId.has(node.parentTempId)) {
      depthCache.set(tempId, 1)
      return 1
    }
    const depth = depthOf(node.parentTempId, seen) + 1
    depthCache.set(tempId, depth)
    return depth
  }

  for (const node of nodes) depthOf(node.tempId)
  return depthCache
}

export function getDraftDepthViolations(
  nodes: MindmapDraftNode[],
  maxDepth: number = MAX_MINDMAP_DRAFT_DEPTH,
): MindmapDraftNode[] {
  const depths = getDraftNodeDepths(nodes)
  return nodes.filter(node => (depths.get(node.tempId) ?? 1) > maxDepth)
}

export interface GenerateDraftResult {
  draft: MindmapDraft
  modelName: string
  inputTokens: number
  outputTokens: number
}

/**
 * メモ群からマインドマップのドラフトを生成する。DBへの書き込みは行わない。
 */
export async function generateMindmapDraft(args: {
  notes: MemoInput[]
  mode: MemoMindmapMode
  existingTree?: string
}): Promise<GenerateDraftResult> {
  const { model, modelName } = getModelForMemoMindmap(args.mode)

  const result = await generateObject({
    model,
    schema: MindmapDraftSchema,
    system: SYSTEM_PROMPT,
    prompt: buildUserPrompt({ notes: args.notes, existingTree: args.existingTree }),
  })

  const inputTokens = result.usage.inputTokens ?? 0
  const outputTokens = result.usage.outputTokens ?? 0

  return { draft: result.object, modelName, inputTokens, outputTokens }
}
