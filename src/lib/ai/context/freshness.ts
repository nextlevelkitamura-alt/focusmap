/**
 * AI Context Freshness Score System
 * 指数減衰方式でドキュメントの鮮度を算出する
 */

export type FreshnessStatus = 'fresh' | 'aging' | 'stale'

export type DocumentType =
  | 'personality'
  | 'purpose'
  | 'situation'
  | 'project_purpose'
  | 'project_status'
  | 'project_insights'
  | 'note'

/** ドキュメントタイプ別の半減期（日数） */
const HALF_LIFE_DAYS: Record<DocumentType, number> = {
  personality: 90,        // 性格はめったに変わらない
  purpose: 60,            // 目標は数ヶ月単位で見直し
  situation: 14,          // 状況は頻繁に変化
  project_purpose: 90,    // プロジェクト目的は安定
  project_status: 14,     // プロジェクト進捗は頻繁
  project_insights: 30,   // 重要な決定は中期的
  note: 30,               // カスタムノートのデフォルト
}

/**
 * 鮮度スコアを算出（0.0〜1.0）
 * 指数減衰: score = e^(-ln(2) * days / halfLife)
 */
export function calculateFreshnessScore(
  contentUpdatedAt: string | Date,
  freshnessReviewedAt: string | Date | null,
  documentType: string,
): number {
  const now = Date.now()
  const baseDate = freshnessReviewedAt
    ? new Date(freshnessReviewedAt).getTime()
    : new Date(contentUpdatedAt).getTime()

  const daysSinceUpdate = (now - baseDate) / (1000 * 60 * 60 * 24)
  const halfLife = HALF_LIFE_DAYS[documentType as DocumentType] || 30

  const score = Math.exp(-Math.LN2 * daysSinceUpdate / halfLife)
  return Math.max(0, Math.min(1, score))
}

/**
 * 鮮度スコアからステータスを判定
 */
export function getFreshnessStatus(score: number): FreshnessStatus {
  if (score >= 0.7) return 'fresh'
  if (score >= 0.3) return 'aging'
  return 'stale'
}

/**
 * 最終更新からの経過日数を算出
 */
export function daysSinceUpdate(
  contentUpdatedAt: string | Date,
  freshnessReviewedAt: string | Date | null,
): number {
  const baseDate = freshnessReviewedAt
    ? new Date(freshnessReviewedAt).getTime()
    : new Date(contentUpdatedAt).getTime()

  return Math.floor((Date.now() - baseDate) / (1000 * 60 * 60 * 24))
}

/**
 * AIプロンプト注入用: 古くなっているドキュメントのアラート文を生成
 */
export function buildFreshnessAlertForPrompt(
  documents: Array<{
    title: string
    content_updated_at: string
    freshness_reviewed_at: string | null
    document_type: string
  }>,
): string {
  const staleDocuments = documents.filter((d) => {
    const score = calculateFreshnessScore(
      d.content_updated_at,
      d.freshness_reviewed_at,
      d.document_type,
    )
    return getFreshnessStatus(score) === 'stale'
  })

  if (staleDocuments.length === 0) return ''

  const lines = staleDocuments.map((d) => {
    const days = daysSinceUpdate(d.content_updated_at, d.freshness_reviewed_at)
    return `- ${d.title}（${days}日前に更新）`
  })

  return `\n## 古くなっているコンテキスト\n以下の情報は最終更新から時間が経っています。会話の中で自然に最新状況を確認してください。\n${lines.join('\n')}`
}
