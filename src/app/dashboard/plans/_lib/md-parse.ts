// 子07: 計画スマホ表示。program.md / plan.md の生md本文（plan_docs.body）を
// 表示用に軽量パースする純関数群。DBアクセスは持たない（lib/turso/plan-docs.ts が担当）。
// 子計画マップ・完了条件のパース規則は plan-ops `_planops_map.py` に準拠する（表示用の読み取り専用ミラー）。

export type ChildBlock = {
  nn: string
  checked: boolean | null // チェックボックスが無い旧形式は null
  title: string
  state: string
  fields: Record<string, string> // 役割/対象repo/並列/レビュー/人間ゲート/次/場所/依存/参照 等
}

export type CompletionItem = {
  done: boolean
  text: string
}

const SEP = ' … '
// 行頭（インデント無し）で `- [ ]`/`- [x]`（任意）+ 2桁数字 + 空白 + 本文、を子計画マップの見出し行とみなす。
const HEADER_RE = /^(?:- \[([ x])\]\s+)?(\d{2})(\s+)(.*)$/
const FIELD_LABELS = ['役割', '対象repo', '並列', 'レビュー', '人間ゲート', '次', '場所', '依存', '参照']

function headingLevel(line: string): number {
  const m = /^(#+)[ \t]/.exec(line)
  return m ? m[1].length : 0
}

/** `heading_prefix` で前方一致する見出しを探し [見出しindex, 本文開始, 本文終端) を返す。無ければnull。 */
function findSection(lines: string[], headingPrefix: string): [number, number, number] | null {
  for (let i = 0; i < lines.length; i++) {
    const lv = headingLevel(lines[i])
    if (lv === 0) continue
    const text = lines[i].replace(/^#+\s*/, '').trim()
    if (text.startsWith(headingPrefix)) {
      let end = lines.length
      for (let j = i + 1; j < lines.length; j++) {
        const lv2 = headingLevel(lines[j])
        if (lv2 !== 0 && lv2 <= lv) {
          end = j
          break
        }
      }
      return [i, i + 1, end]
    }
  }
  return null
}

function stateBase(stateText: string): string {
  if (!stateText) return ''
  const idx = stateText.search(/[（(]/)
  return (idx >= 0 ? stateText.slice(0, idx) : stateText).trim()
}

/** 「## 子計画マップ」セクションから子ブロック一覧を抽出する。無ければ空配列。 */
export function parseChildMap(body: string): ChildBlock[] {
  const lines = body.split('\n')
  const section = findSection(lines, '子計画マップ')
  if (!section) return []
  const [, bodyStart, bodyEnd] = section

  const headers: { nn: string; checked: boolean | null; title: string; state: string; idx: number }[] = []
  for (let i = bodyStart; i < bodyEnd; i++) {
    const m = HEADER_RE.exec(lines[i])
    if (!m) continue
    const [, check, nn, , rest] = m
    const sepIdx = rest.indexOf(SEP)
    const title = (sepIdx >= 0 ? rest.slice(0, sepIdx) : rest).trim()
    const state = sepIdx >= 0 ? rest.slice(sepIdx + SEP.length).trim() : ''
    headers.push({ nn, checked: check === undefined ? null : check === 'x', title, state, idx: i })
  }

  const blocks: ChildBlock[] = []
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i]
    const blockEnd = i + 1 < headers.length ? headers[i + 1].idx : bodyEnd
    const fields: Record<string, string> = {}
    for (let j = h.idx + 1; j < blockEnd; j++) {
      const stripped = lines[j].replace(/^[ \t]+/, '')
      for (const label of FIELD_LABELS) {
        if (stripped.startsWith(`${label}:`)) {
          fields[label] = stripped.slice(label.length + 1).trim()
          break
        }
      }
    }
    blocks.push({ nn: h.nn, checked: h.checked, title: h.title, state: h.state, fields })
  }
  return blocks
}

export function childIsDone(block: ChildBlock): boolean {
  return block.checked === true || stateBase(block.state) === '完了'
}

/** 「## 完了条件（レビュー項目）」セクションのチェックリストを抽出する。無ければ空配列。 */
export function parseCompletionItems(body: string): CompletionItem[] {
  const lines = body.split('\n')
  const section = findSection(lines, '完了条件')
  if (!section) return []
  const [, bodyStart, bodyEnd] = section
  const items: CompletionItem[] = []
  const itemRe = /^\s*- \[([ x])\]\s*(.*)$/
  for (let i = bodyStart; i < bodyEnd; i++) {
    const m = itemRe.exec(lines[i])
    if (m) items.push({ done: m[1] === 'x', text: m[2].trim() })
  }
  return items
}

/** program.md/plan.md冒頭、先頭H1より前の「ラベル: 値 ／ ラベル: 値」メタ行を Map にする。 */
export function parseMetaHeader(body: string): Map<string, string> {
  const lines = body.split('\n')
  const meta = new Map<string, string>()
  for (const line of lines) {
    if (/^#\s/.test(line)) break
    if (!line.trim()) continue
    for (const chunk of line.split('／')) {
      const idx = chunk.indexOf(':')
      if (idx < 0) continue
      const label = chunk.slice(0, idx).trim()
      const value = chunk.slice(idx + 1).trim()
      if (label && value) meta.set(label, value)
    }
  }
  return meta
}

/** 一覧カードの「次の一手」1行。program: 最初の未完了子の次:。single: 最初の未完了完了条件。 */
export function deriveNextStep(body: string, kind: 'program' | 'single'): string {
  if (kind === 'program') {
    const blocks = parseChildMap(body)
    const next = blocks.find((b) => !childIsDone(b))
    if (!next) return blocks.length > 0 ? '全子完了・統合評価待ち' : ''
    return next.fields['次'] || `${next.title}（${next.state || '状態不明'}）`
  }
  const items = parseCompletionItems(body)
  const next = items.find((item) => !item.done)
  return next ? next.text : items.length > 0 ? '完了条件すべてチェック済み' : ''
}

/** md本文から先頭メタ行（H1より前）を取り除いた本体だけを返す（Badge帯へ分離済みのため）。 */
export function stripMetaHeader(body: string): string {
  const lines = body.split('\n')
  const h1Index = lines.findIndex((line) => /^#\s/.test(line))
  if (h1Index <= 0) return body
  return lines.slice(h1Index).join('\n')
}

export type Freshness = {
  label: string // 例: "3分前" / "2時間前" / "たった今"
  stale: boolean // 30分超で true（表示側でamber等の視覚強調に使う）
}

/** 最終同期時刻の相対表示。syncedAtがISOとして解釈できなければ空labelを返す（表示側は非表示にする）。 */
export function formatFreshness(syncedAt: string, now: number = Date.now()): Freshness {
  const t = Date.parse(syncedAt)
  if (Number.isNaN(t)) return { label: '', stale: false }
  const minutes = Math.max(0, Math.floor((now - t) / 60000))
  const stale = minutes > 30
  if (minutes < 1) return { label: 'たった今', stale }
  if (minutes < 60) return { label: `${minutes}分前`, stale }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return { label: `${hours}時間前`, stale }
  const days = Math.floor(hours / 24)
  return { label: `${days}日前`, stale }
}

/**
 * md本文中の相対リンク（href）を、同一計画（program_slug）内の既知パス集合から解決する。
 * 解決できたら plan_docs.path（内部ルートへ変換する材料）を返し、できなければ null
 * （呼び出し側はグレー非リンクとして描画する）。
 * 絶対URL（http/https/mailto）・アンカーのみ（#…）は対象外（null）。
 */
export function resolveRelativeLink(currentPath: string, href: string, knownPaths: Set<string>): string | null {
  if (!href) return null
  if (/^([a-z]+:)?\/\//i.test(href) || href.startsWith('mailto:') || href.startsWith('#')) return null

  const [hrefPath] = href.split('#')
  if (!hrefPath) return null

  const currentDir = currentPath.split('/').slice(0, -1)
  const segments = hrefPath.split('/')
  const stack = [...currentDir]
  for (const seg of segments) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      stack.pop()
      continue
    }
    stack.push(seg)
  }
  const resolved = stack.join('/')
  return knownPaths.has(resolved) ? resolved : null
}
