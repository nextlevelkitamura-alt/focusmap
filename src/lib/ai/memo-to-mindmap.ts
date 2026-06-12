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
export const MAX_CONVERSATION_LOG_CHARS = 5000
export const MAX_HELD_CONVERSATION_ITEMS = 3
export const MAX_MINDMAP_INSTRUCTION_CHARS = 400

export const MindmapDraftItemKindSchema = z.enum(['policy', 'decision', 'question', 'task'])
export const MindmapDraftOrganizationGoalSchema = z.enum(['auto', 'merge', 'tasks'])

export const MindmapDraftTriageItemSchema = z.object({
  clientId: z.string().describe('一時ID。"h1","x1"... の形式'),
  title: z.string().describe('候補の見出し。接頭辞なしの内容見出し'),
  kind: MindmapDraftItemKindSchema.default('task').describe('候補の種類'),
  reason: z.string().describe('採用/保留/除外の理由。短く'),
  sourceNoteIds: z.array(z.string()).default([]).describe('根拠となる元メモID'),
})

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
  holdItems: z
    .array(MindmapDraftTriageItemSchema)
    .max(MAX_HELD_CONVERSATION_ITEMS)
    .default([])
    .describe('会話ログ整理時だけ使う保留候補。採用/除外をユーザーがすぐ選べるように最大3件'),
  excludedItems: z
    .array(MindmapDraftTriageItemSchema)
    .max(20)
    .default([])
    .describe('会話ログ整理時だけ使う除外候補。マップには入れないが確認・復活できるようにする'),
})

export type MindmapDraft = z.infer<typeof MindmapDraftSchema>
export type MindmapDraftNode = MindmapDraft['nodes'][number]
export type ExistingNodeRenameSuggestion = MindmapDraft['existingNodeRenameSuggestions'][number]
export type MindmapDraftTriageItem = z.infer<typeof MindmapDraftTriageItemSchema>
export type MindmapDraftInputKind = 'memo' | 'conversation_log'
export type MindmapDraftOrganizationGoal = z.infer<typeof MindmapDraftOrganizationGoalSchema>

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
14. 既存ノードに接続したいが既存ノード名が狭すぎる/ズレている場合だけ existingNodeRenameSuggestions に変更案を出す。既存ノード名は絶対に勝手に変更しない。
15. 既存マップが与えられた場合、プロジェクト概要、既存ノード見出し、既存ノードの memo プレビューを見て、重複や近い作業を増やさない。
16. 複数の新規要素が同じ目的・同じ作業群・同じ判断軸に属する時は、意味のあるまとめ親ノードを作ってから具体ノードをぶら下げる。1件だけをまとめるだけの空疎な親ノードは禁止。
17. 既存マップの大規模な移動・削除・並べ替えは提案しない。できることは、新規ノード群の追加、既存ノード配下への接続、既存ノード名の変更案だけ。`

const CONVERSATION_LOG_PROMPT = `
# 会話ログを整理する場合の追加ルール
入力がGPT等との会話ログの場合、「全文をマップ化」ではなく、残すべき判断・作業・論点だけを取捨選択して構造化する。

## 採用する情報
- 目的、方針、決定事項、未決の論点、実行タスク、制約、リスク、優先順位
- 後から見返した時に、次の判断や実行に使える内容

## 原則除外する情報
- 相槌、挨拶、前置き、AIのテンプレ説明、一般論、重複、言い直し
- ユーザーが却下した案、根拠のないAIの推測、プロジェクトに関係ない脱線
- APIキー、パスワード、認証情報、不要な個人情報

## 出力分類
- nodes: マップへ入れる採用候補だけを入れる。
- holdItems: 本当に判断不能なものだけ。最大${MAX_HELD_CONVERSATION_ITEMS}件まで。迷ったら保留ではなく採用か除外に寄せる。
- excludedItems: マップには入れないが、ユーザーが確認・復活できるよう短く列挙する。
- 会話ログ1件から複数の具体ノードを作る場合、同じ sourceNoteIds を複数ノードに入れてよい。

## ノードタイトル接頭辞
nodes の title は必ず次のいずれかの接頭辞で始める。
- 方針: 進め方・設計思想・ルール
- 決定: もう決めたこと
- 論点: まだ考えるべき問い・未決事項
- タスク: 実行する作業

