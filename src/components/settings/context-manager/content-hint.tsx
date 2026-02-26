'use client'

import { Lightbulb } from 'lucide-react'

const HINTS: Record<string, string[]> = {
  personality: [
    '働き方（フリーランス / 会社員 / 学生）',
    '生活リズム（朝型 / 夜型）',
    '性格の特徴（計画的 / 柔軟 / 慎重など）',
    'コミュニケーションの好み',
  ],
  purpose: [
    '短期目標（1-3ヶ月）',
    '中長期目標（半年〜1年）',
    '大事にしている価値観',
    '避けたいこと',
  ],
  situation: [
    '最近の出来事や変化',
    '今の悩みや課題',
    '仕事の状況',
    '気分やモチベーション',
  ],
  project_purpose: [
    '誰のどんな課題を解決するか',
    'プロジェクトのゴール',
    '差別化ポイント',
  ],
  project_status: [
    '現在のフェーズ',
    '直近でやっていること',
    'ブロッカーがあれば',
    '次のマイルストーン',
  ],
  project_insights: [
    '重要な技術選定とその理由',
    'プロダクト方針の決定事項',
    '失敗から得た教訓',
  ],
  note: [
    'AIに知っておいてほしいこと',
    '趣味、関心、スキルなど',
  ],
}

interface ContentHintProps {
  documentType: string
}

export function ContentHint({ documentType }: ContentHintProps) {
  const hints = HINTS[documentType] || HINTS.note

  return (
    <div className="bg-muted/50 rounded-lg p-3 text-xs text-muted-foreground">
      <div className="flex items-center gap-1.5 mb-2 font-medium">
        <Lightbulb className="w-3.5 h-3.5" />
        こんな内容を書くとAIが活用できます
      </div>
      <ul className="space-y-0.5 ml-5 list-disc">
        {hints.map((hint) => (
          <li key={hint}>{hint}</li>
        ))}
      </ul>
    </div>
  )
}