holdItems / excludedItems の title には接頭辞を付けず、kind に policy / decision / question / task を入れる。
`

interface BuildPromptArgs {
  notes: MemoInput[]
  existingTree?: string
  inputKind: MindmapDraftInputKind
  organizationGoal: MindmapDraftOrganizationGoal
  userInstruction?: string
}

function buildGoalSection(goal: MindmapDraftOrganizationGoal): string {
  if (goal === 'merge') {
    return `# 整理方針
- 既存マップへ意味が近いものを統合・接続することを優先する。
- 同じ目的のメモが複数ある場合は、まとめ親ノードを作って枝として整理する。
- 既存ノードと重複する単独タスクを増やさない。必要なら attachToExistingTaskId を使う。`
  }
  if (goal === 'tasks') {
    return `# 整理方針
- 実行タスク、未決論点、決定事項を優先して残す。
- 背景説明や一般論は、実行や判断に必要な範囲だけ残す。
- ノード名は次に取る行動や判断が分かる見出しにする。`
  }
  return `# 整理方針
- プロジェクト目的と既存マップを見て、新規追加、既存ノード配下への接続、まとめ親ノード作成を自動判断する。
- まとまりを作る時は、複数の具体ノードを束ねる意味がある場合だけにする。`
}

function buildUserPrompt({ notes, existingTree, inputKind, organizationGoal, userInstruction }: BuildPromptArgs): string {
  const noteList = notes
    .map((n, i) => `${i + 1}. [id: ${n.id}]\n${n.content.trim()}`)
    .join('\n\n')

  const instruction = (userInstruction ?? '').trim()
  const instructionSection = instruction
    ? `\n\n# ユーザーからの追加指示\n${instruction.slice(0, MAX_MINDMAP_INSTRUCTION_CHARS)}`
    : ''
  const goalSection = `\n\n${buildGoalSection(organizationGoal)}`

  const existingSection = existingTree
    ? `\n\n# 追記先の既存プロジェクト文脈\n以下は追記先プロジェクトの目的・概要・既存ツリーです。各行の [task:...] / [group:...] が既存ノードIDです。memo は既存ノードのメモ冒頭です。\n新しいノード群は、適切なら追加ルートの attachToExistingTaskId に既存ノードIDを入れて接続してください。合わなければ null のまま新規ルートにしてください。\n既存ノード名を広げた方がよい場合だけ existingNodeRenameSuggestions に変更案と理由を出してください。自動変更は禁止です。\n${existingTree}`
    : ''

  const conversationSection = inputKind === 'conversation_log' ? `\n\n${CONVERSATION_LOG_PROMPT}` : ''

  return `次の${inputKind === 'conversation_log' ? '会話ログ' : 'メモ群'}をロジックツリーに整理してください。

# メモ一覧（全${notes.length}件）
${noteList}${goalSection}${instructionSection}${existingSection}${conversationSection}

${inputKind === 'conversation_log'
    ? `採用候補だけを nodes に入れ、判断不能なものは最大${MAX_HELD_CONVERSATION_ITEMS}件まで holdItems、マップ不要なものは excludedItems に分けてください。nodes の title は必ず「方針:」「決定:」「論点:」「タスク:」のいずれかで始めてください。`
    : `全てのメモIDを具体ノードの sourceNoteIds に割り当て、分類・要約・橋渡し用の追加ノードは sourceNoteIds: [] にした、最大${MAX_MINDMAP_DRAFT_DEPTH}層までのツリー構造 JSON を出力してください。`}`
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
  inputKind?: MindmapDraftInputKind
  organizationGoal?: MindmapDraftOrganizationGoal
  userInstruction?: string
}): Promise<GenerateDraftResult> {
  const { model, modelName } = getModelForMemoMindmap(args.mode)
  const usingDeepseek = modelName.toLowerCase().includes('deepseek')

  const result = await generateObject({
    model,
    schema: MindmapDraftSchema,
    system: SYSTEM_PROMPT,
    prompt: buildUserPrompt({
      notes: args.notes,
      existingTree: args.existingTree,
      inputKind: args.inputKind ?? 'memo',
      organizationGoal: args.organizationGoal ?? 'auto',
      userInstruction: args.userInstruction,
    }),
    temperature: args.inputKind === 'conversation_log' ? 0.2 : 0.3,
    ...(usingDeepseek
      ? {
        providerOptions: {
          deepseek: {
            thinking: { type: 'disabled' },
            reasoningEffort: 'medium',
          },
        },
      }
      : {}),
  })

  const inputTokens = result.usage.inputTokens ?? 0
  const outputTokens = result.usage.outputTokens ?? 0

  return { draft: result.object, modelName, inputTokens, outputTokens }
}
